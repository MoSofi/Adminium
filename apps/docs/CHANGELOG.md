# @adminium/docs

## 0.3.3

## 0.3.2

## 0.3.1

### Patch Changes

- 71d90e0: The manifest reference covers formulas, numbers without gaps, states, tables built on an add-on's shape, add-ons an app needs, documents, held outbox messages and the new public access claims, and a guide walks through an app built on the Invoices & Receipts add-on.

## 0.3.0

### Patch Changes

- ae41762: **A public API documentation page at `/api-docs`, switched on from Workspace settings.**
  
  Workspace settings gains a **Public API** card for holders of `api-keys.manage`, with two
  switches that apply the moment you click them:
  
  - **Public API** turns the public API on or off. It moved here from the old public API page.
  - **API documentation page** publishes `/api-docs`. It is off by default and does not travel in
    a config bundle.
  
  If `ADMINIUM_PUBLIC_API_ORIGINS` is not set, the card says so and how to fix it.
  `GET/PUT /api/v1/public-api` report and accept `docsEnabled`, and a PUT may change either
  switch on its own.
  
  `/api-docs` works without signing in. It lists only endpoints that a live key can call, with
  the methods keys were granted, and for each one its path, auth level, limits and column
  names and types. It never shows a table name, a filter, a row count or a key. While the page is
  off, the page and `GET /api/v1/api-docs` answer the ordinary not-found response. On a domain
  mapped to a hosted app they are not served at all.
  
  The page has a playground. Paste a browser key and it sends a real request with that key only.
  The key is never stored, never put in a URL or code sample, and your session cookie is not
  sent. The page shows the real status, the time taken and the response body. Code samples in
  cURL, JavaScript (`@adminiumjs/public-client`) and Python use the real paths and headers.
- ae41762: **The old API keys page at `/api-keys` is gone.** Role-bound keys (`adm_sk_…`) still work and can
  still be created and revoked through `/api/v1/api-keys`. There is no page for them now.
  _Guides → Public API → Endpoints and keys_ shows how to create one with `curl`. The sidebar no
  longer has an "API keys" row. Keys for your own pages are under Workspace settings → API keys.
- c451e7d: **A page assistant that drafts in the page's own format, and never saves.**
  
  The pages that build documents — Email templates and Report builder — gain an
  **Ask** button in the header. It opens an assistant
  that already knows what that page holds: its documents, the format they are
  written in, your branding, and the tables your role can read. Describe what you
  need and it drafts it, showing its work: every tool it ran, every table it
  touched, and what the draft would be.
  
  **It never writes.** The model's last move is a draft. Every button that would
  change something is locked until you turn actions on for that session, needs the
  same permission the page's own Save needs, and asks once more before it runs.
  What it saves is a draft — an email template disabled, a report with status
  `draft` — and every write leaves an audit row naming the session that proposed
  it.
  
  **Reading rows is opt-in.** By default it works from your documents and schema
  alone. An administrator can let it read rows your role can read — masked, at
  most 50 per request, and listed under *Sources read* on every result. That
  switch is not carried by an exported bundle: importing somebody else's
  configuration can never turn it on for you.
  
  The permission is seeded to Super Admin and Admin only, and a role that may
  draft but not save is the ordinary case: it can look, draft, preview, and put a
  draft straight onto an editor's screen, with the writing buttons locked and a
  sentence saying why.
  
  Settings → AI names the assistant and holds the row-data switch. It needs the
  same AI provider schema enrichment uses; there is no copy-paste path here,
  because a conversation is many round trips.
- ae41762: **Public API keys can be made from endpoints instead of a hand-written scope.**
  
  Every table and view of a connection now has a generated public endpoint:
  its columns (none marked secret or personal data), its filters, page size,
  order, rate limit and response shape, and the methods its source supports.
  An operator can store an edited endpoint or a new custom one, and a key can
  be given several endpoints with different methods on each. Adminium writes the
  key's scope from those grants.
  
  New admin routes, all behind the API-keys permission:
  
  - `GET /api/v1/public-endpoints?connectionId=` lists the endpoints, the
    source tables and their columns, and any table without a generated endpoint
    with the reason.
  - `POST /api/v1/public-endpoints/check` compiles a definition without saving
    it. It reports every issue, the live keys a save would break, and the
    browser keys that would gain columns, methods or rows.
  - `PUT /api/v1/public-endpoints/:connectionId/:ref` saves an endpoint and
    rewrites the scope of every live key that uses it in the same step. A save
    that would break one of those keys is refused, and the reply names the key.
  - `POST …/:ref/rename` and `DELETE …/:ref` are refused while a live key uses
    the endpoint. Deleting a generated endpoint switches it off instead of
    removing it, so its default does not come back.
  - `POST /api/v1/public-keys` also accepts `connectionId` with `access` (the
    endpoints and methods), next to the existing `scopeId`.
  
  `GET /api/v1/public-keys` now returns each key's connection, kind, what it can
  call on each endpoint (and any method the endpoint no longer offers), and any
  issue that stops the key from working today.
  
  A key's derived scope is not listed by `GET /api/v1/public-scopes` and cannot
  be edited, deleted or reused by another key.
  
  Scopes also gain a default page size (`defaultLimit`), a default order
  (`defaultOrder`), a per-resource rate (`rate`) and a list response shape
  (`response`), and the `replace`, `delete` and `batch` actions. All are
  optional; a scope written before this change behaves as it did. The routes
  that serve the three new actions come in a later release.
  `GET /public/config` reports each resource's response shape.
  
  With more than one server process, a revoke, rotate, key create or endpoint
  save now reaches the other processes within 5 seconds (it was 30).
