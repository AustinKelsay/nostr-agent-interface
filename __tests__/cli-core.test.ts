import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type MockTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

const COMPLEX_TOOL: MockTool = {
  name: "convertNip19",
  description: "Convert values between NIP-19 formats",
  inputSchema: {
    type: "object",
    required: ["input", "targetType"],
    properties: {
      input: { type: "string", description: "Input value" },
      targetType: { type: "string", enum: ["npub", "hex"], description: "Target type" },
      relays: { type: "array", description: "Relay list" },
      metadata: { type: "object", description: "Metadata object" },
      includeDeleted: { type: "boolean", description: "Include deleted" },
      limit: { type: "integer", description: "Max items" },
      weight: { type: "number", description: "Weight" },
      camelCaseField: { type: "string", description: "Camel case option" },
    },
  },
};

const PROFILE_TOOL: MockTool = {
  name: "getProfile",
  description: "Fetch profile",
  inputSchema: {
    type: "object",
    required: ["pubkey"],
    properties: {
      pubkey: { type: "string", description: "Public key" },
    },
  },
};

type MockState = {
  listToolsResponse: unknown;
  callToolResponse: unknown;
  callToolError?: Error;
  createClientError?: Error;
};

const state: MockState = {
  listToolsResponse: { tools: [COMPLEX_TOOL, PROFILE_TOOL] },
  callToolResponse: {
    content: [{ type: "text", text: "ok" }],
    isError: false,
  },
};

const listToolsMock = mock(async () => state.listToolsResponse);
const callToolMock = mock(async (request: unknown) => {
  if (state.callToolError) {
    throw state.callToolError;
  }
  return state.callToolResponse;
});
const closeMock = mock(async () => {});

const createManagedMcpClientMock = mock(async () => {
  if (state.createClientError) {
    throw state.createClientError;
  }

  return {
    client: {
      listTools: listToolsMock,
      callTool: callToolMock,
    },
    close: closeMock,
  };
});

mock.module("../app/mcp-client.js", () => ({
  createManagedMcpClient: createManagedMcpClientMock,
}));

import { runCli } from "../app/cli.js";

async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const originalLog = console.log;
  const lines: string[] = [];

  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    const result = await fn();
    return { result, output: lines.join("\n") };
  } finally {
    console.log = originalLog;
  }
}

