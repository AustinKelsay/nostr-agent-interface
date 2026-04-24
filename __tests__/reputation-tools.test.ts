import { describe, it, expect } from "bun:test";

// Test the internal validation and scoring logic via the module exports
// Since reputation-tools.ts exports handler functions, we test through them

describe("reputation-tools", () => {
  describe("getReputation", () => {
    it("should reject invalid pubkey", async () => {
      const { getReputation } = await import("../reputation/reputation-tools.js");
      const res = await getReputation({ pubkey: "invalid" });
      expect(res.success).toBe(false);
      expect(res.message).toContain("Invalid");
    });
  });

  describe("getAttestations", () => {
    it("should reject invalid pubkey", async () => {
      const { getAttestations } = await import("../reputation/reputation-tools.js");
      const res = await getAttestations({ pubkey: "not-a-key" });
      expect(res.success).toBe(false);
    });
  });

  describe("createReputationAttestation", () => {
    it("should reject self-attestation", async () => {
      const { createReputationAttestation } = await import("../reputation/reputation-tools.js");
      // Generate a keypair where attestor === subject
      const { schnorr } = await import("@noble/curves/secp256k1");
      const privKey = "a".repeat(64); // deterministic for test
      const pubKey = Buffer.from(schnorr.getPublicKey(privKey)).toString("hex");

      const res = await createReputationAttestation({
        privateKey: privKey,
        subjectPubkey: pubKey,
        context: "test",
        rating: 5,
        confidence: 1.0,
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain("self-attestation");
    });

    it("should reject invalid subject pubkey", async () => {
      const { createReputationAttestation } = await import("../reputation/reputation-tools.js");
      const res = await createReputationAttestation({
        privateKey: "a".repeat(64),
        subjectPubkey: "invalid",
        context: "test",
        rating: 5,
        confidence: 1.0,
      });
      expect(res.success).toBe(false);
      expect(res.message).toContain("Invalid");
    });
  });

  describe("formatAttestationsList", () => {
    it("should format attestations with stars", async () => {
      const { formatAttestationsList } = await import("../reputation/reputation-tools.js");
      const result = formatAttestationsList([{
        attestor: "a".repeat(64),
        subject: "b".repeat(64),
        context: "reliability",
        rating: 4,
        confidence: 0.85,
        evidence: null,
        commitment_class: "self_assertion",
        commitment_weight: 1.0,
        half_life: 7776000,
        created_at: Math.floor(Date.now() / 1000) - 86400,
        expiration: Math.floor(Date.now() / 1000) + 86400 * 180,
        decay_factor: 0.99,
      }]);

      expect(result).toContain("★★★★☆");
      expect(result).toContain("reliability");
      expect(result).toContain("85%");
    });
  });

  describe("formatReputationSummary", () => {
    it("should warn on high concentration", async () => {
      const { formatReputationSummary } = await import("../reputation/reputation-tools.js");
      const result = formatReputationSummary({
        pubkey: "b".repeat(64),
        score: 4.5,
        count: 5,
        diversity: { entropy: 0.5, herfindahl: 0.8, uniqueCount: 2 },
        decayType: "exponential",
      });

      expect(result).toContain("4.50/5.0");
      expect(result).toContain("Sybil");
    });
  });
});
