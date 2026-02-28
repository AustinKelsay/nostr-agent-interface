import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { createManagedMcpClient } from "../app/mcp-client.js";

type InvokeRequestOptions = {
  method?: string;
  path: string;
  headers?: Record<string, string | string[]>;
  bodyChunks?: string[];
};

type InvokeResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
};

type TransportResult = {
  statusCode: number;
  body: unknown;
};

const signalHandlers = {
  SIGINT: undefined as (() => Promise<void> | void) | undefined,
  SIGTERM: undefined as (() => Promise<void> | void) | undefined,
};

async function resolveNodeCommand(): Promise<string> {
  return (await Bun.which("node")) ?? process.execPath;
}

async function resolveCliEntry(): Promise<string> {
  const built = path.resolve(process.cwd(), "build/app/index.js");
  if (await Bun.file(built).exists()) {
    return built;
  }

  return path.resolve(process.cwd(), "app/index.ts");
}

async function resolveMcpEntry(): Promise<string> {
  const built = path.resolve(process.cwd(), "build/index.js");
  if (await Bun.file(built).exists()) {
    return built;
  }

  return path.resolve(process.cwd(), "app/index.ts");
}

async function resolveToolRuntimeEntry(): Promise<string> {
  const builtRuntime = path.resolve(process.cwd(), "build/app/tool-runtime.js");
  if (await Bun.file(builtRuntime).exists()) {
    return builtRuntime;
  }

  const sourceRuntime = path.resolve(process.cwd(), "app/tool-runtime.js");
  return `${sourceRuntime}?interface-parity-runtime`;
}

