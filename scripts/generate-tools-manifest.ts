import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createManagedMcpClient } from "../app/mcp-client.js";

type PackageJson = {
  version?: string;
};

async function readPackageVersion(rootDir: string): Promise<string> {
  const packageJsonPath = path.resolve(rootDir, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as PackageJson;
  return parsed.version ?? "0.0.0";
}

async function main() {
  const rootDir = process.cwd();
  const packageVersion = await readPackageVersion(rootDir);

  const managed = await createManagedMcpClient();
  try {
    const response = await managed.client.listTools();
    const tools = [...(response.tools ?? [])]
      .map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema ?? {},
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const manifest = {
      schemaVersion: 1,
      package: {
        name: "nostr-agent-interface",
        version: packageVersion,
      },
      toolCount: tools.length,
      tools,
    };

    const artifactsDir = path.resolve(rootDir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });

    const outputPath = path.resolve(artifactsDir, "tools.json");
    const nextContent = `${JSON.stringify(manifest, null, 2)}\n`;

    let currentContent: string | undefined;
    try {
      currentContent = await readFile(outputPath, "utf8");
    } catch {
      // file may not exist yet
    }

    if (currentContent !== nextContent) {
      await writeFile(outputPath, nextContent, "utf8");
      console.log(`Updated tool manifest: ${outputPath}`);
      return;
    }

    console.log(`Tool manifest unchanged: ${outputPath}`);
  } finally {
    await managed.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
