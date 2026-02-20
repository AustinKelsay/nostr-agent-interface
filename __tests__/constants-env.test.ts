import { describe, expect, test } from "bun:test";
import {
  BUILTIN_DEFAULT_RELAYS,
  DEFAULT_RELAYS,
  KINDS,
  QUERY_TIMEOUT,
  parseEnvRelayList,
} from "../utils/constants.js";

describe("utils/constants env parsing", () => {
  test("returns null for missing/blank env values", () => {
    expect(parseEnvRelayList(undefined)).toBeNull();
    expect(parseEnvRelayList("   ")).toBeNull();
    expect(QUERY_TIMEOUT).toBe(8000);
  });

  test("parses JSON array env values and trims relay entries", () => {
    expect(parseEnvRelayList('["  wss://relay.one  ", "wss://relay.two"]')).toEqual([
      "wss://relay.one",
      "wss://relay.two",
    ]);
  });

  test("parses comma-separated env values and trims entries", () => {
    expect(parseEnvRelayList(" wss://relay.a , wss://relay.b ,, ")).toEqual([
      "wss://relay.a",
      "wss://relay.b",
    ]);
  });

  test("rejects non-string JSON array values", () => {
    expect(() => parseEnvRelayList('["wss://relay.one", 42]')).toThrow(
      "NOSTR_DEFAULT_RELAYS must be a JSON string array or a comma-separated list",
    );
  });

  test("rejects empty relay configuration", () => {
    expect(() => parseEnvRelayList("[]")).toThrow("NOSTR_DEFAULT_RELAYS cannot be empty");
    expect(() => parseEnvRelayList(" , , ")).toThrow("NOSTR_DEFAULT_RELAYS cannot be empty");
  });

  test("exports canonical and back-compat kind aliases", () => {
    expect(Array.isArray(BUILTIN_DEFAULT_RELAYS)).toBe(true);
    expect(DEFAULT_RELAYS.length).toBeGreaterThan(0);

    expect(KINDS.METADATA).toBe(0);
    expect(KINDS.TEXT).toBe(1);
    expect(KINDS.RELAY_LIST).toBe(10002);
    expect(KINDS.ZAP_RECEIPT).toBe(9735);

    expect(KINDS.Metadata).toBe(KINDS.METADATA);
    expect(KINDS.Text).toBe(KINDS.TEXT);
    expect(KINDS.RelayList).toBe(KINDS.RELAY_LIST);
    expect(KINDS.ZapReceipt).toBe(KINDS.ZAP_RECEIPT);
  });
});
