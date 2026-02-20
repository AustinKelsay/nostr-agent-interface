import { beforeEach, describe, expect, mock, test } from "bun:test";

let throwConvert = false;
let throwAnalyze = false;

mock.module("../utils/conversion.js", () => ({
  convertNip19Entity: () => {
    if (throwConvert) throw new Error("convert blew up");
    return { success: true, result: "ok", originalType: "hex", data: "abc" };
  },
  analyzeNip19Entity: () => {
    if (throwAnalyze) throw new Error("analyze blew up");
    return { success: true, originalType: "hex", data: "abc", message: "ok" };
  },
}));

import { analyzeNip19, convertNip19, formatAnalysisResult } from "../utils/nip19-tools.js";

describe("utils/nip19-tools", () => {
  beforeEach(() => {
    throwConvert = false;
    throwAnalyze = false;
  });

  test("convertNip19 handles thrown conversion errors", async () => {
    throwConvert = true;
    const result = await convertNip19("abc", "hex");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Error during conversion: convert blew up");
  });

  test("analyzeNip19 handles thrown analysis errors", async () => {
    throwAnalyze = true;
    const result = await analyzeNip19("abc");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Error during analysis: analyze blew up");
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
