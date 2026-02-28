# CLI Direct Tool Execution Migration Plan

## Goal
Implement a direct runtime architecture where CLI and API execute tools in-process by default, while MCP remains a separate, explicit interface.

## Current Baseline
- `app/cli.ts` uses `app/cli/tool-runtime.ts`, while `app/api.ts` imports and uses `app/tool-runtime.ts` directly.
- `app/index.ts` remains the MCP-mode entrypoint, with direct tool registration preserved for compatibility.
- `cli` and `api` no longer depend on MCP transport for tool execution; they both execute the same shared handlers directly.
- This removes the MCP stdio startup/IPC hop for normal CLI/API operation.

## Success Criteria
- CLI semantics stay identical for:
  - `list-tools`, `--help`, direct-tool invocation, `call`, required arg validation, and `--json` behavior.
- `--json` output for CLI tool invocations is clean JSON on `stdout`, with parseable MCP-like payloads on success and tool-result failures.
- `NOSTR_JSON_ONLY=true` suppresses CLI stderr logs for JSON-mode scripts.
- MCP remains explicitly available as a standalone interface (`nostr-agent-interface mcp`) with its own process contract.
- CLI/API keep shared tool behavior through the same in-process handler paths.
- Observability and timeout/error ordering remain equivalent for representative deterministic paths.
- `CompatibleRelayPool` enforces a hard timeout around `querySync` calls so operations cannot exceed configured timeout budgets indefinitely.

## Phase 1 — Introduce CLI tool-runtime abstraction
- Add `app/cli/tool-runtime.ts`.
- Implemented abstraction with shared tool handlers:
  - `listTools(): Promise<unknown>`
  - `callTool(name, args): Promise<unknown>`
  - `close(): Promise<void>`
- Update `app/cli.ts` to consume this abstraction instead of calling MCP client directly.
- Done.

### Why this phase first
- Gives us a single seam where MCP behavior and direct behavior can be compared.
- Makes runtime parity and future changes low-risk and reviewable.

## Phase 2 — Build direct tool dispatch layer
- Use MCP registration metadata to build direct in-process dispatch with normalized JSON schemas.
- Reuse existing tool modules and handlers while preserving `callTool` payload shape.
- Ensure parser normalization mirrors tool schema type expectations.
- Done.

## Phase 3 — Port CLI to direct path
- CLI now executes through direct runtime by default.
- MCP remains separate command mode only.
- API uses direct runtime in-process.
- Done.

## Phase 4 — Hardening and parity
- Reconcile output formatting differences (`content` block formatting, isError handling).
- Add focused parity checks for deterministic tools and failure scenarios.
- Validate parity expectations in both direct CLI and in-process API harness.
- Document timeout hardening and JSON-only output behavior.
- Done.

## Current status
- MCP transport is no longer used as a CLI/API execution path.
- Standalone MCP mode remains available via `nostr-agent-interface mcp`.
- CLI/API now share the same runtime behavior for tool discovery and tool invocation.
- Network-dependent suites are explicitly quarantined via `NOSTR_NETWORK_TESTS`.

## Suggested Immediate Task Split
1. Continue broadening deterministic parity fixtures for edge/error branches.
2. Keep docs and test matrix aligned with direct-only CLI/API defaults.
3. Expand direct vs MCP compatibility assertions where it materially reduces regression risk.

## Open Implementation Risks
- Deterministic parity is now established for core paths, and timeout-heavy branches are now explicitly bounded by hard timeout behavior in `CompatibleRelayPool`.
- Script-facing behavior (especially `text` ordering in rare edge paths) must remain byte-stable where relied upon by integrations.
