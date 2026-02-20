import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { RelayPool } from "snstr";
import { CompatibleRelayPool, getFreshPool, type NostrEvent } from "../utils/pool.js";

describe("utils/pool CompatibleRelayPool", () => {
  const makeEvent = (id: string): NostrEvent => ({
    id,
    pubkey: "pubkey",
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
  });

  const errorSpy = mock(() => {});
  const originalConsoleError = console.error;
  const originalRelayPoolClose = RelayPool.prototype.close;
  const relayPoolCloseMock = mock(async () => {});

  beforeEach(() => {
    relayPoolCloseMock.mockClear();
    relayPoolCloseMock.mockImplementation(async () => {});
    errorSpy.mockClear();
    console.error = errorSpy as unknown as typeof console.error;
    RelayPool.prototype.close = relayPoolCloseMock as any;
  });

  afterEach(() => {
    console.error = originalConsoleError;
    RelayPool.prototype.close = originalRelayPoolClose;
  });

  test("getFreshPool returns a CompatibleRelayPool", () => {
    const pool = getFreshPool(["wss://relay.example"]);
    expect(pool).toBeInstanceOf(CompatibleRelayPool);
  });

  test("get returns first event when querySync has results", async () => {
    const querySyncMock = mock(
      async (_relays: string[], _filter: unknown, _opts?: { timeout: number }) =>
        [] as NostrEvent[],
    );
    const first = makeEvent("1");
    querySyncMock.mockImplementation(async () => [first, makeEvent("2")]);

    const pool = new CompatibleRelayPool([]);
    (pool as any).querySync = querySyncMock;
    const result = await pool.get(["wss://relay.example"], { kinds: [1] });

    expect(result).toEqual(first);
    expect(querySyncMock).toHaveBeenCalledTimes(1);
    expect(querySyncMock.mock.calls[0]?.[2]).toEqual({ timeout: 8000 });
  });

  test("get returns null for empty results and on query errors", async () => {
    const querySyncMock = mock(
      async (_relays: string[], _filter: unknown, _opts?: { timeout: number }) =>
        [] as NostrEvent[],
    );
    const pool = new CompatibleRelayPool([]);
    (pool as any).querySync = querySyncMock;
    expect(await pool.get(["wss://relay.example"], { kinds: [1] })).toBeNull();

    querySyncMock.mockImplementation(async () => {
      throw new Error("query failed");
    });
    expect(await pool.get(["wss://relay.example"], { kinds: [1] })).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("getMany returns events and falls back to [] on errors", async () => {
    const querySyncMock = mock(
      async (_relays: string[], _filter: unknown, _opts?: { timeout: number }) =>
        [] as NostrEvent[],
    );
    querySyncMock.mockImplementation(async () => [makeEvent("1")]);
    const pool = new CompatibleRelayPool([]);
    (pool as any).querySync = querySyncMock;
    expect(await pool.getMany(["wss://relay.example"], { kinds: [1] })).toEqual([makeEvent("1")]);

    querySyncMock.mockImplementation(async () => {
      throw new Error("query failed");
    });
    expect(await pool.getMany(["wss://relay.example"], { kinds: [1] })).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  test("close swallows parent close errors", async () => {
    const pool = new CompatibleRelayPool([]);
    await pool.close();
    expect(relayPoolCloseMock).toHaveBeenCalledTimes(1);

    relayPoolCloseMock.mockImplementation(async () => {
      throw new Error("close failed");
    });
    await pool.close();
    expect(errorSpy).toHaveBeenCalled();
  });
});
