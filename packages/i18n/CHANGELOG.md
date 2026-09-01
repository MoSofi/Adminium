# @adminium/i18n

## 0.2.5

## 0.2.4

## 0.2.3

### Patch Changes

- 36fb706: The Studio add-ons page can now acquire an add-on, not just install one that is
  already there.
  
  Three things it could not do before, and each was missing for its own reason.
  
  **A download is a job, and the page treated it as a request.** `POST
  /add-ons/download` answers `{ jobId }` the moment the work is enqueued — the
  bytes arrive later, on the worker, with its retries and its cancellation. The
  page reported success on that reply, so an operator saw "done", refreshed, and
  found nothing staged. It now follows the job to an actual terminal state and
  shows what step it is on. A failure is reported as the failure it was, with the
  server's own reason, rather than as a download that quietly did not happen.
  
  **Sideload had no surface at all.** The route existed; nothing in the product
  reached it, which left an air-gapped operator with a documented capability and
  no way to use it. The form asks for the package, its key, its version and its
  `sha512-…` integrity — and the hash is required rather than optional. That path
  runs the identical verify-then-hardened-unpack a registry download runs, one
  code path for bundled, npm and upload, so it needs the same thing a download
  gets from the registry: a hash supplied by something other than the bytes being
  checked. `npm pack --json` prints exactly that value, so the person doing the
  sideloading can produce it without trusting this page. Computing it from the
  uploaded file would have been verifying the bytes against themselves.
  
  The key and version are asked for rather than read out of the tarball,
  deliberately: the store's directory grammar is `<key>/<version>/`, and deriving
  either from a filename an operator can rename is how a package ends up staged
  under somebody else's name.
  
  **The online-catalogue switch had no route to write to.** It is a
  settings-registry boolean, and every other one lives under `/settings/*` — which
  is gated on `settings.manage`. That is precisely the permission the add-on wave
  spent a task un-reserving `manifests.manage` to avoid: a switch deciding whether
  this deployment talks to a package registry is not the same authority as
  renaming a workspace. So it is `PUT /api/v1/add-ons/catalog`, under the add-ons'
  own permission, audited like everything else there.
  
  The reply carries something the design did not anticipate. `ADMINIUM_NETWORK_FEATURES=off`
  and desktop air-gap mode outrank the stored setting, so an operator can switch
  browsing on and have it stay off. The route reports the **effective** state plus
  whether an environment veto is overriding it, and the page says so in words — a
  toggle that springs back with no explanation reads as a broken page rather than
  as a policy.
  
  The plan also asked for a cache invalidation hook here, on the pattern the
  public-API gate uses. There is nothing to invalidate: the catalog client reads
  the setting on every call and caches nothing. Building the hook would have been
  a no-op with a name implying otherwise.
  
  Fourteen new strings across all eight locales, German and French translated, the
  rest drafted from English and marked for review the way the i18n gate expects.
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
- 4d68dc9: Installing an add-on now creates the tables it declares.
  
  Until now an add-on whose `requiredSchema` named a table the database did not
  have was refused whole, with `ADD_ON_DDL_REQUIRED` and a list of table names.
  That covered every add-on attaching to data a host already had, and refused the
  three shipped ones that bring their own.
  
  **There is no SQL in the implementation, and that is the point.** The work was
  priced as a `requiredSchema` → DDL emitter written three times, once per
  dialect, because the only existing exemplar — the desktop runtime's SQLite
  importer — is exactly that. It was not needed: a connection hands back a real
  Kysely instance, whose schema builder already compiles `CREATE TABLE` correctly
  for postgres, mysql and sqlite. What was actually missing was a map from the
  manifest's fifteen abstract column types to a column type per dialect, and the
  rules for what order to create tables in.
  
  Three entries in that map differ from the meta store's answer for the same
  abstract type, and each difference is deliberate. An `id` is `varchar(36)` and
  never `char`, because a blank-padded character column hands the padding back on
  every read. A `timestamptz` is a real timestamp rather than the epoch-
  milliseconds integer the meta store uses, because these tables sit in the
  operator's own database beside their own data, where a `created_at` holding
  `1750000000000` is unreadable to every other tool they point at it. And `money`
  is `decimal(19,4)`, because binary floating point cannot represent a tenth of a
  cent.
  
  **A foreign key names a table, not a column,** so the target's primary key has
  to be resolved — from the manifest for a table this install is creating, from
  the live schema for one the host owns. A target with a composite primary key, or
  none, is refused rather than guessed at: assuming `id` would create a constraint
  against a column that may not exist. Constraints are emitted named and
  table-level, because MySQL parses the inline column-level form and then silently
  discards it.
  
  **The install is re-runnable rather than transactional,** which is the only
  property MySQL leaves available — it commits each DDL statement implicitly, so a
  multi-table install cannot be rolled back. Every create is `IF NOT EXISTS`,
  tables are emitted in dependency order, and the DDL runs *before* the manifest
  row is written. A failure halfway leaves real tables and nothing registered, and
  retrying completes the install rather than colliding with it. The reverse order
  would leave an add-on registered against tables that are not there.
  
  **Which database an add-on installs into is now answered explicitly.** An
  instance may have several connections and a manifest names none. The tables go
  where the host app it attaches to reads — which is the only answer that makes a
  foreign key into the host's data possible — falling back to the sole connection
  when the add-on attaches to no app in particular. When neither rule resolves,
  the install is refused and says why. Creating tables in the wrong database
  succeeds, returns 200, and is discovered much later by an operator wondering why
  an add-on's list is empty.
  
  The consent dialog says all of this before anyone agrees to it: it names the
  tables that will be created, and repeats that uninstalling later leaves them and
  their data alone. That promise is now checked against a database rather than
  asserted — install creates a table, a row goes into it, the add-on is
  uninstalled, and the row is still there.
  
  **One thing install still refuses:** adding columns to a table that already
  exists. Creating a table an add-on asked for is one conversation; altering one
  the operator already owns is a different one, and it is theirs to have. The
  dialog names the missing columns instead of offering a button that fails.
