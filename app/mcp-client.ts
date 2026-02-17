import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_INFO = {
  name: "nostr-agent-interface",
  version: "0.1.0",
};

export type ManagedMcpClient = {
  client: Client;
  close: () => Promise<void>;
};

function parseServerArgs(raw: string | undefined): string[] | undefined {
  if (!raw || raw.trim() === "") {
    return undefined;
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
      throw new Error("NOSTR_MCP_ARGS must be a JSON string array");
    }
    return parsed;
  }

  return trimmed.split(/\s+/).filter(Boolean);
}

function resolveDefaultServerProcess(): StdioServerParameters {
  const filePath = fileURLToPath(import.meta.url);
  const appDir = path.dirname(filePath);
  const buildEntry = path.resolve(appDir, "../index.js");
  const sourceTsEntry = path.resolve(appDir, "../index.ts");
  const buildTsEntry = path.resolve(appDir, "../../index.ts");

  if (existsSync(buildEntry)) {
    return {
      command: process.execPath,
      args: [buildEntry],
      cwd: path.resolve(appDir, ".."),
      stderr: "pipe",
    };
  }

  if (process.versions.bun && existsSync(sourceTsEntry)) {
    return {
      command: process.execPath,
      args: [sourceTsEntry],
      cwd: path.dirname(sourceTsEntry),
      stderr: "pipe",
    };
  }

  if (process.versions.bun && existsSync(buildTsEntry)) {
    return {
      command: process.execPath,
      args: [buildTsEntry],
      cwd: path.dirname(buildTsEntry),
      stderr: "pipe",
    };
  }

  throw new Error(
    "Unable to find MCP server entrypoint. Build the project first or set NOSTR_MCP_COMMAND/NOSTR_MCP_ARGS.",
  );
}

export function resolveMcpServerProcess(): StdioServerParameters {
  const command = process.env.NOSTR_MCP_COMMAND;

  if (!command) {
    return resolveDefaultServerProcess();
  }

  return {
    command,
    args: parseServerArgs(process.env.NOSTR_MCP_ARGS),
    cwd: process.cwd(),
    stderr: "pipe",
  };
}

export async function createManagedMcpClient(
  serverProcess: StdioServerParameters = resolveMcpServerProcess(),
): Promise<ManagedMcpClient> {
  const transport = new StdioClientTransport(serverProcess);
  const client = new Client(CLIENT_INFO);

  if (transport.stderr) {
    transport.stderr.on("data", (chunk: unknown) => {
      if (typeof chunk === "string") {
        process.stderr.write(chunk);
        return;
      }

      if (chunk instanceof Uint8Array) {
        process.stderr.write(chunk);
      }
    });
  }

  await client.connect(transport);

  return {
    client,
    close: async () => {
      await Promise.allSettled([client.close(), transport.close()]);
    },
  };
}
