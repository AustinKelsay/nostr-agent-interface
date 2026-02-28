import { describe, test, expect } from "bun:test";
import { spawn } from "node:child_process";
import path from "node:path";

type ProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runCliProcess(
  args: string[],
  env?: Record<string, string | undefined>,
  stdinInput?: string,
): Promise<ProcessResult> {
  const entrypoint = path.resolve(process.cwd(), "app/index.ts");
  const nextEnv = env ? { ...process.env, ...env } : process.env;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, "cli", ...args], {
      cwd: process.cwd(),
      env: nextEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });

    if (typeof stdinInput === "string") {
      child.stdin.write(stdinInput);
    }

    child.stdin.end();
  });
}

describe("CLI UX", () => {
  test("supports subcommand help for list-tools", async () => {
    const result = await runCliProcess(["list-tools", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("list-tools");
  });

  test("supports subcommand help for call", async () => {
    const result = await runCliProcess(["call", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--stdin");
    expect(result.stdout).toContain("--json");
  });

  test("supports --stdin with --json for tool invocation", async () => {
    const input = JSON.stringify({
      input: "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e",
      targetType: "npub",
    });

    const result = await runCliProcess(["call", "convertNip19", "--stdin", "--json"], undefined, input);

    expect(result.code).toBe(0);

    const parsed = JSON.parse(result.stdout.trim());
    const firstText = parsed?.content?.[0]?.text ?? "";

    expect(typeof firstText).toBe("string");
    expect(firstText).toContain("Conversion successful!");
  });

  test("supports direct tool invocation with schema-aware flags", async () => {
    const result = await runCliProcess([
      "convertNip19",
      "--input",
      "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e",
      "--target-type",
      "npub",
      "--json",
    ]);

    expect(result.code).toBe(0);

    const parsed = JSON.parse(result.stdout.trim());
    const firstText = parsed?.content?.[0]?.text ?? "";

    expect(typeof firstText).toBe("string");
    expect(firstText).toContain("Conversion successful!");
  });

  test("emits clean list-tools --json output with no stderr", async () => {
    const result = await runCliProcess(["list-tools", "--json"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

    const parsed = JSON.parse(result.stdout.trim());
    expect(Array.isArray(parsed.tools)).toBe(true);
  });

  test("supports NOSTR_JSON_ONLY for clean machine output", async () => {
    const result = await runCliProcess(["list-tools", "--json"], {
      NOSTR_JSON_ONLY: "true",
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout.trim());
    expect(Array.isArray(parsed.tools)).toBe(true);
  });

  test("supports direct tool help", async () => {
    const result = await runCliProcess(["getProfile", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("getProfile");
    expect(result.stdout).toContain("--pubkey");
  });

  test("validates required args for direct tool commands", async () => {
    const result = await runCliProcess(["convertNip19", "--input", "abc"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Missing required options for convertNip19");
    expect(result.stderr).toContain("--target-type");
  });

  test("rejects mixing positional jsonArgs with --stdin", async () => {
    const result = await runCliProcess([
      "call",
      "convertNip19",
      '{"input":"abc","targetType":"hex"}',
      "--stdin",
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Provide args either as jsonArgs or with --stdin, not both");
  });
});
