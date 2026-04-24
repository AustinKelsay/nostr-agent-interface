/**
 * Reputation Tools — Kind 30085 Agent Reputation Attestations
 *
 * Implements querying, scoring, and creating reputation attestations
 * per the NIP-XX specification: https://github.com/nostr-protocol/nips/pull/2320
 */

import { z } from "zod";
import { schnorr } from "@noble/curves/secp256k1";
import { createEvent, getEventHash, signEvent } from "snstr";
import {
  NostrEvent,
  NostrFilter,
  DEFAULT_RELAYS,
  QUERY_TIMEOUT,
  getFreshPool,
  npubToHex,
  formatPubkey,
  normalizePrivateKey,
} from "../utils/index.js";

// ============================================================================
// Constants
// ============================================================================

const KIND_REPUTATION = 30085;
const DEFAULT_HALF_LIFE = 7_776_000; // 90 days in seconds

const HALF_LIFE_CLASSES: Record<string, number> = {
  slow: 15_552_000,     // 180 days
  standard: 7_776_000,  // 90 days
  fast: 2_592_000,      // 30 days
};

const COMMITMENT_CLASSES: Record<string, number> = {
  self_assertion: 1.0,
  social_endorsement: 1.05,
  computational_proof: 1.1,
  time_lock: 1.15,
  economic_settlement: 1.25,
};

// ============================================================================
// Tool Configs (Zod schemas)
// ============================================================================

export const getReputationToolConfig = {
  pubkey: z.string().describe("Public key of the subject to check (hex or npub)"),
  context: z.string().optional().describe("Filter by context namespace (e.g., 'reliability', 'code.review')"),
  decayType: z.enum(["exponential", "gaussian"]).default("exponential")
    .describe("Decay type: 'exponential' (long-tail) or 'gaussian' (aggressive drop-off)"),
  limit: z.number().min(1).max(500).default(100).describe("Maximum attestations to fetch for scoring (default 100)"),
  relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
};

export const getAttestationsToolConfig = {
  pubkey: z.string().describe("Public key of the subject (hex or npub)"),
  limit: z.number().min(1).max(100).default(20).describe("Maximum attestations to fetch"),
  context: z.string().optional().describe("Filter by context namespace"),
  relays: z.array(z.string()).optional().describe("Optional list of relays to query"),
};

export const createAttestationToolConfig = {
  privateKey: z.string().describe("Your private key (hex or nsec) for signing"),
  subjectPubkey: z.string().describe("Subject's public key (hex or npub)"),
  context: z.string().describe("Context namespace (e.g., 'reliability', 'code.review')"),
  rating: z.number().int().min(1).max(5).describe("Rating from 1 (poor) to 5 (excellent)"),
  confidence: z.number().min(0).max(1).describe("Confidence level from 0.0 to 1.0"),
  commitmentClass: z.enum([
    "self_assertion", "social_endorsement", "computational_proof",
    "time_lock", "economic_settlement"
  ]).default("self_assertion").describe("Commitment class (higher = more Sybil-resistant)"),
  evidence: z.array(z.string()).optional().describe("Optional evidence strings"),
  expirationDays: z.number().int().min(1).max(365).default(180).describe("Days until expiration"),
  halfLifeClass: z.enum(["slow", "standard", "fast"]).optional()
    .describe("Decay speed: slow (180d), standard (90d), fast (30d)"),
  relays: z.array(z.string()).optional().describe("Optional list of relays to publish to"),
};

// ============================================================================
// Validation
// ============================================================================

interface ValidationResult {
  valid: boolean;
  error: string | null;
}

