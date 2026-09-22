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

API keys are scoped and revocable. A key acts with one role's permissions; mint one
with `POST /api/v1/api-keys` from a signed-in session, as
[Endpoints and keys](/guides/public-api/endpoints-and-keys/#keys-for-your-own-scripts)
shows. Issue one per integration, never share one between two, and revoke on rotation.

These are not the keys your pages use: a browser or server key for the public API
(`adm_pub_…`, `adm_srv_…`) calls only `/api/v1/public/*`, and only what it was granted.

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

Forty-eight namespaces. Counts are operations, not paths.

<!-- BEGIN GENERATED: groups -->

| Group | Ops | |
|---|---:|---|
| `/api/v1/about/*` | 2 | Build version, edition, and the update check |
| `/api/v1/add-ons/*` | 18 | Installed add-ons — list what a host should mount, preview what installing would do, install from a verified package, enable or disable per host, and uninstall |
| `/api/v1/api-docs` | 1 | The public API catalogue behind /api-docs — what live keys can call; 404 while the page is off |
| `/api/v1/api-keys/*` | 3 | Issue, list and revoke API keys |
| `/api/v1/apps/*` | 11 | Micro-SaaS apps installed into this instance — upload a built bundle or download one from the opt-in online catalog, browse what is staged or offered, plan its tables against a connection, install, update, discard a staged version, and uninstall |
| `/api/v1/assistant/*` | 7 | The page assistant — open a session on a page, ask it something, read what the turn came back with, and act on the draft it proposed. Every route needs the assistant permission; saving what it drafts additionally needs the same permission the page’s own save needs. The assistant reads; nothing it does writes a record on its own. |
| `/api/v1/audit/*` | 2 | The audit log — list and read single entries |
| `/api/v1/auth/*` | 12 | Login, logout, session listing, 2FA enrolment, password change and reset |
| `/api/v1/automation-runs/*` | 3 | Every execution of a rule — the last seven days, the three status filters, one run’s full step-by-step trace, and today’s counters |
| `/api/v1/automations/*` | 9 | Automation rules — the trigger, the steps and the branches between them; the tables, columns, templates and roles a rule can name; the 30-day counters the cards show; and a dry run that walks the flow without executing anything |
| `/api/v1/bootstrap` | 1 | Everything the dashboard needs on first paint, in one call |
| `/api/v1/branding/*` | 4 | Instance name, colours and logo (read is public; writes are admin) |
| `/api/v1/connections/*` | 22 | Databases Adminium is pointed at — CRUD, connection test, introspection, schema snapshots, diffs, overrides, and generation |
| `/api/v1/data/*` | 10 | Rows in your database — list, read, create, update, delete, bulk write, undo, and inbound references |
| `/api/v1/documents/*` | 13 | Documents drawn from your own records — the register of what was issued, the bytes behind each one, and the mappings that say which columns make which document. A document keeps a frozen copy of what it was drawn from, so editing or deleting the source row never changes an invoice somebody already has. Reading one needs read access to every table its mapping uses; a caller without all of them is told the document exists and not what is in it. |
| `/api/v1/email-blocks/*` | 3 | Reusable email sections saved from the editor — list, save one, delete one |
| `/api/v1/email-runs` | 1 | Campaign sends — cancel a scheduled or running run |
| `/api/v1/email-templates/*` | 17 | Email templates and campaigns — the documents, their language variations, the starters, test sends of the on-screen document, and export/import of a bundle |
| `/api/v1/events` | 1 | Server-sent events — the fallback when a WebSocket cannot be established |
| `/api/v1/exports/*` | 7 | Queued exports of a whole result set, and their downloads |
| `/api/v1/files/*` | 11 | Uploaded files and record attachments — upload, list, download (with Range and ETag), attach to a record, rename, move to trash and restore |
| `/api/v1/healthz` | 1 | Liveness |
| `/api/v1/i18n/*` | 13 | Runtime translations — locales, keys, bundles, import/export, format errors |
| `/api/v1/imports/*` | 6 | CSV/spreadsheet imports — upload, dry run, run, error report |
| `/api/v1/invoices/*` | 10 | Invoice templates and invoices — the documents, their language variations, the starters, duplicates, and building an invoice from a template |
| `/api/v1/jobs/*` | 4 | Background jobs — enqueue, poll, cancel |
| `/api/v1/llm/*` | 13 | LLM assist — provider config, runs, prompts, diffs, apply, undo |
| `/api/v1/me/*` | 11 | The signed-in user — profile, preferences, notifications, saved layouts |
| `/api/v1/meta/*` | 2 | Where the meta store lives, and relocating it |
| `/api/v1/onboarding/*` | 2 | The first-run checklist |
| `/api/v1/option-lists/*` | 5 | Named sets of answers a column accepts, written once and pointed at by as many columns as need them. Reading one needs only a session — a create dialog has to render the choices to anyone who may add a row — while writing needs the same grant that points a column at a list. The built-in lists live in code and are served with their labels in the caller's locale; editing one makes an ordinary copy rather than changing it. Deleting a list a column still names is refused with 409 and the columns using it. |
| `/api/v1/pages/*` | 15 | Pages and dashboards — layout, config, nav order, shared views, and what a template needs from a table (with a new table drafted to fit when none does) |
| `/api/v1/permissions` | 1 | The permission catalog every role is built from |
| `/api/v1/project/*` | 7 | A project folder on the server that runs one — which pages and schema customizations differ from the deployed files, settling a page changed on both sides, the changed copies `adminium pull --from` writes into the project, running the project’s actions, the built files of its own pages and widgets, and what Studio shows about the project |
| `/api/v1/public/*` | 15 | The scoped public API for customer- and staff-facing pages (off by default) |
| `/api/v1/public-api/*` | 3 | Turn the public API on or off, and see whether this instance opted in |
| `/api/v1/public-endpoints/*` | 5 | Build the endpoints a key can be granted — source, columns, filters, methods and limits |
| `/api/v1/public-keys/*` | 5 | Issue, reveal, rotate and revoke the browser-safe keys your pages use |
| `/api/v1/public-scopes/*` | 4 | Define what a public key may read — resources, columns, filters and time zone |
| `/api/v1/readyz` | 1 | Readiness — per-dependency verdicts, 503 when a dependency is down |
| `/api/v1/report-documents/*` | 9 | Report templates and reports — the block documents behind the report builder, the starters, duplicates, and building a report from a template |
| `/api/v1/roles/*` | 6 | RBAC roles and their permission sets |
| `/api/v1/scheduled-reports/*` | 4 | Recurring exports delivered on a schedule |
| `/api/v1/schema-import` | 1 | Parse a schema file (SQL, Prisma, Drizzle, the JSON IR, …) into the IR |
| `/api/v1/search` | 1 | Cross-resource search for the command palette |
| `/api/v1/settings/*` | 10 | Instance settings — defaults, branding, email, security, telemetry, workspace |
| `/api/v1/setup/*` | 4 | First-boot super-admin creation, whether setup is still open, and — in that same window — checking a database for an Adminium store already in it and adopting that store |
| `/api/v1/storage/*` | 8 | Where uploaded and generated files are stored — configure destinations (this server’s disk, an S3-compatible bucket, a WebDAV server), test one, choose the default, and move existing files between them |
| `/api/v1/surfaces/*` | 6 | Hosted app surfaces — placement in the dashboard, and attaching your own domains |
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
PUT /api/v1/add-ons/{key}/settings
```

### `/api-docs`

```http
GET /api/v1/api-docs
```

### `/api-keys`

```http
GET /api/v1/api-keys
POST /api/v1/api-keys
DELETE /api/v1/api-keys/{id}
```

### `/apps`

```http
GET /api/v1/apps
POST /api/v1/apps/upload
GET /api/v1/apps/catalog
PUT /api/v1/apps/catalog
POST /api/v1/apps/catalog/refresh
POST /api/v1/apps/download
POST /api/v1/apps/plan
POST /api/v1/apps/install
POST /api/v1/apps/{key}/update
DELETE /api/v1/apps/staged/{key}/{version}
DELETE /api/v1/apps/{key}
```

### `/assistant`

```http
GET /api/v1/assistant/availability
POST /api/v1/assistant/sessions
POST /api/v1/assistant/sessions/{id}/turns
GET /api/v1/assistant/sessions/{id}/turns/{turnId}
POST /api/v1/assistant/sessions/{id}/turns/{turnId}/cancel
POST /api/v1/assistant/sessions/{id}/turns/{turnId}/actions
POST /api/v1/assistant/sessions/{id}/close
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

### `/automation-runs`

```http
GET /api/v1/automation-runs/stats
GET /api/v1/automation-runs
GET /api/v1/automation-runs/{id}
```

### `/automations`

```http
GET /api/v1/automations
POST /api/v1/automations
GET /api/v1/automations/sources
GET /api/v1/automations/stats
GET /api/v1/automations/{id}
PATCH /api/v1/automations/{id}
DELETE /api/v1/automations/{id}
POST /api/v1/automations/{id}/duplicate
POST /api/v1/automations/{id}/test
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
POST /api/v1/connections/{id}/schema/plan
POST /api/v1/connections/{id}/schema/apply
POST /api/v1/connections/{id}/schema/adopt
GET /api/v1/connections/{id}/schema/changes
PUT /api/v1/connections/{id}/diagram-layout
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
GET /api/v1/data/{connectionId}/{table}/availability
GET /api/v1/data/{connectionId}/{table}/{recordId}/links/{relationId}
```

### `/documents`

```http
GET /api/v1/documents/kinds
GET /api/v1/documents/providers
GET /api/v1/documents/profiles
POST /api/v1/documents/profiles
PUT /api/v1/documents/profiles/{id}
DELETE /api/v1/documents/profiles/{id}
GET /api/v1/documents
GET /api/v1/documents/{id}
GET /api/v1/documents/{id}/content
GET /api/v1/documents/{id}/print
POST /api/v1/documents/render
POST /api/v1/documents/{id}/void
POST /api/v1/documents/{id}/send
```

### `/email-blocks`

```http
GET /api/v1/email-blocks
POST /api/v1/email-blocks
DELETE /api/v1/email-blocks/{id}
```

### `/email-runs`

```http
POST /api/v1/email-runs/{id}/cancel
```

### `/email-templates`

```http
GET /api/v1/email-templates
POST /api/v1/email-templates
GET /api/v1/email-templates/starters
GET /api/v1/email-templates/export
GET /api/v1/email-templates/{key}/{locale}
GET /api/v1/email-templates/{id}
PUT /api/v1/email-templates/{id}
PATCH /api/v1/email-templates/{id}
DELETE /api/v1/email-templates/{id}
POST /api/v1/email-templates/{id}/duplicate
POST /api/v1/email-templates/{id}/languages
POST /api/v1/email-templates/{id}/from-template
POST /api/v1/email-templates/{id}/test-send
POST /api/v1/email-templates/{id}/audience/preview
POST /api/v1/email-templates/{id}/send
GET /api/v1/email-templates/{id}/runs
POST /api/v1/email-templates/import
```

### `/events`

```http
GET /api/v1/events
```

### `/exports`

```http
GET /api/v1/exports/sources
GET /api/v1/exports/views
POST /api/v1/exports/preview
GET /api/v1/exports
POST /api/v1/exports
GET /api/v1/exports/{id}
GET /api/v1/exports/{id}/download
```

### `/files`

```http
GET /api/v1/files
POST /api/v1/files
GET /api/v1/files/usage
GET /api/v1/files/{id}
PATCH /api/v1/files/{id}
DELETE /api/v1/files/{id}
POST /api/v1/files/resolve
GET /api/v1/files/{id}/content
POST /api/v1/files/{id}/attach
POST /api/v1/files/{id}/detach
POST /api/v1/files/{id}/restore
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

### `/invoices`

```http
GET /api/v1/invoices
POST /api/v1/invoices
GET /api/v1/invoices/starters
GET /api/v1/invoices/{id}
PUT /api/v1/invoices/{id}
PATCH /api/v1/invoices/{id}
DELETE /api/v1/invoices/{id}
POST /api/v1/invoices/{id}/duplicate
POST /api/v1/invoices/{id}/languages
POST /api/v1/invoices/{id}/from-template
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

### `/option-lists`

```http
GET /api/v1/option-lists
POST /api/v1/option-lists
GET /api/v1/option-lists/{key}
PATCH /api/v1/option-lists/{key}
DELETE /api/v1/option-lists/{key}
```

### `/pages`

```http
GET /api/v1/pages/{pageId}
PATCH /api/v1/pages/{pageId}
DELETE /api/v1/pages/{pageId}
PATCH /api/v1/pages/{pageId}/layout
GET /api/v1/pages
POST /api/v1/pages
GET /api/v1/pages/fit
GET /api/v1/pages/fit/new-table
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

### `/project`

```http
GET /api/v1/project/status
POST /api/v1/project/resolve
GET /api/v1/project/export
GET /api/v1/project/actions
POST /api/v1/project/actions/{id}
GET /api/v1/project/overview
GET /api/v1/project/client/{*}
```

### `/public`

```http
GET /api/v1/public/config
GET /api/v1/public/records/{ref}
POST /api/v1/public/records/{ref}
GET /api/v1/public/records/{ref}/{id}
PUT /api/v1/public/records/{ref}/{id}
PATCH /api/v1/public/records/{ref}/{id}
DELETE /api/v1/public/records/{ref}/{id}
POST /api/v1/public/records/{ref}/batch
POST /api/v1/public/claim
POST /api/v1/public/documents/render
GET /api/v1/public/documents
GET /api/v1/public/documents/{id}
GET /api/v1/public/documents/{id}/content
POST /api/v1/public/documents/{id}/email
DELETE /api/v1/public/session
```

### `/public-api`

```http
GET /api/v1/public-api
PUT /api/v1/public-api
GET /api/v1/public-api/stats
```

### `/public-endpoints`

```http
GET /api/v1/public-endpoints
POST /api/v1/public-endpoints/check
PUT /api/v1/public-endpoints/{connectionId}/{ref}
DELETE /api/v1/public-endpoints/{connectionId}/{ref}
POST /api/v1/public-endpoints/{connectionId}/{ref}/rename
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

### `/report-documents`

```http
GET /api/v1/report-documents
POST /api/v1/report-documents
GET /api/v1/report-documents/starters
GET /api/v1/report-documents/{id}
PUT /api/v1/report-documents/{id}
PATCH /api/v1/report-documents/{id}
DELETE /api/v1/report-documents/{id}
POST /api/v1/report-documents/{id}/duplicate
POST /api/v1/report-documents/{id}/from-template
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
POST /api/v1/setup/probe
POST /api/v1/setup/adopt
```

### `/storage`

```http
GET /api/v1/storage/destinations
POST /api/v1/storage/destinations
PATCH /api/v1/storage/destinations/{id}
DELETE /api/v1/storage/destinations/{id}
POST /api/v1/storage/destinations/{id}/test
POST /api/v1/storage/destinations/test
POST /api/v1/storage/destinations/{id}/default
POST /api/v1/storage/migrate
```

### `/surfaces`

```http
GET /api/v1/surfaces
PUT /api/v1/surfaces/{appKey}/placement
PUT /api/v1/surfaces/{appKey}/name
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
