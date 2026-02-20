import { describe, expect, test } from "bun:test";
import { encodePrivateKey, generateKeypair } from "snstr";
import { normalizePrivateKey } from "../utils/keys.js";

describe("utils/keys normalizePrivateKey", () => {
  test("normalizes hex private keys", () => {
    const mixedCaseHex = "A".repeat(64);
    expect(normalizePrivateKey(`  ${mixedCaseHex}  `)).toBe("a".repeat(64));
  });

  test("normalizes nsec private keys", async () => {
    const keys = await generateKeypair();
    const nsec = encodePrivateKey(keys.privateKey);
    expect(normalizePrivateKey(nsec)).toBe(keys.privateKey.toLowerCase());
  });

  test("rejects malformed nsec values", () => {
    expect(() => normalizePrivateKey("nsec1INVALID***")).toThrow(
      "Invalid nsec format: must match pattern nsec1[0-9a-z]+",
    );
  });

  test("rejects unsupported private key formats", () => {
    expect(() => normalizePrivateKey("not-a-key")).toThrow(
      "Invalid private key format: must be 64-character hex string or valid nsec format",
    );
  });
});
