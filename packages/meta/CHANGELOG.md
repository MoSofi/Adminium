# @adminium/meta

## 0.2.3

### Patch Changes

- 4d68dc9: Add-ons can now be acquired: a package store, a hardened unpack, and a catalog client.
  
  Plan 26 specs everything that happens once an add-on package is on local disk —
  validate, install, connect, enable per surface, uninstall — and deliberately
  assumes the package is already there. Nothing put it there. This is the
  acquisition half: where a package comes from, how its bytes are authenticated,
  and how they get onto disk without the archive being able to decide where.
  
  **The store** (`apps/server/src/add-ons/store.ts`) keeps packages at
  `<ADMINIUM_DATA_DIR>/add-ons/<key>/<version>/`, a sibling of `files/` on the
  same named volume, so downloads survive an image upgrade the way exports and
  backups already do. It clones `files/storage.ts`'s fail-closed discipline and
  adds the two things a code package needs that a byte blob does not: a version in
  the path, and a tree that is written atomically. `adminium_files` was not reused
  — a `file_<ULID>` key has nowhere to put a version, `FileKind` has no member
  that fits, and a package is a tree the runtime serves individual files out of,
  not a blob.
  
  **Unpack treats every archive as hostile** (`add-ons/archive.ts`). It has to: an
  add-on ships a server half that runs in-process, so distribution is an RCE
  channel, and the publisher gate in `@adminium/manifest` cannot run until
  `manifest.json` has already been extracted — the field it reads lives inside the
  attacker's archive. So the reader is an allowlist. Symlink, hardlink, device,
  FIFO, PAX and GNU long-name entries are refused by name rather than skipped;
  absolute paths, `..` components, backslash separators and control bytes are
  refused; the header checksum is verified; GNU base-256 size fields are refused
  (they describe members over 8 GiB, three orders of magnitude past the cap, so in
  practice they only appear from something trying to confuse a size check); a
  duplicate path is refused, because last-write-wins is how you show a scanner one
  file and the runtime another. Archive mode bits are read for the checksum and
  then discarded — files land 0o600 whatever the tarball asked for.
  
  Decompression is bounded by measurement, not by hope. `gunzipSync` would
  materialise the whole expansion before any cap could look at it, so the reader
  streams through fflate's `Gunzip` and aborts from the chunk callback; fflate
  flushes on a fixed internal buffer, so overshoot past the cap is one chunk —
  16 MiB for 64 MiB, 256 MiB and 1 GiB bombs alike, since the first chunk does not
  scale with the bomb. Worst-case allocation is the cap plus 16 MiB regardless of
  what the archive claims. No new dependency was added for any of this: `fflate`
  was already here for the export/backup zip paths, and a hand-written strict
  header reader is more auditable on an RCE path than a general-purpose extractor
  being argued out of extracting. The strictness costs nothing in compatibility —
  a real `npm pack` tarball is pure USTAR, regular files only, every path under
  `package/`, which is what the reader accepts.
  
  **The stage-to-install window is closed by a tree pin.** The data volume is
  shared, writable state, so between unpack and install anything with write access
  could edit the tree. `stage()` records a per-file sha256 manifest; `verifyTree()`
  re-checks it before install parses a byte, and refuses an ADDED file as well as a
  changed one — pinning only the files you know about would let a writer drop an
  extra module beside them for the runtime to load.
  
  **The catalog client** (`add-ons/catalog.ts`) is built on the telemetry client's
  precedent, including the part that matters: the off-switch is checked before a
  URL is constructed, so there is no code path from a disabled client to `fetch`.
  Two independent vetoes, either sufficient — `ADMINIUM_NETWORK_FEATURES` for
  whoever owns the process environment, and a new default-off
  `addOns.catalogEnabled` setting for whoever administers the instance. Exactly two
  hostnames are reachable, both module constants; the tarball URL is the one
  address that arrives as remote data, so its host is compared with `===` against
  the registry constant before it is fetched. The feed schema is `.strict()`, which
  is what makes deferred monetization a rule rather than a coincidence: a feed
  carrying `price`, `tier` or `licenseKey` is refused, not ignored. Versions are
  exact — the schema rejects `latest`, `^1.0.0` and `1.x` outright.
  
  `add-on-network-isolation.test.ts` proves the off-path the way
  `telemetry-network-isolation.test.ts` does, with a recording thrower over fetch
  and node net/http/https: a client that swallowed its own fetch failures would
  otherwise turn "off means off" into "off means we tried", and a
  non-throwing-result assertion would not notice.
  
  The transport carries three properties that the exact-hostname rule needs and
  that a plain `fetch` call does not give you. **Redirects are refused, not
  followed** — this is the load-bearing one. A host check necessarily runs on the
  URL *before* the request, so with `fetch`'s default a `302 Location:
  https://evil.example/x.tgz` out of the registry would be followed silently and
  "exactly two hostnames" would hold only on paper; both endpoints are first-party
  or first-party-pinned and neither has any business bouncing us, so a redirect is
  a typed refusal that names where it tried to send us. **Responses are capped
  while streaming**, because the archive limits bound what is *unpacked* and by
  the time they see anything the bytes are already in memory — a declared
  over-cap `content-length` is refused before a byte is read, and a body that lies
  about its length is cancelled mid-stream. **Every request carries a wall-clock
  budget**, so a host that accepts a connection and never answers cannot park a
  job forever.
  
  **Acquisition runs as jobs, not request handlers** (`jobs/add-on-acquire.ts`).
  A download is a multi-second chain — packument pin, ledger cross-check, tarball,
  verify, unpack — and the jobs substrate already carries retries, cooperative
  cancellation, and progress on the `jobs:<jobId>` WS topic that the Studio page
  will consume for free. `add-on-download` is registered INTERNAL-ONLY: its
  integrity value comes from the cached catalog, so a `jobs.manage` holder able to
  hand-craft the payload through `POST /jobs` would be choosing their own integrity
  value, which is the same as having none. Idempotency is the repo's own
  `dedupeKey` per `(key, version)`, so two operators pressing Download get one
  download. `catalog-refresh` is scheduled daily and is a no-op — not a failure —
  when the switch is off.
  
  Both a refusal and a success are audited, under a new `add-on` audit category.
  It gets its own category rather than a `system` action because an add-on runs
  code in-process: "what arrived on this deployment, from where, and did anything
  refuse it" is a question an operator asks on its own, and should not have to be
  sieved out of the system log. The column is `str(20)` with no CHECK constraint,
  so this needed no migration.
  
  All of this was then attacked from three independent lenses and every claimed
  defect adversarially verified before being believed — 14 of 27 survived, and
  the survivors were the useful kind. `fflate` does not validate the gzip footer,
  so a stream with a wrong CRC32 and ISIZE was being accepted; a single zero block
  mid-stream desynchronised the parser in a way that made system `tar` and this
  reader disagree about how many members an archive has, which is a parser
  differential a scanner could be walked straight past; the ustar magic was never
  checked at all, so a v7 or GNU header was being read at ustar offsets; versions
  sorted lexicographically, which puts `1.10.0` below `1.9.0`; the bundled-seed
  filename regex was non-greedy and split a hyphenated key at the wrong hyphen;
  the tree pin lived inside the directory it pinned, so a package could ship its
  own; the temp directory was named from the tarball hash alone, so two concurrent
  stages of the same bytes collided; and the replace step removed the outgoing
  tree before renaming the new one in, so a failure mid-swap left neither.
  
  Four more came out of the same pass. The feed's `npmPackage` accepted any name
  up to npm's 214-character limit while `pinRelease` built the packument URL from
  it — so whoever served the feed chose which package a download actually fetched,
  and the D7 cross-check gave no protection at all there, because the same
  attacker supplies both the name and the `integrity` it is compared against. It
  is now bound to `@adminiumjs/add-on-<key>` by a schema refinement. The job's
  cancellation signal reached none of the network calls, so a cancelled download
  held its socket until the timeout; the tarball leg had no audit row, making the
  audit trail's completeness depend on which failure happened to occur; and the
  memory-bound comment claimed "the cap plus 16 MiB" when the accumulated chunks
  and the flat copy assembled from them are both alive at once — roughly twice the
  cap, which is what it now says.
  
  At boot the store prunes orphaned staging directories (an atomic-rename scheme
  leaks exactly those on a SIGKILL) and seeds the image's bundled set
  copy-if-absent, re-verifying every hash on the way in — so "pre-verified" means
  the hash is checked again, not that the check is skipped. That is what lets an
  air-gapped install browse and install with no registry reachable at all.
