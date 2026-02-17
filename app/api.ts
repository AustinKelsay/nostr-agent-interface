import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createManagedMcpClient } from "./mcp-client.js";

type ApiOptions = {
  host: string;
  port: number;
  showHelp: boolean;
};

type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

class ApiHttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function parsePort(value: string, sourceLabel: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port from ${sourceLabel}: ${value}`);
  }
  return parsed;
}

function printApiHelp() {
  console.log(`Usage:
  nostr-agent-interface api [--host <host>] [--port <port>]

Config precedence:
  1. CLI flags (--host, --port)
  2. Environment vars (NOSTR_AGENT_API_HOST, NOSTR_AGENT_API_PORT)
  3. Defaults (127.0.0.1:3030)`);
}

function parseApiOptions(args: string[]): ApiOptions {
  let host = process.env.NOSTR_AGENT_API_HOST?.trim() || "127.0.0.1";
  const envPort = process.env.NOSTR_AGENT_API_PORT?.trim() || "3030";
  let port = parsePort(envPort, "NOSTR_AGENT_API_PORT");

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = args[i + 1];

    if (arg === "--help" || arg === "-h") {
      return { host, port, showHelp: true };
    }

    if (arg === "--host" && value) {
      host = value;
      i += 1;
      continue;
    }

    if (arg === "--port" && value) {
      port = parsePort(value, "--port");
      i += 1;
      continue;
    }

    if (arg === "--host" || arg === "--port") {
      throw new Error(`Missing value for ${arg}`);
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return { host, port, showHelp: false };
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  requestId?: string,
) {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (requestId) {
    res.setHeader("x-request-id", requestId);
  }
  res.end(body);
}

function sendError(
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
) {
  const payload: ApiErrorPayload = {
    error: {
      code,
      message,
      ...(typeof details !== "undefined" ? { details } : {}),
      requestId,
    },
  };

  sendJson(res, statusCode, payload, requestId);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ApiHttpError(
      400,
      "invalid_json",
      "Request body must contain valid JSON.",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiHttpError(400, "invalid_request", "Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

export async function runApi(args: string[]): Promise<void> {
  const options = parseApiOptions(args);

  if (options.showHelp) {
    printApiHelp();
    return;
  }

  const managed = await createManagedMcpClient();

  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();

    try {
      const method = req.method ?? "GET";
      const requestUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? `${options.host}:${options.port}`}`,
      );

      if (method === "GET" && requestUrl.pathname === "/health") {
        sendJson(res, 200, {
          status: "ok",
          transport: "mcp-stdio",
        }, requestId);
        return;
      }

      if (method === "GET" && requestUrl.pathname === "/tools") {
        const tools = await managed.client.listTools();
        sendJson(res, 200, tools, requestId);
        return;
      }

      if (method === "POST" && requestUrl.pathname.startsWith("/tools/")) {
        const toolName = decodeURIComponent(requestUrl.pathname.replace("/tools/", ""));
        if (!toolName) {
          sendError(
            res,
            400,
            "invalid_request",
            "Missing tool name in path.",
            requestId,
          );
          return;
        }

        const argsPayload = await readJsonBody(req);
        const result = await managed.client.callTool({
          name: toolName,
          arguments: argsPayload,
        });

        sendJson(res, 200, result, requestId);
        return;
      }

      sendError(
        res,
        404,
        "not_found",
        "Route not found.",
        requestId,
        {
          endpoints: [
          "GET /health",
          "GET /tools",
          "POST /tools/:toolName",
          ],
        },
      );
    } catch (error) {
      if (error instanceof ApiHttpError) {
        sendError(res, error.statusCode, error.code, error.message, requestId, error.details);
        return;
      }

      sendError(
        res,
        500,
        "internal_error",
        error instanceof Error ? error.message : "Unknown server error.",
        requestId,
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      console.log(
        `Nostr Agent API listening at http://${options.host}:${options.port} (backed by MCP stdio)`,
      );
      resolve();
    });
  });

  const shutdown = async () => {
    await Promise.allSettled([
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
      managed.close(),
    ]);
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}