async function startApiHarness() {
  const runtimeEntry = await resolveToolRuntimeEntry();
  const runtimeModule = await import(runtimeEntry as string);
  const toolRuntime = await runtimeModule.createInProcessToolRuntime();

  const parseBody = (options: InvokeRequestOptions): Record<string, unknown> => {
    const bodyChunks = options.bodyChunks ?? [];
    if (bodyChunks.length === 0) {
      return {};
    }

    const rawBody = bodyChunks.join("");
    if (!rawBody.trim()) {
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error(`Expected JSON body object: ${rawBody}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Expected JSON body object, got ${typeof parsed}`);
    }

    return parsed as Record<string, unknown>;
  };

  const invokeResponse = (statusCode: number, payload: unknown): InvokeResponse => {
    const rawBody = JSON.stringify(payload);
    return {
      statusCode,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: statusCode === 204 ? null : payload,
      rawBody,
    };
  };

  signalHandlers.SIGINT = async () => {
    await toolRuntime.close();
  };
  signalHandlers.SIGTERM = async () => {
    await toolRuntime.close();
  };

  return {
    invoke: async (options: InvokeRequestOptions): Promise<InvokeResponse> => {
      try {
        const method = options.method ?? "GET";
        const normalizedPath = options.path.replace(/^\/v1(?=\/|$)/, "") || "/";

        if (method === "GET" && normalizedPath === "/tools") {
          const tools = await toolRuntime.listTools();
          return invokeResponse(200, tools);
        }

        if (method === "POST" && normalizedPath.startsWith("/tools/")) {
          const toolName = decodeURIComponent(normalizedPath.replace("/tools/", ""));
          if (!toolName) {
            return invokeResponse(400, {
              error: {
                code: "invalid_request",
                message: "Missing tool name in path.",
                requestId: "local",
              },
            });
          }

          const args = parseBody(options);
          const result = await toolRuntime.callTool(toolName, args);
          return invokeResponse(200, result);
        }

        return invokeResponse(404, {
          error: {
            code: "not_found",
            message: "Route not found.",
            requestId: "local",
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return invokeResponse(500, {
          error: {
            code: "internal_error",
            message,
            requestId: "local",
          },
        });
      }
    },

    shutdown: async () => {
      const handler = signalHandlers.SIGINT ?? signalHandlers.SIGTERM;
      if (!handler) {
        return;
      }

      const originalProcessExit = process.exit;
      process.exit = ((..._args: unknown[]) => undefined) as NodeJS.Process["exit"];

      try {
        await handler();
      } finally {
        process.exit = originalProcessExit;
      }
    },
  };
}

type McpHarness = {
  listTools: () => Promise<TransportResult>;
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<TransportResult>;
  close: () => Promise<void>;
};

async function startMcpHarness(): Promise<McpHarness> {
  const nodeCommand = await resolveNodeCommand();
  const mcpEntry = await resolveMcpEntry();
  const serverProcess = {
    command: nodeCommand,
    args: [mcpEntry, "mcp"],
    cwd: process.cwd(),
    stderr: "pipe" as const,
  };

  const managed = await createManagedMcpClient(serverProcess, {
    stderrWriter: () => {},
  });

  return {
    listTools: async () => {
      const body = await managed.client.listTools();
      return { statusCode: 200, body };
    },
    callTool: (toolName: string, args: Record<string, unknown>) =>
      managed.client.callTool({ name: toolName, arguments: args }).then((body) => ({ statusCode: 200, body })),
    close: async () => managed.close(),
  };
}

function isErrorResult(response: unknown): boolean {
  return (response as { isError?: unknown }).isError === true;
}

function getContent(response: unknown): unknown[] {
  if (response && typeof response === "object" && Array.isArray((response as { content?: unknown[] }).content)) {
    return (response as { content?: unknown[] }).content ?? [];
  }
  return [];
}

function parseJsonOutput<T>(output: string): T {
  return JSON.parse(output);
}

async function runCliJson(args: string[]): Promise<TransportResult> {
  const cliEntry = await resolveCliEntry();
  const command = await resolveNodeCommand();
  const proc = Bun.spawn({
    cmd: [command, cliEntry, "cli", ...args, "--json"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NOSTR_JSON_ONLY: "true",
    },
  });

  const [stdout, stderrOutput] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  const trimmedOutput = stdout.trim();

  if (!trimmedOutput) {
    if (exitCode !== 0 && stderrOutput.trim()) {
      throw new Error(stderrOutput.trim());
    }

    throw new Error("Expected JSON output from CLI process, but output was empty");
  }

  const parsed = parseJsonOutput(trimmedOutput);
  return { statusCode: exitCode, body: parsed };
}

describe("Interface parity (CLI, API)", () => {
  let api: Awaited<ReturnType<typeof startApiHarness>> | undefined;
  let mcp: Awaited<ReturnType<typeof startMcpHarness>> | undefined;

  beforeAll(async () => {
    api = await startApiHarness();
    mcp = await startMcpHarness();
  });

  afterAll(async () => {
    await api?.shutdown();
    await mcp?.close();
  });

  test("lists the same tool names", async () => {
    if (!api) throw new Error("API harness not started");
    if (!mcp) throw new Error("MCP harness not started");

    const cliTools = await runCliJson(["list-tools"]);
    const apiResponse = await api.invoke({ path: "/tools" });
    const mcpTools = await mcp.listTools();

    const cliPayload = cliTools.body as { tools?: unknown[] } | undefined;
    const apiPayload = apiResponse.body as { tools?: unknown[] } | undefined;
    const mcpPayload = mcpTools.body as { tools?: unknown[] } | undefined;

    const cliNames = (cliPayload?.tools ?? [])
      .map((tool) => (tool as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
      .sort();
    const apiNames = (apiPayload?.tools ?? [])
      .map((tool) => (tool as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
      .sort();
    const mcpNames = (mcpPayload?.tools ?? [])
      .map((tool) => (tool as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
      .sort();

    expect(cliTools.statusCode).toBe(0);
    expect(apiResponse.statusCode).toBe(200);
    expect(mcpTools.statusCode).toBe(200);
    expect(cliNames).toEqual(apiNames);
    expect(cliNames).toEqual(mcpNames);
  });

  test("tool call behavior matches for deterministic validation paths", async () => {
    if (!api) throw new Error("API harness not started");
    if (!mcp) throw new Error("MCP harness not started");

    const cases: Array<{
      toolName: string;
      args: Record<string, unknown>;
      useCallSubcommand?: boolean;
    }> = [
      { toolName: "convertNip19", args: { input: "not-a-valid-value", targetType: "npub" } },
      {
        toolName: "convertNip19",
        args: {
          input:
            "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e",
          targetType: "npub",
        },
      },
      {
        toolName: "postNote",
        args: { privateKey: "invalid", content: "test" },
        useCallSubcommand: true,
      },
    ];

    for (const testCase of cases) {
      const cliArgs = testCase.useCallSubcommand
        ? ["call", testCase.toolName, JSON.stringify(testCase.args)]
        : [testCase.toolName, JSON.stringify(testCase.args)];

      const cliResult = await runCliJson(cliArgs);
      expect(cliResult.statusCode).toBe(0);
      const apiResponse = await api.invoke({
        method: "POST",
        path: `/tools/${testCase.toolName}`,
        headers: { "content-type": "application/json" },
        bodyChunks: [JSON.stringify(testCase.args)],
      });
      const mcpResult = await mcp.callTool(testCase.toolName, testCase.args);

      const cliContent = getContent(cliResult.body);
      const apiContent = getContent(apiResponse.body);
      const mcpContent = getContent(mcpResult.body);
      const cliIsError = isErrorResult(cliResult.body);
      const apiIsError = isErrorResult(apiResponse.body);
      const mcpIsError = isErrorResult(mcpResult.body);

      expect(apiResponse.statusCode).toBe(200);
      expect(mcpResult.statusCode).toBe(200);
      expect(cliContent).toEqual(apiContent);
      expect(cliContent).toEqual(mcpContent);
      expect(cliIsError).toBe(apiIsError);
      expect(cliIsError).toBe(mcpIsError);
      expect(Array.isArray(cliContent)).toBe(true);
      expect(Array.isArray(apiContent)).toBe(true);
      expect(Array.isArray(mcpContent)).toBe(true);
    }
  });
});
