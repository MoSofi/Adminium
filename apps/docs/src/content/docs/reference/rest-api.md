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
| **Session cookie** | The dashboard | `adminium_session` — httpOnly, signed, `SameSite=Lax` |
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
GET /api/v1/readyz
```

Readiness, as opposed to `/healthz`'s liveness: can this process serve a real
request right now? It reports per-dependency verdicts — most importantly
whether the meta store is reachable — and answers `503` when it is not. Point
load-balancer and orchestrator readiness gates here, not at `/healthz`. (The
Docker image's own `HEALTHCHECK` deliberately probes `/api/v1/healthz` instead:
restarting the container cannot reconnect a dead meta database, so a database
blip must not become a crash-loop.)

```
GET /api/v1/system/info
```

Version and instance information.

## The machine-readable spec

The full contract is published as OpenAPI 3.1, generated from the route tree
itself — every `/api/v1` route declares a Zod schema and the server refuses to
boot without one, so the spec is derived from the code that enforces it rather
than written alongside it. CI fails when the two disagree.

```
https://docs.adminium.dev/openapi.json
```

Point a client generator, Postman, Insomnia, or an editor's OpenAPI extension at
it. Request and response shapes, query parameters, enums and status codes are
all in there; the sections below are the map, not the territory.

## Route groups

Thirty-one namespaces. Counts are operations, not paths.

<!-- BEGIN GENERATED: groups -->

| Group | Ops | |
|---|---:|---|
| `/api/v1/about/*` | 2 | Build version, edition, and the update check |
| `/api/v1/add-ons/*` | 17 | Installed add-ons — list what a host should mount, preview what installing would do, install from a verified package, enable or disable per host, and uninstall |
| `/api/v1/api-keys/*` | 3 | Issue, list and revoke API keys |
| `/api/v1/audit/*` | 2 | The audit log — list and read single entries |
| `/api/v1/auth/*` | 12 | Login, logout, session listing, 2FA enrolment, password change and reset |
| `/api/v1/bootstrap` | 1 | Everything the dashboard needs on first paint, in one call |
| `/api/v1/branding/*` | 4 | Instance name, colours and logo (read is public; writes are admin) |
| `/api/v1/connections/*` | 17 | Databases Adminium is pointed at — CRUD, connection test, introspection, schema snapshots, diffs, overrides, and generation |
| `/api/v1/data/*` | 8 | Rows in your database — list, read, create, update, delete, bulk write, undo, and inbound references |
| `/api/v1/email-templates/*` | 4 | Transactional email bodies per locale, plus a test send |
| `/api/v1/events` | 1 | Server-sent events — the fallback when a WebSocket cannot be established |
| `/api/v1/exports/*` | 4 | Queued exports of a whole result set, and their downloads |
| `/api/v1/healthz` | 1 | Liveness |
| `/api/v1/i18n/*` | 13 | Runtime translations — locales, keys, bundles, import/export, format errors |
| `/api/v1/imports/*` | 6 | CSV/spreadsheet imports — upload, dry run, run, error report |
| `/api/v1/jobs/*` | 4 | Background jobs — enqueue, poll, cancel |
| `/api/v1/llm/*` | 13 | LLM assist — provider config, runs, prompts, diffs, apply, undo |
| `/api/v1/me/*` | 11 | The signed-in user — profile, preferences, notifications, saved layouts |
| `/api/v1/meta/*` | 2 | Where the meta store lives, and relocating it |
| `/api/v1/onboarding/*` | 2 | The first-run checklist |
| `/api/v1/pages/*` | 13 | Pages and dashboards — layout, config, nav order, shared views |
| `/api/v1/permissions` | 1 | The permission catalog every role is built from |
| `/api/v1/public/*` | 6 | The scoped public API for customer- and staff-facing pages (off by default) |
| `/api/v1/public-api/*` | 2 | Turn the public API on or off, and see whether this instance opted in |
| `/api/v1/public-keys/*` | 5 | Issue, reveal, rotate and revoke the browser-safe keys your pages use |
| `/api/v1/public-scopes/*` | 4 | Define what a public key may read — resources, columns, filters and time zone |
| `/api/v1/readyz` | 1 | Readiness — per-dependency verdicts, 503 when a dependency is down |
| `/api/v1/roles/*` | 6 | RBAC roles and their permission sets |
| `/api/v1/scheduled-reports/*` | 4 | Recurring exports delivered on a schedule |
| `/api/v1/schema-import` | 1 | Parse a schema file (SQL, Prisma, Drizzle, the JSON IR, …) into the IR |
| `/api/v1/search` | 1 | Cross-resource search for the command palette |
| `/api/v1/settings/*` | 10 | Instance settings — defaults, branding, email, security, telemetry, workspace |
| `/api/v1/setup/*` | 2 | First-boot super-admin creation, and whether setup is still open |
| `/api/v1/surfaces/*` | 5 | Hosted app surfaces — placement in the dashboard, and attaching your own domains |
| `/api/v1/system` | 1 | Version and instance information |
| `/api/v1/users/*` | 9 | People in the workspace — invite, suspend, delete, assign roles |
| `/api/v1/widget-data/*` | 2 | The queries widgets run, singly and in batches |

<!-- END GENERATED: groups -->

Three of these deserve a note, because the obvious guess is wrong:

- **There is no `/api/v1/schema/*`.** Snapshots, diffs and overrides are nested
  under the connection they belong to: `/connections/:id/schema/*`.
- **There is no `/api/v1/generate/*`.** Generation is an action on a connection:
  `POST /connections/:id/generate`.
- **There is no `/api/v1/views/*`.** Shared views belong to a page
  (`/pages/:pageId/views`); per-user saved layouts belong to you
  (`/me/views/:pageId/layout`).

## Every operation

The complete surface, straight from the spec. Path parameters appear as
`{name}`.

<!-- BEGIN GENERATED: operations -->

### `/about`

```http
GET /api/v1/about
GET /api/v1/about/update-check
```

### `/add-ons`

```http
GET /api/v1/add-ons/catalog
PUT /api/v1/add-ons/catalog
POST /api/v1/add-ons/catalog/refresh
POST /api/v1/add-ons/download
POST /api/v1/add-ons/upload
DELETE /api/v1/add-ons/staged/{key}/{version}
POST /api/v1/add-ons/{key}/upgrade
GET /api/v1/add-ons
POST /api/v1/add-ons
GET /api/v1/add-ons/{key}/plan
GET /api/v1/add-ons/{key}/bundle/{*}
POST /api/v1/add-ons/{key}/connect
DELETE /api/v1/add-ons/{key}/connect
POST /api/v1/add-ons/{key}/connect/oauth/start
POST /api/v1/add-ons/{key}/connect/oauth/complete
PATCH /api/v1/add-ons/{key}
DELETE /api/v1/add-ons/{key}
```

### `/api-keys`

```http
GET /api/v1/api-keys
POST /api/v1/api-keys
DELETE /api/v1/api-keys/{id}
```

### `/audit`

```http
GET /api/v1/audit
GET /api/v1/audit/{id}
```

### `/auth`

```http
POST /api/v1/auth/login
POST /api/v1/auth/2fa/verify
POST /api/v1/auth/logout
GET /api/v1/auth/session
GET /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/{id}
POST /api/v1/auth/password/change
POST /api/v1/auth/password/forgot
POST /api/v1/auth/password/reset
POST /api/v1/auth/2fa/enroll
POST /api/v1/auth/2fa/activate
POST /api/v1/auth/2fa/disable
```

### `/bootstrap`

```http
GET /api/v1/bootstrap
```

### `/branding`

```http
GET /api/v1/branding
GET /api/v1/branding/logo
POST /api/v1/branding/logo
DELETE /api/v1/branding/logo
```

### `/connections`

```http
GET /api/v1/connections
POST /api/v1/connections
POST /api/v1/connections/test
GET /api/v1/connections/{id}
PATCH /api/v1/connections/{id}
DELETE /api/v1/connections/{id}
POST /api/v1/connections/{id}/test
POST /api/v1/connections/{id}/introspect
GET /api/v1/connections/{id}/schema
GET /api/v1/connections/{id}/schema/snapshots
GET /api/v1/connections/{id}/schema/snapshots/{snapshotId}
GET /api/v1/connections/{id}/schema/diff
GET /api/v1/connections/{id}/schema/overrides
PUT /api/v1/connections/{id}/schema/overrides
GET /api/v1/connections/{id}/overrides
PUT /api/v1/connections/{id}/overrides
POST /api/v1/connections/{id}/generate
```

### `/data`

```http
GET /api/v1/data/{connectionId}/{table}
POST /api/v1/data/{connectionId}/{table}
POST /api/v1/data/undo/{token}
POST /api/v1/data/{connectionId}/{table}/bulk
GET /api/v1/data/{connectionId}/{table}/{recordId}/references
GET /api/v1/data/{connectionId}/{table}/{recordId}
PATCH /api/v1/data/{connectionId}/{table}/{recordId}
DELETE /api/v1/data/{connectionId}/{table}/{recordId}
```

### `/email-templates`

```http
GET /api/v1/email-templates
GET /api/v1/email-templates/{key}/{locale}
PUT /api/v1/email-templates/{key}/{locale}
POST /api/v1/email-templates/{key}/test-send
```

### `/events`

```http
GET /api/v1/events
```

### `/exports`

```http
GET /api/v1/exports
POST /api/v1/exports
GET /api/v1/exports/{id}
GET /api/v1/exports/{id}/download
```

### `/healthz`

```http
GET /api/v1/healthz
```

### `/i18n`

```http
GET /api/v1/i18n/manifest
GET /api/v1/i18n/bundle/{locale}/{namespace}
GET /api/v1/i18n/format-errors
GET /api/v1/i18n/keys
PUT /api/v1/i18n/keys
DELETE /api/v1/i18n/keys
POST /api/v1/i18n/keys/bulk
GET /api/v1/i18n/export/{locale}
POST /api/v1/i18n/import/{locale}
GET /api/v1/i18n/locales
POST /api/v1/i18n/locales
PATCH /api/v1/i18n/locales/{locale}
DELETE /api/v1/i18n/locales/{locale}
```

### `/imports`

```http
POST /api/v1/imports/upload
GET /api/v1/imports
POST /api/v1/imports
POST /api/v1/imports/{id}/run
GET /api/v1/imports/{id}
GET /api/v1/imports/{id}/error-report
```

### `/jobs`

```http
GET /api/v1/jobs
POST /api/v1/jobs
GET /api/v1/jobs/{id}
POST /api/v1/jobs/{id}/cancel
```

### `/llm`

```http
GET /api/v1/llm/config
PUT /api/v1/llm/config
POST /api/v1/llm/config/test
GET /api/v1/llm/models
GET /api/v1/llm/runs
POST /api/v1/llm/runs
POST /api/v1/llm/runs/{id}/execute
POST /api/v1/llm/runs/{id}/response
GET /api/v1/llm/runs/{id}
GET /api/v1/llm/runs/{id}/prompt
GET /api/v1/llm/runs/{id}/diff
POST /api/v1/llm/runs/{id}/apply
POST /api/v1/llm/runs/{id}/undo/{token}
```

### `/me`

```http
GET /api/v1/me
PATCH /api/v1/me
GET /api/v1/me/prefs
PATCH /api/v1/me/prefs
GET /api/v1/me/notifications
POST /api/v1/me/notifications/{id}/read
POST /api/v1/me/notifications/read-all
GET /api/v1/me/notification-prefs
PUT /api/v1/me/notification-prefs
PUT /api/v1/me/views/{pageId}/layout
DELETE /api/v1/me/views/{pageId}/layout
```

### `/meta`

```http
GET /api/v1/meta/placement
POST /api/v1/meta/relocate
```

### `/onboarding`

```http
GET /api/v1/onboarding
POST /api/v1/onboarding/dismiss
```

### `/pages`

```http
GET /api/v1/pages/{pageId}
PATCH /api/v1/pages/{pageId}
DELETE /api/v1/pages/{pageId}
PATCH /api/v1/pages/{pageId}/layout
GET /api/v1/pages
POST /api/v1/pages
PUT /api/v1/pages/nav-order
PATCH /api/v1/pages/{pageId}/config
POST /api/v1/pages/{pageId}/duplicate
GET /api/v1/pages/{pageId}/views
POST /api/v1/pages/{pageId}/views
PATCH /api/v1/pages/{pageId}/views/{viewId}
DELETE /api/v1/pages/{pageId}/views/{viewId}
```

### `/permissions`

```http
GET /api/v1/permissions/catalog
```

### `/public`

```http
GET /api/v1/public/config
GET /api/v1/public/records/{ref}
POST /api/v1/public/records/{ref}
PATCH /api/v1/public/records/{ref}/{id}
POST /api/v1/public/claim
DELETE /api/v1/public/session
```

### `/public-api`

```http
GET /api/v1/public-api
PUT /api/v1/public-api
```

### `/public-keys`

```http
GET /api/v1/public-keys
POST /api/v1/public-keys
GET /api/v1/public-keys/{id}/reveal
POST /api/v1/public-keys/{id}/rotate
DELETE /api/v1/public-keys/{id}
```

### `/public-scopes`

```http
GET /api/v1/public-scopes
POST /api/v1/public-scopes
PATCH /api/v1/public-scopes/{id}
DELETE /api/v1/public-scopes/{id}
```

### `/readyz`

```http
GET /api/v1/readyz
```

### `/roles`

```http
GET /api/v1/roles
POST /api/v1/roles
PATCH /api/v1/roles/{id}
DELETE /api/v1/roles/{id}
GET /api/v1/roles/{id}/permissions
PUT /api/v1/roles/{id}/permissions
```

### `/scheduled-reports`

```http
GET /api/v1/scheduled-reports
POST /api/v1/scheduled-reports
PATCH /api/v1/scheduled-reports/{id}
DELETE /api/v1/scheduled-reports/{id}
```

### `/schema-import`

```http
POST /api/v1/schema-import/parse
```

### `/search`

```http
GET /api/v1/search
```

### `/settings`

```http
GET /api/v1/settings/defaults
PUT /api/v1/settings/defaults
GET /api/v1/settings/workspace
PUT /api/v1/settings/branding
GET /api/v1/settings/security
PUT /api/v1/settings/security
GET /api/v1/settings/telemetry
PUT /api/v1/settings/telemetry
GET /api/v1/settings/email
PUT /api/v1/settings/email
```

### `/setup`

```http
GET /api/v1/setup/state
POST /api/v1/setup/super-admin
```

### `/surfaces`

```http
GET /api/v1/surfaces
PUT /api/v1/surfaces/{appKey}/placement
PUT /api/v1/surfaces/{appKey}/connection
PUT /api/v1/surfaces/instances
PUT /api/v1/surfaces/domains
```

### `/system`

```http
GET /api/v1/system/info
```

### `/users`

```http
POST /api/v1/users/{id}/roles
PUT /api/v1/users/{id}/roles
DELETE /api/v1/users/{id}/roles/{roleId}
GET /api/v1/users
POST /api/v1/users
GET /api/v1/users/{id}
PATCH /api/v1/users/{id}
DELETE /api/v1/users/{id}
POST /api/v1/users/{id}/invite/resend
```

### `/widget-data`

```http
POST /api/v1/widget-data/query
POST /api/v1/widget-data/batch
```

<!-- END GENERATED: operations -->

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

→ [The OpenAPI document](https://docs.adminium.dev/openapi.json)