- 4d68dc9: Add-ons can now be installed, attached to a host, switched off per host, and
  uninstalled — and `manifests.manage` became a real permission.
  
  Plan 32 got a verified package onto local disk and stopped there. This is the
  first half of what happens next: the meta surface, the install planner, and the
  routes. It is deliberately not the whole runtime — see the end for what still
  refuses.
  
  **`adminium_manifests` already existed.** It has shipped since migration 0006
  with no repo, no writer and zero rows, and three planning documents recorded it
  as absent. So migration 0020 ALTERs rather than creates, adding `kind`, and
  `licenseKeyEncrypted` — a column plan 17 defers by name — is left in place and
  read by nothing rather than dropped, because it is empty and dropping a column
  is the one thing a migration cannot take back.
  
  **Attachments are a join table.** The wave's plan originally recommended two
  manifest rows keyed `(manifest_key, attached_to)` for an add-on attached to two
  hosts; that recommendation was withdrawn and the join table ratified. Three costs argue against it, and the
  third only became visible once the table turned out to be shipped: two rows mean
  two copies of the manifest document, which an upgrade must then rewrite
  atomically or leave one host on an older version; the credential FK becomes
  ambiguous, since a DHL API key belongs to the add-on rather than to one of its
  attachments, so disconnecting "the other one" either orphans a secret or deletes
  a live one; and it requires dropping and recreating the shipped
  `uq_adminium_manifests_manifest_key` across three dialects, against §4's own
  "never edit a shipped migration". An attachment is a many-to-many fact and now
  has the table that models one. `disabledAt` lives there rather than on the
  manifest, so an add-on can be live on one host and off on another — which a
  single flag could not represent.
  
  **Credentials get their own key, not the DSN's.** `deriveKey`'s `info` parameter
  exists to keep purposes apart, and these are genuinely different: a DSN opens
  the operator's own database, an add-on credential opens a third party's API on
  their behalf. Sharing a key would mean a leak of either is a leak of both, and
  rotating one to contain an incident would silently invalidate the other. The
  ciphertext column is called `payload`, which none of the log-redaction patterns
  matched — `payload` is now redacted, along with `refreshToken` and `accessToken`.
  That will redact some innocent job payloads too; an un-redacted credential in a
  log costs more than a debugging session does.
  
  **`planInstall` is a document, not a step.** The consent dialog is the security
  surface, so what it shows had to be computable without side effects and
  renderable even when the answer is no — a refusal is data, not an exception that
  leaves the dialog with nothing to draw. The case that makes it non-trivial is
  the foreign key pointing *out*: two of the three shipped add-ons that declare
  tables reference tables they do not own (`design-studio.job_id → jobs`,
  `personalizer.product_id → products` and `order_line_id → order_lines`). Those
  belong to the host, so a reference resolves as internal, host, or unresolved,
  and only the third stops an install. A planner that only emitted DDL would find
  that at `CREATE TABLE`, having already created the other tables — on MySQL,
  which has no transactional DDL, permanently.
  
  **`manifests.manage` is grantable, in the same change that landed its first
  enforcement point** — which is the rule its own reserved list documents. It went
  to `operations` rather than `workspace`: installing an add-on runs its server
  half in this process, which is closer to starting a job than to changing a
  setting, and 26 D3 exists precisely to stop it riding on `settings.manage`. The
  reserved set had four hard-coded copies rather than the two that were expected,
  and one of them is production code — `RESERVED_GRANTS` in the dashboard's
  `rolesApi.ts`, which the dashboard cannot import from `@adminium/meta`, so
  nothing detects drift and a key left there is silently dropped from the matrix
  with no error and no failing test.
  
  Applying a plan that needs new tables lands in the same release — see the
  add-on schema changeset — so an add-on whose tables the host database already
  has and one that brings its own both install completely.
  
  Uninstall deletes the meta rows and the package directory and touches the data
  source not at all, so every table an add-on brought stays with its rows; the
  reply says so, rather than leaving the UI to assert it. And 26's acceptance #8 —
  "a composeServer-level test that fails if a route is exported but unregistered"
  — finally has one. Nothing enforced it before: the M10 regression test checks a
  hard-coded URL list, audit coverage only sees routes that are registered, and
  the OpenAPI check reads the built spec. All three are blind to exactly the gap
  that shipped green twice.
