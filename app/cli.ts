import { createManagedMcpClient } from "./mcp-client.js";

type CliFlags = {
  json: boolean;
  stdin: boolean;
  help: boolean;
};

type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object";

type JsonSchema = {
  type?: JsonSchemaType | JsonSchemaType[] | string | string[];
  description?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  additionalProperties?: unknown;
};

type CliToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
};

type ToolCommandArgs = {
  flags: CliFlags;
  toolArgs: Record<string, unknown>;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
const JSON_SCHEMA_TYPES = new Set<JsonSchemaType>([
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
]);

function printHelp() {
  console.log(`Nostr Agent CLI

Usage:
  nostr-agent-interface cli list-tools [--json]
  nostr-agent-interface cli <toolName> [--field value ...] [--json]
  nostr-agent-interface cli <toolName> [jsonArgs] [--json]
  nostr-agent-interface cli <toolName> --stdin [--json]
  nostr-agent-interface cli call <toolName> [jsonArgs] [--json]
  nostr-agent-interface cli call <toolName> --stdin [--json]

Commands:
  list-tools  List available MCP tools (canonical names + schemas)
  call        Invoke a tool by name with JSON args (legacy-compatible)
  <toolName>  Invoke any MCP tool directly by name (recommended)

Use --help with a command or tool name for more details.`);
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

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function parseBooleanLiteral(raw: string, optionLabel: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new Error(`Invalid boolean for ${optionLabel}: ${raw}`);
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

function getSchemaType(schema: JsonSchema | undefined): JsonSchemaType | undefined {
  if (!schema) return undefined;

  const raw = schema.type;
  if (typeof raw === "string" && JSON_SCHEMA_TYPES.has(raw as JsonSchemaType)) {
    return raw as JsonSchemaType;
  }

  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === "string" && JSON_SCHEMA_TYPES.has(value as JsonSchemaType)) {
        return value as JsonSchemaType;
      }
    }
  }

  return undefined;
}

function getToolSchema(tool: CliToolDefinition): JsonSchema {
  if (!tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
    return {};
  }
  return tool.inputSchema;
}

function getToolProperties(tool: CliToolDefinition): Record<string, JsonSchema> {
  const schema = getToolSchema(tool);
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    return {};
  }
  return schema.properties;
}

function getToolRequiredFields(tool: CliToolDefinition): string[] {
  const schema = getToolSchema(tool);
  if (!Array.isArray(schema.required)) {
    return [];
  }

  return schema.required.filter((value): value is string => typeof value === "string");
}

function parseJsonValue(raw: string, optionLabel: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON for ${optionLabel}`);
  }
}

function parseToolArgValue(raw: string, schema: JsonSchema | undefined, optionLabel: string): unknown {
  const schemaType = getSchemaType(schema);
  let parsed: unknown = raw;

  if (schemaType === "boolean") {
    parsed = parseBooleanLiteral(raw, optionLabel);
  } else if (schemaType === "integer" || schemaType === "number") {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Invalid number for ${optionLabel}: ${raw}`);
    }
    if (schemaType === "integer" && !Number.isInteger(numeric)) {
      throw new Error(`Invalid integer for ${optionLabel}: ${raw}`);
    }
    parsed = numeric;
  } else if (schemaType === "array") {
    const asJson = parseJsonValue(raw, optionLabel);
    if (!Array.isArray(asJson)) {
      throw new Error(`Expected JSON array for ${optionLabel}`);
    }
    parsed = asJson;
  } else if (schemaType === "object") {
    const asJson = parseJsonValue(raw, optionLabel);
    if (!asJson || typeof asJson !== "object" || Array.isArray(asJson)) {
      throw new Error(`Expected JSON object for ${optionLabel}`);
    }
    parsed = asJson;
  }

  if (schema?.enum && schema.enum.length > 0) {
    const enumMatch = schema.enum.some((entry) => Object.is(entry, parsed));
    if (!enumMatch) {
      const choices = schema.enum.map((value) => JSON.stringify(value)).join(", ");
      throw new Error(`Invalid value for ${optionLabel}. Allowed: ${choices}`);
    }
  }

  return parsed;
}

function getToolOptionsLookup(tool: CliToolDefinition): Map<string, string> {
  const lookup = new Map<string, string>();
  const properties = getToolProperties(tool);

  for (const propertyName of Object.keys(properties)) {
    lookup.set(propertyName, propertyName);
    lookup.set(toKebabCase(propertyName), propertyName);
  }

  return lookup;
}

