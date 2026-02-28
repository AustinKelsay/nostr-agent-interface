import { afterAll, describe, expect, test } from "bun:test";
import { createServer as createNetServer } from "node:net";
import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { WebSocket } from "ws";
import { KINDS } from "../utils/constants.js";
import { NostrRelay } from "../utils/ephemeral-relay.js";
import { describeNetwork } from "./support/network-suite.js";

type SignedEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

const TEST_PRIVATE_KEY = "0".repeat(63) + "1";
const TEST_PUBLIC_KEY = Buffer.from(schnorr.getPublicKey(TEST_PRIVATE_KEY)).toString("hex");
const MIN_PORT = 49152;
const PORT_SPAN = 16384;

function createSignedEvent(params: {
  kind: number;
  content: string;
  tags?: string[][];
  createdAt?: number;
}): SignedEvent {
  const created_at = params.createdAt ?? Math.floor(Date.now() / 1000);
  const tags = params.tags ?? [];
  const payload = [0, TEST_PUBLIC_KEY, created_at, params.kind, tags, params.content];
  const id = Buffer.from(sha256(JSON.stringify(payload))).toString("hex");
  const sig = Buffer.from(schnorr.sign(id, TEST_PRIVATE_KEY)).toString("hex");
  return {
    id,
    pubkey: TEST_PUBLIC_KEY,
    created_at,
    kind: params.kind,
    tags,
    content: params.content,
    sig,
  };
}

function randomForPort(port: number): number {
  const offset = Math.max(0, Math.min(PORT_SPAN - 1, port - MIN_PORT));
  return (offset + 0.01) / PORT_SPAN;
}

