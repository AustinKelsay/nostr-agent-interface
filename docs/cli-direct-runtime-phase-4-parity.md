# Phase 4: CLI Direct Runtime Parity Sweep

Goal
- Confirm shared in-process CLI/API direct execution paths remain behaviorally equivalent on deterministic paths and preserve expected contract-shape for scripts.
- Focus scope: tool return structure, text ordering, and error semantics where responses are stable and fast.

Scope
- Deterministic tool outputs
  - `convertNip19` (valid + invalid conversion path)
  - `queryEvents` invalid-argument path (invalid author)
  - `postNote` invalid private key path
- Interface parity baseline
  - `__tests__/interface-parity.test.ts` compares CLI and API results for stable tool paths.
  - `__tests__/mcp-dispatch.test.ts` validates MCP server registration and dispatch contracts independently.

Acceptance checks
- `content` is always an array and `isError` is boolean-equivalent across MCP and direct runs.
- Content blocks are byte-identical (`JSON.stringify`) when compared as ordered arrays where stable.
- Script-facing text is ordered identically (`textBlocksInOrder` exact match, newline split checks).
- Tool names and schemas remain aligned across MCP catalog, CLI list-tools, and API tooling surface.

Implementation notes
- Added parity helpers in [`__tests__/interface-parity.test.ts`](../__tests__/interface-parity.test.ts):
  - `getContentBlocks`
  - `textBlocksInOrder`
  - `assertToolResultParity`
- Added and updated cases:
  - `cli direct transport preserves deterministic error text ordering` (existing case strengthened)
  - `cli direct transport and MCP dispatch output are structurally aligned` now checks content/text parity
  - `tool call behavior matches for deterministic validation paths` across CLI and API.

Current status
- CLI/API direct runtime parity is now the default implementation.
- MCP parity remains covered via dedicated MCP dispatch tests and schema checks.
- Timeout semantics for live relay paths are intentionally excluded from parity expectations due environment-dependent timing variance.