- 36fb706: Add-ons have a Studio page: browse, consent, connect, enable per host, uninstall.
  
  Thirteen tasks of server work become something an operator can use.
  `/studio/add-ons` presents them in the order they actually matter — what is
  available, what installing would do, what is installed — and the design input
  (`designs/Integrations.dc.html`) supplies the shapes while this supplies the
  data story behind them.
  
  **Browsing is a disk read, and the page says so.** A fresh install lists what
  came with the build, with no network call at all, so it is useful before anyone
  decides whether to switch the online catalogue on. When that switch is off there
  is no "check for newer" button to press — an action that could only fail is
  worse than an absent one — and the copy states plainly that nothing here has
  contacted the internet. When it is on, checking is a visible action rather than
  something the page does on load.
  
  **The consent dialog is the security surface, so it shows the plan first.**
  26 §7 calls it that explicitly, and what it shows is the real server-computed
  plan: the tables an add-on will use, the tables installing will CREATE, the
  hosts it may contact, and — when the answer is no — the reason, in a sentence
  naming the missing table. Install is not offered for a plan that cannot be
  applied. The one schema case that stays refused is a table that exists but
  lacks columns the add-on needs, and the honest surface for that is the plan
  naming those columns, not a button that would fail.
  
  **Three outcomes get three sentences.** Disable keeps everything and is one
  click to undo. Disconnect deletes the keys and keeps every table and every row.
  Uninstall additionally removes the files from the server, and still keeps every
  table and every row. A shared "are you sure?" would make the safest of the three
  read like the most destructive, so each confirm says what it actually does — and
  each says the data survives, because that is the promise 24 D16 makes and the
  dialog is where a person either believes it or does not.
  
  Fifty-one keys across all eight locales, German and French translated, the rest
  drafted from English and marked for review the way the i18n gate expects.
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
- 8ed7972: Fix the Email Templates builder rendering an empty canvas for every stored template.
  
  The surface was non-functional in both directions on every install, and had been
  since it shipped. `apps/server/src/email/render.ts` owns a closed six-kind
  vocabulary — `email.heading`, `email.text`, `email.button`, `email.divider`,
  `email.spacer`, `email.footer` — and that is what `seedBuiltinEmailTemplates`
  writes to `adminium_email_templates` at every boot and what `renderEmail` turns
  into MIME. The builder canvas knew a different vocabulary entirely: the 22
  `block-*` document ids (`block-line-items`, `block-tax-breakdown`,
  `block-qr-pay`, …). The intersection was empty.
  
  So `emailDoc.ts` classified every block of every seeded row as `unknown`,
  `blockOrder` came out `[]`, and the editor opened on "No blocks yet" for all 24
  rows a fresh install seeds (3 built-ins × 8 compiled locales). The reverse trip
  failed the same way: the palette could only offer `block-*` ids, `renderEmail`
  skips any kind outside its vocabulary, so anything an admin added was saved,
  shown as saved, and then silently dropped on send.
  
  **Neither half ever failed loudly, and that is why CI stayed green.** An
  unrecognised kind is *skipped* on both sides — deliberately on the server, where
  throwing would turn a stale row into a 500 on the password-reset path and lock
  someone out of their own account. The only coverage the surface had fed it
  hand-written docs made of `block-highlight-box` / `block-contact`, ids the canvas
  already knew and the mail renderer never did, so the one broken thing was the one
  thing nothing exercised.
  
  **The canvas moved to `email.*`, not the other way round.** The stored
  vocabulary is the wire format of a production table and of sent mail; the
  `block-*` set is a UI list. Changing code is free, migrating seeded rows in every
  install is not. A mapping between the two was never an option either: the 22
  document blocks contain no heading, paragraph, button, divider, spacer or footer,
  so nothing could express a transactional email, and a lossy round trip would have
  written `block-*` into stored rows — upgrading a broken editor into one that
  blanks real password-reset mail. The Email Templates comp settles it too: its
  inspector is Heading / Body paragraphs / Call-to-action / Footer text, and the
  five ecommerce modules that `DOC_TYPE_BLOCKS.email` used to hold are the comp's
  *optional* rail. They are still there, one click down the palette.
  
  Six canvas blocks back the kinds (`BlockEmail.tsx`). They read the stored payload
  bare rather than through `rowOf`, because that payload is the template entry's own
  `data` object and wrapping it would mean rewriting what the server sends.
  `email.button` renders as a styled span plus its destination in mono, not an
  `<a href>`: this is a preview inside an editor, a real link would navigate away on
  the click meant to select the block, and the href is usually an unresolved
  `{{resetUrl}}`. The heading renders as a weighted `<p>` carrying `data-level` —
  the canvas already emits an `<h3>` block label, so a real `<h1>` inside it would
  invert heading order on every template.
  
  **Payloads are now keyed by instance id, not block id.** Repeated kinds are the
  ordinary case here — `password-reset` has an `intro` paragraph and a `notice`
  paragraph, both `email.text` — and block-keyed storage collapses the two, showing
  one sentence twice while the other is unreachable. `blockDataForInstance` reads
  the instance id first and falls back to the block id, so no existing invoice or
  report doc changes shape. For the same reason the canvas now emits
  `blockInstanceOrder` alongside `blockOrder`: two instances of one kind produce an
  identical sequence of block ids, so "swap the two paragraphs" was a silent no-op.
  
  Because `apps/server` may not import `@adminium/widgets` and there is no runtime
  package both depend on, the vocabulary crosses that boundary the way the LLM
  allow-lists already do — declared on each side, held identical by
  `scripts/check-email-block-vocab.mjs` in CI. The gate compares both lists in
  order, checks each kind actually reaches a renderer on both sides, and checks
  that `BLOCK_IDS` still spreads `EMAIL_BLOCK_KINDS`: an earlier draft that compared
  only the two lists passed happily while `isBlockId` rejected all six kinds, which
  is the exact failure being fixed.
  
  Regression coverage runs a row copied verbatim out of a seeded install's meta
  store through `emailDoc.ts` into the rendered page, and asserts six block
  instances, two distinct paragraphs, a byte-identical round trip, and no empty
  state. The server side asserts every vocabulary kind renders non-empty HTML, that
  the real `builtins.ts` seed emits only vocabulary kinds in all eight compiled
  locales, and that an unknown kind is still skipped rather than thrown on.
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