async function findHighEphemeralPort(avoid: Set<number>): Promise<number> {
  const startOffset = (Date.now() + process.pid) % PORT_SPAN;
  for (let attempt = 0; attempt < PORT_SPAN; attempt++) {
    const port = MIN_PORT + ((startOffset + attempt) % PORT_SPAN);
    if (avoid.has(port)) {
      continue;
    }

    const server = createNetServer();
    const canUsePort = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (!canUsePort) {
      try {
        server.close();
      } catch {
        // Ignore cleanup errors while probing.
      }
      continue;
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  throw new Error("Unable to find a high ephemeral port");
}

async function connectWs(url: string): Promise<WebSocket> {
  return await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function closeWs(ws: WebSocket | null | undefined): Promise<void> {
  if (!ws) return;
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    ws.once("close", () => resolve());
    ws.close();
    setTimeout(() => resolve(), 250);
  });
}

async function waitForMessage(
  ws: WebSocket,
  predicate: (message: any[]) => boolean,
  timeoutMs = 1500,
): Promise<any[]> {
  return await new Promise<any[]>((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      let parsed: any[];
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (predicate(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };

    const onError = (error: unknown) => {
      cleanup();
      reject(error);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };

    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

async function collectUntilEose(ws: WebSocket, subId: string, timeoutMs = 2000): Promise<any[][]> {
  return await new Promise<any[][]>((resolve, reject) => {
    const messages: any[][] = [];
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(raw.toString());
        messages.push(parsed);
        if (parsed[0] === "EOSE" && parsed[1] === subId) {
          cleanup();
          resolve(messages);
        }
      } catch {
        // Ignore malformed test responses.
      }
    };

    const onError = (error: unknown) => {
      cleanup();
      reject(error);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for EOSE for ${subId}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };

    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

describeNetwork("ephemeral-relay coverage", () => {
  const relaysToClose: NostrRelay[] = [];
  const serversToClose: Array<{ close: (callback: () => void) => void }> = [];

  afterAll(async () => {
    for (const relay of relaysToClose.reverse()) {
      try {
        await relay.close();
      } catch {
        // Ignore teardown failures.
      }
    }
    for (const server of serversToClose.reverse()) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("throws when websocket server getter is used before start", () => {
    const relay = new NostrRelay(0);
    expect(() => relay.wss).toThrow("websocket server not initialized");
  });

  test("emits onconnect on successful start", async () => {
    const relay = new NostrRelay(0);
    relaysToClose.push(relay);
    const connected = new Promise<void>((resolve) => relay.onconnect(() => resolve()));
    await relay.start();
    await connected;
    expect(relay.url.startsWith("ws://localhost:")).toBe(true);
  });

  test("throws start error when fixed port is already in use", async () => {
    const occupiedPort = await findHighEphemeralPort(new Set());
    const blocker = createNetServer();
    serversToClose.push(blocker);
    await new Promise<void>((resolve, reject) => {
      blocker.once("listening", () => resolve());
      blocker.once("error", reject);
      blocker.listen(occupiedPort, "127.0.0.1");
    });
    const relay = new NostrRelay(occupiedPort);
    await expect(relay.start()).rejects.toThrow();
  });

  test("retries a random port when first pick is occupied", async () => {
    const blockedPort = await findHighEphemeralPort(new Set());
    const blocker = createNetServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("listening", () => resolve());
      blocker.once("error", reject);
      blocker.listen(blockedPort, "127.0.0.1");
    });
    serversToClose.push(blocker);

    const relay = new NostrRelay(0, undefined, undefined, () => randomForPort(blockedPort));
    relaysToClose.push(relay);
    await relay.start();
    expect(relay.port).not.toBe(blockedPort);
  });

  test("handles malformed and invalid protocol messages with NOTICE responses", async () => {
    const relay = new NostrRelay(0);
    relaysToClose.push(relay);
    await relay.start();

    const ws = await connectWs(relay.url);
    try {
      ws.send("not-json");
      const parseNotice = await waitForMessage(ws, (m) => m[0] === "NOTICE" && m[2] === "Unable to parse message");
      expect(parseNotice).toEqual(["NOTICE", "", "Unable to parse message"]);

      ws.send(JSON.stringify({ hello: "world" }));
      const formatNotice = await waitForMessage(ws, (m) => m[0] === "NOTICE" && m[2] === "Unable to handle message");
      expect(formatNotice).toEqual(["NOTICE", "", "Unable to handle message"]);

      ws.send(JSON.stringify(["EVENT"]));
      expect(await waitForMessage(ws, (m) => m[1] === "invalid: EVENT message missing params")).toEqual([
        "NOTICE",
        "invalid: EVENT message missing params",
      ]);

      ws.send(JSON.stringify(["REQ"]));
      expect(await waitForMessage(ws, (m) => m[1] === "invalid: REQ message missing params")).toEqual([
        "NOTICE",
        "invalid: REQ message missing params",
      ]);

      ws.send(JSON.stringify(["CLOSE"]));
      expect(await waitForMessage(ws, (m) => m[1] === "invalid: CLOSE message missing params")).toEqual([
        "NOTICE",
        "invalid: CLOSE message missing params",
      ]);

      ws.send(JSON.stringify(["AUTH"]));
      expect(await waitForMessage(ws, (m) => m[1] === "invalid: AUTH message missing params")).toEqual([
        "NOTICE",
        "invalid: AUTH message missing params",
      ]);
    } finally {
      await closeWs(ws);
    }
  });

  test("enforces auth and validates wrong-kind, bad-signature, mismatch, then success", async () => {
    const relay = new NostrRelay(0, undefined, true);
    relaysToClose.push(relay);
    await relay.start();

    const ws = await connectWs(relay.url);
    try {
      ws.send(JSON.stringify(["REQ", "auth-sub", { kinds: [1] }]));
      const challengeMsg = await waitForMessage(ws, (m) => m[0] === "AUTH");
      const challenge = String(challengeMsg[1]);
      expect(challenge.startsWith("challenge-")).toBe(true);

      const wrongKind = createSignedEvent({
        kind: 1,
        content: "wrong-kind",
        tags: [["challenge", challenge]],
      });
      ws.send(JSON.stringify(["AUTH", wrongKind]));
      expect(await waitForMessage(ws, (m) => m[0] === "OK" && m[1] === wrongKind.id)).toEqual([
        "OK",
        wrongKind.id,
        false,
        "invalid: wrong auth kind",
      ]);

      const invalidSig = createSignedEvent({
        kind: KINDS.AUTH,
        content: "",
        tags: [["challenge", challenge]],
      });
      invalidSig.sig = "0".repeat(128);
      ws.send(JSON.stringify(["AUTH", invalidSig]));
      expect(await waitForMessage(ws, (m) => m[0] === "OK" && m[1] === invalidSig.id)).toEqual([
        "OK",
        invalidSig.id,
        false,
        "invalid: auth failed validation",
      ]);

      const mismatch = createSignedEvent({
        kind: KINDS.AUTH,
        content: "",
        tags: [["challenge", "wrong-challenge"]],
      });
      ws.send(JSON.stringify(["AUTH", mismatch]));
      expect(await waitForMessage(ws, (m) => m[0] === "OK" && m[1] === mismatch.id)).toEqual([
        "OK",
        mismatch.id,
        false,
        "invalid: auth challenge mismatch",
      ]);

      const okAuth = createSignedEvent({
        kind: KINDS.AUTH,
        content: "",
        tags: [["challenge", challenge]],
      });
      ws.send(JSON.stringify(["AUTH", okAuth]));
      expect(await waitForMessage(ws, (m) => m[0] === "OK" && m[1] === okAuth.id)).toEqual([
        "OK",
        okAuth.id,
        true,
        "",
      ]);

      ws.send(JSON.stringify(["REQ", "auth-sub-2", { kinds: [1], authors: [TEST_PUBLIC_KEY] }]));
      const eose = await waitForMessage(ws, (m) => m[0] === "EOSE" && m[1] === "auth-sub-2");
      expect(eose).toEqual(["EOSE", "auth-sub-2"]);
    } finally {
      await closeWs(ws);
    }
  });

  test("broadcasts NIP-46 events only to matching #p subscribers", async () => {
    const relay = new NostrRelay(0);
    relaysToClose.push(relay);
    await relay.start();

    const sender = await connectWs(relay.url);
    const receiver = await connectWs(relay.url);
    try {
      receiver.send(JSON.stringify(["REQ", "nip46-sub", { kinds: [24133], "#p": ["target-pub"] }]));
      await waitForMessage(receiver, (m) => m[0] === "EOSE" && m[1] === "nip46-sub");

      const matching = createSignedEvent({
        kind: 24133,
        content: "{\"id\":\"1\"}",
        tags: [["p", "target-pub"]],
      });
      sender.send(JSON.stringify(["EVENT", matching]));

      const forwarded = await waitForMessage(
        receiver,
        (m) => m[0] === "EVENT" && m[1] === "nip46-sub" && m[2]?.id === matching.id,
      );
      expect(forwarded[2].id).toBe(matching.id);

      const ignored = createSignedEvent({
        kind: 24133,
        content: "{\"id\":\"2\"}",
        tags: [["p", "other-pub"]],
      });
      sender.send(JSON.stringify(["EVENT", ignored]));

      await expect(
        waitForMessage(
          receiver,
          (m) => m[0] === "EVENT" && m[1] === "nip46-sub" && m[2]?.id === ignored.id,
          350,
        ),
      ).rejects.toThrow("Timed out waiting for websocket message");
    } finally {
      await closeWs(sender);
      await closeWs(receiver);
    }
  });

  test("applies REQ limits against cached events and closes idempotently", async () => {
    const relay = new NostrRelay(0);
    await relay.start();
    relaysToClose.push(relay);

    const eventA = createSignedEvent({
      kind: 1,
      content: "cached-a",
      createdAt: Math.floor(Date.now() / 1000) - 1,
      tags: [["t", "relay-test"]],
    });
    const eventB = createSignedEvent({
      kind: 1,
      content: "cached-b",
      createdAt: Math.floor(Date.now() / 1000),
      tags: [["t", "relay-test"]],
    });
    relay.store(eventA);
    relay.store(eventB);

    const ws = await connectWs(relay.url);
    try {
      ws.send(
        JSON.stringify([
          "REQ",
          "limit-sub",
          { kinds: [1], authors: [TEST_PUBLIC_KEY], "#t": ["relay-test"], limit: 1 },
        ]),
      );
      const messages = await collectUntilEose(ws, "limit-sub");
      const events = messages.filter((m) => m[0] === "EVENT");
      expect(events).toHaveLength(1);
      expect(["cached-a", "cached-b"]).toContain(events[0][2].content);
      expect(relay.subs.size).toBeGreaterThan(0);
      expect(relay.cache.length).toBeGreaterThan(0);
    } finally {
      await closeWs(ws);
    }

    await Promise.all([relay.close(), relay.close()]);
    expect(relay.cache).toHaveLength(0);
    expect(relay.subs.size).toBe(0);
  });
});
