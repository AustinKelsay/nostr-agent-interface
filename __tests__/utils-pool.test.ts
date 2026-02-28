import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { RelayPool } from "snstr";
import { CompatibleRelayPool, getFreshPool, type NostrEvent } from "../utils/pool.js";
import { QUERY_TIMEOUT } from "../utils/constants.js";

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
  const originalSetTimeout = globalThis.setTimeout;

  async function withShortTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
    const timeoutSpy = ((callback: (...args: any[]) => void, _duration?: number, ...args: any[]) => {
      return originalSetTimeout(callback, ms, ...args);
    }) as typeof setTimeout;

    globalThis.setTimeout = timeoutSpy;

    try {
      return await fn();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  }


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
    globalThis.setTimeout = originalSetTimeout;
  });

  test("getFreshPool returns a CompatibleRelayPool", () => {
    const pool = getFreshPool(["wss://relay.example"]);
    expect(pool).toBeDefined();
    expect(typeof pool.get).toBe("function");
    expect(typeof pool.getMany).toBe("function");
    expect(typeof pool.close).toBe("function");
    expect(typeof pool.publish).toBe("function");
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
    expect(querySyncMock.mock.calls[0]?.[2]).toEqual({ timeout: QUERY_TIMEOUT });
  });

  test("get enforces a hard timeout before returning fallback", async () => {
    const querySyncMock = mock(async () => new Promise<NostrEvent[]>(() => {}));
    const pool = new CompatibleRelayPool([]);
    (pool as any).querySync = querySyncMock;

    const result = await withShortTimeout(1, async () => {
      return pool.get(["wss://relay.example"], { kinds: [1] }, { timeoutMs: 5 });
    });

    expect(result).toBeNull();
    expect(querySyncMock).toHaveBeenCalledTimes(1);
    expect((querySyncMock.mock.calls[0] as unknown[] | undefined)?.[2]).toEqual({ timeout: 5 });
    expect(errorSpy).toHaveBeenCalled();
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

  test("getMany enforces a hard timeout before returning fallback", async () => {
    const querySyncMock = mock(async () => new Promise<NostrEvent[]>(() => {}));
    const pool = new CompatibleRelayPool([]);
    (pool as any).querySync = querySyncMock;

    const result = await withShortTimeout(1, async () => {
      return pool.getMany(["wss://relay.example"], { kinds: [1] }, { timeoutMs: 5 });
    });

    expect(result).toEqual([]);
    expect(querySyncMock).toHaveBeenCalledTimes(1);
    expect((querySyncMock.mock.calls[0] as unknown[] | undefined)?.[2]).toEqual({ timeout: 5 });
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