- 08df45d: Fix the accessibility violations the axe sweep had been hiding, and the two
  harness defects that hid them.
  
  `a11y-baseline.json` held 162 fingerprints for four weeks. 111 of them do not
  reproduce at all.
  The sweep runs over the Storybook build, and that build was measuring something
  the product does not look like: `storybook.css` `@source`d only `packages/ui`
  while `.storybook/main.ts` has loaded the widgets and charts stories since
  04-T17, so every widget story rendered unstyled; and nothing painted `--bg` on
  the preview body, so under `data-theme="dark"` stories drew dark-theme
  foregrounds on Storybook's white body — axe resolves `color-contrast` against
  the nearest opaque ancestor, so the translucent tone tints composited over white
  and reported pairs the product never renders.
  
  Fixing both exposed violations the unstyled build had concealed. 128 were found
  and fixed rather than baselined:
  
  - alpha-dimmed small text on the accent bubble and calendar chips
    (`text-accent-fg/70`, `opacity-80`) measured 3.1–3.9:1 and went to full
    opacity — `--accent-fg` on `--accent` is already gated at 4.5:1, the alpha was
    the whole failure;
  - six scrollable regions with no focusable content were mouse-only and now carry
    `tabIndex` with a labelled role (chat transcripts, the AI panel, the queue
    detail pane, three chart matrices, the calendar lists);
  - `role="row"` containers whose children carried no cell role made their whole
    table invalid to assistive tech, and now use `rowheader`/`cell`/`columnheader`;
  - the grouped-summary expander was `aria-expanded` on a row with a keydown shim,
    and is a real `<button>`;
  - a `<dl>` with a direct `<p>` child is corrected;
  - `ChipInput` and paused job rows dim to 40–55% and now say `aria-disabled`,
    which is what makes WCAG 1.4.3's inactive-component exemption apply rather
    than merely look as though it should.
  
  The **AuthLayout brand panel** is the one the sweep can never see — it is
  `aria-hidden`, so axe skips the subtree while a sighted low-vision user reads all
  of it. It painted `--accent`, which resolves to the dark ramp under
  `data-theme="dark"`; that ramp is a foreground colour, so it is light, and white
  copy on it measured **1.64–2.35:1** across the eight accents. It now paints
  `--accent-light` in both themes (5.90–18.88:1), with the white alphas raised and
  the testimonial card darkened rather than lightened. A new `brand-panel` group in
  the token contrast gate measures it, since nothing else can.
  
  Eight `ui.*` keys were added across all locales for the new region labels.
  
  The baseline now holds 112, and getting a trustworthy number took two wrong
  answers first. `data-vrt-ready` was a bare mount effect while widget bodies load
  as per-family lazy chunks, so the sweep raced the stories: a fast machine
  reported 1 violation and CI reported 111 on the same commit. The sweep and the
  VRT spec now navigate with `networkidle` and the flag waits for DOM quiescence,
  after which both agree. Against the original 162: 111 do not reproduce, 51 were
  real all along, and 59 more were exposed once the stories rendered styled.
