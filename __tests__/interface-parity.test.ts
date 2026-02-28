import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { runApi } from "../app/api.js";
import { runCli } from "../app/cli.js";

type RequestHandler = (req: any, res: any) => Promise<void>;

type InvokeRequestOptions = {
  method?: string;
  path: string;
  headers?: Record<string, string | string[]>;
  bodyChunks?: string[];
  remoteAddress?: string;
};

type InvokeResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
};

type FakeServer = {
  once: ReturnType<typeof mock>;
  listen: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
};

let latestRequestHandler: RequestHandler | undefined;

const signalHandlers = {
  SIGINT: undefined as (() => void) | undefined,
  SIGTERM: undefined as (() => void) | undefined,
};
const originalProcessOnce = process.once;
type ProcessOnce = NodeJS.Process["once"];

function createServerMock(handler: RequestHandler) {
  latestRequestHandler = handler;
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const server: FakeServer = {
    once: mock((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return server;
    }),
    listen: mock((_port: number, _host: string, callback?: () => void) => {
      if (callback) {
        callback();
      }
      return server;
    }),
    close: mock((callback?: () => void) => {
      if (callback) {
        callback();
      }
      return server;
    }),
  };

  return server;
}

mock.module("node:http", () => ({
  default: { createServer: createServerMock },
  createServer: createServerMock,
}));

function interceptSignals() {
  process.once = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "SIGINT" || event === "SIGTERM") {
      signalHandlers[event] = listener;
      return process as never;
    }

    return originalProcessOnce.call(process, event, listener as never) as never;
  }) as ProcessOnce;
}

function restoreSignals() {
  process.once = originalProcessOnce;
}

function setEnv(updates: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (typeof value === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function invokeRequest(handler: RequestHandler, options: InvokeRequestOptions): Promise<InvokeResponse> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    host: "127.0.0.1:3030",
    ...(options.headers ?? {}),
  };
  const bodyChunks = options.bodyChunks ?? [];
  const req = {
    method,
    url: options.path,
    headers,
    socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      for (const chunk of bodyChunks) {
        yield Buffer.from(chunk, "utf8");
      }
    },
  } as any;

  const responseHeaders: Record<string, string> = {};
  let ended = false;
  let rawBody = "";

  const res = {
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
    },
    end(payload?: unknown) {
      rawBody = typeof payload === "string" ? payload : payload ? String(payload) : "";
      ended = true;
    },
  } as any;

  await handler(req, res);
  if (!ended) {
    throw new Error("API handler did not terminate response");
  }

  try {
    return {
      statusCode: res.statusCode,
      headers: responseHeaders,
      body: rawBody ? JSON.parse(rawBody) : null,
      rawBody,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Expected JSON response, got: ${rawBody}`);
    }
    throw error;
  }
}

async function startApiHarness() {
  const restoreEnv = setEnv({
    NOSTR_AGENT_API_HOST: "127.0.0.1",
    NOSTR_AGENT_API_PORT: "3030",
    NOSTR_AGENT_API_RATE_LIMIT_MAX: "0",
    NOSTR_AGENT_API_AUDIT_LOG_ENABLED: "false",
    NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES: "false",
    NOSTR_AGENT_API_TRUST_PROXY: "false",
    NOSTR_AGENT_API_MAX_BODY_BYTES: "1048576",
  });
  interceptSignals();

  try {
    await runApi([]);
  } finally {
    restoreEnv();
  }

  if (!latestRequestHandler) {
    throw new Error("API handler not registered");
  }

  return {
    invoke: (options: InvokeRequestOptions) => invokeRequest(latestRequestHandler as RequestHandler, options),
    shutdown: async () => {
      restoreSignals();
      const handler = signalHandlers.SIGINT ?? signalHandlers.SIGTERM;
      if (!handler) return;
      handler();
      return;
    },
  };
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

async function runCliJson(args: string[]): Promise<unknown> {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };

  try {
    await runCli([...args, "--json"]);
    return parseJsonOutput(lines.join("\n"));
  } finally {
    console.log = originalLog;
  }
}

describe("Interface parity (CLI, API)", () => {
  let api: Awaited<ReturnType<typeof startApiHarness>> | undefined;

  beforeAll(async () => {
    api = await startApiHarness();
  });

  afterAll(async () => {
    await api?.shutdown();
  });

  test("lists the same tool names", async () => {
    if (!api) throw new Error("API harness not started");
    const cliTools = await runCliJson(["list-tools"]);
    const apiTools = (await api.invoke({ path: "/tools" })).body;

    const cliNames = ((cliTools as { tools?: unknown[] }).tools ?? [])
      .map((tool) => (tool as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
      .sort();
    const apiNames = ((apiTools as { tools?: unknown[] }).tools ?? [])
      .map((tool) => (tool as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
      .sort();

    expect(cliNames).toEqual(apiNames);
  });

  test("tool call behavior matches for deterministic validation paths", async () => {
    if (!api) throw new Error("API harness not started");

    const cases: Array<{
      toolName: string;
      args: Record<string, unknown>;
      useCallSubcommand?: boolean;
    }> = [
      { toolName: "convertNip19", args: { input: "not-a-valid-value", targetType: "npub" } },
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
      const apiResponse = await api.invoke({
        method: "POST",
        path: `/tools/${testCase.toolName}`,
        headers: { "content-type": "application/json" },
        bodyChunks: [JSON.stringify(testCase.args)],
      });

      const apiResult = apiResponse.body;
      const cliContent = getContent(cliResult);
      const apiContent = getContent(apiResult);

      expect(apiResponse.statusCode).toBe(200);
      expect(cliContent).toEqual(apiContent);
      expect((cliResult as { isError?: unknown }).isError === true)
        .toBe((apiResult as { isError?: unknown }).isError === true);
      expect(Array.isArray(cliContent)).toBe(true);
    }
  });
});

afterAll(() => {
  mock.restore();
});
