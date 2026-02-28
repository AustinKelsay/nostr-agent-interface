# Testing Guide

This project uses Bun test suites with explicit parity checks across **CLI**, **API**, and **MCP** interfaces.

Nostr Agent Interface is API/CLI-first in day-to-day usage, while MCP remains a supported compatibility transport. Tests enforce that all transports remain semantically aligned.

CLI/API run through the shared in-process runtime, so parity checks focus on behavior equivalence and contract stability rather than transport mechanics.

## Interface Coverage Snapshot

- CLI and API tests validate the shared parser/runtime path, output formatting, and process lifecycle.
- MCP tests validate protocol registration and dispatch mapping as a separate interface.
- Deterministic parity tests guard the overlap where all interfaces should return equivalent results.

`docs/cli-direct-runtime-migration.md` and `docs/cli-direct-runtime-phase-4-parity.md` describe the implemented architecture and parity expectations.

## Goals

1. Keep one canonical tool contract across transports.
2. Catch wrapper regressions early.
3. Keep tests deterministic where possible.

## Core Commands

```bash
bun test
bun run test:parity
bun test __tests__/cli-core.test.ts
bun test __tests__/api-core.test.ts
bun test __tests__/mcp-dispatch.test.ts
bun test __tests__/interface-parity.test.ts __tests__/cli-ux.test.ts
bun test __tests__/api-errors.test.ts
bun test __tests__/api-audit-logging.test.ts
bun test __tests__/zap-tools-tests.test.ts
bun run build
```

By default, network-heavy suites are skipped to keep local runs deterministic.

Run with network/integration suites enabled:

```bash
NOSTR_NETWORK_TESTS=1 bun test
```

`bun run test:parity` currently targets `__tests__/interface-parity.test.ts` and `__tests__/cli-ux.test.ts`.

Targeted command groups:

- CLI runtime and UX: `bun test __tests__/cli-core.test.ts __tests__/cli-ux.test.ts`
- API perimeter and core internals: `bun test __tests__/api-core.test.ts __tests__/api-errors.test.ts __tests__/api-audit-logging.test.ts`
- MCP protocol contract: `bun test __tests__/mcp-dispatch.test.ts`
- Deterministic parity surface: `bun test __tests__/interface-parity.test.ts`
- Relay timeout behavior: `bun test __tests__/utils-pool.test.ts`
- Network suites (set `NOSTR_NETWORK_TESTS=1`): `bun test __tests__/integration.test.ts __tests__/websocket-integration.test.ts __tests__/relay-tools.test.ts __tests__/event-tools.test.ts __tests__/social-tools.test.ts __tests__/dm-tools.test.ts __tests__/nip42-auth.test.ts __tests__/ephemeral-relay.test.ts`

## Coverage Map

| Suite | Scope | Why it exists |
| --- | --- | --- |
| `__tests__/interface-parity.test.ts` | CLI/API semantic parity for representative tools, with MCP catalog checks in dedicated tests | Prevent transport drift in tool contract behavior |
| `__tests__/cli-core.test.ts` | In-process CLI parser and command dispatcher (`runCli`) | Catch regressions in flag parsing, schema-aware coercion, stdin/json modes, and required-field validation |
| `__tests__/cli-ux.test.ts` | Spawned-process CLI UX behavior | Verify real process exit codes, stdout/stderr layout, and help/usage ergonomics |
| `__tests__/utils-pool.test.ts` | Relay compatibility timeout behavior | Ensure query hard-timeout fallback and deterministic timeout-aware signatures for `CompatibleRelayPool` |
| `__tests__/api-core.test.ts` | API internals and request lifecycle in an in-memory server harness | Validate option parsing, redaction utilities, request routing, auth/rate-limit/body-cap handling, and shutdown behavior |
| `__tests__/api-errors.test.ts` | API edge/error envelopes + perimeter controls | Lock error envelopes, auth behavior, rate limits, body caps, and route compatibility |
| `__tests__/api-audit-logging.test.ts` | Structured API audit logging | Ensure request/response log events, redaction, and `requestId` correlation stay stable |
| `__tests__/mcp-dispatch.test.ts` | Full MCP catalog and schema/dispatch contract checks | Detect drift in registered tools, input schema shapes, and deterministic validation-path handler routing |
| `__tests__/zap-tools-tests.test.ts` | Zap parsing/validation/formatting/cache helpers | Guard zap receipt validation edges, invoice decode helpers, and cache lifecycle behavior |
| `__tests__/integration.test.ts`, `__tests__/websocket-integration.test.ts` | In-memory relay + websocket integration paths | Verify end-to-end behavior against relay I/O and live event flow |

