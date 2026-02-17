# LLM Playbook

This playbook describes how to run reliable LLM workflows on top of Nostr Agent Interface.

## 1) Operating Model

Treat Nostr Agent Interface as one tool surface with three equivalent transports:

1. MCP: best for direct MCP-capable assistants.
2. CLI: best for local scripts and shell agents.
3. API: best for remote services and orchestrators.

Use whichever transport is available in your runtime, but keep workflow logic tool-centric (tool name + JSON args).

## 2) Prompting Strategy

For an agent system prompt, include:

1. Objective: what Nostr task should be completed.
2. Constraints: required relays, private key policies, output format.
3. Tool policy: read-first, then write only with explicit confirmation.
4. Error policy: retry rules and fallback relay behavior.

Suggested baseline policy:

1. Query before mutate.
2. Never invent keys or signatures.
3. Echo relay and event IDs in final output.
4. On failures, include exact tool error and attempted args summary.

## 3) Safety and Key Handling

1. Avoid logging raw private keys in user-visible output.
2. Prefer scoped key usage: pass key only to the tool call that needs it.
3. If key format is ambiguous, normalize via NIP-19 utility tools first.
4. For destructive actions (`deleteEvent`, unfollow), require explicit user intent.

## 4) Standard Workflow Templates

## Profile lookup

1. Call `getProfile`.
2. If missing, optionally query notes with `getKind1Notes` to verify activity.

## Authenticated posting

1. If note needs preprocessing/tags, run `createNote` -> `signNote` -> `publishNote`.
2. If simple post is enough, use `postNote`.
3. Return publish status and event ID.

## Social action with confirmation

1. Read current state (`getContactList`, `queryEvents`).
2. Confirm intended mutation.
3. Execute (`follow`, `unfollow`, `reactToEvent`, `replyToEvent`, etc.).
4. Return compact audit output (target, relays, resulting IDs).

## DM flow

1. Encrypt with `encryptNip04` or `encryptNip44` as required.
2. Send with matching send tool.
3. Validate retrieval/decryption using conversation or inbox read tools.

## 5) API and CLI Equivalents

`getProfile` example:

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

When a tool call fails:

1. Check argument shape against `GET /tools` schema or MCP tool schema.
2. Verify key format (`hex` vs `npub`/`nsec`).
3. Retry once with explicit relays where supported.
4. Report failure with:
   - tool name
   - sanitized args summary
   - server error text

## 7) Suggested Next Docs

As the project grows, extend this folder with:

1. `workflows/` per domain (profile, notes, social, DM, zaps).
2. transport compatibility matrix and known edge cases.
3. eval prompts and goldens for regression testing agent behavior.
