#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMcpStdioServer } from "../index.js";
import { runApi } from "./api.js";
import { runCli } from "./cli.js";

function printHelp() {
  console.log(`Nostr Agent Interface

Usage:
  nostr-agent-interface mcp
  nostr-agent-interface cli <command>
  nostr-agent-interface api [--host <host>] [--port <port>]

Modes:
  mcp  Start the original MCP stdio server
  cli  Invoke tools via command line through MCP
  api  Expose tools over HTTP through MCP`);
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);

  if (!mode || mode === "help" || mode === "--help") {
    printHelp();
    return;
  }

  if (mode === "mcp") {
    await startMcpStdioServer();
    return;
  }

  if (mode === "cli") {
    const code = await runCli(args);
    process.exitCode = code;
    return;
  }

  if (mode === "api") {
    await runApi(args);
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
