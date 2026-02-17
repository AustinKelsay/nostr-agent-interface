# Nostr Agent Interface

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Nostr Agent Interface extends the original **Nostr MCP Server**.

Nostr MCP Server established the core JARC-style Nostr toolset (stable tool names + JSON input contracts). This project keeps that same core contract and exposes it across a broader runtime surface where **CLI** and **HTTP API** are the default operational interfaces, while **MCP** remains a supported compatibility mode.

## Positioning

1. **Nostr MCP Server remains valid on its own** and is not being deprecated by this project.
2. **Nostr Agent Interface is the preferred operational interface** for mixed agentic workflows.
3. **CLI/API are first-class for "pick it up, do work, put it down" loops.**
4. **MCP is supported when a runtime requires it.**

## Interface Modes

| Mode | Best For | Command |
| --- | --- | --- |
| CLI | local shell agents, scripts, CI jobs | `nostr-agent-interface cli ...` |
| API | services, orchestrators, remote runtimes | `nostr-agent-interface api ...` |
| MCP | MCP-native clients (Claude Desktop/Cursor/Goose) | `nostr-agent-interface mcp` |

Compatibility binaries:

1. `nostr-agent-interface`
2. `nostr-mcp-server` (legacy alias retained)

## Quick Start

### CLI (recommended for local agent runs)

```bash
nostr-agent-interface cli list-tools --json
nostr-agent-interface cli call getProfile '{"pubkey":"npub..."}' --json
```

### API (recommended for orchestration)

```bash
nostr-agent-interface api --host 127.0.0.1 --port 3030
```

```bash
curl -s http://127.0.0.1:3030/tools/getProfile \
  -X POST \
  -H 'content-type: application/json' \
  -d '{"pubkey":"npub..."}'
```

Endpoints:

1. `GET /health`
2. `GET /tools`
3. `POST /tools/:toolName`

### MCP (optional)

```bash
nostr-agent-interface mcp
```

## Installation

### npm

```bash
npm install -g nostr-agent-interface
```

### Source (Bun)

```bash
git clone https://github.com/AustinKelsay/nostr-agent-interface.git
cd nostr-agent-interface
bun install
bun run build
```

### Source (npm)

```bash
git clone https://github.com/AustinKelsay/nostr-agent-interface.git
cd nostr-agent-interface
npm install
npm run build
```

## Tool Surface

This interface currently exposes **40 tools** across:

1. reading/querying
2. identity/profile
3. notes + generic events
4. social + relay list management
5. DMs (NIP-04 and NIP-44/NIP-17)
6. anonymous actions (note + zap)
7. NIP-19 conversion/analysis

Canonical tool contracts live in `artifacts/tools.json`.

## Artifact Contract

`artifacts/tools.json` is the machine-readable contract for current tools and schemas. It now also carries interface lineage/transport metadata so downstream systems can distinguish:

1. canonical package identity (`nostr-agent-interface`)
2. project lineage (extension of Nostr MCP Server JARC contracts)
3. preferred operational model (CLI/API-first)
4. supported transports and preferred transports

Generate it with:

```bash
bun run build
# or
bun run generate:tools-manifest
```

## Configuration

Use `.env.example` as the baseline.

Precedence:

1. explicit CLI/API/tool arguments
2. environment variables
3. built-in defaults

Primary env vars:

1. `NOSTR_DEFAULT_RELAYS`
2. `NOSTR_AGENT_API_HOST`
3. `NOSTR_AGENT_API_PORT`
4. `NOSTR_MCP_COMMAND`
5. `NOSTR_MCP_ARGS`

## MCP Client Setup (Optional)

If you use an MCP-native client, point it at the MCP mode entrypoint:

1. npm install: `npx nostr-agent-interface mcp`
2. source install: `node /ABSOLUTE/PATH/TO/nostr-agent-interface/build/app/index.js mcp`

Sample config file: `claude_desktop_config.sample.json`

## Documentation Map

1. `llm/README.md`
2. `llm/tool-catalog.md`
3. `llm/playbook.md`
4. `docs/testing.md`
5. `profile/README.md`
6. `note/README.md`
7. `zap/README.md`

## Development

```bash
bun run build
bun test
bun run test:parity
bun run check:docs
```

## Lineage Summary

Nostr Agent Interface is an API/CLI-first extension of Nostr MCP Server. It preserves the original JARC tool contract and broadens how agents consume that contract without removing MCP support.