## Recent Changes and Their Test Coverage

### CLI direct invocation and typed flag parsing

Recent CLI work centered around schema-aware direct tool execution in `app/cli.ts`:

1. direct `<toolName>` invocation as first-class path.
2. typed coercion for `string`, `number`, `integer`, `boolean`, `array`, `object`.
3. enum validation.
4. `camelCase` + `kebab-case` option aliases.
5. strict input-mode exclusivity (JSON positional vs `--stdin` vs field flags).
6. required schema field validation before tool call.

Primary coverage:

1. `__tests__/cli-core.test.ts` (unit-level parser/dispatcher behavior).
2. `__tests__/cli-ux.test.ts` (process-level behavior and exit codes).

### Relay pool timeout hardening

Recent changes enforce a hard timeout around `CompatibleRelayPool` query calls so stale `querySync` promises cannot stall command execution.

Primary coverage:

1. `__tests__/utils-pool.test.ts`.

### API perimeter hardening

Recent API changes include optional auth, fixed-window rate limiting, request-body caps, audit logging, and `/v1/*` compatibility routes.

Primary coverage:

1. `__tests__/api-errors.test.ts` for auth/rate-limit/body-limit/error envelope and `/v1` route compatibility.
2. `__tests__/api-audit-logging.test.ts` for structured logs, redaction, and `requestId` linking.
3. `__tests__/api-core.test.ts` for parser/env validation, route dispatch, auth/rate-limit/body-limit internals, and signal-driven shutdown paths.

### MCP catalog + dispatch contract hardening

Recent MCP hardening includes explicit checks for:

1. complete tool registration (name set is stable and complete).
2. per-tool JSON schema shape stability (`required`, `properties`, types, enums, nested object contracts).
3. deterministic validation/success-path dispatch across all canonical handlers.

Primary coverage:

1. `__tests__/mcp-dispatch.test.ts`.

### Zap processing edge handling

Recent zap test additions focus on stricter receipt validation and utility behavior:

1. validation edge cases (`description` requirements, request-kind checks, event/recipient mismatch handling).
2. zap request optional tag parsing (`relays`, `e`, `lnurl`).
3. event target decoding (`hex`, `note`, `nevent`, `naddr`) and invoice amount extraction paths.
4. cache TTL/eviction behavior and anonymous-zap pre-validation.

Primary coverage:

1. `__tests__/zap-tools-tests.test.ts`.

### Contract artifact metadata

`artifacts/tools.json` now includes lineage/transport metadata used by downstream consumers.

Validation path:

1. `bun run build` or `bun run generate:tools-manifest` regenerates the artifact.
2. Interface parity tests ensure tool naming/shape consistency remains aligned across transports.

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
4. Direct tool invocation (`cli <toolName> --field value`).
5. Tool-specific help (`cli <toolName> --help`).
6. Argument validation edge cases.

## CLI Core Parser Tests

Coverage file:

1. `__tests__/cli-core.test.ts`

Checks:

1. top-level/subcommand help dispatch and usage validation.
2. robust `list-tools` handling, including malformed/partial runtime responses.
3. `call` subcommand usage constraints and stdin/json argument-mode rules.
4. direct tool command parsing with schema-aware typed coercion and enum checks.
5. required-field enforcement for direct command execution.
6. stdin behavior for TTY vs piped input.
7. runtime lifecycle guarantees (`runCli` and tool runtime close on both success and errors).

## API Error Envelope Tests

Coverage file:

1. `__tests__/api-errors.test.ts`

Checks:

1. `not_found` shape.
2. `invalid_json` shape.
3. Optional API-key auth behavior (`unauthorized` without credentials).
4. Header auth acceptance (`x-api-key` and `authorization: Bearer`).
5. Rate-limit response behavior (`429` + rate-limit headers).
6. Anti-spoof behavior for limiter identity when `NOSTR_AGENT_API_TRUST_PROXY=false`.
7. Request-body size cap behavior (`413 payload_too_large` with `NOSTR_AGENT_API_MAX_BODY_BYTES`).
8. Legacy and `/v1` endpoint compatibility.
9. `requestId` and `x-request-id` correlation.