function validateAttestation(event: NostrEvent, now: number): ValidationResult {
  if (event.kind !== KIND_REPUTATION) {
    return { valid: false, error: `wrong kind: ${event.kind}` };
  }

  let content: any;
  try {
    content = JSON.parse(event.content);
  } catch {
    return { valid: false, error: "invalid JSON content" };
  }

  for (const field of ["subject", "rating", "context", "confidence"]) {
    if (!(field in content)) {
      return { valid: false, error: `missing field: ${field}` };
    }
  }

  const tag = (name: string) => (event.tags || []).find((t: string[]) => t[0] === name)?.[1];

  const p = tag("p");
  const t = tag("t");
  const d = tag("d");
  const exp = tag("expiration");

  if (!p || content.subject !== p) return { valid: false, error: "subject/p-tag mismatch" };
  if (!t || content.context !== t) return { valid: false, error: "context/t-tag mismatch" };
  if (d !== `${p}:${t}`) return { valid: false, error: "d-tag mismatch" };

  if (!Number.isInteger(content.rating) || content.rating < 1 || content.rating > 5) {
    return { valid: false, error: "rating must be int in [1,5]" };
  }
  if (typeof content.confidence !== "number" || content.confidence < 0 || content.confidence > 1) {
    return { valid: false, error: "confidence must be in [0,1]" };
  }

  if (!exp || isNaN(parseInt(exp, 10))) {
    return { valid: false, error: "missing expiration" };
  }

  if (event.pubkey === content.subject) {
    return { valid: false, error: "self-attestation" };
  }

  if (now >= parseInt(exp, 10)) {
    return { valid: false, error: "expired" };
  }

  return { valid: true, error: null };
}

// ============================================================================
// Decay & Scoring
// ============================================================================

const GAUSSIAN_SIGMA_FACTOR = 1 / Math.sqrt(2 * Math.LN2);

function decay(createdAt: number, now: number, halfLife: number, type: string): number {
  const age = now - createdAt;
  if (age <= 0) return 1.0;
  if (type === "gaussian") {
    const sigma = halfLife * GAUSSIAN_SIGMA_FACTOR;
    return Math.exp(-0.5 * Math.pow(age / sigma, 2));
  }
  return Math.pow(2, -age / halfLife);
}

interface ParsedAttestation {
  attestor: string;
  subject: string;
  context: string;
  rating: number;
  confidence: number;
  evidence: string[] | null;
  commitment_class: string;
  commitment_weight: number;
  half_life: number;
  created_at: number;
  expiration: number;
  decay_factor: number;
}

function parseAttestation(event: NostrEvent, now: number, decayType: string): ParsedAttestation {
  const content = JSON.parse(event.content);
  const tag = (name: string) => (event.tags || []).find((t: string[]) => t[0] === name)?.[1];

  const hlClass = tag("half_life_class");
  const halfLife = hlClass && HALF_LIFE_CLASSES[hlClass] ? HALF_LIFE_CLASSES[hlClass] : DEFAULT_HALF_LIFE;

  const commitmentClass = content.commitment_class || tag("commitment_class") || "self_assertion";
  const commitmentWeight = COMMITMENT_CLASSES[commitmentClass] || 1.0;

  return {
    attestor: event.pubkey,
    subject: content.subject,
    context: content.context,
    rating: content.rating,
    confidence: content.confidence,
    evidence: content.evidence || null,
    commitment_class: commitmentClass,
    commitment_weight: commitmentWeight,
    half_life: halfLife,
    created_at: event.created_at,
    expiration: parseInt(tag("expiration") || "0", 10),
    decay_factor: decay(event.created_at, now, halfLife, decayType),
  };
}