- 66f0683: Stop bulk export silently dropping every row selected on an earlier page.
  
  `page-crud`'s selection survives paging, and the browser-side export — which is
  the path every user takes, because no host implements the optional
  `CrudApi.export` — filtered the CURRENTLY LOADED page by the selected ids.
  Select on page one, page forward, select again, export: page one's rows were
  gone from the file, with nothing on screen to say so. The toolbar still counted
  them.
  
  The template now snapshots each selected row as it is selected — from the rows
  the grid was rendering when the click happened, so a row that could be clicked
  can never be missed — and exports from that, in selection order. Membership is
  captured in the selection handler rather than in an effect keyed on the loaded
  page: an effect can only record rows that happen to be loaded when it runs,
  which would have made the snapshot depend on effect ordering against the list,
  the same class of bug as the one it exists to fix. Deselecting drops a row from the snapshot; deleting a
  row drops it from the SELECTION too, on the single-row path as well as the bulk
  one — a deleted row must not keep being counted, and must not turn up in a file.
  
  One new string, `templates.crud.toast.exportIncomplete`, covers the case the
  design makes unreachable: if the snapshot were ever short, the export says how
  many rows it wrote. The point of the fix is that a short export can no longer be
  a silent one.
  
  The queued server-side run is deliberately still not wired: `ExportSource` on the
  wire carries `{kind, table, viewId, filters}` and no row selection at all, so
  implementing `export` against it as it stands would widen a selection export to
  the whole table — trading a silent drop for a silent over-export.
