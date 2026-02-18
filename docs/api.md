# API Guide

Nostr Agent Interface exposes the canonical tool contract over HTTP.

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

Set `NOSTR_AGENT_API_RATE_LIMIT_MAX=0` to disable.

When limited, API returns:

1. HTTP `429`
2. `error.code = "rate_limited"`
3. `retry-after` header
4. `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` headers

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
5. Bind intentionally: use `--host 127.0.0.1` behind a trusted reverse proxy, or use `--host 0.0.0.0` only when network controls are in place.

Example:

```bash
NOSTR_AGENT_API_KEY=replace-with-strong-token \
NOSTR_AGENT_API_RATE_LIMIT_MAX=120 \
NOSTR_AGENT_API_RATE_LIMIT_WINDOW_MS=60000 \
NOSTR_AGENT_API_AUDIT_LOG_ENABLED=true \
NOSTR_AGENT_API_AUDIT_LOG_INCLUDE_BODIES=false \
nostr-agent-interface api --host 127.0.0.1 --port 3030
```

## Request Examples

List tools:

```bash
curl -s http://127.0.0.1:3030/tools \
  -H 'x-api-key: your-token'
```

Call tool:

```bash
curl -s http://127.0.0.1:3030/tools/getProfile \
  -X POST \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer your-token' \
  -d '{"pubkey":"npub..."}'
```

## Error Envelope

All API errors use a standardized shape:

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
