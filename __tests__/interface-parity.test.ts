import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
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
  const built = path.resolve(process.cwd(), "build/app/index.js");
  if (await Bun.file(built).exists()) {
    return built;
  }

  return path.resolve(process.cwd(), "app/index.ts");
}

async function startApiHarness() {
  type RequestHandler = (req: any, res: any) => Promise<void> | void;

  const handlers: { SIGINT?: () => void; SIGTERM?: () => void } = {};
  const originalOnce = process.once;
  (process as any).once = function patchedOnce(event: string, listener: () => void) {
    if (event === "SIGINT" || event === "SIGTERM") {
      handlers[event] = listener;
      return this;
    }
    return originalOnce.call(this, event, listener);
  };

  let latestRequestHandler: RequestHandler | undefined;
  const createServerMock = mock((handler: RequestHandler) => {
    latestRequestHandler = handler;
    return {
      once: (_event: string, _listener: (...args: unknown[]) => void) => undefined,
      listen: (_port: number, _host: string, callback?: () => void) => {
        if (callback) callback();
      },
      close: (callback?: () => void) => {
        if (callback) callback();
      },
    };
  });

  mock.module("node:http", () => ({
    default: { createServer: createServerMock },
    createServer: createServerMock,
  }));

  try {
    const apiModule = await import("../app/api.js?interface-parity-api");
    await apiModule.runApi([]);
  } finally {
    (process as any).once = originalOnce;
  }

  if (!latestRequestHandler) {
    throw new Error("API harness did not capture request handler");
  }

  const capturedHandler = latestRequestHandler;

  return {
    invoke: async (options: InvokeRequestOptions): Promise<InvokeResponse> => {
      const reqHeaders: Record<string, string | string[]> = {
        host: "127.0.0.1:3030",
        ...(options.headers ?? {}),
      };
      const bodyChunks = options.bodyChunks ?? [];

      const req = {
        method: options.method ?? "GET",
        url: options.path,
        headers: reqHeaders,
        socket: { remoteAddress: "127.0.0.1" },
        async *[Symbol.asyncIterator]() {
          for (const chunk of bodyChunks) {
            yield Buffer.from(chunk, "utf8");
          }
        },
      } as any;

      let ended = false;
      let rawBody = "";
      const headers: Record<string, string> = {};

      const res = {
        statusCode: 200,
        setHeader(name: string, value: unknown) {
          headers[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
        },
        end(payload?: unknown) {
          rawBody = typeof payload === "string" ? payload : payload ? String(payload) : "";
          ended = true;
        },
      } as any;

      await capturedHandler(req, res);
      if (!ended) {
        throw new Error("Expected response to be ended");
      }

      let body: unknown = null;
      try {
        body = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        body = null;
      }

      return {
        statusCode: res.statusCode,
        headers,
        body,
        rawBody,
      };
    },

    shutdown: async () => {
      const shutdownHandler = handlers.SIGTERM ?? handlers.SIGINT;
      if (!shutdownHandler) {
        return;
      }

      const originalProcessExit = process.exit;
      process.exit = ((..._args: unknown[]) => undefined) as NodeJS.Process["exit"];
      try {
        shutdownHandler();
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