- ae41762: **The public API gains one-row reads, PUT, DELETE and BATCH, per-endpoint rate limits, list shapes, request counts and server keys.**
  
  New public routes, each allowed only when the key was granted that method on the endpoint:
  
  - `GET /public/records/:ref/:id` reads one row. It returns the same columns as the list and
    hides the same personal data. A row that doesn't exist and a row outside the key's scope both
    answer the same 404.
  - `PUT /public/records/:ref/:id` replaces a row. The body must include every column the key may
    write. The scope is part of the UPDATE statement itself.
  - `DELETE /public/records/:ref/:id` deletes a row. The scope is part of the DELETE statement
    itself. A row outside the scope answers 404 and is not deleted. When the database refuses a
    delete because of a foreign key, the caller gets one refusal that names nothing. Each delete
    writes an audit row showing the removed row, with personal data masked.
  - `POST /public/records/:ref/batch` takes 1 to 500 rows in one transaction, and either all of
    them are written or none are.
    - A row without its primary key is inserted, and the server chooses the key.
    - A row with its primary key updates that row, and the key must also hold PATCH.
    - If any keyed row is missing or outside the scope, the whole batch is refused, without saying
      which case it was.
  
  An endpoint's own rate limit now replaces its class limit. For browser keys it counts per
  visitor, and for server keys it counts across the whole key. A batch uses up one request per row.
  A request too large to ever fit is refused with 400 rather than 429. Scopes written before this
  change keep the limits they had.
  
  An address whose keys keep failing to match is refused after 30 failures a minute, before the
  server looks the key up.
  
  A list can be returned wrapped (as before), as a bare array with the next cursor in
  `X-Next-Cursor`, or as exactly one row. `Retry-After` and `X-Next-Cursor` can now be read by
  pages on other origins.
  
  "Requests · 24h" is counted per key, endpoint and hour. The counts are written every minute and
  when the server shuts down, and kept for `retention.publicRequestStatsDays`. The new admin route
  `GET /api/v1/public-api/stats` returns the total.
  
  **Server keys** (`adm_srv_`) work without an `Origin` header. They are refused when a request
  comes from a browser, are shown only once, and cannot be revealed. Rotating one gives another
  server key. Only a server key can be granted a service-role endpoint. A hosted app is never
  given a server key.

## 0.3.0-rc.4

## 0.3.0-rc.3

### Patch Changes

- ae41762: **A public API documentation page at `/api-docs`, switched on from Workspace settings.**
  
  Workspace settings gains a **Public API** card for holders of `api-keys.manage`, with two
  switches that apply the moment you click them:
  
  - **Public API** turns the public API on or off. It moved here from the old public API page.
  - **API documentation page** publishes `/api-docs`. It is off by default and does not travel in
    a config bundle.
  
  If `ADMINIUM_PUBLIC_API_ORIGINS` is not set, the card says so and how to fix it.
  `GET/PUT /api/v1/public-api` report and accept `docsEnabled`, and a PUT may change either
  switch on its own.
  
  `/api-docs` works without signing in. It lists only endpoints that a live key can call, with
  the methods keys were granted, and for each one its path, auth level, limits and column
  names and types. It never shows a table name, a filter, a row count or a key. While the page is
  off, the page and `GET /api/v1/api-docs` answer the ordinary not-found response. On a domain
  mapped to a hosted app they are not served at all.
  
  The page has a playground. Paste a browser key and it sends a real request with that key only.
  The key is never stored, never put in a URL or code sample, and your session cookie is not
  sent. The page shows the real status, the time taken and the response body. Code samples in
  cURL, JavaScript (`@adminiumjs/public-client`) and Python use the real paths and headers.
- ae41762: **The old API keys page at `/api-keys` is gone.** Role-bound keys (`adm_sk_…`) still work and can
  still be created and revoked through `/api/v1/api-keys`. There is no page for them now.
  _Guides → Public API → Endpoints and keys_ shows how to create one with `curl`. The sidebar no
  longer has an "API keys" row. Keys for your own pages are under Workspace settings → API keys.
