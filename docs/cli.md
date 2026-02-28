# CLI Guide

Nostr Agent Interface exposes the canonical tool contract directly in CLI mode.

CLI executes tools through the in-process shared tool runtime by default; it does not route through MCP transport.

## Command Model

Use one of these forms:

1. `nostr-agent-interface cli list-tools [--json]`
2. `nostr-agent-interface cli <toolName> [--field value ...] [--json]`
3. `nostr-agent-interface cli <toolName> [jsonArgs] [--json]`
4. `nostr-agent-interface cli <toolName> --stdin [--json]`
5. `nostr-agent-interface cli call <toolName> ...` (legacy-compatible)

`<toolName>` is any canonical tool from `list-tools`; use `list-tools` for the current set.

## Discovery Workflow

List tools:

```bash
nostr-agent-interface cli list-tools
```

List tools with full schema:

```bash
nostr-agent-interface cli list-tools --json
```

Inspect one tool's options and required fields:

```bash
nostr-agent-interface cli getProfile --help
nostr-agent-interface cli convertNip19 --help
```

## Invocation Styles

### 1) Direct schema-aware flags (recommended)

```bash
nostr-agent-interface cli getProfile --pubkey npub...
nostr-agent-interface cli convertNip19 --input npub... --target-type hex --json
```

### 2) JSON object positional arg

```bash
nostr-agent-interface cli getProfile '{"pubkey":"npub..."}' --json
```

### 3) JSON object via stdin

```bash
echo '{"input":"npub...","targetType":"hex"}' \
  | nostr-agent-interface cli convertNip19 --stdin --json
```

### 4) Legacy `call` command

```bash
nostr-agent-interface cli call getProfile '{"pubkey":"npub..."}' --json
```

## Option Parsing Rules

CLI field flags are generated from tool `inputSchema` and parsed by type:

1. `string`: passed as text.
2. `number` / `integer`: parsed from numeric input.
3. `boolean`: accepts `true/false`, `1/0`, `yes/no`, `on/off`.
4. `array`: expects JSON array input, for example `'["wss://relay.damus.io"]'`.
5. `object`: expects JSON object input.
6. `enum`: value must be one of allowed schema values.

Flag names support both:

1. camelCase: `--targetType`
2. kebab-case: `--target-type`

Required schema fields are validated before tool execution.

## Output Modes

1. default: prints text blocks from tool output.
2. `--json`: prints raw tool result payload as JSON.
3. `NOSTR_JSON_ONLY=true`: suppresses CLI stderr logging while keeping JSON output parseable.

`NOSTR_JSON_ONLY` is useful for automation scripts that need strict machine-readable output. It also applies to
`--json` commands, so startup/service logs and tool-call informational logs are not written to stderr.

## Usage Notes

1. Do not mix input styles in one command (`--stdin` with per-field flags, or JSON positional with field flags).
2. Unknown fields fail fast (schema-aware option validation).
3. `list-tools --json` and `artifacts/tools.json` are the canonical contract sources.

## Testing Coverage

Primary suites:

1. `__tests__/cli-core.test.ts` for in-process parser/dispatcher behavior (`runCli`).
2. `__tests__/cli-ux.test.ts` for process-level UX behavior (stdout/stderr, help, exit codes).

Targeted run:

```bash
bun test __tests__/cli-core.test.ts __tests__/cli-ux.test.ts
```

## Examples by Workflow

Profile read:

```bash
nostr-agent-interface cli getProfile --pubkey npub...
```

Query events:

```bash
nostr-agent-interface cli queryEvents --kinds '[1]' --limit 5 --json
```

Post note:

```bash
nostr-agent-interface cli postNote --private-key nsec... --content "hello nostr" --json
```

DM send (NIP-44):

```bash
nostr-agent-interface cli sendDmNip44 \
  --private-key nsec... \
  --recipient-pubkey npub... \
  --content "hi"
```

## Security Note (Private Keys)

Avoid passing secrets with CLI flags like `--private-key`; command-line args can be exposed via shell history and process listings.

Prefer `--stdin` with a full JSON payload so sensitive values flow through standard input instead of argv:

```bash
{
  printf '{"privateKey":"'
  tr -d '\n' < /secure/path/private-key.txt
  printf '","content":"hello nostr"}'
} | nostr-agent-interface cli postNote --stdin --json
```
