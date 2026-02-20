# API Guide

Nostr Agent Interface exposes the canonical tool contract over HTTP.

For CLI usage of the same tool contract, see `docs/cli.md`.

## Start

```bash
nostr-agent-interface api --host 127.0.0.1 --port 3030
```

## Endpoints

1. `GET /health`
2. `GET /tools`
3. `POST /tools/:toolName`
4. `GET /v1/health`
5. `GET /v1/tools`
6. `POST /v1/tools/:toolName`

`/v1/*` endpoints mirror the legacy routes for compatibility.

## Response Shape

Successful tool calls (`POST /tools/:toolName`) return the underlying MCP `callTool` payload as JSON.

Error responses use a standardized envelope:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests. Try again later.",
    "details": {
      "limit": 120,
      "windowMs": 60000,
      "retryAfterMs": 40000
    },
    "requestId": "..."
  }
}
```

`x-request-id` response header matches `error.requestId`.

## Authentication (Optional)

Set `NOSTR_AGENT_API_KEY` to require auth on tool endpoints:

```bash
NOSTR_AGENT_API_KEY=your-token nostr-agent-interface api --host 127.0.0.1 --port 3030
```

Behavior:

1. `GET /health` remains public.
2. `GET /tools` requires API key.
3. `POST /tools/:toolName` requires API key.

Supported headers:

1. `x-api-key: <token>`
2. `authorization: Bearer <token>`

## Rate Limiting

`/tools` endpoints use an in-memory fixed window limiter by default.

Env vars:

1. `NOSTR_AGENT_API_RATE_LIMIT_MAX` (default `120`)
2. `NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS` (default `60000`)
3. `NOSTR_AGENT_API_TRUST_PROXY` (default `false`)

Set `NOSTR_AGENT_API_RATE_LIMIT_MAX=0` to disable.

Rate-limit identity behavior:

1. If API auth is enabled and a valid API key is supplied, limiter keys by that API key.
2. Otherwise, limiter keys by client IP.
3. By default (`NOSTR_AGENT_API_TRUST_PROXY=false`), IP is taken from the socket remote address.
4. If `NOSTR_AGENT_API_TRUST_PROXY=true`, `x-forwarded-for` / `x-real-ip` are trusted before socket IP.

Only enable proxy trust behind a trusted reverse proxy that strips/spoofs client IP headers safely.

When limited, API returns:

1. HTTP `429`
2. `error.code = "rate_limited"`
3. `retry-after` header
4. `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` headers

## Request Body Limits

Tool-call request bodies are capped to avoid unbounded buffering.

Env var:

1. `NOSTR_AGENT_API_MAX_BODY_BYTES` (default `1048576`, 1 MiB)

If a request exceeds the cap, API returns:

1. HTTP `413`
2. `error.code = "payload_too_large"`
3. `details.maxBodyBytes` and size context (`contentLength` or `receivedBytes`)

## Audit Logging

API emits structured JSON logs for both request and response events:

1. `event = "api.request"` with request metadata.
2. `event = "api.response"` with status/duration and correlated `requestId`.

Env vars:

1. `NOSTR_AGENT_API_AUDIT_LOG_ENABLED` (default `true`)
2. `NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES` (default `true`)

Sensitive values are masked in logs (for example `authorization`, `x-api-key`, `privateKey`, `token`, `secret`, `password`).

## Production Defaults

Recommended baseline for internet-facing deployments:

1. Require API auth: set `NOSTR_AGENT_API_KEY` to a strong secret.
2. Keep rate limiting enabled: start with `NOSTR_AGENT_API_RATE_LIMIT_MAX=120` and `NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS=60000`.
3. Keep audit logging on: `NOSTR_AGENT_API_AUDIT_LOG_ENABLED=true`.
4. Disable audit bodies by default: `NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES=false`.
5. Keep `NOSTR_AGENT_API_TRUST_PROXY=false` unless running behind a trusted proxy.
6. Keep request size caps enabled: `NOSTR_AGENT_API_MAX_BODY_BYTES=1048576` (or tighter for your workload).
7. Bind intentionally: use `--host 127.0.0.1` behind a trusted reverse proxy, or use `--host 0.0.0.0` only when network controls are in place.

Example:

```bash
NOSTR_AGENT_API_KEY=replace-with-strong-token \
NOSTR_AGENT_API_RATE_LIMIT_MAX=120 \
NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS=60000 \
NOSTR_AGENT_API_AUDIT_LOG_ENABLED=true \
NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES=false \
NOSTR_AGENT_API_TRUST_PROXY=false \
NOSTR_AGENT_API_MAX_BODY_BYTES=1048576 \
nostr-agent-interface api --host 127.0.0.1 --port 3030
```

## Testing Coverage

Primary suites:

1. `__tests__/api-core.test.ts` for option parsing, sanitization helpers, in-memory request handling, and signal-driven shutdown.
2. `__tests__/api-errors.test.ts` for standardized error envelopes and perimeter failures.
3. `__tests__/api-audit-logging.test.ts` for structured log emission and redaction guarantees.

Targeted run:

```bash
bun test __tests__/api-core.test.ts __tests__/api-errors.test.ts __tests__/api-audit-logging.test.ts
```

## Request Examples

List tools:

```bash
curl -s http://127.0.0.1:3030/tools \
  -H 'x-api-key: API_KEY_EXAMPLE'
```

Call tool:

```bash
curl -s http://127.0.0.1:3030/tools/getProfile \
  -X POST \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer FAKE_BEARER_TOKEN_DO_NOT_USE' \
  -d '{"pubkey":"npub_example_fake"}'
```

## Error Codes

Common API error codes:

1. `invalid_json` (`400`): request body JSON is malformed.
2. `invalid_request` (`400`): request body shape/header is invalid (for example non-object JSON or invalid `content-length`).
3. `unauthorized` (`401`): missing/invalid API key on protected routes.
4. `not_found` (`404`): route is unknown.
5. `payload_too_large` (`413`): request body exceeds `NOSTR_AGENT_API_MAX_BODY_BYTES`.
6. `rate_limited` (`429`): client exceeded fixed-window rate limit.
7. `internal_error` (`500`): unexpected server-side failure.