- 7e5f704: A data connection can now be PAUSED instead of deleted.
  
  Deleting was the only way to stop Adminium touching a source database, and it
  takes the generated pages with it — so "turn this off for the migration
  window" and "I am done with this database" had one button between them. Studio
  → Data connections now carries a Pause/Resume action per card.
  
  The state is a new `adminium_connections.disabled_at` column (meta wave 0019),
  deliberately NOT a `status` value: `status` is a health reading and every
  connection test overwrites it, so a pause folded into that enum would be
  silently undone by the next successful probe — and a connection that was
  FAILING when it was paused would lose that reading on the way. Health is
  observed, a pause is intended; two facts, two columns, and the card can say
  "paused, and it was failing when you paused it". The timestamp (rather than a
  boolean) is what lets the card say *how long* — a source paused for an hour
  during a migration and one paused five weeks ago and forgotten are the same
  boolean and very different situations. NULL means serving, so no backfill.
  
  Enforcement is at the source-database boundary, not in the UI that offers the
  button. `ConnectionManager.data/dataAdapter/introspectAdapter` refuse with a
  new 503 `CONNECTION_DISABLED`, which is what covers every caller with no
  operator in the loop: scheduled reports, export and import jobs, quick search,
  widget refreshes and the public API. The check runs ahead of the pooled-handle
  cache on every call, because the pool is process-local and a pause is a row in
  the meta store — checking only on a cold open would leave a warm handle in a
  second server process serving a source somebody had switched off. Pausing also
  disposes the pool, so a paused connection holds no sockets open. `mustFind`
  deliberately does NOT refuse: Studio has to be able to read and resume the row.
  
  - `PATCH /api/v1/connections/:id` accepts `disabled`, audited under its own
    `connection.disable` / `connection.enable` actions. Omitted leaves the pause
    alone, so a rename never resumes a source by accident.
  - `POST /connections/:id/test` and `/introspect` refuse while paused — the
    introspect refusal lands before the job is enqueued, so the operator is told
    while they are still looking rather than by a job that fails out of sight.
  - The public API maps the refusal to its own `PUBLIC_UPSTREAM_UNAVAILABLE`:
    that surface's callers are the tenant's customers, who cannot resume
    anything and should not learn the operator switched a database off.
  - A paused connection's pages leave the SIDEBAR, and every other surface that
    enumerates pages with them: the command palette, G-chord jumps, the 404's
    suggestions, and the page pickers in scheduled reports, exports and imports
    (all of which read `flattenNav(bootstrap.nav)`). They leave `hiddenPages`
    too — that list is still enumerated by record-page related tabs and
    cross-links, and a paused source must be enumerable by nothing. Quick search
    drops the connection from its candidate set rather than dialling it and
    degrading every table to a `partial: true` group.
  - They travel in a new `pausedPages` bootstrap field read by exactly one
    caller: the `/p/<slug>` URL resolver. A bookmark, or a tab that was open when
    the pause landed, renders the `connection-paused` state instead of a 404 —
    the page has not gone, its database has.
  - Pausing publishes on the `config-changed` realtime channel, so every signed-in
    session drops its bootstrap cache. The operator who flips it is rarely the
    only person looking at the sidebar.
  - Pages over a paused connection get a new `connection-paused` system state
    and a matching template panel — "This connection is paused", calm tone, and
    no Retry button, because retrying cannot change the answer until a person
    resumes it. The four data templates that render an error panel share one
    `describeDataError` helper for it.
  - The desktop runtime chip stops counting a paused remote as either reachable
    or offline; the hub's "healthy" count drops it and the header says how many
    are paused, but only when some are.
