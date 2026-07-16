---
title: REST API
description: The /api/v1 REST API — authentication, the error envelope, and the route groups.
---

Adminium exposes a REST API at `/api/v1`. The dashboard is built on it: there is
no private API the UI uses and you cannot.

## Versioning

`/api/v1` is **additive-only**. New fields and new routes may appear; existing
ones do not change shape or disappear. A breaking change would ship as
`/api/v2`, side by side.

## Authentication

Two mechanisms:

| | Used by | Sends |
|---|---|---|
| **Session cookie** | The dashboard | Cookie + CSRF token |
| **API key** | Your scripts and integrations | `Authorization: Bearer <key>` |

API keys are scoped and revocable. Create them in Settings → API Keys. Issue one
per integration, never share one between two, and revoke on rotation.

```bash
curl -H "Authorization: Bearer $ADMINIUM_API_KEY" \
  https://admin.example.com/api/v1/system/info
```

Every request is authorized against the caller's role. An API key cannot do what
its role cannot do — the RBAC check is the same one the UI goes through.

## Health

```
GET /api/v1/healthz
```

Returns JSON with `ok`. **Check the body, not just the status code** — bare
`/healthz` has no route and is answered by the SPA history fallback with a 200,
so a probe there reports healthy even when the meta store is unreachable.

```
GET /api/v1/system/info
```

Version and instance information.

## Route groups

| Group | |
|---|---|
| `/api/v1/auth/*` | Login, logout, 2FA |
| `/api/v1/me`, `/api/v1/me/views` | The current user; saved views |
| `/api/v1/connections/*` | Connections; test, introspect |
| `/api/v1/schema/*` | Snapshots and overrides |
| `/api/v1/schema-import/*` | Schema-file import |
| `/api/v1/data/:connectionId/:table` | Rows — list, read, create, update, delete |
| `/api/v1/widget-data/*` | Widget queries |
| `/api/v1/generate/*` | Generation |
| `/api/v1/pages/*` | Pages and dashboards |
| `/api/v1/views/*` | Shared views |
| `/api/v1/settings/*` | Instance settings |
| `/api/v1/roles/*` | RBAC |
| `/api/v1/api-keys/*` | API-key issuance and revocation |
| `/api/v1/audit/*` | Audit log |
| `/api/v1/jobs/*` | Background jobs |
| `/api/v1/llm/*` | LLM runs, responses, diffs, apply |
| `/api/v1/onboarding/*`, `/api/v1/bootstrap/*` | First-run setup |
| `/api/v1/system/*` | Health, version, instance info |

## Realtime

| | |
|---|---|
| `/ws` | WebSocket |
| `/api/v1/events` | SSE fallback |

Behind a reverse proxy the WebSocket needs `Upgrade`/`Connection` headers and a
long read timeout, or the UI goes stale without erroring:
[Behind a reverse proxy](/self-hosting/reverse-proxy/).

## Errors

Every error shares one envelope, with a stable machine-readable `code`. Branch on
`code`, not on the message — messages are for humans and may be reworded or
localized.

Validation failures identify the offending path: every external input is
schema-validated before a handler sees it.

## CORS

Off by default: the dashboard is served by the same process as the API, so it is
same-origin.

For a split deployment, `ADMINIUM_CORS_ORIGINS` takes a CSV of exact origins.
`*` is rejected — responses are credentialed.

→ [Environment variables](/self-hosting/env-vars/)