- 586426a: Defer the two data-io route bodies, and make the `page-wizard` template split real.
  
  `app/router.tsx` imports `data-io/routes.tsx` statically — it has to, the routes
  are built at module scope — and that module imported `ImportWizardPage` and
  `DataExportsPage` statically, so both route bodies sat in the synchronously
  loaded set for every user on every route.
  
  `ImportWizardPage` is also the `page-wizard` template body, which made this
  worse than one heavy route. `pages/templates.tsx` registers all fourteen
  template bindings behind dynamic imports, and thirteen of them were genuinely
  deferred: the fourteenth's chunk held a 22-line wrapper while the body shipped
  on boot anyway, because this file had already pulled it into the entry. The
  accounting said fourteen. It is fourteen now.
  
  Entry chunk: **330,905 → 315,684 bytes gz, −14.9 KiB**, and
  `chunk-budget.json`'s ratchet comes down from 331,000 to 317,700 in the same
  change — the file's own rule, and the edit is the reviewable click. The 331,000
  was loose besides: nothing had raised it, but ordinary additions had spent
  ~1.4 KiB of its margin since 2026-08-18, which is the drift a stale ratchet
  hides. RELEASE-GATE.md recorded the entry as 321.3 KiB on one line and 321.4 on
  another for the same measurement; both now state the one number this build
  measures, and say out loud that the gate counts JS only — the entry stylesheet
  blocks paint, is uncounted, and is 20,955 bytes gz of the real payload.
  
  The cost is one chunk fetch the first time `/imports` or `/exports` is opened.
  The page surface and its topbar title stay outside the Suspense boundary, so the
  frame paints immediately and only the body waits behind a spinner.
  
  Both routes also have end-to-end coverage for the first time
  (`apps/e2e/tests/data-io.spec.ts`). `dataio.test.tsx` mounts the two components
  directly, which proves they render and says nothing about the route — and a
  lazily-loaded body fails in ways a direct mount cannot see.
- e15787b: Give the connect wizard's generate step the cancellation its two siblings already had.
  
  `GenerateStep.run()` is a click-started async chain — a staged delay, the
  generate POST, another delay — and it narrated straight into `setPhase`,
  `setResult`, `setError` and the log console with nothing checking whether the
  step was still mounted. Leave the wizard mid-generate and every one of those
  lands on a tree that is gone.
  
  `TestStep` and `EnrichDirectProgress` are the same wizard, with the same `wait()`
  helper copied into all three, and both carry a `cancelledRef` cleared in an
  effect. This step never got one. That asymmetry is what makes it an oversight
  rather than a decision, and it was found by grepping the dashboard for timers
  that outlive their component after two others turned up the same week.
  
  The ref is RE-ARMED on every effect setup rather than initialised once, because
  `main.tsx` renders under `React.StrictMode`: a setup→cleanup→setup double-invoke
  would otherwise leave it stuck `true` from the simulated cleanup, and the step
  would silently narrate nothing. `EnrichDirectProgress` carries that same comment
  for the same reason. The new test renders inside StrictMode precisely so it can
  fail on that mistake — a plain render passes either way.
  
  One call is deliberately left unguarded: the `bootstrap` invalidation after a
  successful generate. Those pages exist on the server whether or not the step is
  still on screen, so skipping it would leave a stale nav behind.
