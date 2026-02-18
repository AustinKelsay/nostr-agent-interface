# Nostr Agent Interface Test Suite

This directory contains tests for the shared Nostr tool contract and its MCP/CLI/API surfaces, with CLI/API as the preferred operational transports and MCP kept in parity.

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
9. `zap-tools-tests.test.ts`
10. `nip19-conversion.test.ts`
11. `nip42-auth.test.ts`

Interface tests include:

1. `interface-parity.test.ts`
2. `cli-ux.test.ts`
3. `api-errors.test.ts` (error envelope + API auth + API rate limiting)
4. `api-audit-logging.test.ts` (structured API audit logs + redaction)

Integration tests include:

1. `integration.test.ts`
2. `websocket-integration.test.ts`

## Running Tests

```bash
bun test
bun run test:parity
```

## Design Notes

1. Tests prioritize deterministic validation paths for parity checks.
2. Integration tests rely on the in-memory relay in `utils/ephemeral-relay.ts`.
3. Coverage focuses on tool-contract stability and transport consistency.