- 37c99f2: The Studio's messages are their own namespace, and nobody downloads them until
  they open the Studio.
  
  `10-i18n-theming.md` §2.4 has always specified `studio` as a namespace that
  loads "lazily when a Studio route mounts", and §2.5's own example key is
  `studio:connect.wizard.testCta`. The build never did it. All 971 console
  messages lived in `common.studio.*` and `common.studioPages.*`, and every en-US
  namespace was imported statically into the caller's main chunk — so the connect
  wizard, the schema remap editor, the LLM review screens and the workspace
  settings hub were downloaded, in English, by every user on every route, on top
  of their own locale's copy of the same text.
  
  Nothing caught it. The cross-locale parity gate proves the eight bundles agree
  with each other, and agreeing about the wrong namespace is still agreement.
  
  They are `studio:*` and `studio:pages.*` now, in all eight locales, fetched by
  the Studio through the same spinner its lazy route bodies already showed. The
  dashboard's entry chunk drops **15 KiB gzipped**, which is the difference
  between a build that was over its size ratchet and one that is 60 KiB under the
  v1.0 target.
  
  Three things had to come with them, and each is the kind of thing that would
  have been found in production rather than in CI.
  
  **The inline fallback became load-bearing.** `t('studio:hub.title', 'Data
  connections')` renders its second argument until the chunk lands, and in every
  unit test that never boots i18next. While the catalogue was always present that
  argument was decoration; now it is the text on screen for a moment. All 1,057
  were compared against the bundle and one had drifted — a settings helper still
  describing a control that had been reworded. A test now compares every one of
  them, character for character, so the next drift fails a build instead of
  flickering on a page.
  
  **A deferred namespace cannot be read outside the surface that loads it.** The
  topbar titled its two Studio menu items from `studio.hub.title` and
  `studio.settingsHub.title`, and the topbar paints on every route — after the
  move it would have shown English to a German admin until they opened the Studio.
  Those two items have their own `topbar.*` keys, and a test fails the build on
  any `studio:` key read from outside `src/studio`.
  
  **And the overrides had to move with the messages.** An operator who reworded a
  Studio string through the Translations editor had a row filed under
  `(common, studio.hub.title)`, and a row is addressed by namespace and key — so
  the rewording would have stopped resolving the moment the message answered to a
  new address. Not with an error: the string would simply revert to the compiled
  English, on the one surface whose users are the people who did the rewording.
  Meta migration 0022 re-files those rows. It also *copies* rather than moves an
  override on the two keys the topbar gave up, so an operator who renamed "Data
  connections" does not end up with a menu item and the page it opens disagreeing.
  
  The client half is the same problem one layer up: the boot path fetches override
  rows for the eagerly-bundled namespaces only, which was correct while every
  Studio key was a `common` key. The Studio now fetches its own overrides
  alongside its compiled bundle, and the server's per-locale override budget
  counts the namespace — deferring bytes is not the same as not sending them.
  
  One note for anyone reading the bundle numbers. Moving the keys, on its own,
  made the entry chunk *larger*. `@adminium/i18n`'s barrel re-exported the
  complete en-US catalogue, and a re-export keeps its module statically reachable
  — which in turn pinned the override layer's *dynamic* import of that same module
  into the entry, because a module the bundler can reach statically cannot be
  split out. The note directly above that export had predicted this about two
  other modules. Deleting the one line is essentially the entire 15 KiB.
  
  `EN_US_RESOURCES` is therefore no longer exported from `@adminium/i18n`; import
  it from `@adminium/i18n/resources`, which is where every consumer in this repo
  already got it. `NAMESPACES` keeps its meaning (all five), and
  `EAGER_NAMESPACES` / `DEFERRED_NAMESPACES` are exported alongside it so which
  side of the split a namespace is on is a declaration rather than a comment.

