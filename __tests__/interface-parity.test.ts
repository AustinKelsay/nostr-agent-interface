import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createManagedMcpClient } from "../app/mcp-client.js";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

const API_HOST = "127.0.0.1";
const API_PORT = 39000 + Math.floor(Math.random() * 1000);
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

let apiProcess: ChildProcess | undefined;
let apiLogs = "";

function parseJsonFromOutput(output: string): any {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Expected JSON output but got empty output");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`Unable to parse JSON output: ${trimmed}`);
  }
}

function textFromResult(result: any): string {
  const content = Array.isArray(result?.content) ? result.content : [];
  return content
    .filter((block: any) => block?.type === "text" && typeof block?.text === "string")
    .map((block: any) => block.text)
    .join("\n")
    .trim();
}

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

async function callViaMcp(toolName: string, args: Record<string, unknown>): Promise<any> {
  const managed = await createManagedMcpClient();
  try {
    return await managed.client.callTool({ name: toolName, arguments: args });
  } finally {
    await managed.close();
  }
}

async function listViaMcp(): Promise<any> {
  const managed = await createManagedMcpClient();
  try {
    return await managed.client.listTools();
  } finally {
    await managed.close();
  }
}

async function callViaCli(toolName: string, args: Record<string, unknown>): Promise<any> {
  const entrypoint = path.resolve(process.cwd(), "app/index.ts");
  const { stdout } = await execFileAsync(
    process.execPath,
    [entrypoint, "cli", "call", toolName, JSON.stringify(args), "--json"],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );

  return parseJsonFromOutput(stdout);
}

async function listViaCli(): Promise<any> {
  const entrypoint = path.resolve(process.cwd(), "app/index.ts");
  const { stdout } = await execFileAsync(
    process.execPath,
    [entrypoint, "cli", "list-tools", "--json"],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );

  return parseJsonFromOutput(stdout);
}

async function callViaApi(toolName: string, args: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/tools/${encodeURIComponent(toolName)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    throw new Error(`API call failed with ${response.status}`);
  }

  return await response.json();
}

async function listViaApi(): Promise<any> {
  const response = await fetch(`${API_BASE_URL}/tools`);
  if (!response.ok) {
    throw new Error(`API list-tools failed with ${response.status}`);
  }
  return await response.json();
}

describe("Interface parity (MCP, CLI, API)", () => {
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

    if (proc.exitCode === null) {
      proc.kill("SIGTERM");
    }

    await new Promise((resolve) => {
      const forceKillTimer = setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill("SIGKILL");
        }
        resolve(undefined);
      }, 1500);

      proc.once("exit", () => {
        clearTimeout(forceKillTimer);
        resolve(undefined);
      });
    });
  });

  test("list-tools parity", async () => {
    const [mcp, cli, api] = await Promise.all([listViaMcp(), listViaCli(), listViaApi()]);

    const mcpNames = (mcp.tools ?? []).map((tool: any) => tool.name).sort();
    const cliNames = (cli.tools ?? []).map((tool: any) => tool.name).sort();
    const apiNames = (api.tools ?? []).map((tool: any) => tool.name).sort();

    expect(cliNames).toEqual(mcpNames);
    expect(apiNames).toEqual(mcpNames);

    expect(mcpNames).toContain("getProfile");
    expect(mcpNames).toContain("queryEvents");
    expect(mcpNames).toContain("postNote");
  });

  test("tool call parity for deterministic validation paths", async () => {
    const cases: Array<{ toolName: string; args: Record<string, unknown> }> = [
      {
        toolName: "getProfile",
        args: { pubkey: "invalid_pubkey" },
      },
      {
        toolName: "queryEvents",
        args: { authors: ["invalid_author_value"], limit: 1 },
      },
      {
        toolName: "postNote",
        args: { privateKey: "invalid_private_key", content: "test" },
      },
    ];

    for (const testCase of cases) {
      const [mcp, cli, api] = await Promise.all([
        callViaMcp(testCase.toolName, testCase.args),
        callViaCli(testCase.toolName, testCase.args),
        callViaApi(testCase.toolName, testCase.args),
      ]);

      expect(textFromResult(cli)).toBe(textFromResult(mcp));
      expect(textFromResult(api)).toBe(textFromResult(mcp));

      expect(Boolean(cli?.isError)).toBe(Boolean(mcp?.isError));
      expect(Boolean(api?.isError)).toBe(Boolean(mcp?.isError));
    }
  });
});
