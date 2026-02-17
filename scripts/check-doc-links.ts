import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DOC_FILES = [
  "README.md",
  "docs/testing.md",
  "llm/README.md",
  "llm/tool-catalog.md",
  "llm/playbook.md",
  "note/README.md",
  "profile/README.md",
  "zap/README.md",
];

function isExternalLink(target: string): boolean {
  return /^(https?:|mailto:|data:|#)/i.test(target);
}

function normalizeLinkTarget(rawTarget: string): string {
  const trimmed = rawTarget.trim();
  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">")
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  const hashIndex = unwrapped.indexOf("#");
  const noHash = hashIndex >= 0 ? unwrapped.slice(0, hashIndex) : unwrapped;

  return noHash;
}

async function findMissingLinks(docPath: string): Promise<string[]> {
  const content = await readFile(docPath, "utf8");
  const regex = /!?\[[^\]]*\]\(([^)]+)\)/g;
  const missing: string[] = [];

  for (const match of content.matchAll(regex)) {
    const rawTarget = match[1];
    const target = normalizeLinkTarget(rawTarget);

    if (!target || isExternalLink(target)) {
      continue;
    }

    const resolved = path.resolve(path.dirname(docPath), target);
    if (!existsSync(resolved)) {
      missing.push(`${docPath} -> ${target}`);
    }
  }

  return missing;
}

async function main() {
  const missing: string[] = [];

  for (const relativePath of DOC_FILES) {
    const docPath = path.resolve(process.cwd(), relativePath);
    if (!existsSync(docPath)) {
      missing.push(`Missing document: ${relativePath}`);
      continue;
    }

    missing.push(...(await findMissingLinks(docPath)));
  }

  if (missing.length > 0) {
    console.error("Documentation link check failed:");
    for (const item of missing) {
      console.error(`- ${item}`);
    }
    process.exit(1);
  }

  console.log("Documentation link check passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