## 0.2.2

### Patch Changes

- c09848a: Say what `auth.require2fa` actually does. It is advisory, and its name is not.
  
  The setting reads as a perimeter — "Require TOTP for all users" — and the
  registry entry that defines it said nothing more than that. Two things read the
  flag in the entire product, both in `apps/server/src/routes/auth/handlers.ts`:
  
      needsTwoFactorSetup    -> twoFactorSetupRequired on the login reply
                                and on GET /auth/session
      disable2faHandler      -> ForbiddenError on POST /auth/2fa/disable
  
  The first is a signal, not a denial, and that part is deliberate: `/auth/2fa/
  enroll` and `/auth/2fa/activate` are both `requireAuth`, so refusing the session
  would leave a user with no door to enroll through. The second stops an enrolled
  account opting back out.
  
  Nothing else reads it. No preHandler blocks an un-enrolled principal, so any
  client that ignores the signal — anything that is not our own dashboard — keeps
  a full session and can call every route without enrolling. Our dashboard is in
  fact the only thing that would honour it, and today it does not: `twoFactorSetup
  Required` appears nowhere in `apps/dashboard/src`. API-key principals are outside
  the question structurally — `apps/server/src/plugins/auth.ts` resolves an
  `Authorization: Bearer adm_…` key and returns before a session exists, so no
  session-conditioned gate would reach them even if one were written.
  
  The flag is also `portable`, which the entry did not mention and which has teeth:
  `export/redaction.ts` derives the export allow-list from this registry, and the
  import service replays settings through `settingsRepo.set`, so a bundle can land
  `true` on an instance where nobody has TOTP enrolled. That is survivable only
  because the flag is not a perimeter — everyone can still log in, so an admin
  turns it back off at Settings → Security. Where no admin UI is reachable the
  floor is SQL, because there is no `adminium settings` subcommand (the CLI has
  eight commands and none of them writes a setting):
  
      DELETE FROM adminium_settings WHERE key = 'auth.require2fa';
  
  Deleting the row is enough — `repos/settings.ts` `get()` returns the registry
  default for a key with no row, and that default is `false`.
  
  Documentation only. No behaviour changes, and enforcement is deliberately not
  added here: a half-enforced control that reads as a perimeter is worse than one
  documented as partial, and closing the gap is a decision with a blast radius
  (every API client of an instance that has the flag on) rather than a patch.
- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
- aabc4e1: Diagnose transaction-pooling (PgBouncer) Postgres endpoints. Adminium sets its
  session timeouts in the startup packet, which Neon `-pooler` hosts and Supabase's
  port-6543 pooler reject with a bare `08P01: unsupported startup parameter in
  options: statement_timeout`. That failure now maps to `UNSUPPORTED` with a hint
  naming the fix — use the direct/unpooled connection string — and the connect
  wizard shows the adapter's hint instead of the generic "verify the DSN" copy.
  
  Adapter remediation hints are now persisted alongside the driver message
  (`adminium_connections.last_error_hint`, migration `0013`), so a failing
  connection still explains itself on the Hub after a reload.
- ef1c300: Let admins create and edit pages from Studio, and give every screen one gutter.
  
  Pages are now a first-class thing an admin can make. Studio gains a pages
  section — create, duplicate, reorder columns, pick an icon, choose a template —
  backed by page lifecycle routes on the server and the page repo and permission
  checks in `@adminium/meta`. Until now a page existed only as something the
  generator emitted from a schema snapshot, so a hand-made page had no way to
  fill its own body.
  
  `@adminium/engine` gains the entry point that makes that possible.
  `generatePages` composes a whole app and picks every template itself;
  `composeRequestedArchetype` composes one page but only for the nine archetypes,
  because it delegates to `buildArchetypeEnvelope` and that returns null for
  anything else. Neither serves an admin who picked `page-crud` for a table by
  hand, which is the most common choice. `recompose` is the missing third door:
  the same classify → candidates → compose prelude, dispatching to
  `buildCrudEnvelope` or `buildArchetypeEnvelope` as the template demands, so the
  server can rebuild a page's body from live schema instead of leaving it empty.
  Templates that are not table-bound — `page-dashboard` composes from a domain,
  and `page-builder`/`page-wizard`/`page-settings` are tool surfaces whose bodies
  the renderers ignore — return `bindable: false` with a null envelope, so the
  caller keeps whatever the page already had rather than blanking it.
  
  The second half is `PageSurface`. Every routed screen used to invent its own
  gutter — `p-6` here, `p-[var(--main-pad)]` there, `p-10` on one wizard, nothing
  at all on the templates that forward straight to `@adminium/widgets` — so the
  padding changed every time you moved between two screens of the same app. Now
  each screen renders exactly one `PageSurface`, which owns the inner main
  section and is the only thing that can set the gutter; the shell's sidebar and
  topbar sit outside it and are unaffected. It takes `standard` (the density-scaled
  `--main-pad`), `none` for templates that draw their own full-bleed chrome, or an
  explicit x/y pair from a page's stored config, with `width: 'content'` as an
  independent knob for screens that are a short stack of controls rather than a
  grid.
  
  Chart and KPI text now has a legibility floor held by a test rather than by
  eye, and the theme control moved out of the header into the account menu as a
  verb-labelled item ("Light mode" / "Dark mode") that keeps its ⌘⇧L shortcut.