- ae41762: **Public API keys can be made from endpoints instead of a hand-written scope.**
  
  Every table and view of a connection now has a generated public endpoint:
  its columns (none marked secret or personal data), its filters, page size,
  order, rate limit and response shape, and the methods its source supports.
  An operator can store an edited endpoint or a new custom one, and a key can
  be given several endpoints with different methods on each. Adminium writes the
  key's scope from those grants.
  
  New admin routes, all behind the API-keys permission:
  
  - `GET /api/v1/public-endpoints?connectionId=` lists the endpoints, the
    source tables and their columns, and any table without a generated endpoint
    with the reason.
  - `POST /api/v1/public-endpoints/check` compiles a definition without saving
    it. It reports every issue, the live keys a save would break, and the
    browser keys that would gain columns, methods or rows.
  - `PUT /api/v1/public-endpoints/:connectionId/:ref` saves an endpoint and
    rewrites the scope of every live key that uses it in the same step. A save
    that would break one of those keys is refused, and the reply names the key.
  - `POST …/:ref/rename` and `DELETE …/:ref` are refused while a live key uses
    the endpoint. Deleting a generated endpoint switches it off instead of
    removing it, so its default does not come back.
  - `POST /api/v1/public-keys` also accepts `connectionId` with `access` (the
    endpoints and methods), next to the existing `scopeId`.
  
  `GET /api/v1/public-keys` now returns each key's connection, kind, what it can
  call on each endpoint (and any method the endpoint no longer offers), and any
  issue that stops the key from working today.
  
  A key's derived scope is not listed by `GET /api/v1/public-scopes` and cannot
  be edited, deleted or reused by another key.
  
  Scopes also gain a default page size (`defaultLimit`), a default order
  (`defaultOrder`), a per-resource rate (`rate`) and a list response shape
  (`response`), and the `replace`, `delete` and `batch` actions. All are
  optional; a scope written before this change behaves as it did. The routes
  that serve the three new actions come in a later release.
  `GET /public/config` reports each resource's response shape.
  
  With more than one server process, a revoke, rotate, key create or endpoint
  save now reaches the other processes within 5 seconds (it was 30).
- ae41762: **The public API gains one-row reads, PUT, DELETE and BATCH, per-endpoint rate limits, list shapes, request counts and server keys.**
  
  New public routes, each allowed only when the key was granted that method on the endpoint:
  
  - `GET /public/records/:ref/:id` reads one row. It returns the same columns as the list and
    hides the same personal data. A row that doesn't exist and a row outside the key's scope both
    answer the same 404.
  - `PUT /public/records/:ref/:id` replaces a row. The body must include every column the key may
    write. The scope is part of the UPDATE statement itself.
  - `DELETE /public/records/:ref/:id` deletes a row. The scope is part of the DELETE statement
    itself. A row outside the scope answers 404 and is not deleted. When the database refuses a
    delete because of a foreign key, the caller gets one refusal that names nothing. Each delete
    writes an audit row showing the removed row, with personal data masked.
  - `POST /public/records/:ref/batch` takes 1 to 500 rows in one transaction, and either all of
    them are written or none are.
    - A row without its primary key is inserted, and the server chooses the key.
    - A row with its primary key updates that row, and the key must also hold PATCH.
    - If any keyed row is missing or outside the scope, the whole batch is refused, without saying
      which case it was.
  
  An endpoint's own rate limit now replaces its class limit. For browser keys it counts per
  visitor, and for server keys it counts across the whole key. A batch uses up one request per row.
  A request too large to ever fit is refused with 400 rather than 429. Scopes written before this
  change keep the limits they had.
  
  An address whose keys keep failing to match is refused after 30 failures a minute, before the
  server looks the key up.
  
  A list can be returned wrapped (as before), as a bare array with the next cursor in
  `X-Next-Cursor`, or as exactly one row. `Retry-After` and `X-Next-Cursor` can now be read by
  pages on other origins.
  
  "Requests · 24h" is counted per key, endpoint and hour. The counts are written every minute and
  when the server shuts down, and kept for `retention.publicRequestStatsDays`. The new admin route
  `GET /api/v1/public-api/stats` returns the total.
  
  **Server keys** (`adm_srv_`) work without an `Origin` header. They are refused when a request
  comes from a browser, are shown only once, and cannot be revealed. Rotating one gives another
  server key. Only a server key can be granted a service-role endpoint. A hosted app is never
  given a server key.

## 0.3.0-rc.2

## 0.3.0-rc.1

## 0.3.0-rc.0

### Patch Changes

