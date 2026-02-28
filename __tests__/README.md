# Nostr Agent Interface Test Suite

This directory contains tests for the shared Nostr tool contract and its MCP/CLI/API surfaces, with CLI/API as the preferred operational transports and MCP kept as an explicit standalone mode.

## Test Scope

1. Unit coverage for feature modules.
2. Integration coverage with in-memory relay + websocket behavior.
3. Interface parity checks to prevent transport drift.

## Main Files

Unit tests include:

1. `basic.test.ts`
2. `profile-tools.test.ts`
3. `note-creation.test.ts`
4. `event-tools.test.ts`
5. `relay-tools.test.ts`
6. `social-tools.test.ts`
7. `dm-tools.test.ts`
8. `zap-tools-simple.test.ts`
9. `zap-tools-tests.test.ts` (expanded zap receipt validation, decode helper, and cache-lifecycle regression coverage)
10. `nip19-conversion.test.ts`
11. `nip42-auth.test.ts`

Interface tests include:

1. `interface-parity.test.ts`
2. `cli-core.test.ts` (in-process CLI parser/core command behavior in `runCli`)
3. `cli-ux.test.ts` (direct tool commands + legacy `call` UX + stdin/help validation)
4. `api-core.test.ts` (API option parsing + sanitization helpers + in-memory request lifecycle and shutdown behavior)
5. `api-errors.test.ts` (error envelope + API auth + API rate limiting + body caps + `/v1` compatibility)
6. `api-audit-logging.test.ts` (structured API audit logs + redaction + request/response correlation)
7. `mcp-dispatch.test.ts` (full MCP tool registration + schema contract stability + deterministic handler dispatch)

Integration tests include:

1. `integration.test.ts`
2. `websocket-integration.test.ts`

## Running Tests

```bash
bun test
bun run test:parity
bun test __tests__/cli-core.test.ts
bun test __tests__/cli-ux.test.ts
bun test __tests__/api-core.test.ts __tests__/api-errors.test.ts __tests__/api-audit-logging.test.ts
bun test __tests__/mcp-dispatch.test.ts
bun test __tests__/zap-tools-tests.test.ts
```

## Design Notes

1. Tests prioritize deterministic validation paths for parity checks.
2. `cli-core.test.ts` validates parser/type-coercion behavior in-process; `cli-ux.test.ts` validates end-user process behavior and exit codes.
3. `api-core.test.ts` provides in-memory HTTP harness coverage for option parsing, route handling, auth/rate-limit behavior, and signal-driven shutdown.
4. `mcp-dispatch.test.ts` locks full tool catalog/schema contracts and deterministic handler routing.
5. Integration tests rely on the in-memory relay in `utils/ephemeral-relay.ts`.
6. Coverage focuses on tool-contract stability and transport consistency.
