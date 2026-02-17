import { describe, test, expect } from "bun:test";
import { spawn } from "node:child_process";
import path from "node:path";

type ProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runCliProcess(args: string[], stdinInput?: string): Promise<ProcessResult> {
  const entrypoint = path.resolve(process.cwd(), "app/index.ts");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, "cli", ...args], {
      cwd: process.cwd(),
      env: process.env,
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

    const result = await runCliProcess(["call", "convertNip19", "--stdin", "--json"], input);

    expect(result.code).toBe(0);

    const parsed = JSON.parse(result.stdout.trim());
    const firstText = parsed?.content?.[0]?.text ?? "";

    expect(typeof firstText).toBe("string");
    expect(firstText).toContain("Conversion successful!");
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