- c451e7d: **A page assistant that drafts in the page's own format, and never saves.**
  
  The pages that build documents — Email templates and Report builder — gain an
  **Ask** button in the header. It opens an assistant
  that already knows what that page holds: its documents, the format they are
  written in, your branding, and the tables your role can read. Describe what you
  need and it drafts it, showing its work: every tool it ran, every table it
  touched, and what the draft would be.
  
  **It never writes.** The model's last move is a draft. Every button that would
  change something is locked until you turn actions on for that session, needs the
  same permission the page's own Save needs, and asks once more before it runs.
  What it saves is a draft — an email template disabled, a report with status
  `draft` — and every write leaves an audit row naming the session that proposed
  it.
  
  **Reading rows is opt-in.** By default it works from your documents and schema
  alone. An administrator can let it read rows your role can read — masked, at
  most 50 per request, and listed under *Sources read* on every result. That
  switch is not carried by an exported bundle: importing somebody else's
  configuration can never turn it on for you.
  
  The permission is seeded to Super Admin and Admin only, and a role that may
  draft but not save is the ordinary case: it can look, draft, preview, and put a
  draft straight onto an editor's screen, with the writing buttons locked and a
  sentence saying why.
  
  Settings → AI names the assistant and holds the row-data switch. It needs the
  same AI provider schema enrichment uses; there is no copy-paste path here,
  because a conversation is many round trips.

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

### Patch Changes

- a44a0ff: The ghcr image and the desktop build now carry the six first-party add-ons as
  a pre-verified bundled set.
  
  The boot seed has existed since the store landed, but nothing ever put a bundle
  where it looks — every image and installer shipped an empty Add-ons page and
  called the air-gap story done. Now a release script
  (`scripts/release/fetch-add-ons-bundle.mjs`) downloads the six tarballs at build
  time against exact version + sha512 pins (`scripts/release/add-ons-bundle.json`,
  copied from the release ledger — never `latest`, no redirects, timing-safe
  digest comparison, refusal on any unpinnable entry), and writes the flat
  `<key>-<version>.tgz` + `.tgz.integrity` layout the seed reads. The Docker build
  parks it at `/app/add-ons-bundle`, which the runtime stage's CWD makes the
  server's own default; desktop-release.yml parks it in `resources/add-ons-bundle`
  next to the demo seed.
  
  The desktop shell now closes the loop in both directions: `buildServerEnv`
  points `ADMINIUM_BUNDLED_ADD_ONS` at the packaged directory (only when it
  actually exists — dev checkouts ship no bundle), and the variable joins
  `STRIPPED_INHERITED_ENV_KEYS`, because it names a directory the server installs
  packages FROM, hashes and all — an inherited value was a whole package set
  chosen by whoever can set an environment variable.
  
  Seeding stays copy-if-absent with every hash re-verified on the way in, so the
  build-time verification is the first check, not the only one. A new
  self-hosting docs page (Installing add-ons) states the rest of the story
  plainly: the bundled set browses with zero network, the online catalog is a
  default-off opt-in that contacts exactly two hosts and discloses the
  deployment's IP and exact package@version to npm, and air-gapped installs
  sideload with a hash from the release ledger.

## 0.2.3

## 0.2.2

### Patch Changes

- docs: correct four claims the code does not support
  
  - **Desktop.** `Settings → Desktop` renders exactly three cards (Sign-in,
    Share on local network, App permissions). The install page's update-mode
    table and the backups page's "change the depth or turn it off in Settings →
    Desktop" both pointed at controls that have never existed. Both settings are
    real — `updates.mode` and `autoBackup.{enabled,keep}` in `config.json` — so
    the pages now say where they actually live, that the file is read once at
    launch, and which read-only surfaces (Help → About, Help → Check for
    Updates…) exist instead. Also records how the updater resolves its release
    (the releases list, filtered to `desktop-v*`, never GitHub's repository-wide
    "latest" pointer), the auto-backup schedule, and that `export-zip` is
    portability rather than a backup.
  - **`anatomy/index.md`.** "Nothing in the repository sends mail" was false end to
    end: `email.smtp` drives a real nodemailer transport, `email.send` is a
    registered job kind, and password resets, invitations, notifications and the
    template test-send all queue through it. Rewritten to name the absences that are
    real — no provider adapters, no `/settings/email` screen, no outbox table — and
    to correct `smtpConfigured` from "the whole of it" to the read-only consequence
    it is.
  - **`anatomy/packages.md`.** Every row of the per-package table recomputed
    under the convention the page states; 13 of 15 were wrong, several by a whole
    package's worth of files. The page now prints the commands that produce the
    figures and says plainly that nothing in CI holds them.
  - **The axe baseline count.** Dropped rather than refreshed. It is a debt
    counter with no CI tie — the quoted 162 had drifted well past the file — so
    the note points at `packages/ui/a11y-baseline.json` instead.

## 0.2.1

## 0.2.0

## 0.1.0

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