function parseDirectToolArgs(args: string[], tool: CliToolDefinition): ToolCommandArgs {
  const flags: CliFlags = {
    json: false,
    stdin: false,
    help: false,
  };
  const toolArgs: Record<string, unknown> = {};
  const positionals: string[] = [];
  const properties = getToolProperties(tool);
  const optionsLookup = getToolOptionsLookup(tool);
  let hasFieldOptions = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--json") {
      flags.json = true;
      continue;
    }

    if (arg === "--stdin") {
      flags.stdin = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }

    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const rawOption = arg.slice(2);
    const equalsIndex = rawOption.indexOf("=");
    const optionName = equalsIndex >= 0 ? rawOption.slice(0, equalsIndex) : rawOption;
    let optionValue = equalsIndex >= 0 ? rawOption.slice(equalsIndex + 1) : undefined;
    const propertyName = optionsLookup.get(optionName);

    if (!propertyName) {
      throw new Error(`Unknown option for ${tool.name}: --${optionName}`);
    }

    if (flags.stdin) {
      throw new Error("Cannot combine --stdin with individual tool options");
    }

    hasFieldOptions = true;
    const propertySchema = properties[propertyName];
    const propertyType = getSchemaType(propertySchema);

    if (typeof optionValue === "undefined") {
      const nextArg = args[i + 1];
      const canConsumeNext = typeof nextArg === "string" && !nextArg.startsWith("--");

      if (propertyType === "boolean") {
        if (!canConsumeNext) {
          toolArgs[propertyName] = true;
          continue;
        }
      } else if (!canConsumeNext) {
        throw new Error(`Missing value for --${optionName}`);
      }

      if (canConsumeNext) {
        optionValue = nextArg;
        i += 1;
      }
    }

    if (typeof optionValue === "undefined") {
      throw new Error(`Missing value for --${optionName}`);
    }

    toolArgs[propertyName] = parseToolArgValue(optionValue, propertySchema, `--${optionName}`);
  }

  if (flags.stdin && hasFieldOptions) {
    throw new Error("Cannot combine --stdin with individual tool options");
  }

  if (positionals.length > 1) {
    throw new Error(`Too many positional arguments for ${tool.name}`);
  }

  if (positionals.length === 1) {
    if (flags.stdin || hasFieldOptions) {
      throw new Error("Provide args as JSON, --stdin, or field options (not a mix)");
    }
    return {
      flags,
      toolArgs: parseJsonArgs(positionals[0]),
    };
  }

  return { flags, toolArgs };
}

function validateRequiredToolArgs(tool: CliToolDefinition, toolArgs: Record<string, unknown>) {
  const requiredFields = getToolRequiredFields(tool);
  const missing = requiredFields.filter(
    (field) => !(field in toolArgs) || typeof toolArgs[field] === "undefined",
  );

  if (missing.length > 0) {
    const missingOptions = missing
      .map((field) => `--${toKebabCase(field)}`)
      .join(", ");
    throw new Error(`Missing required options for ${tool.name}: ${missingOptions}`);
  }
}

function formatSchemaHint(schema: JsonSchema | undefined): string {
  const schemaType = getSchemaType(schema);

  if (schema?.enum && schema.enum.length > 0) {
    const values = schema.enum.map((entry) => String(entry)).join("|");
    return `<${values}>`;
  }

  if (schemaType === "array" || schemaType === "object") {
    return "<json>";
  }

  if (schemaType === "boolean") {
    return "[true|false]";
  }

  if (schemaType === "integer") {
    return "<int>";
  }

  if (schemaType === "number") {
    return "<number>";
  }

  return "<string>";
}

function printToolHelp(tool: CliToolDefinition) {
  const properties = getToolProperties(tool);
  const propertyEntries = Object.entries(properties);
  const requiredSet = new Set(getToolRequiredFields(tool));

  console.log(`Usage:
  nostr-agent-interface cli ${tool.name} [--field value ...] [--json]
  nostr-agent-interface cli ${tool.name} [jsonArgs] [--json]
  nostr-agent-interface cli ${tool.name} --stdin [--json]

Description:
  ${tool.description ?? "No description available."}`);

  if (propertyEntries.length > 0) {
    console.log("\nTool options:");
    for (const [propertyName, schema] of propertyEntries) {
      const kebab = toKebabCase(propertyName);
      const optionName =
        kebab === propertyName ? `--${propertyName}` : `--${kebab} | --${propertyName}`;
      const requiredSuffix = requiredSet.has(propertyName) ? " (required)" : "";
      const hint = formatSchemaHint(schema);
      const description = schema.description ?? "";
      console.log(`  ${optionName} ${hint}${requiredSuffix}`.trimEnd());
      if (description) {
        console.log(`    ${description}`);
      }
    }
  }

  console.log("\nCommon options:\n  --json\n  --stdin\n  --help");
}

function getToolsFromListResponse(response: unknown): CliToolDefinition[] {
  if (!response || typeof response !== "object") {
    return [];
  }

  const rawTools = (response as { tools?: unknown }).tools;
  if (!Array.isArray(rawTools)) {
    return [];
  }

  return rawTools.filter((entry): entry is CliToolDefinition => {
    return (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string"
    );
  });
}

function findToolByName(tools: CliToolDefinition[], toolName: string): CliToolDefinition | undefined {
  return tools.find((tool) => tool.name === toolName);
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
      const tools = getToolsFromListResponse(response);

      if (flags.json) {
        console.log(JSON.stringify(response, null, 2));
        return 0;
      }

      for (const tool of tools) {
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

    managed = await createManagedMcpClient();
    const listResponse = await managed.client.listTools();
    const tools = getToolsFromListResponse(listResponse);
    const tool = findToolByName(tools, command);

    if (!tool) {
      throw new Error(`Unknown command or tool: ${command}. Use "cli list-tools" to view available tools.`);
    }

    const { flags, toolArgs: parsedToolArgs } = parseDirectToolArgs(rest, tool);

    if (flags.help) {
      printToolHelp(tool);
      return 0;
    }

    const toolArgs = flags.stdin ? await readStdinJsonObject() : parsedToolArgs;
    validateRequiredToolArgs(tool, toolArgs);

    const result = await managed.client.callTool({
      name: tool.name,
      arguments: toolArgs,
    });

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printToolContent(result);
    }

    return isResultError(result) ? 1 : 0;
  } finally {
    if (managed) {
      await managed.close();
    }
  }
}
