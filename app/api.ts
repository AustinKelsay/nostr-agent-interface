import { randomUUID } from "node:crypto";
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createInProcessToolRuntime } from "./tool-runtime.js";

type ApiOptions = {
  host: string;
  port: number;
  showHelp: boolean;
  apiKey?: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  auditLogEnabled: boolean;
  auditLogIncludeBodies: boolean;
  trustProxy: boolean;
  maxBodyBytes: number;
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

const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const SENSITIVE_KEY_HINTS = [
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "privatekey",
  "apikey",
  "nsec",
];
const MAX_AUDIT_DEPTH = 6;
const MAX_AUDIT_OBJECT_KEYS = 50;
const MAX_AUDIT_ARRAY_ITEMS = 50;
const MAX_AUDIT_STRING_LENGTH = 512;
const API_V1_PREFIX = "/v1";
const API_ENDPOINTS = [
  "GET /health",
  "GET /tools",
  "POST /tools/:toolName",
  "GET /v1/health",
  "GET /v1/tools",
  "POST /v1/tools/:toolName",
];

function parsePort(value: string, sourceLabel: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port from ${sourceLabel}: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, sourceLabel: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer from ${sourceLabel}: ${value}`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, sourceLabel: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer from ${sourceLabel}: ${value}`);
  }
  return parsed;
}

function parseBoolean(value: string, sourceLabel: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean from ${sourceLabel}: ${value}`);
}

function printApiHelp() {
  console.log(`Usage:
  nostr-agent-interface api [--host <host>] [--port <port>]

Config precedence:
  1. CLI flags (--host, --port)
  2. Environment vars (NOSTR_AGENT_API_HOST, NOSTR_AGENT_API_PORT, NOSTR_AGENT_API_KEY, NOSTR_AGENT_API_RATE_LIMIT_MAX, NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS, NOSTR_AGENT_API_AUDIT_LOG_ENABLED, NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES, NOSTR_AGENT_API_TRUST_PROXY, NOSTR_AGENT_API_MAX_BODY_BYTES)
  3. Defaults (127.0.0.1:3030)`);
}

function parseApiOptions(args: string[]): ApiOptions {
  let host = process.env.NOSTR_AGENT_API_HOST?.trim() || "127.0.0.1";
  const envPort = process.env.NOSTR_AGENT_API_PORT?.trim() || "3030";
  let port = parsePort(envPort, "NOSTR_AGENT_API_PORT");
  const apiKey = process.env.NOSTR_AGENT_API_KEY?.trim() || undefined;
  const rateLimitMax = parseNonNegativeInteger(
    process.env.NOSTR_AGENT_API_RATE_LIMIT_MAX?.trim() || "120",
    "NOSTR_AGENT_API_RATE_LIMIT_MAX",
  );
  const rateLimitWindowMs = parsePositiveInteger(
    process.env.NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS?.trim() || "60000",
    "NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS",
  );
  const auditLogEnabled = parseBoolean(
    process.env.NOSTR_AGENT_API_AUDIT_LOG_ENABLED?.trim() || "true",
    "NOSTR_AGENT_API_AUDIT_LOG_ENABLED",
  );
  const auditLogIncludeBodies = parseBoolean(
    process.env.NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES?.trim() || "true",
    "NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES",
  );
  const trustProxy = parseBoolean(
    process.env.NOSTR_AGENT_API_TRUST_PROXY?.trim() || "false",
    "NOSTR_AGENT_API_TRUST_PROXY",
  );
  const maxBodyBytes = parsePositiveInteger(
    process.env.NOSTR_AGENT_API_MAX_BODY_BYTES?.trim() || "1048576",
    "NOSTR_AGENT_API_MAX_BODY_BYTES",
  );

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = args[i + 1];

    if (arg === "--help" || arg === "-h") {
      return {
        host,
        port,
        showHelp: true,
        apiKey,
        rateLimitMax,
        rateLimitWindowMs,
        auditLogEnabled,
        auditLogIncludeBodies,
        trustProxy,
        maxBodyBytes,
      };
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

  return {
    host,
    port,
    showHelp: false,
    apiKey,
    rateLimitMax,
    rateLimitWindowMs,
    auditLogEnabled,
    auditLogIncludeBodies,
    trustProxy,
    maxBodyBytes,
  };
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

async function readJsonBody(
  req: IncomingMessage,
  maxBodyBytes: number,
): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  const contentLengthHeader = getHeaderValue(req.headers["content-length"])?.trim();
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new ApiHttpError(
        400,
        "invalid_request",
        "Invalid content-length header.",
      );
    }
    if (contentLength > maxBodyBytes) {
      throw new ApiHttpError(
        413,
        "payload_too_large",
        `Request body exceeds maximum size of ${maxBodyBytes} bytes.`,
        {
          maxBodyBytes,
          contentLength,
        },
      );
    }
  }

  let totalBytes = 0;

  for await (const chunk of req) {
    const normalized = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += normalized.byteLength;
    if (totalBytes > maxBodyBytes) {
      throw new ApiHttpError(
        413,
        "payload_too_large",
        `Request body exceeds maximum size of ${maxBodyBytes} bytes.`,
        {
          maxBodyBytes,
          receivedBytes: totalBytes,
        },
      );
    }
    chunks.push(normalized);
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

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  if (typeof value === "string") {
    return value;
  }

  return undefined;
}

function normalizeApiPath(pathname: string): string {
  if (pathname === API_V1_PREFIX) {
    return "/";
  }

  if (pathname.startsWith(`${API_V1_PREFIX}/`)) {
    return pathname.slice(API_V1_PREFIX.length) || "/";
  }

  return pathname;
}

function isSensitiveKey(rawKey: string): boolean {
  const key = rawKey.toLowerCase().replace(/[-_]/g, "");
  return SENSITIVE_KEY_HINTS.some((hint) => key.includes(hint));
}

function truncateAuditString(value: string): string {
  if (value.length <= MAX_AUDIT_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_AUDIT_STRING_LENGTH)}${TRUNCATED}`;
}

function sanitizeAuditValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value === "undefined") {
    return value;
  }

  if (typeof value === "string") {
    return truncateAuditString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (depth >= MAX_AUDIT_DEPTH) {
    return TRUNCATED;
  }

  if (value instanceof Uint8Array) {
    return `[Uint8Array:${value.byteLength}]`;
  }

  if (Array.isArray(value)) {
    const limited = value.slice(0, MAX_AUDIT_ARRAY_ITEMS);
    const sanitized = limited.map((item) => sanitizeAuditValue(item, depth + 1, seen));
    if (value.length > MAX_AUDIT_ARRAY_ITEMS) {
      sanitized.push(`[TRUNCATED_ITEMS:${value.length - MAX_AUDIT_ARRAY_ITEMS}]`);
    }
    return sanitized;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (seen.has(objectValue)) {
      return "[CIRCULAR]";
    }
    seen.add(objectValue);

    const entries = Object.entries(objectValue);
    const limitedEntries = entries.slice(0, MAX_AUDIT_OBJECT_KEYS);
    const output: Record<string, unknown> = {};

    for (const [key, entryValue] of limitedEntries) {
      output[key] = isSensitiveKey(key)
        ? REDACTED
        : sanitizeAuditValue(entryValue, depth + 1, seen);
    }

    if (entries.length > MAX_AUDIT_OBJECT_KEYS) {
      output.__truncatedKeys = entries.length - MAX_AUDIT_OBJECT_KEYS;
    }

    return output;
  }

  return String(value);
}

export function sanitizeForAuditLogs(value: unknown): unknown {
  return sanitizeAuditValue(value, 0, new WeakSet<object>());
}

