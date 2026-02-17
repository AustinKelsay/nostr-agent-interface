# Profile Tools

This module handles Nostr identity lifecycle operations used by Nostr Agent Interface.

It inherits the original Nostr MCP Server tool contracts and exposes schema/logic that are transport-neutral (MCP, CLI, API).

## Files

1. `profile-tools.ts` - keypair generation, profile create/update, authenticated posting.

## Capabilities

1. `createKeypair`: Generate secure secp256k1 keys in hex, npub/nsec, or both.
2. `createProfile`: Publish kind 0 profile metadata.
3. `updateProfile`: Update replaceable profile metadata.
4. `postNote`: Authenticated one-step note publishing with existing keys.

## Key Behaviors

1. Accepts both hex and `nsec` private keys.
2. Derives/validates author pubkeys before signing.
3. Supports optional relay overrides with defaults fallback.
4. Surfaces clear validation and network errors.

## Usage

```typescript
import {
  createKeypair,
  createProfile,
  updateProfile,
  postNote,
  createKeypairToolConfig,
  createProfileToolConfig,
  updateProfileToolConfig,
  postNoteToolConfig,
} from "./profile/profile-tools.js";

const keys = await createKeypair("both");

await createProfile(keys.privateKey!, { name: "Alice", about: "Nostr builder" }, []);
await updateProfile(keys.privateKey!, { about: "Updated bio" }, []);
await postNote(keys.nsec!, "Shipping from Nostr Agent Interface", [["client", "nostr-agent-interface"]], []);

// Schemas are reused across MCP/CLI/API entrypoints.
void createKeypairToolConfig;
void createProfileToolConfig;
void updateProfileToolConfig;
void postNoteToolConfig;
```
