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

type ResolveMcpServerProcessOptions = {
  command?: string;
  rawArgs?: string;
  cwd?: string;
  filePath?: string;
  existsSyncFn?: (candidate: string) => boolean;
  isBun?: boolean;
  execPath?: string;
};

type TransportLike = {
  stderr?: {
    on: (event: string, handler: (chunk: unknown) => void) => void;
  };
  close: () => Promise<void>;
};

type ClientLike = {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
};

export type CreateManagedMcpClientDependencies = {
  transportFactory?: (serverProcess: StdioServerParameters) => TransportLike;
  clientFactory?: (clientInfo: typeof CLIENT_INFO) => ClientLike;
  stderrWriter?: (chunk: string | Uint8Array) => void;
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

function resolveDefaultServerProcess(options: ResolveMcpServerProcessOptions = {}): StdioServerParameters {
  const filePath = options.filePath ?? fileURLToPath(import.meta.url);
  const appDir = path.dirname(filePath);
  const buildEntry = path.resolve(appDir, "../index.js");
  const sourceTsEntry = path.resolve(appDir, "../index.ts");
  const buildTsEntry = path.resolve(appDir, "../../index.ts");
  const exists = options.existsSyncFn ?? existsSync;
  const isBun = options.isBun ?? Boolean(process.versions.bun);
  const execPath = options.execPath ?? process.execPath;

  if (exists(buildEntry)) {
    return {
      command: execPath,
      args: [buildEntry],
      cwd: path.resolve(appDir, ".."),
      stderr: "pipe",
    };
  }

  if (isBun && exists(sourceTsEntry)) {
    return {
      command: execPath,
      args: [sourceTsEntry],
      cwd: path.dirname(sourceTsEntry),
      stderr: "pipe",
    };
  }

  if (isBun && exists(buildTsEntry)) {
    return {
      command: execPath,
      args: [buildTsEntry],
      cwd: path.dirname(buildTsEntry),
      stderr: "pipe",
    };
  }

  throw new Error(
    "Unable to find MCP server entrypoint. Build the project first or set NOSTR_MCP_COMMAND/NOSTR_MCP_ARGS.",
  );
}

export function resolveMcpServerProcess(options: ResolveMcpServerProcessOptions = {}): StdioServerParameters {
  const command = options.command ?? process.env.NOSTR_MCP_COMMAND;

  if (!command) {
    return resolveDefaultServerProcess(options);
  }

  return {
    command,
    args: parseServerArgs(options.rawArgs ?? process.env.NOSTR_MCP_ARGS),
    cwd: options.cwd ?? process.cwd(),
    stderr: "pipe",
  };
}

export async function createManagedMcpClient(
  serverProcess: StdioServerParameters = resolveMcpServerProcess(),
  dependencies: CreateManagedMcpClientDependencies = {},
): Promise<ManagedMcpClient> {
  const transport = (dependencies.transportFactory ?? ((params) => new StdioClientTransport(params)))(serverProcess);
  const client = (dependencies.clientFactory ?? ((info) => new Client(info)))(CLIENT_INFO);
  const writeStderr = dependencies.stderrWriter ?? ((chunk: string | Uint8Array) => process.stderr.write(chunk));

  if (transport.stderr) {
    transport.stderr.on("data", (chunk: unknown) => {
      if (typeof chunk === "string") {
        writeStderr(chunk);
        return;
      }

      if (chunk instanceof Uint8Array) {
        writeStderr(chunk);
      }
    });
  }

  await (client as ClientLike).connect(transport);

  return {
    client: client as unknown as Client,
    close: async () => {
      await Promise.allSettled([client.close(), transport.close()]);
    },
  };
}