async function withFakeStdin<T>(
  rawInput: string,
  isTTY: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  const stdin = process.stdin as any;
  const originalIterator = stdin[Symbol.asyncIterator];
  const originalIsTTY = stdin.isTTY;

  Object.defineProperty(stdin, "isTTY", {
    value: isTTY,
    configurable: true,
  });

  stdin[Symbol.asyncIterator] = async function* () {
    if (rawInput.length > 0) {
      yield Buffer.from(rawInput, "utf8");
    }
  };

  try {
    return await fn();
  } finally {
    Object.defineProperty(stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    stdin[Symbol.asyncIterator] = originalIterator;
  }
}

beforeEach(() => {
  state.listToolsResponse = { tools: [COMPLEX_TOOL, PROFILE_TOOL] };
  state.callToolResponse = {
    content: [{ type: "text", text: "ok" }],
    isError: false,
  };
  state.callToolError = undefined;
  state.createClientError = undefined;

  createManagedMcpClientMock.mockClear();
  listToolsMock.mockClear();
  callToolMock.mockClear();
  closeMock.mockClear();
});

afterEach(() => {
  state.callToolError = undefined;
  state.createClientError = undefined;
});

afterAll(() => {
  mock.restore();
});

describe("runCli core behavior", () => {
  test("prints top-level help when no command is provided", async () => {
    const { result, output } = await captureStdout(() => runCli([]));

    expect(result).toBe(0);
    expect(output).toContain("Nostr Agent CLI");
    expect(createManagedMcpClientMock).not.toHaveBeenCalled();
  });

  test("prints top-level help for explicit help aliases", async () => {
    const helpCommand = await captureStdout(() => runCli(["help"]));
    expect(helpCommand.result).toBe(0);
    expect(helpCommand.output).toContain("Usage:");

    const helpFlag = await captureStdout(() => runCli(["--help"]));
    expect(helpFlag.result).toBe(0);
    expect(helpFlag.output).toContain("Commands:");
  });

  test("list-tools supports --help and blocks --stdin", async () => {
    const help = await captureStdout(() => runCli(["list-tools", "--help"]));
    expect(help.result).toBe(0);
    expect(help.output).toContain("Usage:");

    await expect(runCli(["list-tools", "--stdin"])).rejects.toThrow(
      "--stdin is only supported for cli call",
    );
  });

  test("list-tools renders plain output and json output", async () => {
    const plain = await captureStdout(() => runCli(["list-tools"]));
    expect(plain.result).toBe(0);
    expect(plain.output).toContain("convertNip19\tConvert values between NIP-19 formats");
    expect(plain.output).toContain("getProfile\tFetch profile");

    const asJson = await captureStdout(() => runCli(["list-tools", "--json"]));
    expect(asJson.result).toBe(0);
    expect(asJson.output).toContain('"tools"');
  });

  test("list-tools validates usage and tolerates malformed list responses", async () => {
    await expect(runCli(["list-tools", "extra"])).rejects.toThrow("Usage: cli list-tools [--json]");

    state.listToolsResponse = null;
    const nullResponse = await captureStdout(() => runCli(["list-tools"]));
    expect(nullResponse.result).toBe(0);
    expect(nullResponse.output).toBe("");

    state.listToolsResponse = { tools: { bad: true } };
    const nonArrayTools = await captureStdout(() => runCli(["list-tools"]));
    expect(nonArrayTools.result).toBe(0);
    expect(nonArrayTools.output).toBe("");

    state.listToolsResponse = {
      tools: [null, { name: 123 }, { name: "validTool", description: "works" }],
    };
    const filtered = await captureStdout(() => runCli(["list-tools"]));
    expect(filtered.result).toBe(0);
    expect(filtered.output).toContain("validTool\tworks");
  });

  test("call subcommand supports --help and rejects unknown flags", async () => {
    const help = await captureStdout(() => runCli(["call", "--help"]));
    expect(help.result).toBe(0);
    expect(help.output).toContain("Examples:");
    expect(help.output).toContain("--stdin");

    await expect(runCli(["call", "--nope"])).rejects.toThrow("Unknown option: --nope");
  });

  test("call command validates usage and argument shape", async () => {
    await expect(runCli(["call"])).rejects.toThrow("Missing tool name");
    await expect(runCli(["call", "convertNip19", "{}", "extra"]))
      .rejects.toThrow("Too many positional arguments");
    await expect(runCli(["call", "convertNip19", "{}", "--stdin"]))
      .rejects.toThrow("Provide args either as jsonArgs or with --stdin, not both");
    await expect(runCli(["call", "convertNip19", "[]"]))
      .rejects.toThrow("Tool args must be a JSON object");
  });

  test("call command handles text rendering, json rendering, and error return code", async () => {
    state.callToolResponse = {
      content: [
        { type: "text", text: "line one" },
        { type: "json", value: { ok: true } },
      ],
      isError: false,
    };

    const rendered = await captureStdout(() => runCli(["call", "convertNip19", "{}"]));
    expect(rendered.result).toBe(0);
    expect(rendered.output).toContain("line one");
    expect(rendered.output).toContain('"type": "json"');

    state.callToolResponse = { content: [], isError: true };
    const asJson = await captureStdout(() => runCli(["call", "convertNip19", "{}", "--json"]));
    expect(asJson.result).toBe(1);
    expect(asJson.output).toContain('"isError": true');
  });

  test("call command supports omitted args and fallback rendering when content is absent", async () => {
    state.callToolResponse = { isError: false };
    const rendered = await captureStdout(() => runCli(["call", "convertNip19"]));
    expect(rendered.result).toBe(0);
    expect(rendered.output).toContain('"isError": false');

    expect(callToolMock).toHaveBeenCalledWith({
      name: "convertNip19",
      arguments: {},
    });
  });

  test("direct tool command handles unknown tool and help output", async () => {
    await expect(runCli(["not-a-tool"])).rejects.toThrow("Unknown command or tool");

    const help = await captureStdout(() => runCli(["convertNip19", "--help"]));
    expect(help.result).toBe(0);
    expect(help.output).toContain("Tool options:");
    expect(help.output).toContain("--target-type");
    expect(help.output).toContain("--camel-case-field");
    expect(help.output).toContain("(required)");
    expect(help.output).toContain("<npub|hex>");
    expect(help.output).toContain("<json>");
    expect(help.output).toContain("[true|false]");
    expect(help.output).toContain("<int>");
    expect(help.output).toContain("<number>");
  });

  test("direct tool command parses typed schema-aware flags", async () => {
    await runCli([
      "convertNip19",
      "--input",
      "abc",
      "--target-type",
      "npub",
      "--relays",
      '["wss://relay.one"]',
      "--metadata",
      '{"env":"test"}',
      "--include-deleted",
      "--limit",
      "5",
      "--weight",
      "1.5",
      "--camel-case-field",
      "camel",
    ]);

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(callToolMock).toHaveBeenCalledWith({
      name: "convertNip19",
      arguments: {
        input: "abc",
        targetType: "npub",
        relays: ["wss://relay.one"],
        metadata: { env: "test" },
        includeDeleted: true,
        limit: 5,
        weight: 1.5,
        camelCaseField: "camel",
      },
    });
  });

  test("direct tool command supports positional json args and --json flag", async () => {
    const asPositional = await captureStdout(() =>
      runCli(["convertNip19", '{"input":"abc","targetType":"npub"}']),
    );
    expect(asPositional.result).toBe(0);
    expect(callToolMock).toHaveBeenLastCalledWith({
      name: "convertNip19",
      arguments: { input: "abc", targetType: "npub" },
    });

    const asJson = await captureStdout(() =>
      runCli(["convertNip19", "--input", "abc", "--target-type", "npub", "--json"]),
    );
    expect(asJson.result).toBe(0);
    expect(asJson.output).toContain('"content"');
  });

  test("direct tool command validates required and rejects invalid option formats", async () => {
    await expect(runCli(["convertNip19", "--input", "abc"]))
      .rejects.toThrow("Missing required options for convertNip19: --target-type");

    await expect(runCli(["convertNip19", "--input", "abc", "--target-type", "bad"]))
      .rejects.toThrow("Invalid value for --target-type");

    await expect(runCli(["convertNip19", "--input", "abc", "--target-type", "npub", "--limit", "1.2"]))
      .rejects.toThrow("Invalid integer for --limit: 1.2");

    await expect(runCli(["convertNip19", "--input", "abc", "--target-type", "npub", "--relays", "not-json"]))
      .rejects.toThrow("Invalid JSON for --relays");

    await expect(runCli(["convertNip19", "--input", "abc", "--target-type", "npub", "--relays", "{}"]))
      .rejects.toThrow("Expected JSON array for --relays");

    await expect(runCli(["convertNip19", "--input", "abc", "--target-type", "npub", "--metadata", "[]"]))
      .rejects.toThrow("Expected JSON object for --metadata");

    await expect(runCli(["convertNip19", "--input", "abc", "--target-type", "npub", "--weight", "NaN"]))
      .rejects.toThrow("Invalid number for --weight: NaN");

    await expect(runCli(["convertNip19", "--input", "abc", "--target-type", "npub", "--include-deleted", "maybe"]))
      .rejects.toThrow("Invalid boolean for --include-deleted");

    await expect(runCli(["convertNip19", "-x"]))
      .rejects.toThrow("Unknown option: -x");

    await expect(runCli(["convertNip19", "--nope", "x"]))
      .rejects.toThrow("Unknown option for convertNip19: --nope");

    await expect(runCli(["convertNip19", "--input"]))
      .rejects.toThrow("Missing value for --input");
  });

  test("direct tool command enforces arg mode exclusivity", async () => {
    await expect(runCli(["convertNip19", "{}", "extra"]))
      .rejects.toThrow("Too many positional arguments for convertNip19");

    await expect(runCli(["convertNip19", "{}", "--input", "abc"]))
      .rejects.toThrow("Provide args as JSON, --stdin, or field options (not a mix)");

    await expect(runCli(["convertNip19", "--stdin", "--input", "abc"]))
      .rejects.toThrow("Cannot combine --stdin with individual tool options");

    await expect(runCli(["convertNip19", "--input", "abc", "--stdin"]))
      .rejects.toThrow("Cannot combine --stdin with individual tool options");
  });

  test("stdin mode handles tty errors, empty input, and json input", async () => {
    await withFakeStdin("", true, async () => {
      await expect(runCli(["convertNip19", "--stdin"]))
        .rejects.toThrow("--stdin requires piped input");
    });

    await withFakeStdin("", false, async () => {
      await runCli(["call", "convertNip19", "--stdin"]);
      expect(callToolMock).toHaveBeenLastCalledWith({
        name: "convertNip19",
        arguments: {},
      });
    });

    await withFakeStdin('{"input":"abc","targetType":"npub"}', false, async () => {
      await runCli(["convertNip19", "--stdin"]);
      expect(callToolMock).toHaveBeenLastCalledWith({
        name: "convertNip19",
        arguments: { input: "abc", targetType: "npub" },
      });
    });
  });

  test("always closes MCP client even when callTool throws", async () => {
    state.callToolError = new Error("tool failed");

    await expect(runCli(["call", "convertNip19", "{}"]))
      .rejects.toThrow("tool failed");

    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  test("handles tools with unusual or missing schema metadata", async () => {
    state.listToolsResponse = {
      tools: [
        {
          name: "arrayTypedTool",
          description: "Array schema type checks",
          inputSchema: {
            type: "object",
            properties: {
              alias: { type: ["null", "string"], description: "type array that resolves to string" },
              passthrough: { type: ["null", "bogus"], description: "type array with no known type" },
            },
          },
        },
        {
          name: "badSchemaTool",
          description: "Bad schema shape",
          inputSchema: [],
        },
      ],
    };

    await runCli(["arrayTypedTool", "--alias", "ok", "--passthrough", "raw"]);
    expect(callToolMock).toHaveBeenLastCalledWith({
      name: "arrayTypedTool",
      arguments: {
        alias: "ok",
        passthrough: "raw",
      },
    });

    const help = await captureStdout(() => runCli(["badSchemaTool", "--help"]));
    expect(help.result).toBe(0);
    expect(help.output).toContain("Common options:");

    await runCli(["badSchemaTool"]);
    expect(callToolMock).toHaveBeenLastCalledWith({
      name: "badSchemaTool",
      arguments: {},
    });
  });
});
