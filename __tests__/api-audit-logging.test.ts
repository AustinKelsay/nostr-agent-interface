import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { describeNetwork } from "./support/network-suite.js";

const API_HOST = "127.0.0.1";
const API_PORT = 43000 + Math.floor(Math.random() * 1000);
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;
const TEST_API_KEY = "test-api-key";
const AUTH_SECRET = "auth-secret-token";
const PRIVATE_KEY_SECRET = "nsec1-super-secret-value";
const BODY_TOKEN_SECRET = "body-token-secret";

type StartedApi = {
  process: ChildProcess;
  getStdout: () => string;
  getStderr: () => string;
};

function startApiProcess(env: NodeJS.ProcessEnv = process.env): StartedApi {
  const entrypoint = path.resolve(process.cwd(), "app/index.ts");
  const apiProcess = spawn(
    process.execPath,
    [entrypoint, "api", "--host", API_HOST, "--port", String(API_PORT)],
    {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  apiProcess.stdout?.setEncoding("utf8");
  apiProcess.stderr?.setEncoding("utf8");
  apiProcess.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  apiProcess.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });

  return {
    process: apiProcess,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

async function stopApiProcess(apiProcess: ChildProcess | undefined): Promise<void> {
  if (!apiProcess) return;

  if (apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
  }

  await new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => {
      if (apiProcess.exitCode === null) {
        apiProcess.kill("SIGKILL");
      }
      resolve(undefined);
    }, 1500);

    apiProcess.once("exit", () => {
      clearTimeout(forceKillTimer);
      resolve(undefined);
    });
  });
}

async function waitForApiReady(
  getProc: () => ChildProcess | undefined,
  getLogs: () => string,
  timeoutMs = 15000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const apiProcess = getProc();
    if (apiProcess && apiProcess.exitCode !== null) {
      throw new Error(`API process exited early with code ${apiProcess.exitCode}. Logs:\n${getLogs()}`);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`API did not become ready within ${timeoutMs}ms. Logs:\n${getLogs()}`);
}

function parseAuditEntries(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object") {
          return [parsed as Record<string, unknown>];
        }
      } catch {
        // ignore non-json lines
      }
      return [];
    })
    .filter((entry) => entry.event === "api.request" || entry.event === "api.response");
}

async function waitForRequestLogs(
  getStdout: () => string,
  requestId: string,
  timeoutMs = 5000,
): Promise<{
  requestEntry: Record<string, unknown>;
  responseEntry: Record<string, unknown>;
  rawStdout: string;
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const rawStdout = getStdout();
    const entries = parseAuditEntries(rawStdout);
    const requestEntry = entries.find(
      (entry) => entry.event === "api.request" && entry.requestId === requestId,
    );
    const responseEntry = entries.find(
      (entry) => entry.event === "api.response" && entry.requestId === requestId,
    );

    if (requestEntry && responseEntry) {
      return { requestEntry, responseEntry, rawStdout };
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Audit log entries not found for requestId=${requestId}`);
}

describeNetwork("API audit logging", () => {
  let apiProcess: ChildProcess | undefined;
  let getStdout = () => "";
  let getStderr = () => "";

  beforeAll(async () => {
    const started = startApiProcess({
      ...process.env,
      NOSTR_AGENT_API_KEY: TEST_API_KEY,
      NOSTR_AGENT_API_AUDIT_LOG_ENABLED: "true",
      NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES: "true",
    });
    apiProcess = started.process;
    getStdout = started.getStdout;
    getStderr = started.getStderr;

    await waitForApiReady(() => apiProcess, () => `${getStdout()}\n${getStderr()}`);
  });

  afterAll(async () => {
    await stopApiProcess(apiProcess);
    apiProcess = undefined;
  });

  test("emits correlated request/response logs with sensitive fields redacted", async () => {
    const response = await fetch(`${API_BASE_URL}/v1/tools/getProfile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": TEST_API_KEY,
        authorization: `Bearer ${AUTH_SECRET}`,
      },
      body: JSON.stringify({
        pubkey: "invalid_pubkey",
        privateKey: PRIVATE_KEY_SECRET,
        token: BODY_TOKEN_SECRET,
      }),
    });

    expect(response.status).toBe(200);
    const requestId = response.headers.get("x-request-id");
    expect(typeof requestId).toBe("string");

    const logs = await waitForRequestLogs(getStdout, requestId!);
    const requestHeaders = (logs.requestEntry.headers ?? {}) as Record<string, unknown>;
    const requestBody = (logs.responseEntry.requestBody ?? {}) as Record<string, unknown>;

    expect(logs.requestEntry.requestId).toBe(requestId);
    expect(logs.responseEntry.requestId).toBe(requestId);
    expect(logs.requestEntry.path).toBe("/v1/tools/getProfile");
    expect(logs.responseEntry.statusCode).toBe(200);

    expect(requestHeaders["x-api-key"]).toBe("[REDACTED]");
    expect(requestHeaders.authorization).toBe("[REDACTED]");
    expect(requestBody.privateKey).toBe("[REDACTED]");
    expect(requestBody.token).toBe("[REDACTED]");

    expect(logs.rawStdout.includes(TEST_API_KEY)).toBe(false);
    expect(logs.rawStdout.includes(AUTH_SECRET)).toBe(false);
    expect(logs.rawStdout.includes(PRIVATE_KEY_SECRET)).toBe(false);
    expect(logs.rawStdout.includes(BODY_TOKEN_SECRET)).toBe(false);
  });
});
