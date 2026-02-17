# LLM Documentation: Nostr Agent Interface

This folder is the model-facing documentation for building LLM workflows on top of **Nostr Agent Interface**.

Nostr Agent Interface is organized around a single source of truth: the upstream `nostr-mcp-server` tool surface. The same capabilities are exposed through three transports:

1. MCP (`stdio`)
2. CLI
3. HTTP API

## Goals

1. Keep MCP, CLI, and API behavior consistent.
2. Give LLM builders clear workflow and safety guidance.
3. Make tool selection predictable for agentic runtimes.

## Documentation Map

1. `tool-catalog.md`
   - Full grouped catalog of current tools and their intent.
2. `playbook.md`
   - Prompting patterns, guardrails, error handling, and workflow templates for LLM agents.

## Quick Start

### MCP Mode

```bash
nostr-agent-interface mcp
```

### CLI Mode

```bash
# list tools
nostr-agent-interface cli list-tools

# call a tool
nostr-agent-interface cli call getProfile '{"pubkey":"npub..."}'
```

### API Mode

```bash
nostr-agent-interface api --host 127.0.0.1 --port 3030
```

Endpoints:

1. `GET /health`
2. `GET /tools`
3. `POST /tools/:toolName`

Example:

```bash
curl -s http://127.0.0.1:3030/tools/getProfile \
  -X POST \
  -H 'content-type: application/json' \
  -d '{"pubkey":"npub..."}'
```

## Transport Parity Contract

The CLI and API are thin wrappers over MCP tool calls. If a tool is available in MCP, it is expected to be available in CLI and API with the same input schema and equivalent output content.

When parity breaks, treat it as a bug in the interface layer.

## Configuration Strategy

For LLM deployments and wrappers, use this precedence model:

1. explicit request/tool arguments
2. environment variables
3. built-in defaults

Relevant env vars:

1. `NOSTR_DEFAULT_RELAYS`
2. `NOSTR_AGENT_API_HOST`
3. `NOSTR_AGENT_API_PORT`
4. `NOSTR_MCP_COMMAND`
5. `NOSTR_MCP_ARGS`

API integrations should also expect standardized error payloads:

1. `error.code`
2. `error.message`
3. optional `error.details`
4. `error.requestId` (also in `x-request-id` header)
