import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeNoteId } from "snstr";
import { decodeEventId, formatZapReceipt, prepareAnonymousZap, processZapReceipt, type ZapReceipt } from "../zap/zap-tools.js";

describe("Zap Tools Simple (real module)", () => {
  const originalConsoleError = console.error;
  const targetPubkey = "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e";

  beforeAll(() => {
    console.error = () => {};
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  test("processZapReceipt enriches direction and fallback amount", () => {
    const zapReceipt: ZapReceipt = {
      id: `simple-zap-${Date.now()}`,
      pubkey: "zapper-pubkey",
      created_at: Math.floor(Date.now() / 1000),
      kind: 9735,
      tags: [
        ["p", targetPubkey],
        ["description", JSON.stringify({
          kind: 9734,
          content: "Simple zap",
          tags: [
            ["p", targetPubkey],
            ["amount", "5000"],
          ],
          pubkey: "sender-pubkey",
          id: "request-id",
          sig: "request-sig",
          created_at: Math.floor(Date.now() / 1000),
        })],
      ],
      content: "",
      sig: "test-sig",
    };

    const result = processZapReceipt(zapReceipt, targetPubkey);

    expect(result.id).toBe(zapReceipt.id);
    expect(result.targetPubkey).toBe(targetPubkey);
    expect(result.direction).toBe("received");
    expect(result.amountSats).toBe(5);
  });

  test("formatZapReceipt renders cached enriched zap details", () => {
    const zapReceipt: ZapReceipt = {
      id: `simple-format-${Date.now()}`,
      pubkey: "zapper-pubkey",
      created_at: Math.floor(Date.now() / 1000),
      kind: 9735,
      tags: [
        ["p", targetPubkey],
        ["description", JSON.stringify({
          kind: 9734,
          content: "Simple format comment",
          tags: [
            ["p", targetPubkey],
            ["amount", "9000"],
          ],
          pubkey: "sender-pubkey",
          id: "request-id",
          sig: "request-sig",
          created_at: Math.floor(Date.now() / 1000),
        })],
      ],
      content: "",
      sig: "test-sig",
    };

    processZapReceipt(zapReceipt, targetPubkey);
    const formatted = formatZapReceipt(zapReceipt);

    expect(formatted).toContain("RECEIVED");
    expect(formatted).toContain("Amount: 9 sats");
    expect(formatted).toContain("Comment: Simple format comment");
  });

  test("decodeEventId resolves hex and note identifiers", async () => {
    const eventIdHex = "a".repeat(64);
    const note = encodeNoteId(eventIdHex);

    const fromHex = await decodeEventId(eventIdHex.toUpperCase());
    const fromNote = await decodeEventId(note);

    expect(fromHex).toEqual({ type: "eventId", eventId: eventIdHex });
    expect(fromNote).toEqual({ type: "note", eventId: eventIdHex });
  });

  test("prepareAnonymousZap fails fast on invalid target", async () => {
    const result = await prepareAnonymousZap("invalid-target", 100, "test comment");

    expect(result?.success).toBe(false);
    expect(result?.invoice).toBe("");
    expect(result?.message).toContain("Invalid target");
  });
});
