import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

const API_HOST = "127.0.0.1";
const API_PORT = 41000 + Math.floor(Math.random() * 1000);
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

let apiProcess: ChildProcess | undefined;
let apiLogs = "";

async function waitForApiReady(timeoutMs = 15000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (apiProcess && apiProcess.exitCode !== null) {
      throw new Error(`API process exited early with code ${apiProcess.exitCode}. Logs:\n${apiLogs}`);
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

  throw new Error(`API did not become ready within ${timeoutMs}ms. Logs:\n${apiLogs}`);
}

describe("API error envelope", () => {
  beforeAll(async () => {
    const entrypoint = path.resolve(process.cwd(), "app/index.ts");
    apiProcess = spawn(
      process.execPath,
      [entrypoint, "api", "--host", API_HOST, "--port", String(API_PORT)],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    apiProcess.stdout?.setEncoding("utf8");
    apiProcess.stderr?.setEncoding("utf8");
    apiProcess.stdout?.on("data", (chunk) => {
      apiLogs += chunk;
    });
    apiProcess.stderr?.on("data", (chunk) => {
      apiLogs += chunk;
    });

    await waitForApiReady();
  });

  afterAll(async () => {
    if (!apiProcess) return;

    const proc = apiProcess;
    apiProcess = undefined;

    if (!proc.killed) {
      proc.kill("SIGTERM");
    }

    await new Promise((resolve) => {
      proc.once("exit", () => resolve(undefined));
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
        resolve(undefined);
      }, 1500);
    });
  });

  test("404 responses use standardized error payload", async () => {
    const response = await fetch(`${API_BASE_URL}/does-not-exist`);
    const body = await response.json();
    const requestId = response.headers.get("x-request-id");

    expect(response.status).toBe(404);
    expect(typeof requestId).toBe("string");
    expect(body?.error?.code).toBe("not_found");
    expect(typeof body?.error?.message).toBe("string");
    expect(body?.error?.requestId).toBe(requestId);
    expect(Array.isArray(body?.error?.details?.endpoints)).toBe(true);
  });

  test("invalid JSON returns invalid_json error code", async () => {
    const response = await fetch(`${API_BASE_URL}/tools/getProfile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{invalid_json",
    });

    const body = await response.json();
    const requestId = response.headers.get("x-request-id");

    expect(response.status).toBe(400);
    expect(body?.error?.code).toBe("invalid_json");
    expect(body?.error?.requestId).toBe(requestId);
    expect(typeof body?.error?.details).toBe("string");
  });
});
