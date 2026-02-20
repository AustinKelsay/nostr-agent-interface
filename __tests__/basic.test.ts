import { describe, test, expect } from "bun:test";
import { formatProfile } from "../note/note-tools.js";
import { processZapReceipt, type ZapReceipt } from "../zap/zap-tools.js";

describe("Basic Nostr Functionality", () => {
  test("profile formatting should work correctly", () => {
    const profileEvent = {
      id: "1234",
      pubkey: "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e",
      created_at: Math.floor(Date.now() / 1000) - 3600,
      kind: 0,
      tags: [],
      content: JSON.stringify({
        name: "Test User",
        display_name: "Tester",
        about: "A test profile for unit tests",
      }),
      sig: "mock_signature",
    };

    const result = formatProfile(profileEvent as any);

    expect(result).toContain("Name: Test User");
    expect(result).toContain("Display Name: Tester");
    expect(result).toContain("About: A test profile for unit tests");
  });

  test("profile formatting should handle empty fields", () => {
    const profileEvent = {
      id: "5678",
      pubkey: "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e",
      created_at: Math.floor(Date.now() / 1000) - 3600,
      kind: 0,
      tags: [],
      content: JSON.stringify({ name: "Minimal User" }),
      sig: "mock_signature",
    };

    const result = formatProfile(profileEvent as any);

    expect(result).toContain("Name: Minimal User");
    expect(result).toContain("Display Name: Minimal User");
    expect(result).toContain("About: No about information");
  });

  test("zap receipt processing uses real module behavior", () => {
    const targetPubkey = "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e";
    const senderPubkey = "f".repeat(64);
    const now = Math.floor(Date.now() / 1000);

    const zapRequest = {
      kind: 9734,
      content: "",
      tags: [["amount", "10000"]],
      pubkey: senderPubkey,
      id: "a".repeat(64),
      sig: "b".repeat(128),
      created_at: now - 900,
    };

    const zapReceipt: ZapReceipt = {
      id: `basic-zap-${Date.now()}`,
      pubkey: "c".repeat(64),
      created_at: now - 600,
      kind: 9735,
      tags: [
        ["p", targetPubkey],
        ["description", JSON.stringify(zapRequest)],
      ],
      content: "",
      sig: "d".repeat(128),
    };

    const result = processZapReceipt(zapReceipt, targetPubkey);

    expect(result.direction).toBe("received");
    expect(result.amountSats).toBe(10);
    expect(result.targetPubkey).toBe(targetPubkey);
  });
});
