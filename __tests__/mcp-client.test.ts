import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createManagedMcpClient, resolveMcpServerProcess } from "../app/mcp-client.js";

const existsSyncMock = mock((_candidate: string) => false);
const stderrOnMock = mock((_event: string, _handler: (chunk: unknown) => void) => {});
const transportCloseMock = mock(async () => {});
const clientConnectMock = mock(async (_transport: unknown) => {});
const clientCloseMock = mock(async () => {});

let includeTransportStderr = true;
let latestStderrHandler: ((chunk: unknown) => void) | undefined;

const constructedTransports: FakeTransport[] = [];
const constructedClients: FakeClient[] = [];

class FakeTransport {
  readonly params: unknown;
  readonly stderr: { on: typeof stderrOnMock } | undefined;

  constructor(params: unknown) {
    this.params = params;
    this.stderr = includeTransportStderr ? { on: stderrOnMock } : undefined;
    constructedTransports.push(this);
  }

  close = transportCloseMock;
}

class FakeClient {
  readonly info: unknown;

  constructor(info: unknown) {
    this.info = info;
    constructedClients.push(this);
  }

  connect = clientConnectMock;
  close = clientCloseMock;
}

const MOCK_FILE_PATH = "/mock/project/app/mcp-client.ts";

describe("mcp-client", () => {
  beforeEach(() => {
    delete process.env.NOSTR_MCP_COMMAND;
    delete process.env.NOSTR_MCP_ARGS;

    existsSyncMock.mockClear();
    stderrOnMock.mockClear();
    transportCloseMock.mockClear();
    clientConnectMock.mockClear();
    clientCloseMock.mockClear();

    existsSyncMock.mockImplementation((_candidate: string) => false);
    stderrOnMock.mockImplementation((event: string, handler: (chunk: unknown) => void) => {
      if (event === "data") {
        latestStderrHandler = handler;
      }
    });
    transportCloseMock.mockImplementation(async () => {});
    clientConnectMock.mockImplementation(async (_transport: unknown) => {});
    clientCloseMock.mockImplementation(async () => {});

    includeTransportStderr = true;
    latestStderrHandler = undefined;
    constructedTransports.length = 0;
    constructedClients.length = 0;
  });

  afterEach(() => {
    delete process.env.NOSTR_MCP_COMMAND;
    delete process.env.NOSTR_MCP_ARGS;
  });

  test("resolves explicit command with undefined args when args env is absent/blank", () => {
    process.env.NOSTR_MCP_COMMAND = "node";
    let resolved = resolveMcpServerProcess();
    expect(resolved).toEqual({
      command: "node",
      args: undefined,
      cwd: process.cwd(),
      stderr: "pipe",
    });

    process.env.NOSTR_MCP_ARGS = "   ";
    resolved = resolveMcpServerProcess();
    expect(resolved.args).toBeUndefined();
  });

  test("parses explicit args as JSON array and whitespace-delimited tokens", () => {
    process.env.NOSTR_MCP_COMMAND = "bun";
    process.env.NOSTR_MCP_ARGS = '["run","build/index.js","mcp"]';
    expect(resolveMcpServerProcess().args).toEqual(["run", "build/index.js", "mcp"]);

    process.env.NOSTR_MCP_ARGS = "run build/index.js mcp";
    expect(resolveMcpServerProcess().args).toEqual(["run", "build/index.js", "mcp"]);
  });

  test("rejects non-string JSON arrays for NOSTR_MCP_ARGS", () => {
    process.env.NOSTR_MCP_COMMAND = "bun";
    process.env.NOSTR_MCP_ARGS = '["ok", 1]';
    expect(() => resolveMcpServerProcess()).toThrow("NOSTR_MCP_ARGS must be a JSON string array");
  });

  test("prefers build index.js when default process entry exists", () => {
    existsSyncMock.mockImplementation((candidate: string) => candidate === "/mock/project/index.js");
    const resolved = resolveMcpServerProcess({
      existsSyncFn: existsSyncMock,
      filePath: MOCK_FILE_PATH,
      isBun: true,
      execPath: process.execPath,
    });

    expect(resolved).toEqual({
      command: process.execPath,
      args: ["/mock/project/index.js"],
      cwd: "/mock/project",
      stderr: "pipe",
    });
  });

  test("falls back to source index.ts when build entry is missing", () => {
    existsSyncMock.mockImplementation((candidate: string) => candidate === "/mock/project/index.ts");
    const resolved = resolveMcpServerProcess({
      existsSyncFn: existsSyncMock,
      filePath: MOCK_FILE_PATH,
      isBun: true,
      execPath: process.execPath,
    });

    expect(resolved).toEqual({
      command: process.execPath,
      args: ["/mock/project/index.ts"],
      cwd: "/mock/project",
      stderr: "pipe",
    });
  });

  test("falls back to build-tree index.ts when source entry is missing", () => {
    existsSyncMock.mockImplementation((candidate: string) => candidate === "/mock/index.ts");
    const resolved = resolveMcpServerProcess({
      existsSyncFn: existsSyncMock,
      filePath: MOCK_FILE_PATH,
      isBun: true,
      execPath: process.execPath,
    });

    expect(resolved).toEqual({
      command: process.execPath,
      args: ["/mock/index.ts"],
      cwd: "/mock",
      stderr: "pipe",
    });
  });

  test("throws when no default MCP server entrypoint can be found", () => {
    existsSyncMock.mockImplementation((_candidate: string) => false);
    expect(() =>
      resolveMcpServerProcess({
        existsSyncFn: existsSyncMock,
        filePath: MOCK_FILE_PATH,
        isBun: true,
        execPath: process.execPath,
      }),
    ).toThrow("Unable to find MCP server entrypoint. Build the project first or set NOSTR_MCP_COMMAND/NOSTR_MCP_ARGS.");
  });

  test("connects client, pipes stderr string/bytes, and closes transport + client", async () => {
    const stderrWrites: unknown[] = [];

    const serverProcess: StdioServerParameters = {
      command: "node",
      args: ["build/index.js"],
      cwd: "/tmp",
      stderr: "pipe",
    };

    const managed = await createManagedMcpClient(serverProcess, {
      transportFactory: (params) => new FakeTransport(params),
      clientFactory: (info) => new FakeClient(info),
      stderrWriter: (chunk) => {
        stderrWrites.push(chunk);
      },
    });

    expect(constructedTransports).toHaveLength(1);
    expect(constructedTransports[0].params).toEqual(serverProcess);
    expect(constructedClients).toHaveLength(1);
    expect((constructedClients[0].info as any).name).toBe("nostr-agent-interface");
    expect(clientConnectMock).toHaveBeenCalledTimes(1);
    expect(clientConnectMock).toHaveBeenCalledWith(constructedTransports[0]);
    expect(stderrOnMock).toHaveBeenCalledTimes(1);

    latestStderrHandler?.("stderr line");
    latestStderrHandler?.(new Uint8Array([65, 66]));
    latestStderrHandler?.({ not: "forwarded" });
    expect(stderrWrites).toHaveLength(2);
    expect(stderrWrites[0]).toBe("stderr line");
    expect(stderrWrites[1]).toBeInstanceOf(Uint8Array);

    await managed.close();
    expect(clientCloseMock).toHaveBeenCalledTimes(1);
    expect(transportCloseMock).toHaveBeenCalledTimes(1);
  });

  test("close resolves even when both client.close and transport.close reject", async () => {
    clientCloseMock.mockImplementation(async () => {
      throw new Error("client close failed");
    });
    transportCloseMock.mockImplementation(async () => {
      throw new Error("transport close failed");
    });

    const managed = await createManagedMcpClient(
      {
        command: "node",
        args: ["build/index.js"],
        cwd: "/tmp",
        stderr: "pipe",
      },
      {
        transportFactory: (params) => new FakeTransport(params),
        clientFactory: (info) => new FakeClient(info),
      },
    );

    await expect(managed.close()).resolves.toBeUndefined();
    expect(clientCloseMock).toHaveBeenCalledTimes(1);
    expect(transportCloseMock).toHaveBeenCalledTimes(1);
  });

  test("skips stderr wiring when transport has no stderr stream", async () => {
    includeTransportStderr = false;

    await createManagedMcpClient(
      {
        command: "node",
        args: ["build/index.js"],
        cwd: "/tmp",
        stderr: "pipe",
      },
      {
        transportFactory: (params) => new FakeTransport(params),
        clientFactory: (info) => new FakeClient(info),
      },
    );

    expect(stderrOnMock).not.toHaveBeenCalled();
    expect(clientConnectMock).toHaveBeenCalledTimes(1);
  });
});
