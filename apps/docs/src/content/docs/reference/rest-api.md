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

## Dates in rows

A `date` column is a calendar day, and every reply spells it as its text, `"2026-08-14"`, on
every engine. It is never an instant: read it as that day (split the text, or format it at UTC),
because `new Date("2026-08-14")` is midnight UTC, which is the day before west of Greenwich.
Before 0.3.4 a Postgres or MySQL date came back as the server's local midnight as an instant
(`"2026-08-13T22:00:00.000Z"` on a server in Berlin). A `timestamptz` or `timestamp` column is
unchanged.

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
| `/api/v1/add-ons/*` | 23 | Installed add-ons — list what a host should mount, preview what installing would do, install from a verified package, enable or disable per host, and uninstall |
| `/api/v1/api-docs` | 1 | The public API catalogue behind /api-docs — what live keys can call; 404 while the page is off |
| `/api/v1/api-keys/*` | 3 | Issue, list and revoke API keys |
| `/api/v1/apps/*` | 26 | Micro-SaaS apps installed into this instance — upload a built bundle or download one from the opt-in online catalog, browse what is staged or offered, plan its tables against a connection, install (with the public access it asks for, unless declined), update (giving what a new version adds to its public access only when allowed, and taking back what it drops), rename an older install’s tables to the app’s prefix, change one app’s settings, switch it off and on, set its domains and instances, add and remove its sample data, discard a staged version, and uninstall |
| `/api/v1/assistant/*` | 7 | The page assistant — open a session on a page, ask it something, read what the turn came back with, and act on the draft it proposed. Every route needs the assistant permission; saving what it drafts additionally needs the same permission the page’s own save needs. The assistant reads; nothing it does writes a record on its own. |
| `/api/v1/audit/*` | 2 | The audit log — list and read single entries |
| `/api/v1/auth/*` | 12 | Login, logout, session listing, 2FA enrolment, password change and reset |
| `/api/v1/automation-runs/*` | 3 | Every execution of a rule — the last seven days, the three status filters, one run’s full step-by-step trace, and today’s counters |
| `/api/v1/automations/*` | 9 | Automation rules — the trigger, the steps and the branches between them; the tables, columns, templates and roles a rule can name; the 30-day counters the cards show; and a dry run that walks the flow without executing anything |
| `/api/v1/bootstrap` | 1 | Everything the dashboard needs on first paint, in one call |
| `/api/v1/branding/*` | 4 | Instance name, colours and logo (read is public; writes are admin) |
| `/api/v1/connections/*` | 23 | Databases Adminium is pointed at — CRUD, connection test, introspection, schema snapshots, diffs, overrides, and generation |
| `/api/v1/data/*` | 20 | Rows in your database — list, read, create, update, delete, bulk write, undo, and inbound references |
| `/api/v1/designer/*` | 2 | Adminium Designer on a server people reach — whether it is allowed and switched on, and the switch itself (a Super Admin, with their password). The Designer’s own routes exist only while the server runs it |
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
| `/api/v1/llm/*` | 15 | LLM assist — provider config, runs, prompts, diffs, apply, undo |
| `/api/v1/me/*` | 11 | The signed-in user — profile, preferences, notifications, saved layouts |
| `/api/v1/meta/*` | 2 | Where the meta store lives, and relocating it |
| `/api/v1/onboarding/*` | 2 | The first-run checklist |
| `/api/v1/option-lists/*` | 5 | Named sets of answers a column accepts, written once and pointed at by as many columns as need them. Reading one needs only a session — a create dialog has to render the choices to anyone who may add a row — while writing needs the same grant that points a column at a list. The built-in lists live in code and are served with their labels in the caller's locale; editing one makes an ordinary copy rather than changing it. Deleting a list a column still names is refused with 409 and the columns using it. |
| `/api/v1/pages/*` | 15 | Pages and dashboards — layout, config, nav order, shared views, and what a template needs from a table (with a new table drafted to fit when none does) |
| `/api/v1/permissions` | 1 | The permission catalog every role is built from |
| `/api/v1/project/*` | 9 | A project folder on the server that runs one — which pages and schema customizations differ from the deployed files, settling a page changed on both sides, the changed copies `adminium pull --from` writes into the project, running the project’s actions, the built files of its own pages and widgets, and what Studio shows about the project |
| `/api/v1/public/*` | 32 | The scoped public API for customer- and staff-facing pages (off by default) |
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
| `/api/v1/widget-data/*` | 3 | The queries widgets run, singly and in batches |

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
POST /api/v1/add-ons/{key}/update/plan
POST /api/v1/add-ons/{key}/update
GET /api/v1/add-ons
POST /api/v1/add-ons
GET /api/v1/add-ons/{key}/plan
POST /api/v1/add-ons/plan
POST /api/v1/add-ons/{key}/attachments
GET /api/v1/add-ons/{key}/bundle/{*}
GET /api/v1/add-ons/{key}/pages/{ref}/bundle
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
POST /api/v1/apps/{key}/documents/render
GET /api/v1/apps
POST /api/v1/apps/upload
GET /api/v1/apps/catalog
PUT /api/v1/apps/catalog
POST /api/v1/apps/catalog/refresh
POST /api/v1/apps/download
POST /api/v1/apps/plan
POST /api/v1/apps/install
POST /api/v1/apps/{key}/update
GET /api/v1/apps/{key}/sample-data
POST /api/v1/apps/{key}/sample-data
POST /api/v1/apps/{key}/sample-data/remove-plan
POST /api/v1/apps/{key}/sample-data/remove
GET /api/v1/apps/{key}/uninstall-plan
GET /api/v1/apps/{key}/settings
PATCH /api/v1/apps/{key}/settings
GET /api/v1/apps/{key}/overview
POST /api/v1/apps/{key}/disable
POST /api/v1/apps/{key}/enable
PUT /api/v1/apps/{key}/domains
PUT /api/v1/apps/{key}/instances
POST /api/v1/apps/{key}/rename-tables/plan
POST /api/v1/apps/{key}/rename-tables
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
GET /api/v1/connections/{id}/shape-rules
```

### `/data`

```http
GET /api/v1/data/{connectionId}/{table}
POST /api/v1/data/{connectionId}/{table}
POST /api/v1/data/undo/{token}
POST /api/v1/data/{connectionId}/{table}/bulk
GET /api/v1/data/{connectionId}/{table}/{recordId}/references
GET /api/v1/data/{connectionId}/{table}/{recordId}/history
POST /api/v1/data/{connectionId}/{table}/person
GET /api/v1/data/{connectionId}/{table}/{recordId}/claim-lock
DELETE /api/v1/data/{connectionId}/{table}/{recordId}/claim-lock
POST /api/v1/data/{connectionId}/{table}/{recordId}/regenerate-code
GET /api/v1/data/{connectionId}/{table}/{recordId}
PATCH /api/v1/data/{connectionId}/{table}/{recordId}
DELETE /api/v1/data/{connectionId}/{table}/{recordId}
GET /api/v1/data/{connectionId}/{table}/availability
GET /api/v1/data/{connectionId}/{table}/booking-slots
GET /api/v1/data/{connectionId}/{table}/capacity-counts
GET /api/v1/data/{connectionId}/{table}/{recordId}/nightly
GET /api/v1/data/{connectionId}/{table}/{recordId}/links/{relationId}
POST /api/v1/data/{connectionId}/{table}/dry-run
POST /api/v1/data/{connectionId}/{table}/{recordId}/dry-run
```

### `/designer`

```http
GET /api/v1/designer/live
PUT /api/v1/designer/live
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
GET /api/v1/llm/connections
GET /api/v1/llm/connections/{id}/models
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
GET /api/v1/project/apps/{key}/removals
POST /api/v1/project/apps/{key}/removals
```

### `/public`

```http
GET /api/v1/public/config
GET /api/v1/public/records/{ref}
POST /api/v1/public/records/{ref}
GET /api/v1/public/availability/{ref}
GET /api/v1/public/records/{ref}/{id}
PUT /api/v1/public/records/{ref}/{id}
PATCH /api/v1/public/records/{ref}/{id}
DELETE /api/v1/public/records/{ref}/{id}
POST /api/v1/public/records/{ref}/dry-run
POST /api/v1/public/records/{ref}/{id}/dry-run
POST /api/v1/public/records/{ref}/batch
POST /api/v1/public/claim
POST /api/v1/public/claim/code
POST /api/v1/public/claim/verify
POST /api/v1/public/claim/token
POST /api/v1/public/claim/link
POST /api/v1/public/claim/link/resend
POST /api/v1/public/claim/link/peek
POST /api/v1/public/claim/link/verify
GET /api/v1/public/files/{ref}/{rowId}/{column}
GET /api/v1/public/pictures/{keyId}/{ref}/{rowId}/{column}/{fileId}
GET /api/v1/public/add-ons/{key}/settings
GET /api/v1/public/challenge
POST /api/v1/public/documents/render
GET /api/v1/public/documents
GET /api/v1/public/documents/{id}
GET /api/v1/public/documents/{id}/content
POST /api/v1/public/documents/{id}/email
POST /api/v1/public/session/revoke-all
DELETE /api/v1/public/account
POST /api/v1/public/records/{ref}/{id}/new-link
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
POST /api/v1/widget-data/link-filters
POST /api/v1/widget-data/batch
```

<!-- END GENERATED: operations -->

## Records with their rows, quotes and retries

The staff side of the API, under `/api/v1/data/{connectionId}/{table}`, answers a session cookie
or an API key. What a desk needs to take a booking or an order in one save is below: a record with
its child rows, a quote before the save, a check of the price shown, a retry that finds its first
save, and the counts and nights a desk screen reads. Refusals use the envelope and codes in
[Errors](/reference/errors/). The rules an app declares for these are in the manifest reference,
under [Dry runs, price checks and retries](/reference/manifest/#dry-runs-price-checks-and-retries).

### A record with its child rows

`POST /api/v1/data/{connectionId}/{table}` takes `children` beside `values`: the rows below the
record, keyed by relation id (`model.relations[].id` in `GET /api/v1/connections/{id}/schema`). Each
row is `{ key?, values, children? }`, two levels at most and up to 1,000 rows per list, and 1,000
below one create in all (the public API's creates take 200). A row's own
`children` hold `{ values }` rows only. Every row is written in one transaction, or none; totals
are settled from the bottom up, and the reply is the record as stored.

```json
{
  "values": { "customer_name": "Ada Park", "pickup_at": "2026-10-02T18:30:00Z" },
  "children": {
    "<order lines relation id>": [
      {
        "values": { "menu_item_id": 12, "qty": 2 },
        "children": { "<line options relation id>": [{ "values": { "option_id": 4 } }] }
      }
    ]
  }
}
```

```json
{ "data": { "id": 981, "customer_name": "Ada Park", "total": "31.50" }, "undoToken": "…" }
```

The rows are held to what the app's public create entries on the table declare: a row's values
agree with its parent's (no more guests than the room sleeps), and each list stays within its least
and most. A refusal about one row names it in `details`: `relation` and `row`, and `under` for a
row one level further down. Rows below a child row are refused `422` when a table of the write
runs a before hook. On `PATCH`, a row with a `key` is changed, a row without one is added, a
row the list leaves out is removed, and `[]` empties the list; rows below a child row come with a
new record only.

### When the write happened

`occurredAt` on a `POST` or a `PATCH` is the time the thing really happened, as a staff device
says: a door scan made offline and sent later. It is an ISO instant with an offset, at most six
hours in the past and at most 60 seconds ahead (a time ahead is taken as now). A signed-in user or
an API key may send it. Anything else is refused `422` `VALIDATION_FAILED` with
`fields.occurredAt` (`out-of-range`). The write judges its own rules by that time, so a stamp
says when the scan was made and a window open then lets it through. Limits shared with other
writers still count on the server's clock. The audit row keeps the time sent as
`changes.occurredAt`, beside the time it arrived.

```json
{ "values": { "status": "admitted" }, "occurredAt": "2026-10-02T19:04:12+02:00" }
```

### Quotes of a create and a change

`POST …/{table}/dry-run` tries a create with its child rows. `POST …/{table}/{recordId}/dry-run`
tries a change of one record. Each works out every figure the save would, refuses what the save
would refuse, and keeps nothing: the write is rolled back, nothing is announced, no number from a
series is taken, and no code the save would make is shown. A create quote needs the table's create
permission. A change quote needs update.

The create quote takes the create's `values` and `children`. The change quote takes `values`,
`children` (one level) and `from`. Its own places are left out of the limits it is judged
against, so a full house still quotes a stay's own dates. It takes no named lock; like any
update, it holds its own row until it rolls back.

```json
{ "values": { "depart": "2026-08-08" } }
```

```json
{
  "data": { "id": 412, "depart": "2026-08-08", "room_total": "875.00", "total": "953.75" },
  "children": {},
  "nights": [
    { "date": "2026-08-03", "rate": "170.00", "base": "150.00", "tags": ["August"] },
    { "date": "2026-08-07", "rate": "195.00", "base": "150.00", "tags": ["Weekend", "August"] }
  ]
}
```

`children` holds, per relation the request sent, each row as the save would leave it:
`{ "<relation id>": [{ "data": {…} }] }`. A create quote's rows carry their own `children` one
level down. `nights` is there only for a row
[priced by the night](/reference/manifest/#prices-by-the-night): each night's `rate`, the `base`
before what was added, and the `tags` naming what was added. It is left out for a caller who
cannot read the priced column or a column the price rule reads (its dates, its rates). The change
quote also refuses `404` for a record that is not there, `422` for rows below a child row, and
`422` naming the relation for a list whose table runs a before hook, because a quote runs none.

### Checking the price shown

`expect: { total, column? }` on a create or a `PATCH` saves only at the price the desk showed.
`total` is a decimal string. The figure is compared on the record as the save leaves it, totals
settled, inside the transaction. A different figure refuses the save `409` `PRICE_CHANGED`,
with `details.column` and `details.total` (the figure it would have saved), and nothing is kept.

```json
{ "values": { "depart": "2026-08-06" }, "expect": { "total": "495.95" } }
```

Without `column`, the figure is the one the app's public create or change entries on the table
check. `column` may name another money column. The column must be one the caller may read (`403`
otherwise) and must hold a number: a text column, an unknown one, or no column at all is refused
`422` with `fields.expect`. A price check is also refused `422` with `repeat`, and on a create
whose child or link table runs a before hook.

### A retry that finds its first save

`clientKey` on a create is a key the form mints for this save, 22 to 64 letters, digits, `-` or
`_`. Sent again after a reply that never came, it answers the record the first save made, with
`200` and no undo, instead of making a second one. The values of the retry are not applied. Two
sent at once make one record.

```json
{ "data": { "id": 981, "first_name": "Zoe" }, "undoToken": null, "replayed": true }
```

The table must keep a retry key: the column the app's public create entries keep a guest's key
in, or, on a table no guest creates rows of (a desk's payments), a column the app marks
[`retryKey`](/reference/manifest/#column-rules). The key is stored there as a keyed hash, never as sent, and per person: another user's same
key makes another record, and a guest's key never finds a desk's. A key of the wrong form, a
table that keeps none, or a key sent with `repeat` is refused `422` with `fields.clientKey`.

### The state a form loaded, and undo

On a table with [states](/reference/manifest/#states), `from` on a `PATCH` names the state the
form loaded the row in. The change is made only while the row is still there. A row another screen
moved on since is refused `409` `STATE_MOVE_REFUSED`, with `details.column`, `from` (where the
row is now), `to` and `named`. `from` on a table without states is refused `422` with
`fields.from`.

```json
{ "values": { "status": "preparing" }, "from": "ready" }
```

A bulk update (`POST …/{table}/bulk`) takes `from` too: every row must still be in that state, or
the whole write is refused `409` `STATE_MOVE_REFUSED`, naming the row by `details.id`, and nothing
is written. A show's live orders are cancelled in a few writes this way, one per state they were
seen in, rather than one request per order.

### The values a form loaded

`seen` on a `PATCH` names up to 8 plain columns as the form loaded them. The change is made only
while each still holds that value: two door phones ticking one party's arrivals, or two people
editing one note, cannot both write over what they did not see. A row that moved is refused `409`
`ROW_CHANGED`, with `details.column`, `expected` and `retry: true`; read the row again and decide.
A column the caller may not read is refused as it would be in `values`.

```json
{ "values": { "arrived": 3 }, "seen": { "arrived": 2 } }
```

A change of a row that moves through states usually gets `undoToken: null`: an undo would put the
state back with no rules. The exception is a change that was a status move alone (with the stamps
the move wrote), on a table whose states list a move marked `undo` the other way. Its token is
given, and `POST /api/v1/data/undo/{token}` makes that listed move, naming the state the change
left, so it is judged, stamped and announced like any move. A move marked `undo` is made only
by a write that names `from`; without it, it is refused `409` `STATE_MOVE_REFUSED` with
`details.undo: true`. See [Undo of a move](/reference/manifest/#undo-of-a-move).

### A limit's counts

`GET …/{table}/capacity-counts` answers one of the table's
[limits](/reference/manifest/#capacity) as a desk sees it: each pool's size, what is taken, what
holds keep, and what is left. It is counted as the write path counts, with no lock, and with none
of a guest's filters: no notice, pause or sales window hides a pool. A pool made smaller after it
was sold can show less than nothing left.

| Parameter | Rule |
|---|---|
| `rule` | Which limit, `0` to `2`. Default `0`. |
| `date` | One day, `YYYY-MM-DD`: a slot limit's day, or a parent limit that counts by day. |
| `from`, `days` | A strip: up to 31 days for a slot limit, up to 62 nights for a night limit. |
| `under`, `value` | A parent limit: the pools' rows whose column `under` holds `value` (an event's ticket types). |
| `values` | With `under`: up to 50 values, comma-separated (a page of events), in one ask. Each row then says the value it is under (`under`). |
| `ids` | A parent or night limit: pool row ids, comma-separated. Up to 500 pool rows are counted in one ask. |

A slot limit takes `date` or `from` and `days`. A parent limit takes `ids` or `under` and `value`,
with `date` when it counts by day. A night limit takes `from` and `days`, and every pool when
`ids` is absent. A form its kind does not take, or a `rule` the table does not have, is refused
`422` `VALIDATION_FAILED`; a table with no limit is `404`.

```http
GET /api/v1/data/{connectionId}/{table}/capacity-counts?under=event_id&value=42
```

```json
{
  "data": {
    "kind": "parent",
    "rows": [{ "id": "7", "size": 200, "taken": 143, "held": 6, "left": 51, "also": [] }]
  }
}
```

A slot limit's rows are `{ time, size, taken, held }` for one day (`paused` or `closed` when so),
or `{ date, size, taken, held }` per day of a strip. A parent limit's rows carry `kept` when it
keeps places back for a waitlist, and `also`, the wider pools the row takes from. A night limit's
rows are `{ pool, date, size, outOfService, taken, held, left }` per pool and night, where
`size` already leaves out the rooms out of service. It needs the table's read grant, read access
to the pools' tables (`403` `TABLE_FORBIDDEN`), and the rule's columns and any `under` column
readable unmasked (`403`).

### A row's nights

`GET …/{table}/{recordId}/nightly` spells out a row priced by the night: each night with its
rate, priced from the rates as they are now. `column` may name the priced column, and only that
one.

```json
{
  "data": {
    "column": "room_total",
    "nights": [
      { "date": "2026-08-03", "rate": "170.00", "base": "150.00", "tags": ["August"], "qty": "1", "amount": "170.00" },
      { "date": "2026-08-04", "rate": "170.00", "base": "150.00", "tags": ["August"], "qty": "1", "amount": "170.00" }
    ],
    "total": "340.00",
    "stale": false
  }
}
```

When the rates changed after the row was priced, the nights no longer add up to the stored
figure. The reply is then `stale: true` with one line for them all: the first night's date, the
number of nights as `qty`, no rate, and the stored figure as `amount`. A table with no price by the
night is `404`. A caller who may not read the priced column or a column the price rule reads is
refused `403` `COLUMN_FORBIDDEN`.

## The public API for app pages

The routes under `/api/v1/public/*` answer a public key (`adm_pub_…`) and, for a guest who has
found or signed in as themselves, a session sent in `x-adminium-public-session`. Errors here are
`{ error: { code, params?, message } }`, and the `code` is the contract. What each entry allows is
declared in the app's [public access](/reference/manifest/#public-access) and listed by
`GET /public/config`. The client library's method is named where there is one.

### A create with its rows

`POST /public/records/{ref}` takes `children` beside `values`: the rows below the new one, by the
names `refs[ref].children` lists in the config, two levels at most and 200 rows per list. It
writes every row or none (`createTree` in the client).

```json
{
  "values": { "name": "Ada Park", "email": "ada@example.com", "client_key": "V1StGXR8_Z5jdHi6B-myT3Kq9wLp0aZxQ" },
  "children": {
    "lines": [{ "values": { "item_id": 12, "qty": 2 }, "children": { "options": [{ "values": { "option_id": 4 } }] } }]
  },
  "expect": { "total": "31.50" }
}
```

```json
{
  "data": { "id": 981, "total": "31.50" },
  "children": { "lines": [{ "data": { "item_id": 12, "qty": 2 }, "children": { "options": [{ "data": { "option_id": 4 } }] } }] },
  "rank": 3,
  "link": { "key": "link", "token": "…", "session": "adm_pubs_…", "expiresAt": 1790000000000 }
}
```

- **`expect`** is `{ total }`, the price the guest was shown. A different figure is refused `409`
  `PUBLIC_PRICE_CHANGED`, with `params.total` and `params.lines`, and nothing is written. On an
  entry that checks no price it is refused `400` `PUBLIC_WRITE_REFUSED`. `PATCH` takes it too.
- **The retry key** travels in `values`, in the column the entry names as its `clientKey`: 22 to 64
  letters, digits, `-` or `_` (`newClientKey()` mints one). Stored as a keyed hash, it makes a
  second send of the same order answer `200` with `data`, `children` and `replayed: true`, and no
  `link`. A key of the wrong form is refused `400` `PUBLIC_WRITE_REFUSED` with
  `params.reason: "format"`. A retry replays even after the app's switch for the entry was turned
  off. Any other create is then refused `403` `PUBLIC_SWITCHED_OFF`.
- **`rank`** is there on an entry that ranks: how many matching rows come at or before the new one.
- **`link`** is the new row's own link, answered once, on an entry that gives one: the key it opens
  through, the code for the page's URL fragment, and a session already open on the row.
- **`replaces`** is the own-link session of a hold this create lets go in the same write, so a
  changed checkout does not hold its places twice.

### Public quotes of a create and a change

`POST /public/records/{ref}/dry-run` tries the same create and keeps nothing (`quote` in the
client). It takes `values`, `children` and `replaces`, where the hold named is judged as let go.
The entry must declare `dryRun: true`; otherwise the route answers `404` `PUBLIC_REF_NOT_FOUND`.
A quote costs a read, not a write, and needs no proof of work. It may come before the guest has
typed their details, and it shows figures only: no retry key, no running number, no code.

```json
{
  "data": { "subtotal": "28.90", "tax": "2.60", "total": "31.50" },
  "children": { "lines": [{ "data": { "unit_price": "12.50", "line_total": "25.00" } }] },
  "capacity": [{ "pool": "12", "state": "available", "at": "2026-10-02" }],
  "exact": true
}
```

`exact` is `false` when a before hook runs on a table of the write. A quote runs none, so the
save may come out otherwise. `nights` is added for a row priced by the night.

`POST /public/records/{ref}/{id}/dry-run` tries a change of the guest's own row: `{ values }` in,
`{ data, exact, nights?, children? }` out (`quoteChange` in the client, which answers
`{ data, exact, nights }`). `data` is the row as the change would leave it, with the stamps and
totals the change would decide. `children` holds the rows below it that the change moves (the
extras that follow a stay's nights and guests), under each child entry on the key that is read
with this row as its parent, shown as that entry shows them. The entry must declare `dryRun: true`
and allow the change.

### A row's own link, made again

`POST /public/records/{ref}/{id}/new-link` makes a row's own link again for its signed-in person
(`newLink` in the client). The old link stops opening the row, every session it opened ends, and
the new link is emailed as the app's own message. The reply is `202` with `{ "data": {} }`; the
new code never comes back here. The entry must declare `newLink`.

It needs a verified session of a person signed in by email. A row's own link, a `lookup` session,
another person's row and a row that is not there all get the same `404` `PUBLIC_REF_NOT_FOUND`.
A second ask within 60 seconds changes nothing and answers `202`. Once five new links were made for
one row in a day, the next ask is refused `409` `PUBLIC_LIMIT_REACHED`. When no email can be sent, it is refused `503`
`PUBLIC_CODE_UNAVAILABLE` before the old link is stopped.

On an entry opened by a row's own link, the same route makes another own link of that row again
(the confirm link of a confirmation email, "Send it again"), with the session the row's own link
opened. The email goes to the row's own address; the asking session stays open. When the entry's
`newLink.when` does not hold for the row, or that link is stopped, the ask is refused `409`
`PUBLIC_WRITE_REFUSED`, and nothing is made, sent or counted. Such asks are limited to 5 a day per row
and 5 a day per mailbox over the table (`409` `PUBLIC_LIMIT_REACHED`). The email is queued in the same
transaction as the new code: when it cannot be, nothing is made and nothing counted. See
[Identity and own links](/guides/apps/identity-and-own-links/).

### Signing out, and deleting details

| Route | Client | What it does |
|---|---|---|
| `DELETE /public/session` | `signOut` | Ends this session. Always `200` `{ "data": {} }`. |
| `POST /public/session/revoke-all` | `signOutEverywhere` | Ends every session of the person, this one too, and takes back every sign-in link still open to their address. |
| `DELETE /public/account` | `forgetMe` | Deletes the person's details, then ends every session and sends the old address one last email. |

The last two need a verified session of a person signed in by email: a row's own link is refused
`403` `PUBLIC_CLAIM_UNAVAILABLE`, a `lookup` session `403` `PUBLIC_CLAIM_LEVEL`, and no session
`404` `PUBLIC_REF_NOT_FOUND`. Both answer `200` `{ "data": {} }`.

`DELETE /public/account` also needs a mailbox proved in the last ten minutes, by a link pressed or
a code confirmed; otherwise it is refused `403` `PUBLIC_CODE_STEP_UP`. It empties the columns the
identity's `forget` names and writes its stamp. The row keeps its key, so the bookings and tickets
that point at it stay. With `forget.links`, every own link of the person's rows is made again
first. If one cannot be, the call is refused `409` `PUBLIC_WRITE_REFUSED` and nothing is
forgotten. See [Delete my details](/reference/manifest/#delete-my-details).

A device whose session was ended this way is told why on its next request. That reply carries
`x-adminium-session-ended: elsewhere` or `forgotten`, once, and the session is gone after it
(`sessionEnded()` in the client). The header is exposed to cross-origin pages.

### The level a shared link opens

`POST /public/claim/token` takes `{ "token": "…" }`, the code from a shared link's fragment, and
answers `{ "data": { "session", "expiresAt", "level"? } }`. On a key whose claim is a row's own
link (`own: true`), the session is `verified` and the reply says `level: "verified"`. Any other
shared link opens a `lookup` session, and the reply carries no `level`. An unknown code is `404`
`PUBLIC_REF_NOT_FOUND`; a link stopped or expired is `410` `LINK_EXPIRED`.

### Typed codes

A code a guest types for a read travels in the `x-adminium-code` header (64 characters at most),
never in a URL, where logs and proxies would keep it. `?code=` on a list or on availability is
refused `400` `PUBLIC_QUERY_REFUSED`. A write carries its typed code in its values.

An entry marked `unlock: true` in the config shows its rows only with the code that unlocks them.
Without a code a list is empty, and a code that unlocks nothing is a spent guess. Once a visitor's
guesses are spent, a typed code is refused `429` `PUBLIC_RATE_LIMITED` before anything is looked
up. Availability counts the rows a code unlocks too. In the client, `list` and `get` take
`{ code }`, and so does `parentAvailability`. See
[Codes that unlock rows](/reference/manifest/#codes-that-unlock-rows).

### Availability by kind

`GET /public/availability/{ref}` answers an availability entry. `refs[ref].capacity` in the
config says its kind, and the entry's `rule` says which of the table's limits it answers. A
parameter the kind does not take is refused `400` `PUBLIC_QUERY_REFUSED`, never ignored.
An app installed by an earlier Adminium answers its entries without `capacity` until the app is
next updated (an update to the same version will do). Read such an entry over a limit as `slot`,
the only kind there was.

| Kind | Asks | Answers `data` as |
|---|---|---|
| `slot` | `date`, or `from` and `days` (up to 31); `party` | `[{ time, state }]`, `free`, `full` or `paused`; per day `[{ date, open, state }]`, `open`, `full` or `closed` |
| `parent` | `under`, `date`, `qty` (1 to 50), `exclude`; a code in the header | `[{ id, state, left? }]`, `on`, `soon`, `ended` or `soldout` |
| `night` | `from` and `to` (up to 31 nights), `guests` (1 to 50), `earliest` (1 to 90 days), `exclude` | `[{ pool, state, left?, earliest? }]`, `open`, `full` or `closed` |

- **Slot.** `party` is never asked for more than one row may hold.
- **Parent.** The rows the limit is held on (an event's ticket types) that a plain public read of
  their table shows, at most 200. On an entry with `under`, only the rows under that value, and
  none without it. `date` is a day for a limit that counts by day, today on the venue's clock when
  absent. A row is `soldout` when fewer are left than `qty` (`parentAvailability` in the client).
- **Night.** Each pool (a room type) over the nights `from` to `to`, leaving out the pools that
  sleep fewer than `guests`. With `earliest`, each pool also gives its first arrival of the same
  length with room, and the reply's top-level `earliest` gives the house's (`nightAvailability`
  in the client).

```http
GET /api/v1/public/availability/room-types?from=2026-08-03&to=2026-08-06&guests=2&earliest=14
```

```json
{
  "data": [
    { "pool": "2", "state": "full", "earliest": "2026-08-05" },
    { "pool": "3", "state": "open", "left": 1, "earliest": null }
  ],
  "earliest": "2026-08-05"
}
```

`left` is said only where the entry declares `showLeft` (`{ "below": n }` or
`{ "belowShare": percent }`), and only when fewer are left than that. A page may ask a parent
limit for a `qty` no higher than that count and one order's most; without `showLeft`, it asks for
one. `exclude` names a row of the session's own, such as a booking being moved or the order a
checkout already holds, and leaves its places out of the count. An id the session does not reach
is ignored. See [Availability](/reference/manifest/#availability).

### Pictures

`GET /public/pictures/{keyId}/{ref}/{rowId}/{column}/{fileId}` serves an image column any visitor
may see, with no key header, so an `<img>` can load it. The config's `pictures` gives the base. See
[Pictures](/reference/manifest/#pictures).

### The server's clock

`GET /public/config` carries `now`, the server's time as an ISO instant, and answers with
`cache-control: no-store`. The staff and customer `surface-config.json` carry `now` the same way.
A page on a device whose clock is wrong still asks for the venue's today. The client's `now()`
applies the difference the config showed.

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

A path parameter or a query parameter holding the character U+0000 (`%00`, or
`\u0000` in the JSON of a `where` filter) is refused `400` `VALIDATION_FAILED`
before anything reads it, on every database: `details.in` is `params` or
`querystring`, and `details.issues[0]` names the parameter with the code
`invalid-character`. The same holds for a request body (`details.in` is `body`, the
path names the field: `name`, `ids.0`), except a row's values on their way to your
database (a record's `values`, a child row's, a public entry's): those are judged
by the write that would store them, `422` naming the column. A body nested more than
64 levels deep is refused `400` `VALIDATION_FAILED` with the code `too-deep`,
unread. A list's `cursor` that holds the character is the list's own `422`
malformed cursor.

Every write refusal, its status and what its `details` carry, and the public API's own codes, are
listed in [Error codes](/reference/errors/).

## CORS

Off by default: the dashboard is served by the same process as the API, so it is
same-origin.

For a split deployment, `ADMINIUM_CORS_ORIGINS` takes a CSV of exact origins.
`*` is rejected — responses are credentialed.

→ [Environment variables](/self-hosting/env-vars/)

→ [The OpenAPI document](https://docs.adminium.dev/openapi.json)
