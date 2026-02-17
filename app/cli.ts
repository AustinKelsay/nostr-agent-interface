import { createManagedMcpClient } from "./mcp-client.js";

type CliFlags = {
  json: boolean;
  stdin: boolean;
  help: boolean;
};

function printHelp() {
  console.log(`Nostr Agent CLI

Usage:
  nostr-agent-interface cli list-tools [--json]
  nostr-agent-interface cli call <toolName> [jsonArgs] [--json]
  nostr-agent-interface cli call <toolName> --stdin [--json]

Commands:
  list-tools  List available MCP tools
  call        Invoke a tool by name

Use --help with a subcommand for more details.`);
}

function printListToolsHelp() {
  console.log(`Usage:
  nostr-agent-interface cli list-tools [--json]

Options:
  --json   Print raw listTools response as JSON`);
}

function printCallHelp() {
  console.log(`Usage:
  nostr-agent-interface cli call <toolName> [jsonArgs] [--json]
  nostr-agent-interface cli call <toolName> --stdin [--json]

Arguments:
  toolName   MCP tool name (for example: getProfile)
  jsonArgs   Optional JSON object string for tool arguments

Options:
  --stdin    Read tool arguments JSON object from stdin
  --json     Print raw callTool response as JSON

Examples:
  nostr-agent-interface cli call getProfile '{"pubkey":"npub..."}'
  echo '{"input":"npub...","targetType":"hex"}' | nostr-agent-interface cli call convertNip19 --stdin --json`);
}

function parseJsonArgs(input: string | undefined): Record<string, unknown> {
  if (!input || input.trim() === "") {
    return {};
  }

  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool args must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

async function readStdinJsonObject(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) {
    throw new Error("--stdin requires piped input");
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return parseJsonArgs(raw);
}

function parseFlags(
  args: string[],
  options: { allowStdin: boolean },
): { flags: CliFlags; positionals: string[] } {
  const flags: CliFlags = {
    json: false,
    stdin: false,
    help: false,
  };
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === "--json") {
      flags.json = true;
      continue;
    }

    if (arg === "--stdin") {
      if (!options.allowStdin) {
        throw new Error("--stdin is only supported for cli call");
      }
      flags.stdin = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}

function getResultContent(result: unknown): unknown[] {
  if (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    return (result as { content: unknown[] }).content;
  }

  return [];
}

function isResultError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "isError" in result &&
    (result as { isError?: unknown }).isError === true
  );
}

function printToolContent(result: unknown) {
  const content = getResultContent(result);
  if (content.length === 0) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      "text" in block &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      console.log((block as { text: string }).text);
      continue;
    }

    console.log(JSON.stringify(block, null, 2));
  }
}

export async function runCli(args: string[]): Promise<number> {
  const [command, ...rest] = args;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return 0;
  }

  let managed: Awaited<ReturnType<typeof createManagedMcpClient>> | undefined;

  try {
    if (command === "list-tools") {
      const { flags, positionals } = parseFlags(rest, { allowStdin: false });

      if (flags.help) {
        printListToolsHelp();
        return 0;
      }

      if (positionals.length > 0) {
        throw new Error("Usage: cli list-tools [--json]");
      }

      managed = await createManagedMcpClient();
      const response = await managed.client.listTools();

      if (flags.json) {
        console.log(JSON.stringify(response, null, 2));
        return 0;
      }

      for (const tool of response.tools ?? []) {
        console.log(`${tool.name}\t${tool.description ?? ""}`.trimEnd());
      }

      return 0;
    }

    if (command === "call") {
      const { flags, positionals } = parseFlags(rest, { allowStdin: true });

      if (flags.help) {
        printCallHelp();
        return 0;
      }

      const [toolName, rawArgs, ...extraPositionals] = positionals;

      if (!toolName) {
        throw new Error("Missing tool name. Usage: cli call <toolName> [jsonArgs] [--json]");
      }

      if (extraPositionals.length > 0) {
        throw new Error("Too many positional arguments. Usage: cli call <toolName> [jsonArgs] [--json]");
      }

      if (flags.stdin && typeof rawArgs !== "undefined") {
        throw new Error("Provide args either as jsonArgs or with --stdin, not both");
      }

      const toolArgs = flags.stdin ? await readStdinJsonObject() : parseJsonArgs(rawArgs);

      managed = await createManagedMcpClient();
      const result = await managed.client.callTool({
        name: toolName,
        arguments: toolArgs,
      });

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printToolContent(result);
      }

      return isResultError(result) ? 1 : 0;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    if (managed) {
      await managed.close();
    }
  }
}