## 0.2.2-rc.0

### Patch Changes

- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
- aabc4e1: Diagnose transaction-pooling (PgBouncer) Postgres endpoints. Adminium sets its
  session timeouts in the startup packet, which Neon `-pooler` hosts and Supabase's
  port-6543 pooler reject with a bare `08P01: unsupported startup parameter in
  options: statement_timeout`. That failure now maps to `UNSUPPORTED` with a hint
  naming the fix — use the direct/unpooled connection string — and the connect
  wizard shows the adapter's hint instead of the generic "verify the DSN" copy.
  
  Adapter remediation hints are now persisted alongside the driver message
  (`adminium_connections.last_error_hint`, migration `0013`), so a failing
  connection still explains itself on the Hub after a reload.
- ef1c300: Let admins create and edit pages from Studio, and give every screen one gutter.
  
  Pages are now a first-class thing an admin can make. Studio gains a pages
  section — create, duplicate, reorder columns, pick an icon, choose a template —
  backed by page lifecycle routes on the server and the page repo and permission
  checks in `@adminium/meta`. Until now a page existed only as something the
  generator emitted from a schema snapshot, so a hand-made page had no way to
  fill its own body.
  
  `@adminium/engine` gains the entry point that makes that possible.
  `generatePages` composes a whole app and picks every template itself;
  `composeRequestedArchetype` composes one page but only for the nine archetypes,
  because it delegates to `buildArchetypeEnvelope` and that returns null for
  anything else. Neither serves an admin who picked `page-crud` for a table by
  hand, which is the most common choice. `recompose` is the missing third door:
  the same classify → candidates → compose prelude, dispatching to
  `buildCrudEnvelope` or `buildArchetypeEnvelope` as the template demands, so the
  server can rebuild a page's body from live schema instead of leaving it empty.
  Templates that are not table-bound — `page-dashboard` composes from a domain,
  and `page-builder`/`page-wizard`/`page-settings` are tool surfaces whose bodies
  the renderers ignore — return `bindable: false` with a null envelope, so the
  caller keeps whatever the page already had rather than blanking it.
  
  The second half is `PageSurface`. Every routed screen used to invent its own
  gutter — `p-6` here, `p-[var(--main-pad)]` there, `p-10` on one wizard, nothing
  at all on the templates that forward straight to `@adminium/widgets` — so the
  padding changed every time you moved between two screens of the same app. Now
  each screen renders exactly one `PageSurface`, which owns the inner main
  section and is the only thing that can set the gutter; the shell's sidebar and
  topbar sit outside it and are unaffected. It takes `standard` (the density-scaled
  `--main-pad`), `none` for templates that draw their own full-bleed chrome, or an
  explicit x/y pair from a page's stored config, with `width: 'content'` as an
  independent knob for screens that are a short stack of controls rather than a
  grid.
  
  Chart and KPI text now has a legibility floor held by a test rather than by
  eye, and the theme control moved out of the header into the account menu as a
  verb-labelled item ("Light mode" / "Dark mode") that keeps its ⌘⇧L shortcut.

## 0.2.1

## 0.2.0

### Minor Changes

- 1d7c7b4: Parse Postgres `int8` as a JS number on the meta pool.

  `createPostgresMetaDb` documented that its pool must decode int8 as a number but shipped nothing that could satisfy it, so callers either forgot — every `ts` column arrived as a string and `GET /api/v1/bootstrap` failed against its own reply schema — or reached for a process-global `pg.types.setTypeParser`, which masked the callers that had. `postgresInt8AsNumber(pgModule)` is now exported next to the contract it satisfies: `new Pool({ …, types: postgresInt8AsNumber(pg) })`.

  Scoped to the one pool deliberately. The META schema pins `ts` to epoch milliseconds and `bigint` to values under 2^53, but the server reads the user's own tables through the same `pg` module and their `bigint` ids carry no such promise — a global parser there would be a data-integrity bug in waiting. Structurally typed over the module, so `@adminium/meta` still declares no driver dependency.

### Patch Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.