export function sanitizeHeadersForAuditLogs(headers: IncomingHttpHeaders): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    output[key] = isSensitiveKey(key) ? REDACTED : sanitizeForAuditLogs(value);
  }
  return output;
}

function emitAuditLog(enabled: boolean, payload: Record<string, unknown>): void {
  if (!enabled) {
    return;
  }

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function extractRequestApiKey(req: IncomingMessage): string | undefined {
  const xApiKey = getHeaderValue(req.headers["x-api-key"])?.trim();
  if (xApiKey) {
    return xApiKey;
  }

  const authorization = getHeaderValue(req.headers.authorization)?.trim();
  if (!authorization) {
    return undefined;
  }

  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) {
    return undefined;
  }

  const token = bearerMatch[1].trim();
  return token || undefined;
}

function isProtectedRoute(method: string, pathname: string): boolean {
  if (method === "GET" && pathname === "/tools") {
    return true;
  }

  if (method === "POST" && pathname.startsWith("/tools/")) {
    return true;
  }

  return false;
}

type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetAtEpochSeconds: number;
};

class FixedWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly counters = new Map<string, { windowStartedAt: number; count: number }>();

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  check(identifier: string, now = Date.now()): RateLimitDecision {
    this.prune(now);

    const current = this.counters.get(identifier);
    if (!current || now - current.windowStartedAt >= this.windowMs) {
      this.counters.set(identifier, { windowStartedAt: now, count: 1 });
      return {
        allowed: true,
        limit: this.maxRequests,
        remaining: Math.max(0, this.maxRequests - 1),
        retryAfterMs: 0,
        resetAtEpochSeconds: Math.ceil((now + this.windowMs) / 1000),
      };
    }

    if (current.count < this.maxRequests) {
      current.count += 1;
      return {
        allowed: true,
        limit: this.maxRequests,
        remaining: Math.max(0, this.maxRequests - current.count),
        retryAfterMs: 0,
        resetAtEpochSeconds: Math.ceil((current.windowStartedAt + this.windowMs) / 1000),
      };
    }

    const retryAfterMs = Math.max(1, this.windowMs - (now - current.windowStartedAt));
    return {
      allowed: false,
      limit: this.maxRequests,
      remaining: 0,
      retryAfterMs,
      resetAtEpochSeconds: Math.ceil((current.windowStartedAt + this.windowMs) / 1000),
    };
  }

  private prune(now: number): void {
    if (this.counters.size < 1024) {
      return;
    }

    for (const [identifier, value] of this.counters.entries()) {
      if (now - value.windowStartedAt >= this.windowMs) {
        this.counters.delete(identifier);
      }
    }
  }
}

function getClientIdentifier(
  req: IncomingMessage,
  options: {
    requestApiKey?: string;
    trustProxy: boolean;
  },
): string {
  const { requestApiKey, trustProxy } = options;
  if (requestApiKey) {
    return `api-key:${requestApiKey}`;
  }

  if (trustProxy) {
    const forwardedFor = getHeaderValue(req.headers["x-forwarded-for"]);
    if (forwardedFor) {
      const first = forwardedFor.split(",")[0]?.trim();
      if (first) {
        return `ip:${first}`;
      }
    }

    const realIp = getHeaderValue(req.headers["x-real-ip"])?.trim();
    if (realIp) {
      return `ip:${realIp}`;
    }
  }

  const remoteAddress = req.socket.remoteAddress?.trim();
  if (remoteAddress) {
    return `ip:${remoteAddress}`;
  }

  return "ip:unknown";
}

export type ApiServerHandle = {
  port: number;
  host: string;
  shutdown: () => Promise<void>;
};

export type StartApiServerOverrides = {
  host?: string;
  port?: number;
  apiKey?: string;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  auditLogEnabled?: boolean;
  auditLogIncludeBodies?: boolean;
  trustProxy?: boolean;
  maxBodyBytes?: number;
};