function computeScore(attestations: ParsedAttestation[], now: number, decayType: string): number {
  if (!attestations.length) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const a of attestations) {
    const d = decay(a.created_at, now, a.half_life, decayType);
    const weight = a.confidence * d * a.commitment_weight;
    weightedSum += a.rating * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function computeDiversity(pubkeys: string[]): { entropy: number; herfindahl: number; uniqueCount: number } {
  if (!pubkeys.length) return { entropy: 0, herfindahl: 1, uniqueCount: 0 };

  const counts: Record<string, number> = {};
  for (const pk of pubkeys) counts[pk] = (counts[pk] || 0) + 1;

  const total = pubkeys.length;
  const uniqueCount = Object.keys(counts).length;

  let entropy = 0;
  let herfindahl = 0;
  for (const count of Object.values(counts)) {
    const p = count / total;
    entropy -= p * Math.log2(p);
    herfindahl += p * p;
  }

  return { entropy, herfindahl, uniqueCount };
}

// ============================================================================
// Handler Functions
// ============================================================================

export async function getReputation(params: {
  pubkey: string;
  context?: string;
  decayType?: string;
  limit?: number;
  relays?: string[];
}): Promise<{
  success: boolean;
  message: string;
  score?: number;
  count?: number;
  diversity?: { entropy: number; herfindahl: number; uniqueCount: number };
  attestations?: ParsedAttestation[];
}> {
  const hexPubkey = npubToHex(params.pubkey);
  if (!hexPubkey) {
    return { success: false, message: "Invalid public key format." };
  }

  const relays = params.relays || DEFAULT_RELAYS;
  const now = Math.floor(Date.now() / 1000);
  const decayType = params.decayType || "exponential";
  const pool = getFreshPool(relays);

  try {
    const filter: any = {
      kinds: [KIND_REPUTATION],
      "#p": [hexPubkey],
      limit: params.limit || 100,
    };

    if (params.context) {
      filter["#t"] = [params.context];
    }

    const events = await pool.querySync(relays, filter, { timeout: QUERY_TIMEOUT });

    if (!events || events.length === 0) {
      return {
        success: true,
        message: `No reputation attestations found for ${formatPubkey(hexPubkey)}.`,
        score: 0,
        count: 0,
        diversity: { entropy: 0, herfindahl: 1, uniqueCount: 0 },
      };
    }

    // Validate and parse
    const valid = events.filter((e: NostrEvent) => validateAttestation(e, now).valid);
    const attestations = valid.map((e: NostrEvent) => parseAttestation(e, now, decayType));
    const score = computeScore(attestations, now, decayType);
    const diversity = computeDiversity(attestations.map((a) => a.attestor));

    const contextInfo = params.context ? ` (context: ${params.context})` : "";
    return {
      success: true,
      message: `Reputation for ${formatPubkey(hexPubkey)}${contextInfo}: ${score.toFixed(2)}/5.0 from ${attestations.length} attestation(s).`,
      score: Math.round(score * 100) / 100,
      count: attestations.length,
      diversity,
      attestations,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error querying reputation: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  } finally {
    await pool.close();
  }
}

export async function getAttestations(params: {
  pubkey: string;
  limit?: number;
  context?: string;
  relays?: string[];
}): Promise<{
  success: boolean;
  message: string;
  attestations?: ParsedAttestation[];
  invalidCount?: number;
}> {
  const hexPubkey = npubToHex(params.pubkey);
  if (!hexPubkey) {
    return { success: false, message: "Invalid public key format." };
  }

  const relays = params.relays || DEFAULT_RELAYS;
  const limit = params.limit || 20;
  const now = Math.floor(Date.now() / 1000);
  const pool = getFreshPool(relays);

  try {
    const filter: any = {
      kinds: [KIND_REPUTATION],
      "#p": [hexPubkey],
      limit: limit * 2, // fetch extra to account for invalid ones
    };

    if (params.context) {
      filter["#t"] = [params.context];
    }

    const events = await pool.querySync(relays, filter, { timeout: QUERY_TIMEOUT });

    if (!events || events.length === 0) {
      return {
        success: true,
        message: `No attestations found for ${formatPubkey(hexPubkey)}.`,
        attestations: [],
        invalidCount: 0,
      };
    }

    let invalidCount = 0;
    const attestations: ParsedAttestation[] = [];

    for (const e of events) {
      const result = validateAttestation(e, now);
      if (result.valid) {
        attestations.push(parseAttestation(e, now, "exponential"));
      } else {
        invalidCount++;
      }
    }

    // Sort by creation time, newest first
    attestations.sort((a, b) => b.created_at - a.created_at);
    const limited = attestations.slice(0, limit);

    return {
      success: true,
      message: `Found ${limited.length} valid attestation(s) for ${formatPubkey(hexPubkey)}${invalidCount > 0 ? ` (${invalidCount} invalid filtered)` : ""}.`,
      attestations: limited,
      invalidCount,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error fetching attestations: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  } finally {
    await pool.close();
  }
}

export async function createReputationAttestation(params: {
  privateKey: string;
  subjectPubkey: string;
  context: string;
  rating: number;
  confidence: number;
  commitmentClass?: string;
  evidence?: string[];
  expirationDays?: number;
  halfLifeClass?: string;
  relays?: string[];
}): Promise<{
  success: boolean;
  message: string;
  eventId?: string;
}> {
  // Normalize private key
  let privateKeyHex: string;
  try {
    privateKeyHex = normalizePrivateKey(params.privateKey);
  } catch {
    return { success: false, message: "Invalid private key format." };
  }

  const attestorPubkey = Buffer.from(schnorr.getPublicKey(privateKeyHex)).toString("hex");

  const hexSubject = npubToHex(params.subjectPubkey);
  if (!hexSubject) {
    return { success: false, message: "Invalid subject public key." };
  }

  if (attestorPubkey === hexSubject) {
    return { success: false, message: "Cannot create self-attestation." };
  }

  const now = Math.floor(Date.now() / 1000);
  const expirationDays = params.expirationDays || 180;
  const expiration = now + expirationDays * 86400;
  const commitmentClass = params.commitmentClass || "self_assertion";

  const content: any = {
    subject: hexSubject,
    context: params.context,
    rating: params.rating,
    confidence: params.confidence,
  };
  if (commitmentClass !== "self_assertion") {
    content.commitment_class = commitmentClass;
  }
  if (params.evidence?.length) {
    content.evidence = params.evidence;
  }

  const tags: string[][] = [
    ["d", `${hexSubject}:${params.context}`],
    ["p", hexSubject],
    ["t", params.context],
    ["expiration", String(expiration)],
  ];

  if (params.halfLifeClass && HALF_LIFE_CLASSES[params.halfLifeClass]) {
    tags.push(["half_life_class", params.halfLifeClass]);
  }
  if (commitmentClass !== "self_assertion") {
    tags.push(["commitment_class", commitmentClass]);
  }

  const relays = params.relays || DEFAULT_RELAYS;
  const pool = getFreshPool(relays);

  try {
    const event = createEvent({
      kind: KIND_REPUTATION,
      content: JSON.stringify(content),
      tags,
      created_at: now,
    }, attestorPubkey);

    const id = await getEventHash(event as any);
    const sig = await signEvent(id, privateKeyHex);

    const signedEvent = {
      ...event,
      id,
      sig,
      pubkey: attestorPubkey,
    };

    const results = await pool.publish(relays, signedEvent as any);

    let successCount = 0;
    if (Array.isArray(results)) {
      const settled = await Promise.allSettled(results as Promise<unknown>[]);
      for (const r of settled) {
        if (r.status === "fulfilled" && (r.value as any)?.success === true) {
          successCount++;
        }
      }
    }

    if (successCount > 0) {
      return {
        success: true,
        message: `Attestation published to ${successCount}/${relays.length} relay(s). Rating: ${params.rating}/5, Context: ${params.context}, Subject: ${formatPubkey(hexSubject)}.`,
        eventId: id,
      };
    } else {
      return {
        success: false,
        message: "Failed to publish attestation to any relay.",
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Error creating attestation: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  } finally {
    await pool.close();
  }
}

// ============================================================================
// Formatting
// ============================================================================

export function formatAttestationsList(attestations: ParsedAttestation[]): string {
  return attestations.map((a) => {
    const date = new Date(a.created_at * 1000).toLocaleString();
    const stars = "★".repeat(a.rating) + "☆".repeat(5 - a.rating);
    const lines = [
      `${stars} (${a.rating}/5) — ${a.context}`,
      `  From: ${formatPubkey(a.attestor)}`,
      `  Confidence: ${(a.confidence * 100).toFixed(0)}%`,
      `  Commitment: ${a.commitment_class}`,
      `  Decay: ${(a.decay_factor * 100).toFixed(1)}%`,
      `  Date: ${date}`,
    ];
    if (a.evidence) {
      lines.push(`  Evidence: ${Array.isArray(a.evidence) ? a.evidence.join("; ") : a.evidence}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

export function formatReputationSummary(params: {
  pubkey: string;
  score: number;
  count: number;
  diversity: { entropy: number; herfindahl: number; uniqueCount: number };
  context?: string;
  decayType: string;
}): string {
  const stars = "★".repeat(Math.round(params.score)) + "☆".repeat(5 - Math.round(params.score));
  const lines = [
    `Reputation for ${formatPubkey(params.pubkey)}`,
    `Score: ${params.score.toFixed(2)}/5.0 ${stars}`,
    `Attestations: ${params.count}`,
    `Unique attestors: ${params.diversity.uniqueCount}`,
    `Diversity (entropy): ${params.diversity.entropy.toFixed(2)}`,
    `Concentration (Herfindahl): ${params.diversity.herfindahl.toFixed(3)}`,
    `Decay type: ${params.decayType}`,
  ];
  if (params.context) lines.push(`Context filter: ${params.context}`);
  if (params.diversity.herfindahl > 0.5 && params.count > 1) {
    lines.push(`⚠️ High concentration — few unique attestors (possible Sybil risk)`);
  }
  return lines.join("\n");
}
