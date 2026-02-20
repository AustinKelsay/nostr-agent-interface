import { describe, expect, test } from "bun:test";

import { analyzeNip19, convertNip19, formatAnalysisResult } from "../utils/nip19-tools.js";

describe("utils/nip19-tools", () => {
  test("convertNip19 surfaces conversion failures for invalid inputs", async () => {
    const result = await convertNip19("abc", "hex");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not a valid NIP-19 entity");
  });

  test("analyzeNip19 surfaces analysis failures for invalid inputs", async () => {
    const result = await analyzeNip19("abc");
    expect(result.success).toBe(false);
    expect(result.message).toContain("not a valid NIP-19 entity");
  });

  test("formatAnalysisResult renders all supported types and unknown fallback", () => {
    expect(formatAnalysisResult("hex", "deadbeef")).toContain("Hex String: deadbeef");
    expect(formatAnalysisResult("npub", "npub1abc")).toContain("Public Key (npub): npub1abc");
    expect(formatAnalysisResult("nsec", "nsec1abc")).toContain("Private Key (nsec): nsec1abc");
    expect(formatAnalysisResult("note", "note1abc")).toContain("Note ID: note1abc");

    expect(
      formatAnalysisResult("nprofile", { pubkey: "pub", relays: ["wss://a", "wss://b"] }),
    ).toContain("Relays: wss://a, wss://b");
    expect(
      formatAnalysisResult("nevent", { id: "id", author: "pub", kind: 1, relays: ["wss://a"] }),
    ).toContain("Event ID: id");
    expect(
      formatAnalysisResult("naddr", { identifier: "slug", pubkey: "pub", kind: 30023, relays: [] }),
    ).toContain("Identifier: slug");

    expect(formatAnalysisResult("something-else", {})).toContain("Unknown type: something-else");
  });
});
