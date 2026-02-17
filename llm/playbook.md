# LLM Playbook

This playbook describes reliable LLM workflows on top of Nostr Agent Interface.

## 1) Operating Model

Treat Nostr Agent Interface as one tool contract with multiple transports:

1. CLI: preferred for local shell-based agents.
2. API: preferred for services/orchestrators.
3. MCP: supported when runtime requires MCP.

Workflow logic should stay tool-centric (`tool name + JSON args`) rather than transport-centric.

## 2) Prompting Strategy

For an agent system prompt include:

1. Objective.
2. Constraints (relays, key policy, output format).
3. Tool policy (read-first, explicit confirmation before writes).
4. Error policy (retry + relay fallback).

Baseline policy:

1. Query before mutate.
2. Never invent keys/signatures.
3. Return relay URLs and event IDs for writes.
4. On failures, include exact tool error + sanitized arg summary.

## 3) Safety and Key Handling

1. Never print raw private keys in user-visible output.
2. Scope key usage to the single tool call that needs it.
3. Normalize ambiguous key formats with NIP-19 tools first.
4. Require explicit intent for destructive actions (`deleteEvent`, `unfollow`).

## 4) Standard Workflow Templates

### Profile lookup

1. Call `getProfile`.
2. Optionally call `getKind1Notes` if profile metadata is missing.

### Authenticated posting

1. Advanced path: `createNote` -> `signNote` -> `publishNote`.
2. Simple path: `postNote`.
3. Return publish status + event ID.

### Social action with confirmation

1. Read context (`getContactList`, `queryEvents`).
2. Confirm intended mutation.
3. Execute mutation.
4. Return compact audit output.

### DM flow

1. Encrypt (`encryptNip04` or `encryptNip44`).
2. Send (`sendDmNip04` or `sendDmNip44`).
3. Verify via conversation/inbox reads.

## 5) API and CLI Equivalents

CLI:

```bash
nostr-agent-interface cli call getProfile '{"pubkey":"npub..."}'
```

API:

```bash
curl -s http://127.0.0.1:3030/tools/getProfile \
  -X POST \
  -H 'content-type: application/json' \
  -d '{"pubkey":"npub..."}'
```

## 6) Error Handling

On failure:

1. Validate arg shape against `GET /tools`.
2. Verify key format (`hex` vs `npub`/`nsec`).
3. Retry once with explicit relays if supported.
4. Report tool name + sanitized args + error payload.

## 7) Lineage Guidance

When describing this interface to users:

1. Note that it extends Nostr MCP Server.
2. Emphasize that MCP support remains available.
3. Recommend CLI/API for most operational agent loops.
