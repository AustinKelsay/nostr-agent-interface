import { describe, expect, test } from "bun:test";
import { encodePublicKey } from "snstr";
import {
  formatContacts,
  formatEvent,
  formatEvents,
  formatPubkey,
  formatRelayList,
} from "../utils/formatting.js";

describe("utils/formatting", () => {
  const hexPubkey = "1".repeat(64);
  const npub = encodePublicKey(hexPubkey);

  test("formatPubkey handles valid, invalid, short, and empty values", () => {
    expect(formatPubkey(hexPubkey)).toBe(npub);
    expect(formatPubkey(hexPubkey, true)).toBe(`${npub.substring(0, 8)}...${npub.substring(npub.length - 4)}`);

    const invalid = "z".repeat(64);
    expect(formatPubkey(invalid)).toBe(invalid);
    expect(formatPubkey(invalid, true)).toBe(`${invalid.substring(0, 4)}...${invalid.substring(60)}`);

    expect(formatPubkey("")).toBe("unknown");
  });

  test("formatContacts renders empty and populated contact lists", () => {
    expect(formatContacts([])).toBe("No contacts.");

    const rendered = formatContacts([
      { pubkey: hexPubkey, relay: "wss://relay.example", petname: "alice" },
      { pubkey: "x" as any },
      {} as any,
    ]);

    expect(rendered).toContain(`- ${npub} relay=wss://relay.example petname=alice`);
    expect(rendered).toContain("- x");
    expect(rendered).toContain("- unknown");
  });

  test("formatRelayList sorts output and shows read/write flags", () => {
    expect(formatRelayList([])).toBe("No relays.");

    const rendered = formatRelayList([
      { url: "wss://b.example", read: true, write: false },
      { url: "wss://a.example", read: false, write: true },
      { url: "wss://c.example", read: true, write: true },
    ]);

    const lines = rendered.split("\n");
    expect(lines[0]).toBe("- wss://a.example (write)");
    expect(lines[1]).toBe("- wss://b.example (read)");
    expect(lines[2]).toBe("- wss://c.example (read,write)");
  });

  test("formatEvent and formatEvents render expected fields", () => {
    const event = {
      id: "event-1",
      pubkey: hexPubkey,
      created_at: 1_700_000_000,
      kind: 1,
      tags: [["e", "abc"]],
      content: "a".repeat(300),
      sig: "sig",
    };

    const formatted = formatEvent(event);
    expect(formatted).toContain("Kind: 1");
    expect(formatted).toContain("ID: event-1");
    expect(formatted).toContain("Author:");
    expect(formatted).toContain("Tags: [[\"e\",\"abc\"]]");
    expect(formatted).toContain("\u2026");

    const formattedMany = formatEvents([event, { ...event, id: "event-2", content: "short" }]);
    expect(formattedMany).toContain("ID: event-1");
    expect(formattedMany).toContain("ID: event-2");
  });
});
