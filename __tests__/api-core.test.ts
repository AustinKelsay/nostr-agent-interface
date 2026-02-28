import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

type MockState = {
  listToolsResponse: unknown;
  callToolResponse: unknown;
  callToolError?: Error;
};

const state: MockState = {
  listToolsResponse: {
    tools: [{ name: "convertNip19", description: "Convert NIP-19 entities" }],
  },
  callToolResponse: {
    content: [{ type: "text", text: "ok" }],
    isError: false,
  },
};

const listToolsMock = mock(async () => state.listToolsResponse);
const callToolMock = mock(async (_toolName: string, _args: Record<string, unknown>) => {
  if (state.callToolError) {
    throw state.callToolError;
  }
  return state.callToolResponse;
});
const closeMock = mock(async () => {});

const createToolRuntimeMock = mock(async () => {
  return {
    listTools: listToolsMock,
    callTool: callToolMock,
    close: closeMock,
  };
});

type RequestHandler = (req: any, res: any) => Promise<void>;

type FakeServer = {
  once: ReturnType<typeof mock>;
  listen: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
};

let latestRequestHandler: RequestHandler | undefined;
let latestServer: FakeServer | undefined;
let listenErrorForNextServer: Error | undefined;

const createServerMock = mock((handler: RequestHandler) => {
  latestRequestHandler = handler;
  const listeners = new Map<string, (...args: unknown[]) => void>();

  const server: FakeServer = {
    once: mock((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return server;
    }),
    listen: mock((_port: number, _host: string, callback?: () => void) => {
      if (listenErrorForNextServer) {
        const err = listenErrorForNextServer;
        listenErrorForNextServer = undefined;
        const errorListener = listeners.get("error");
        if (errorListener) {
          errorListener(err);
        } else {
          throw err;
        }
        return server;
      }

      if (callback) callback();
      return server;
    }),
    close: mock((callback?: () => void) => {
      if (callback) callback();
      return server;
    }),
  };

  latestServer = server;
  return server;
});

mock.module("node:http", () => ({
  default: {
    createServer: createServerMock,
  },
  createServer: createServerMock,
}));

mock.module("../app/tool-runtime.js", () => ({
  createInProcessToolRuntime: createToolRuntimeMock,
}));

import { runApi, sanitizeForAuditLogs, sanitizeHeadersForAuditLogs } from "../app/api.js";

type SignalHandlers = {
  SIGINT?: () => void;
  SIGTERM?: () => void;
};
let originalProcessExit: typeof process.exit;

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
  body: any;
  rawBody: string;
};

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

