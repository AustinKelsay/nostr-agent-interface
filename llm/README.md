# LLM Documentation: Nostr Agent Interface

This folder is the model-facing documentation for building LLM workflows on top of **Nostr Agent Interface**.

Nostr Agent Interface extends the original Nostr MCP Server JARC toolset and keeps one canonical contract surfaced through three transports:

1. CLI (preferred for local agents)
2. HTTP API (preferred for orchestrated agents)
3. MCP (supported compatibility mode for MCP-native clients)

## Goals

1. Keep behavior consistent across transports.
2. Keep tool selection predictable for agentic runtimes.
3. Preserve upstream tool lineage while expanding interface flexibility.

## Documentation Map

1. `tool-catalog.md` - grouped catalog of tool intent.
2. `playbook.md` - prompting patterns, guardrails, workflow templates.

## Quick Start

### CLI

```bash
nostr-agent-interface cli list-tools
nostr-agent-interface cli call getProfile '{"pubkey":"npub..."}'
```

### API

```bash
nostr-agent-interface api --host 127.0.0.1 --port 3030
```

```bash
curl -s http://127.0.0.1:3030/tools/getProfile \
  -X POST \
  -H 'content-type: application/json' \
  -d '{"pubkey":"npub..."}'
```

### MCP

```bash
nostr-agent-interface mcp
```

## Transport Contract

1. Tool names and schemas should match across MCP/CLI/API.
2. Output semantics should remain equivalent.
3. Parity drift is treated as a bug.

## Configuration Strategy

Precedence:

1. Explicit request/tool args.
2. Environment variables.
3. Built-in defaults.

Relevant env vars:

1. `NOSTR_DEFAULT_RELAYS`
2. `NOSTR_AGENT_API_HOST`
3. `NOSTR_AGENT_API_PORT`
4. `NOSTR_MCP_COMMAND`
5. `NOSTR_MCP_ARGS`

API integrations should expect standardized error payloads:

1. `error.code`
2. `error.message`
3. Optional `error.details`
4. `error.requestId`
