# Note Tools

This module contains note-centric operations for Nostr Agent Interface, including read, create, sign, publish, and anonymous posting flows.

Schemas and handlers are reused across MCP, CLI, and API transports, with CLI/API as the preferred operational interfaces.

## Files

1. `note-tools.ts` - note/profile reads, note lifecycle, anonymous note helpers.

## Capabilities

1. Read profile metadata and note streams (`getProfile`, `getKind1Notes`, `getLongFormNotes`).
2. Create unsigned notes (`createNote`).
3. Sign notes (`signNote`).
4. Publish signed notes (`publishNote`).
5. Post anonymous notes with one-time keys (`postAnonymousNote`).

## Technical Notes

1. Supports hex + NIP-19 key formats where applicable.
2. Uses shared key normalization helpers.
3. Uses relay pool lifecycle cleanup for stable network behavior.
4. Returns structured, user-friendly validation errors.

## Usage

```typescript
import {
  createNote,
  signNote,
  publishNote,
  postAnonymousNote,
  getProfileToolConfig,
  getKind1NotesToolConfig,
  getLongFormNotesToolConfig,
  createNoteToolConfig,
  signNoteToolConfig,
  publishNoteToolConfig,
  postAnonymousNoteToolConfig,
} from "./note/note-tools.js";

const unsigned = await createNote("nsec1...", "Hello Nostr", [["t", "nostr"]]);
const signed = await signNote("nsec1...", unsigned.noteEvent);
await publishNote(signed.signedNote, ["wss://relay.damus.io"]);
await postAnonymousNote("Anonymous message", ["wss://nos.lol"], [["t", "anon"]]);

// Schemas are reused across transports.
void getProfileToolConfig;
void getKind1NotesToolConfig;
void getLongFormNotesToolConfig;
void createNoteToolConfig;
void signNoteToolConfig;
void publishNoteToolConfig;
void postAnonymousNoteToolConfig;
```
