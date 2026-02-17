# Testing Guide

This project uses Bun test suites with explicit parity checks across **MCP**, **CLI**, and **API** interfaces.

Nostr Agent Interface is API/CLI-first in day-to-day usage, but MCP remains a supported transport. Tests enforce that all transports remain semantically aligned.

## Goals

1. Keep one canonical tool contract across transports.
2. Catch wrapper regressions early.
3. Keep tests deterministic where possible.

## Core Commands

```bash
bun test
bun test __tests__/interface-parity.test.ts __tests__/cli-ux.test.ts
bun test __tests__/api-errors.test.ts
bun run build
```

## Interface Parity Contract

Parity means:

1. The same tool list is available via MCP, CLI, and API.
2. Identical tool+args produce equivalent semantic output.
3. Error behavior is consistent (`isError`/status envelope semantics).

Primary suite:

1. `__tests__/interface-parity.test.ts`

It validates:

1. `list-tools` parity.
2. Deterministic validation-path parity for selected tools (`getProfile`, `queryEvents`, `postNote`).

## CLI UX Tests

Coverage file:

1. `__tests__/cli-ux.test.ts`

Checks:

1. Help output.
2. `--json` behavior.
3. `--stdin` JSON arg flow.
4. Argument validation edge cases.

## API Error Envelope Tests

Coverage file:

1. `__tests__/api-errors.test.ts`

Checks:

1. `not_found` shape.
2. `invalid_json` shape.
3. `requestId` and `x-request-id` correlation.

## Artifact Validation

Generated contract:

1. `artifacts/tools.json`

Generate/refresh:

```bash
bun run build
# or
bun run generate:tools-manifest
```

## Config-Aware Testing

Precedence:

1. Explicit args.
2. Environment variables.
3. Built-in defaults.

Useful env vars:

1. `NOSTR_DEFAULT_RELAYS`
2. `NOSTR_AGENT_API_HOST`
3. `NOSTR_AGENT_API_PORT`
4. `NOSTR_MCP_COMMAND`
5. `NOSTR_MCP_ARGS`

## Troubleshooting

If parity fails:

1. Rerun `bun run build`.
2. Verify wrappers still map to canonical tool contracts.
3. Diff `GET /tools` and MCP `list-tools` output.
4. Inspect stderr for MCP child startup/runtime failures.