/**
 * Starts the API HTTP server for programmatic use (e.g. tests).
 * Uses port 0 by default to bind to a random available port.
 * Does not register SIGINT/SIGTERM handlers.
 */
export async function startApiServer(
  overrides: StartApiServerOverrides = {},
): Promise<ApiServerHandle> {
  const options: Omit<ApiOptions, "showHelp"> = {
    host: overrides.host ?? "127.0.0.1",
    port: overrides.port ?? 0,
    apiKey: overrides.apiKey,
    rateLimitMax: overrides.rateLimitMax ?? 120,
    rateLimitWindowMs: overrides.rateLimitWindowMs ?? 60000,
    auditLogEnabled: overrides.auditLogEnabled ?? false,
    auditLogIncludeBodies: overrides.auditLogIncludeBodies ?? false,
    trustProxy: overrides.trustProxy ?? false,
    maxBodyBytes: overrides.maxBodyBytes ?? 1048576,
  };

  const toolRuntime = await createInProcessToolRuntime();
  const rateLimiter = new FixedWindowRateLimiter(options.rateLimitWindowMs, options.rateLimitMax);

  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let method = req.method ?? "GET";
    let originalPath = "/";
    let canonicalPath = "/";
    let requestBodyForAudit: unknown;
    const requestHeadersForAudit = sanitizeHeadersForAuditLogs(req.headers);

    const sendJsonWithAudit = (statusCode: number, payload: unknown) => {
      const durationMs = Date.now() - startedAt;
      const responseAudit: Record<string, unknown> = {
        event: "api.response",
        timestamp: new Date().toISOString(),
        requestId,
        method,
        path: originalPath,
        canonicalPath,
        statusCode,
        durationMs,
      };

      if (options.auditLogIncludeBodies) {
        responseAudit.requestBody = sanitizeForAuditLogs(requestBodyForAudit);
        responseAudit.responseBody = sanitizeForAuditLogs(payload);
      }

      emitAuditLog(options.auditLogEnabled, responseAudit);
      sendJson(res, statusCode, payload, requestId);
    };

    const sendErrorWithAudit = (
      statusCode: number,
      code: string,
      message: string,
      details?: unknown,
    ) => {
      const payload: ApiErrorPayload = {
        error: {
          code,
          message,
          ...(typeof details !== "undefined" ? { details } : {}),
          requestId,
        },
      };
      sendJsonWithAudit(statusCode, payload);
    };

    try {
      const requestUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? `${options.host}:${options.port}`}`,
      );
      method = req.method ?? "GET";
      originalPath = requestUrl.pathname;
      canonicalPath = normalizeApiPath(requestUrl.pathname);
      const requestApiKey = extractRequestApiKey(req);

      emitAuditLog(options.auditLogEnabled, {
        event: "api.request",
        timestamp: new Date().toISOString(),
        requestId,
        method,
        path: originalPath,
        canonicalPath,
        headers: requestHeadersForAudit,
      });

      if (options.apiKey && isProtectedRoute(method, canonicalPath)) {
        if (requestApiKey !== options.apiKey) {
          sendErrorWithAudit(
            401,
            "unauthorized",
            "Missing or invalid API key.",
            {
              acceptedAuth: [
                "x-api-key: <token>",
                "authorization: Bearer <token>",
              ],
            },
          );
          return;
        }
      }

      if (options.rateLimitMax > 0 && isProtectedRoute(method, canonicalPath)) {
        const validatedApiKey = options.apiKey && requestApiKey === options.apiKey
          ? requestApiKey
          : undefined;
        const clientIdentifier = getClientIdentifier(req, {
          requestApiKey: validatedApiKey,
          trustProxy: options.trustProxy,
        });
        const rateLimit = rateLimiter.check(clientIdentifier);

        res.setHeader("x-ratelimit-limit", String(rateLimit.limit));
        res.setHeader("x-ratelimit-remaining", String(rateLimit.remaining));
        res.setHeader("x-ratelimit-reset", String(rateLimit.resetAtEpochSeconds));

        if (!rateLimit.allowed) {
          res.setHeader("retry-after", String(Math.ceil(rateLimit.retryAfterMs / 1000)));
          sendErrorWithAudit(
            429,
            "rate_limited",
            "Too many requests. Try again later.",
            {
              limit: rateLimit.limit,
              windowMs: options.rateLimitWindowMs,
              retryAfterMs: rateLimit.retryAfterMs,
            },
          );
          return;
        }
      }

      if (method === "GET" && canonicalPath === "/health") {
        sendJsonWithAudit(200, {
          status: "ok",
          transport: "in-process",
          authRequired: Boolean(options.apiKey),
          rateLimit: {
            enabled: options.rateLimitMax > 0,
            max: options.rateLimitMax,
            windowMs: options.rateLimitWindowMs,
          },
        });
        return;
      }

      if (method === "GET" && canonicalPath === "/tools") {
        const tools = await toolRuntime.listTools();
        sendJsonWithAudit(200, tools);
        return;
      }

      if (method === "POST" && canonicalPath.startsWith("/tools/")) {
        const toolName = decodeURIComponent(canonicalPath.replace("/tools/", ""));
        if (!toolName) {
          sendErrorWithAudit(
            400,
            "invalid_request",
            "Missing tool name in path.",
          );
          return;
        }

        const argsPayload = await readJsonBody(req, options.maxBodyBytes);
        requestBodyForAudit = argsPayload;
        const result = await toolRuntime.callTool(toolName, argsPayload);

        sendJsonWithAudit(200, result);
        return;
      }

      sendErrorWithAudit(
        404,
        "not_found",
        "Route not found.",
        {
          endpoints: API_ENDPOINTS,
        },
      );
    } catch (error) {
      if (error instanceof ApiHttpError) {
        sendErrorWithAudit(error.statusCode, error.code, error.message, error.details);
        return;
      }

      sendErrorWithAudit(
        500,
        "internal_error",
        error instanceof Error ? error.message : "Unknown server error.",
      );
    }
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onListenError = (error: Error) => {
        reject(error);
      };

      const onListen = () => {
        server.off("error", onListenError);
        server.off("listening", onListen);
        resolve();
      };

      server.once("error", onListenError);
      server.once("listening", onListen);
      server.listen(options.port, options.host, () => {
        onListen();
      });
    });
  } catch (error) {
    await Promise.allSettled([
      toolRuntime.close(),
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
    ]);
    throw error;
  }

  let port: number;
  let host: string;

  if (typeof server.address === "function") {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      await toolRuntime.close();
      server.close();
      throw new Error("Failed to resolve server address after listen");
    }
    port = addr.port;
    host = typeof addr.address === "string" ? addr.address : options.host;
  } else {
    port = options.port;
    host = options.host;
  }

  const shutdown = async () => {
    await Promise.allSettled([
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
      toolRuntime.close(),
    ]);
  };

  return {
    port,
    host,
    shutdown,
  };
}

export async function runApi(args: string[]): Promise<void> {
  const options = parseApiOptions(args);

  if (options.showHelp) {
    printApiHelp();
    return;
  }

  const handle = await startApiServer({
    host: options.host,
    port: options.port,
    apiKey: options.apiKey,
    rateLimitMax: options.rateLimitMax,
    rateLimitWindowMs: options.rateLimitWindowMs,
    auditLogEnabled: options.auditLogEnabled,
    auditLogIncludeBodies: options.auditLogIncludeBodies,
    trustProxy: options.trustProxy,
    maxBodyBytes: options.maxBodyBytes,
  });

  console.log(
    `Nostr Agent API listening at http://${handle.host}:${handle.port} (in-process tools)`,
  );

  process.once("SIGINT", () => {
    void handle.shutdown().finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void handle.shutdown().finally(() => process.exit(0));
  });
}
