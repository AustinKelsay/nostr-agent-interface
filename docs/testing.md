# Testing Guide

This project currently uses Bun test suites and includes explicit parity checks across MCP, CLI, and API interfaces.

## Goals

1. Keep behavior consistent across all transports.
2. Catch regressions in interface wrappers early.
3. Keep test runs deterministic where possible.

## Core Commands

```bash
# Run all tests
bun test

# Run parity + CLI UX suites only
bun test __tests__/interface-parity.test.ts __tests__/cli-ux.test.ts

# Run API error envelope tests
bun test __tests__/api-errors.test.ts

# Build first (recommended before integration-style tests)
bun run build
```

## Interface Parity Contract

Parity means:

1. The same tool list is available from MCP, CLI, and API.
2. Calling the same tool with the same JSON args yields equivalent semantic output.
3. Error state parity is preserved (`isError` behavior matches).

Current parity suite:

- `__tests__/interface-parity.test.ts`

It validates:

1. `list-tools` parity (tool names match across interfaces)
2. tool-call parity for deterministic validation-path cases:
   - `getProfile`
   - `queryEvents`
   - `postNote`

These cases intentionally use invalid inputs so they do not depend on external relay state and remain stable in CI/local.

## CLI UX Tests

CLI UX coverage lives in:

- `__tests__/cli-ux.test.ts`

It verifies:

1. subcommand help output
2. `--json` output mode behavior
3. `--stdin` JSON args flow
4. argument validation (for example, disallowing both positional JSON and `--stdin`)

## API Error Envelope Tests

Standardized API error shape coverage lives in:

- `__tests__/api-errors.test.ts`

It verifies:

1. `not_found` error payload shape
2. `invalid_json` payload shape for malformed request bodies
3. `x-request-id` response header and body `requestId` correlation

## Tool Manifest Validation

The build process generates:

- `artifacts/tools.json`

Validate generation with:

```bash
bun run build
```

or:

```bash
bun run generate:tools-manifest
```

## Config-Aware Testing

Config precedence for tests follows runtime behavior:

1. explicit arguments
2. environment variables
3. built-in defaults

Useful env vars during testing:

1. `NOSTR_DEFAULT_RELAYS`
2. `NOSTR_AGENT_API_HOST`
3. `NOSTR_AGENT_API_PORT`
4. `NOSTR_MCP_COMMAND`
5. `NOSTR_MCP_ARGS`

Use `.env.example` as baseline documentation for expected values.

## Extending the Parity Suite

When adding a new tool or changing behavior:

1. add at least one parity case in `__tests__/interface-parity.test.ts`
2. prefer deterministic inputs (validation-path or local relay fixture driven)
3. compare semantic output, not formatting artifacts
4. include error parity assertions when relevant

Suggested expansion path:

1. add positive-path parity cases for read-only tools with stable local fixtures
2. add parity coverage for at least one mutation workflow once fixture harness is in place

## Troubleshooting

If parity tests fail:

1. run `bun run build` and rerun tests
2. verify CLI/API wrappers still call MCP tools directly
3. check for schema drift via `list-tools` response
4. inspect stderr for MCP child process startup failures