- 2dffc12: Stop a dead icon name costing a generated app its first paint, and put 64
  untranslated keys into the locale bundles.
  
  - `kanban-square` is not a lucide icon — it was renamed to `square-kanban`. It
    was emitted as `nav.icon` by the page generator, so any generated app with a
    workflow-shaped table fetched the entire ~137 KB icon catalogue on first paint
    to discover the name was dead, then drew the neutral `File` fallback anyway.
    A second instance, `bar-chart-3`, was found by the new gate.
  - `gen-icon-core.mjs` already computed the list of declared-but-unknown icon
    names and discarded it, printing only a count. It now fails in both `--check`
    and write mode, naming the offending file and the canonical rename.
  - `LUCIDE_ICON_NAMES` is now a real export. `allowedIcons` was documented as
    fed by it, that symbol existed nowhere, and nothing supplied the value — so
    the unknown-icon warning and the `table` fallback never fired and a model
    could store any hallucinated icon string on a table.
  - 64 `t()` keys existed in no locale bundle and rendered a hardcoded English
    default in all 8 locales, 56 of them the Settings → Languages & translations
    page itself — the one page whose keys the in-product translation editor
    cannot reach, because it refuses any key absent from the compiled bundle.
    All 8 bundles now carry them, translated rather than copied from English.
- 1d952df: Stop the hub's introspection poll running two minutes past the screen that started it.
  
  `awaitIntrospectJob` loops up to 100 times against `GET /jobs/:id`, so leaving
  the connections hub mid-introspection kept fetching for as long as two minutes
  and ended in a toast about a screen the user had left. It now takes an
  `AbortSignal` the card aborts on unmount — checked at the top of each iteration
  and inside the sleep, the same shape `waitForHealth` already uses in
  `studio/api.ts`, where the flag is read at the loop boundary rather than threaded
  into `fetch` (`app/api.ts` takes no signal, and one in-flight GET is not the
  problem).
  
  `aborted` is a THIRD outcome rather than being folded into `failed`. The job is a
  server job and carries on regardless; only the watching stopped. Reporting that
  as a failure would put "Introspection failed. Try again." in front of someone
  whose introspection is at that moment succeeding. On the aborted path the
  mutation pushes no toast at all, and `onSettled` still invalidates the
  connections query, so the new snapshot is there the next time the hub opens.
  
  This is the last of the four timers the dashboard sweep found outliving their
  component, after the `page-crud` search debounce, the two builder autosaves and
  the connect wizard's generate step.
  
  One inaccuracy in the same function is left alone deliberately: exhausting all
  100 iterations still returns `failed`, so a job that is merely slower than the
  client's ~2-minute budget is reported as a failure. Correcting that needs a
  distinct "still running" message in eight locales, which is a copy change rather
  than a timer fix.