function interceptSignalRegistration(): { handlers: SignalHandlers; restore: () => void } {
  const handlers: SignalHandlers = {};
  const originalOnce = process.once;

  (process as any).once = function patchedOnce(event: string, listener: () => void) {
    if (event === "SIGINT" || event === "SIGTERM") {
      handlers[event] = listener;
      return this;
    }

    return originalOnce.call(this, event, listener);
  };

  return {
    handlers,
    restore: () => {
      (process as any).once = originalOnce;
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

async function invokeRequest(handler: RequestHandler, options: InvokeRequestOptions): Promise<InvokeResponse> {
  const method = options.method ?? "GET";
  const reqHeaders: Record<string, string | string[]> = {
    host: "127.0.0.1:3030",
    ...(options.headers ?? {}),
  };
  const bodyChunks = options.bodyChunks ?? [];

  const req = {
    method,
    url: options.path,
    headers: reqHeaders,
    socket: {
      remoteAddress: options.remoteAddress ?? "127.0.0.1",
    },
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

  await handler(req, res);

  if (!ended) {
    throw new Error("Expected response to be ended");
  }

  let body: any = null;
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
}

async function startApiHarness(config?: {
  args?: string[];
  env?: Record<string, string | undefined>;
}): Promise<{
  invoke: (options: InvokeRequestOptions) => Promise<InvokeResponse>;
  shutdown: (signal?: "SIGINT" | "SIGTERM") => Promise<void>;
}> {
  const restoreEnv = setEnv({
    NOSTR_AGENT_API_HOST: "127.0.0.1",
    NOSTR_AGENT_API_PORT: "3030",
    NOSTR_AGENT_API_KEY: undefined,
    NOSTR_AGENT_API_RATE_LIMIT_MAX: undefined,
    NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS: undefined,
    NOSTR_AGENT_API_AUDIT_LOG_ENABLED: "false",
    NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES: "false",
    NOSTR_AGENT_API_TRUST_PROXY: undefined,
    NOSTR_AGENT_API_MAX_BODY_BYTES: undefined,
    ...(config?.env ?? {}),
  });

  const { handlers, restore } = interceptSignalRegistration();

  try {
    await runApi(config?.args ?? []);
  } finally {
    restore();
    restoreEnv();
  }

  if (!latestRequestHandler || !latestServer) {
    throw new Error("API harness did not capture request handler");
  }

  const capturedHandler = latestRequestHandler;
  const closeStart = closeMock.mock.calls.length;

  return {
    invoke: (options: InvokeRequestOptions) => invokeRequest(capturedHandler, options),
    shutdown: async (signal = "SIGTERM") => {
      const shutdownHandler =
        (signal === "SIGINT" ? handlers.SIGINT : handlers.SIGTERM) ??
        handlers.SIGTERM ??
        handlers.SIGINT;
      if (!shutdownHandler) {
        return;
      }
      shutdownHandler();
      await waitFor(() => closeMock.mock.calls.length > closeStart);
    },
  };
}

beforeEach(() => {
  originalProcessExit = process.exit;
  (process as any).exit = (() => undefined) as any;

  state.listToolsResponse = {
    tools: [{ name: "convertNip19", description: "Convert NIP-19 entities" }],
  };
  state.callToolResponse = {
    content: [{ type: "text", text: "ok" }],
    isError: false,
  };
  state.callToolError = undefined;

  createToolRuntimeMock.mockClear();
  listToolsMock.mockClear();
  callToolMock.mockClear();
  closeMock.mockClear();
  createServerMock.mockClear();
  latestRequestHandler = undefined;
  latestServer = undefined;
  listenErrorForNextServer = undefined;
});

afterEach(() => {
  (process as any).exit = originalProcessExit;

  state.callToolError = undefined;
});

afterAll(() => {
  mock.restore();
});

describe("API sanitization", () => {
  test("sanitizeForAuditLogs redacts/truncates/circular-protects payloads", () => {
    const longValue = "x".repeat(700);
    const payload: any = {
      authorization: "Bearer secret",
      nested: {
        private_key: "nsec-secret",
      },
      blob: new Uint8Array([1, 2, 3]),
      huge: longValue,
      count: 3n,
      arr: [1, 2],
    };
    payload.self = payload;

    const sanitized = sanitizeForAuditLogs(payload) as Record<string, unknown>;

    expect(sanitized.authorization).toBe("[REDACTED]");
    expect((sanitized.nested as Record<string, unknown>).private_key).toBe("[REDACTED]");
    expect(sanitized.blob).toBe("[Uint8Array:3]");
    expect(sanitized.count).toBe("3");
    expect(sanitized.self).toBe("[CIRCULAR]");

    const huge = sanitized.huge as string;
    expect(huge.length).toBeGreaterThan(512);
    expect(huge.endsWith("[TRUNCATED]")).toBe(true);
  });

  test("sanitizeHeadersForAuditLogs redacts auth-like headers", () => {
    const headers = sanitizeHeadersForAuditLogs({
      authorization: "Bearer token",
      "x-api-key": "secret",
      "content-type": "application/json",
      "x-custom": ["one", "two"],
    });

    expect(headers.authorization).toBe("[REDACTED]");
    expect(headers["x-api-key"]).toBe("[REDACTED]");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-custom"]).toEqual(["one", "two"]);
  });
});

describe("runApi options", () => {
  test("supports --help without starting tool runtime", async () => {
    const originalLog = console.log;
    const output: string[] = [];

    console.log = (...args: unknown[]) => {
      output.push(args.join(" "));
    };

    try {
      await runApi(["--help"]);
    } finally {
      console.log = originalLog;
    }

    expect(output.join("\n")).toContain("Config precedence");
    expect(createToolRuntimeMock).not.toHaveBeenCalled();
  });

  test("validates argument and env parsing", async () => {
    await expect(runApi(["--unknown"]))
      .rejects.toThrow("Unknown option: --unknown");

    await expect(runApi(["--host"]))
      .rejects.toThrow("Missing value for --host");

    await expect(runApi(["--port", "-1"]))
      .rejects.toThrow("Invalid port from --port: -1");

    const restore = setEnv({ NOSTR_AGENT_API_AUDIT_LOG_ENABLED: "not-bool" });
    try {
      await expect(runApi([]))
        .rejects.toThrow("Invalid boolean from NOSTR_AGENT_API_AUDIT_LOG_ENABLED: not-bool");
    } finally {
      restore();
    }
  });

  test("rejects when server listen emits an error", async () => {
    listenErrorForNextServer = Object.assign(new Error("port already in use"), { code: "EADDRINUSE" });
    await expect(runApi([])).rejects.toThrow("port already in use");
  });
});

describe("runApi request handling", () => {
  test("serves health endpoints and list-tools with v1 aliases", async () => {
    const harness = await startApiHarness({
      env: {
        NOSTR_AGENT_API_RATE_LIMIT_MAX: "7",
        NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS: "9000",
      },
    });

    try {
      const health = await harness.invoke({ path: "/health" });
      expect(health.statusCode).toBe(200);
      expect(health.body?.status).toBe("ok");
      expect(health.body?.authRequired).toBe(false);
      expect(health.body?.rateLimit?.max).toBe(7);

      const v1Health = await harness.invoke({ path: "/v1/health" });
      expect(v1Health.statusCode).toBe(200);
      expect(v1Health.body?.transport).toBe("in-process");

      const tools = await harness.invoke({ path: "/tools" });
      const v1Tools = await harness.invoke({ path: "/v1/tools" });
      expect(tools.statusCode).toBe(200);
      expect(v1Tools.statusCode).toBe(200);
      expect(listToolsMock).toHaveBeenCalledTimes(2);
    } finally {
      await harness.shutdown();
    }
  });

  test("routes tool calls and parses bodies", async () => {
    const harness = await startApiHarness();

    try {
      await harness.invoke({
        method: "POST",
        path: "/tools/convertNip19",
        headers: { "content-type": "application/json" },
        bodyChunks: ['{"input":"abc","targetType":"npub"}'],
      });

      await harness.invoke({
        method: "POST",
        path: "/v1/tools/convertNip19",
        headers: { "content-type": "application/json" },
        bodyChunks: ["   "],
      });

      await harness.invoke({
        method: "POST",
        path: "/tools/space%20tool",
        headers: { "content-type": "application/json" },
      });

      expect(callToolMock).toHaveBeenNthCalledWith(1, "convertNip19", { input: "abc", targetType: "npub" });
      expect(callToolMock).toHaveBeenNthCalledWith(2, "convertNip19", {});
      expect(callToolMock).toHaveBeenNthCalledWith(3, "space tool", {});
    } finally {
      await harness.shutdown();
    }
  });

  test("returns structured errors for missing routes, invalid JSON, invalid body type, and missing tool", async () => {
    const harness = await startApiHarness();

    try {
      const notFound = await harness.invoke({ path: "/nope" });
      expect(notFound.statusCode).toBe(404);
      expect(notFound.body?.error?.code).toBe("not_found");
      expect(Array.isArray(notFound.body?.error?.details?.endpoints)).toBe(true);
      expect(notFound.headers["x-request-id"]).toBe(notFound.body?.error?.requestId);

      const invalidJson = await harness.invoke({
        method: "POST",
        path: "/tools/convertNip19",
        headers: { "content-type": "application/json" },
        bodyChunks: ["{bad"],
      });
      expect(invalidJson.statusCode).toBe(400);
      expect(invalidJson.body?.error?.code).toBe("invalid_json");

      const invalidType = await harness.invoke({
        method: "POST",
        path: "/tools/convertNip19",
        headers: { "content-type": "application/json" },
        bodyChunks: ["[]"],
      });
      expect(invalidType.statusCode).toBe(400);
      expect(invalidType.body?.error?.code).toBe("invalid_request");

      const missingTool = await harness.invoke({
        method: "POST",
        path: "/tools/",
        headers: { "content-type": "application/json" },
        bodyChunks: ["{}"],
      });
      expect(missingTool.statusCode).toBe(400);
      expect(missingTool.body?.error?.message).toContain("Missing tool name");
    } finally {
      await harness.shutdown();
    }
  });

  test("enforces API key auth and accepts x-api-key or bearer", async () => {
    const harness = await startApiHarness({
      env: {
        NOSTR_AGENT_API_KEY: "test-key",
      },
    });

    try {
      const unauthorized = await harness.invoke({ path: "/tools" });
      expect(unauthorized.statusCode).toBe(401);
      expect(unauthorized.body?.error?.code).toBe("unauthorized");

      const xApiKey = await harness.invoke({
        path: "/tools",
        headers: { "x-api-key": ["test-key", "ignored"] },
      });
      expect(xApiKey.statusCode).toBe(200);

      const bearer = await harness.invoke({
        path: "/tools",
        headers: { authorization: "Bearer test-key" },
      });
      expect(bearer.statusCode).toBe(200);

      const health = await harness.invoke({ path: "/health" });
      expect(health.statusCode).toBe(200);
      expect(health.body?.authRequired).toBe(true);
    } finally {
      await harness.shutdown();
    }
  });

  test("applies rate limits and trust-proxy identity behavior", async () => {
    const untrusted = await startApiHarness({
      env: {
        NOSTR_AGENT_API_RATE_LIMIT_MAX: "1",
        NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS: "60000",
        NOSTR_AGENT_API_TRUST_PROXY: "false",
      },
    });

    try {
      const first = await untrusted.invoke({
        path: "/tools",
        headers: { "x-forwarded-for": "1.1.1.1" },
        remoteAddress: "10.0.0.1",
      });
      const second = await untrusted.invoke({
        path: "/tools",
        headers: { "x-forwarded-for": "2.2.2.2" },
        remoteAddress: "10.0.0.1",
      });

      expect(first.statusCode).toBe(200);
      expect(first.headers["x-ratelimit-limit"]).toBe("1");
      expect(second.statusCode).toBe(429);
      expect(second.body?.error?.code).toBe("rate_limited");
      expect(second.headers["retry-after"]).toBeDefined();
    } finally {
      await untrusted.shutdown();
    }

    const trusted = await startApiHarness({
      env: {
        NOSTR_AGENT_API_RATE_LIMIT_MAX: "1",
        NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS: "60000",
        NOSTR_AGENT_API_TRUST_PROXY: "true",
      },
    });

    try {
      const first = await trusted.invoke({
        path: "/tools",
        headers: { "x-forwarded-for": "1.1.1.1" },
        remoteAddress: "10.0.0.1",
      });
      const second = await trusted.invoke({
        path: "/tools",
        headers: { "x-forwarded-for": "2.2.2.2" },
        remoteAddress: "10.0.0.1",
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);

      const openHealth = await trusted.invoke({ path: "/health" });
      expect(openHealth.headers["x-ratelimit-limit"]).toBeUndefined();
    } finally {
      await trusted.shutdown();
    }
  });

  test("enforces max body size and content-length validation", async () => {
    const harness = await startApiHarness({
      env: {
        NOSTR_AGENT_API_MAX_BODY_BYTES: "16",
      },
    });

    try {
      const invalidLength = await harness.invoke({
        method: "POST",
        path: "/tools/convertNip19",
        headers: {
          "content-type": "application/json",
          "content-length": "abc",
        },
        bodyChunks: ["{}"],
      });
      expect(invalidLength.statusCode).toBe(400);
      expect(invalidLength.body?.error?.code).toBe("invalid_request");

      const tooLargeByLength = await harness.invoke({
        method: "POST",
        path: "/tools/convertNip19",
        headers: {
          "content-type": "application/json",
          "content-length": "100",
        },
        bodyChunks: ["{}"],
      });
      expect(tooLargeByLength.statusCode).toBe(413);
      expect(tooLargeByLength.body?.error?.code).toBe("payload_too_large");
      expect(tooLargeByLength.body?.error?.details?.contentLength).toBe(100);

      const tooLargeByChunks = await harness.invoke({
        method: "POST",
        path: "/tools/convertNip19",
        headers: { "content-type": "application/json" },
        bodyChunks: ['{"x":"xxxxxxxxxxxxxxxxxxxxxxxx"}'],
      });
      expect(tooLargeByChunks.statusCode).toBe(413);
      expect(tooLargeByChunks.body?.error?.details?.receivedBytes).toBeGreaterThan(16);
    } finally {
      await harness.shutdown();
    }
  });

  test("maps unexpected tool runtime exceptions to internal_error", async () => {
    const harness = await startApiHarness();

    try {
      state.callToolError = new Error("tool exploded");
      const response = await harness.invoke({
        method: "POST",
        path: "/tools/convertNip19",
        headers: { "content-type": "application/json" },
        bodyChunks: ["{}"],
      });

      expect(response.statusCode).toBe(500);
      expect(response.body?.error?.code).toBe("internal_error");
      expect(response.body?.error?.message).toContain("tool exploded");
    } finally {
      await harness.shutdown();
    }
  });

  test("emits redacted audit logs when enabled", async () => {
    const output: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);

    (process.stdout as any).write = ((chunk: unknown, ...rest: unknown[]) => {
      output.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
      return (originalWrite as any)(chunk, ...rest);
    }) as typeof process.stdout.write;

    const harness = await startApiHarness({
      env: {
        NOSTR_AGENT_API_AUDIT_LOG_ENABLED: "true",
        NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES: "true",
      },
    });

    try {
      await harness.invoke({
        method: "POST",
        path: "/tools/convertNip19",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer top-secret",
        },
        bodyChunks: ['{"privateKey":"nsec-super-secret"}'],
      });

      const jsonLines = output
        .join("")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{") && line.endsWith("}"))
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));

      const requestLog = jsonLines.find((entry) => entry.event === "api.request");
      const responseLog = jsonLines.find((entry) => entry.event === "api.response");

      expect(requestLog).toBeDefined();
      expect(responseLog).toBeDefined();
      expect((requestLog?.headers as Record<string, unknown>).authorization).toBe("[REDACTED]");
      expect((responseLog?.requestBody as Record<string, unknown>).privateKey).toBe("[REDACTED]");
    } finally {
      await harness.shutdown();
      (process.stdout as any).write = originalWrite;
    }
  });

  test("supports SIGINT shutdown path", async () => {
    const harness = await startApiHarness();

    await harness.shutdown("SIGINT");
    expect(closeMock.mock.calls.length).toBeGreaterThan(0);
  });
});
