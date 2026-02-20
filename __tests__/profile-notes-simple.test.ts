import { describe, test, expect, beforeAll } from "bun:test";
import { createKeypair } from "../profile/profile-tools.js";
import {
  getProfile,
  getKind1Notes,
  getLongFormNotes,
} from "../src/profile-notes.js";

/** Fixture shape for profile and note assertions - derived from beforeAll, not hardcoded. */
interface ProfileFixture {
  pubkey: string;
  name: string;
  displayName: string;
  about: string;
  relays: string[];
}

interface Kind1NoteFixture {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
}

interface LongformNoteFixture {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
}

describe("Profile and Notes Functions", () => {
  let profileFixture: ProfileFixture;
  let kind1NoteFixture: Kind1NoteFixture;
  let longformNoteFixture: LongformNoteFixture;

  beforeAll(async () => {
    const keypair = await createKeypair("hex");
    expect(keypair).toBeDefined();
    expect(keypair.publicKey).toBeDefined();
    const pubkey = keypair.publicKey!;
    const relays = ["wss://relay.example.com"];

    profileFixture = {
      pubkey,
      name: "testuser",
      displayName: "Test User",
      about: "This is a test profile",
      relays,
    };

    kind1NoteFixture = {
      id: "note0",
      pubkey,
      kind: 1,
      content: "Test note 0",
    };

    longformNoteFixture = {
      id: "longform0",
      pubkey,
      kind: 30023,
      content: "Long Form Test 0",
      tags: [
        ["d", "article0"],
        ["title", "Long Form Test 0"],
      ],
    };
  });

  test("getProfile returns profile data from module export", async () => {
    const profile = await getProfile(profileFixture.pubkey, profileFixture.relays);

    expect(profile.pubkey).toBe(profileFixture.pubkey);
    expect(profile.name).toBe(profileFixture.name);
    expect(profile.displayName).toBe(profileFixture.displayName);
    expect(profile.about).toBe(profileFixture.about);
    expect(profile.relays).toEqual(profileFixture.relays);
  });

  test("getKind1Notes returns module notes with requested limit", async () => {
    const limit = 5;
    const notes = await getKind1Notes(profileFixture.pubkey, limit);

    expect(notes).toBeInstanceOf(Array);
    expect(notes.length).toBe(limit);
    expect(notes[0]?.id).toBe(kind1NoteFixture.id);
    expect(notes[0]?.pubkey).toBe(kind1NoteFixture.pubkey);
    expect(notes[0]?.kind).toBe(kind1NoteFixture.kind);
    expect(notes[0]?.content).toBe(kind1NoteFixture.content);
  });

  test("getLongFormNotes returns module long-form notes", async () => {
    const limit = 3;
    const notes = await getLongFormNotes(profileFixture.pubkey, limit);

    expect(notes).toBeInstanceOf(Array);
    expect(notes.length).toBe(limit);
    expect(notes[0]?.id).toBe(longformNoteFixture.id);
    expect(notes[0]?.pubkey).toBe(longformNoteFixture.pubkey);
    expect(notes[0]?.kind).toBe(longformNoteFixture.kind);
    expect(notes[0]?.content).toContain(longformNoteFixture.content);
    expect(notes[0]?.tags).toEqual(longformNoteFixture.tags);
  });
});