- 2728dea: Give `GET|PUT /settings/security` a screen, and stop the 2FA switch overpromising.
  
  The three enforced `auth.*` knobs — `sessionTtlHours`, `require2fa`,
  `passwordMinLength` — had a route, a Zod schema, an RBAC gate and a full set of
  translated strings in all 8 locales, and no way to reach any of it short of
  curl. `settingsHub.security.*` had sat unused in `common.json` since M5, and
  the page's own test asserted the absence with a rationale ("no auth flow
  enforces them yet") that stopped being true when enforcement landed.
  
  Settings → Security is now a second card on the workspace settings form. It is
  the same form, deliberately: one Save button, one review-then-confirm modal
  listing the changed fields, and two independent section-puts underneath. Two
  save buttons on one screen is how half a settings change gets shipped.
  
  `auth.allowSignup` is still not surfaced — the route does not accept it, so a
  fourth control would save nothing. Its strings stay unused, as they were.
  
  The honesty problem, and what was done about it. The only existing description
  of the toggle was "Every member must enable 2FA to sign in." That is false.
  `auth.require2fa` is advisory: it flags un-enrolled accounts with
  `twoFactorSetupRequired` and refuses `POST /auth/2fa/disable`, and that is all
  it does. No preHandler blocks an un-enrolled principal, and API-key principals
  are outside the question structurally, because `plugins/auth.ts` resolves a
  bearer key and returns before a session exists. So one new key —
  `settingsHub.security.require2fa.note` — states the boundary next to the switch
  that throws it, in the same words as the `auth.require2fa` docblock in the
  settings registry:
  
      Advisory, not a barrier: members without 2FA are sent to set it up and can
      no longer turn it off, but their sign-in is never blocked, and API keys are
      unaffected.
  
  The existing `desc` is left alone. Rewording it costs 8 locales and buys
  nothing once the boundary is stated beside it.
  
  The two numbers are held as typed text rather than as `number` state, because
  `number` cannot express "momentarily empty while being retyped" — clearing 720
  to type 24 would otherwise snap the field to 0. Both mirror the route's bounds
  client-side, so an out-of-range value is refused on the field instead of coming
  back as a 422 over a save that also carried a logo.
- 4f297da: Give SMTP a screen, so the transport behind password reset and invites is not curl-only.
  
  `GET|PUT /api/v1/settings/email` had a Zod schema, an RBAC gate, an audit
  marker, a host guard and encryption at rest — and no surface anywhere in the
  product. The transport that gates password resets, user invites, the
  notification `email` channel and scheduled report delivery could be set only by
  hand-writing the PUT or importing a config bundle. The docs said so in a
  "what's absent" bullet, which is now no longer true and has been corrected.
  
  Email (SMTP) is a third card on the workspace settings form, on the same terms
  as Security: one Save button, one review-then-confirm modal, three independent
  section-puts underneath.
  
  The password is the part worth reading about. The GET returns no password in any
  form — not the value, not a masked copy, not a last-4 — so the field starts
  empty on every load and empty means "keep the stored one", which is what stops a
  port change from making an admin retype a production secret. Typing one replaces
  it. Emptying the USERNAME sends `pass: ''` and clears it, because a secret an
  open relay cannot use is one nobody will remember to revoke. The review modal
  lists the field as "Replaced" and never shows a value.
  
  Host, port and from-address bounds mirror the route's, including
  `assertSmtpHostAllowed`'s bare-hostname rule, so a pasted `smtp://host:587` is
  refused under the field instead of coming back as a 422 over a save that also
  carried a logo. An unconfigured workspace opens with empty boxes, a suggested
  port and a note saying what cannot be sent — not three red fields.
  
  `{smtp: null}`, the route's own way of spelling "no relay", is reachable through
  a staged Remove that mirrors the logo's. And `/studio/settings` now has e2e
  coverage at all: the form's stub-driven unit tests could only ever prove what
  body it builds, not that the server accepts it.
- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
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

### Patch Changes

- 4091a4f: Evict ICU format failures by recency, and hand out copies of them.

  The bounded ring evicted by insertion order rather than recency. A repeat updated its record in place without moving it, while eviction always took the first key — so the message failing most often was the first to go. One bad message in a render loop, which is the exact case the ring exists to surface, was evicted by 49 unrelated one-off failures before an admin could ever see it in the Translations editor. Repeats now re-insert, so key order is recency order and eviction takes the least recently seen.

  `formatFailures()` also handed out live references into the ring, typed `readonly FormatFailure[]` — which protects the array, not the entries. A held result changed under the caller on the next failure, and a caller could write straight into the ring; `GET /i18n/format-errors` was safe only because it serialises immediately. Entries are now copied and typed `readonly Readonly<FormatFailure>[]`. The copy is what provides the guarantee, since `readonly` is erased at runtime.

  Both paths are covered by tests, which this module previously had none of.

## 0.2.0

### Minor Changes

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.