## API Audit Logging Tests

Coverage file:

1. `__tests__/api-audit-logging.test.ts`

Checks:

1. Structured request/response log emission.
2. `requestId` correlation between response header and audit logs.
3. Sensitive header/body redaction.

## API Core Harness Tests

Coverage file:

1. `__tests__/api-core.test.ts`

Checks:

1. Audit-log sanitization helpers (`sanitizeForAuditLogs`, `sanitizeHeadersForAuditLogs`).
2. API CLI/env option parsing and validation behavior.
3. In-memory request handling for `/health`, `/tools`, and `/v1/*` alias routes.
4. Structured error mapping for malformed JSON, invalid payload shapes, and missing tool names/routes.
5. Auth acceptance (`x-api-key`, bearer token) and fixed-window limiter identity behavior (`trustProxy` on/off).
6. Request-body size guardrails (`content-length` and streamed chunk overflow).
7. Unexpected MCP exception mapping to `internal_error`.
8. Audit log emission and redaction when enabled.
9. Graceful shutdown paths for both `SIGTERM` and `SIGINT`.

## MCP Dispatch Contract Tests

Coverage file:

1. `__tests__/mcp-dispatch.test.ts`

Checks:

1. Full canonical tool catalog registration from MCP `listTools`.
2. Stable input schema contracts for each tool (required fields, property names, types, enums, and nested object properties).
3. Deterministic dispatch behavior for all handlers through representative validation/success paths.

## Zap Processing Regression Tests

Coverage file:

1. `__tests__/zap-tools-tests.test.ts`

Checks:

1. Zap receipt validation edges and mismatch detection.
2. Zap request parsing for optional relay/event/lnurl tags.
3. Event-id decoding and invoice amount helpers.
4. Zap cache TTL and overflow eviction behavior.
5. Anonymous-zap pre-validation guardrails.

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
4. `NOSTR_AGENT_API_KEY`
5. `NOSTR_AGENT_API_RATE_LIMIT_MAX`
6. `NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS`
7. `NOSTR_AGENT_API_TRUST_PROXY`
8. `NOSTR_AGENT_API_MAX_BODY_BYTES`
9. `NOSTR_AGENT_API_AUDIT_LOG_ENABLED`
10. `NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES`
11. `NOSTR_MCP_COMMAND`
12. `NOSTR_MCP_ARGS`
13. `NOSTR_NETWORK_TESTS`

## Troubleshooting

If parity fails:

1. Rerun `bun run build`.
2. Verify wrappers still map to canonical tool contracts.
3. Diff `GET /tools` and MCP `list-tools` output.
4. If MCP mode tests fail, inspect MCP startup/runtime diagnostics.

If CLI tests fail:

1. Re-run `bun test __tests__/cli-core.test.ts __tests__/cli-ux.test.ts`.
2. Verify `app/cli.ts` option parsing still follows schema type rules.
3. Verify no mixed-mode regression (`--stdin` + field flags, or positional JSON + field flags).

If API perimeter tests fail:

1. Re-run `bun test __tests__/api-core.test.ts __tests__/api-errors.test.ts __tests__/api-audit-logging.test.ts`.
2. Verify env var defaults and overrides for auth/rate-limit/body-size/audit options.
3. Verify `requestId` appears in both error envelope and `x-request-id` response header.

If MCP dispatch contract tests fail:

1. Re-run `bun test __tests__/mcp-dispatch.test.ts`.
2. Verify tool registration order/content in MCP server startup.
3. Verify each tool input schema still declares stable `type`, `required`, `properties`, and enum contracts.

If zap processing tests fail:

1. Re-run `bun test __tests__/zap-tools-tests.test.ts`.
2. Verify zap tag parsing paths (`description`, `bolt11`, `p`, `e`, `a`, `lnurl`) and fallback order.
3. Verify cache TTL/overflow behavior did not change unintentionally.

## Network-Dependent Suites

`NOSTR_NETWORK_TESTS=1` enables network-backed suites that can be flaky in constrained environments:

1. `integration` and `websocket-integration`.
2. `relay-tools`, `event-tools`, `social-tools`, `dm-tools`, `nip42-auth`, `ephemeral-relay`.
3. API integration tests that bind ephemeral ports (`api-audit-logging`, `api-errors`).
