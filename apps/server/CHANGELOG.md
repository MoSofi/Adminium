# @adminium/server

## 0.3.0-rc.0

### Minor Changes

- **0.3.0 — add-ons own pages, and 0.2.10 through 0.2.12 are withdrawn.**
  
  The three releases between 0.2.9 and this one were cut as patches while a much
  larger change was still landing, and each shipped a partial version of it. The
  worst of them, 0.2.12, removed the invoices screen and bundled an add-on that
  could not yet render its replacement. They have been unpublished. **0.2.9 is the
  stable line**, and this release candidate is the whole change rather than a
  fraction of it — everything those three releases described is in here.
  
  What this release is:
  
  - **An add-on can own a dashboard page.** A page declares a `ref`, the client
    bundle that renders it, and where it would like to sit in the navigation — a
    built-in group, or one the add-on brings with it. The host mounts it at
    `/add-ons/<key>/<ref>`, gives it a rail row, and publishes a versioned runtime
    for it to render against. Add-ons register their own message catalogues, so a
    page speaks the operator's language rather than falling back to English.
  
  - **Invoices left the engine and became that add-on's page.** Ninety-seven
    files, eight locale catalogues and the end-to-end specs moved out. **The
    documents did not move** — same rows, same meta table, same routes; only the
    screen that opens them arrives differently. A workspace with invoice rows has
    the add-on adopted for it on the first boot after upgrading, with nobody
    present and nothing to click.
  
  - **A page assistant that drafts in the page's own format.** The pages that
    build documents read the page you opened it from and the connection's
    readable tables through grant-checked tools, draft in that page's document
    format, and preview with that page's own renderer. It saves nothing until an
    operator enables actions and confirms, and the confirmation leaves an audit
    row.
  
  - **A project folder developers can open, edit and commit.** The generated app
    becomes a directory on disk you can put under version control, rather than
    something that only exists inside the instance.
  
  - **Designed create dialogs, column rules, filters and line items.** The create
    path across the product now matches the comps it was designed from.
  
  - **An installed app or add-on survives a deploy that empties the data
    directory.** On a container without a volume, every deploy used to lose every
    package that the image did not happen to bundle at exactly the installed
    version. When a storage destination is configured, Adminium now keeps a copy
    of each installed package there and stages it back at boot.
  
  Also in here: trusted proxies are configured explicitly rather than by hop
  count, email links resolve against a configured public origin, and a revoked
  role grant is no longer re-granted by the next boot's seed backfill.
  
  This is a release candidate. It publishes under the `next` dist-tag, so
  `npx @adminiumjs/adminium` still installs the stable line; reach it with
  `@adminiumjs/adminium@next`.

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
- 874cae3: **The invoices screen comes back, as the add-on's page.**
  
  0.2.12 removed the invoice manager and editor from Adminium and left nothing to
  replace them: the add-on it bundled was from before the page moved in, so an
  upgraded instance had no invoices screen and nothing to adopt. The documents
  were never touched, but there was no way to open them.
  
  The bundled set now carries the version that provides the page. On the first
  boot after upgrading, an instance whose invoice table has rows installs it
  once, unattended, and the rail row returns — under Library, where the add-on
  asks to sit. An instance that never authored an invoice installs nothing.
  
  If you are on 0.2.12, this is the release to move to.
- Updated dependencies [c451e7d]
  - @adminium/llm@0.3.0-rc.0
  - @adminium/meta@0.3.0-rc.0
  - @adminium/i18n@0.3.0-rc.0
  - @adminium/engine@0.3.0-rc.0
  - @adminium/adapter-mysql@0.3.0-rc.0
  - @adminium/adapter-postgres@0.3.0-rc.0
  - @adminium/adapter-sqlite@0.3.0-rc.0
  - @adminium/schema-import@0.3.0-rc.0
  - @adminium/add-on-contracts@0.3.0-rc.0
  - @adminium/manifest@0.3.0-rc.0

## 0.2.12

### Patch Changes

- 4441e0b: **The invoice manager and editor are an add-on's page now, not Adminium's.**

  Invoices were always meant to be an add-on. They were built into the engine
  because an add-on had no way to own a dashboard page: it could fill a slot
  inside someone else's screen, and that was all.

  Add-ons can own pages now. A page declares a `ref`, the client bundle that
  renders it, and where it would like to sit in the navigation — a built-in
  group, or one the add-on brings with it, so an add-on with several pages can
  keep them together. A page that names no group joins Library. The host mounts
  it at `/add-ons/<key>/<ref>`, gives it a rail row, and publishes the runtime
  it renders against.

  So the surface moved out — ninety-seven files, its eight locale catalogues and
  its end-to-end specs — and Adminium no longer ships an invoices screen of its
  own. **The documents did not move.** They are the same rows in the same meta
  table, read by the same routes; only the screen that opens them arrives
  differently.

  Workspaces already using invoices get the add-on adopted for them: on the
  first boot after upgrading, an instance whose invoice table has rows installs
  the bundled add-on once, with nobody present and nothing to click. An empty
  table installs nothing, and the adoption creates no schema.

  **Read this before upgrading.** The engine and the add-on ship from different
  repositories, and in this release the bundled add-on does not carry the page
  yet. So **0.2.12 has no invoices screen at all** — the adoption deliberately
  declines rather than install an add-on that cannot render anything, and your
  documents sit untouched until 0.3.0 bundles the add-on that provides it. If
  you use invoices, upgrade to 0.3.0 rather than stopping here.

- 8e50f36: **An installed app or add-on now survives a deploy that empties the data directory.**
  
  On DigitalOcean App Platform, or any container without a volume, every deploy
  starts with an empty `ADMINIUM_DATA_DIR`. The meta store remembers each
  install; the files do not survive. Until now the only packages that came back
  were the ones the image happens to bundle at exactly the installed version —
  so every app, every add-on you uploaded, and every add-on you had updated past
  the image's copy was gone, and had to be installed again by hand after every
  single deploy.
  
  When a storage destination is configured, Adminium now keeps a copy of each
  installed package there and stages it back at boot.
  
  **What the copy is.** `stage()` verifies a tarball, unpacks it and discards it,
  so by the time anything wants to keep a copy the bytes it arrived as are gone —
  for a package installed a moment ago as much as for one installed last year.
  The copy is therefore a repack of the staged tree, and its fingerprint is
  recorded per install (`adminium_manifests.package_integrity`, migration 0037).
  That fingerprint is of *our* repack, not of the publisher's tarball, so it is
  deliberately never compared with a catalog row or the release ledger: it
  answers only "are these the bytes this instance put there", which is the
  question the restore asks.
  
  **Where it lives.** An ordinary file row of the new kind `package`, which keeps
  it clear of the daily sweep — that collects unattached `upload` rows after 24
  hours, and a package copy is attached to no record by design. A copy written as
  an upload would have been deleted overnight and the loss discovered only by the
  redeploy it existed to survive.
  
  **A local destination is not a copy.** If the default destination is this
  server's own disk, nothing is written and nothing is recorded: that is the disk
  being emptied, and a fingerprint there would claim a package was protected by a
  copy that dies with the original.
  
  **Ordering.** The restore runs after the bundled seeds and before the add-on
  runtime is built and before the missing-package report — all three behind one
  promise. 0.2.9 built the runtime 60–90 ms ahead of the seed and the add-on
  stayed dark until an unrelated toggle; a restore landing after the runtime
  would be the same defect one step along, so `compose.ts`'s wiring is pinned in
  source and a two-boot test drives it for real.
  
  **Instances that predate this** become protected without reinstalling anything:
  the same boot pass uploads a copy of every installed package that does not
  already have one, and skips the ones that do.
  
  A package that still cannot be restored — no copy held, the destination
  unreachable, a fingerprint that does not match — is not silently ignored: the
  boot says which and why, and it continues to read as **Missing** in Studio.
- 5b84085: **An app or add-on whose files a redeploy wiped now says so, everywhere it is listed, instead of reading as installed and fine.**
  
  On a host with no persistent disk — App Platform, or any container without a
  volume — every deploy starts with an empty data directory. The meta store
  remembers each install; the files are gone. Until now the only place that was
  said out loud was the server log, which is not where anyone looks.
  
  Everywhere else it looked like nothing had happened, and on four different
  surfaces for three different reasons:
  
  - **Studio's installed-apps list** showed the app with its version and install
    date, because a lost app's only tell was an empty `sides` — which also means
    "this build ships no frontends".
  - **The installed add-ons list** was a pure read of the meta store and the
    credential table, and *both* outlive a wiped volume — so a gone add-on listed
    with its version, its slots, and a green **Connected** badge.
  - **Both browse shelves** are assembled from the packages on disk plus the last
    cached catalog feed. A lost package is in neither, so it was either labelled
    `installed` (when the feed happened to carry it) or **left out of the reply
    altogether** — which is every uploaded package, and every install with no
    cached feed. The meta store said installed and the page showed nothing at all.
  - **The app's own URL answered 200.** Nothing was mounted for it, so
    `/apps/<key>/staff/` fell through to the dashboard's SPA wildcard and got
    `index.html`, which then painted the dashboard's own 404. The request looked
    like it had succeeded.
  
  Now `GET /apps` and `GET /add-ons` carry `missing` per row, both catalogs have a
  `missing` state plus a pass over the meta store so an installed package can no
  longer vanish from its own list, and `/apps/<key>/…` answers **503
  `APP_FILES_MISSING`** with the coded envelope rather than a page that pretends.
  Studio marks every one with a badge and a line saying what to do; the browse
  shelf shows that badge *instead of* the green "Installed" it used to show. A
  missing add-on the catalog still carries offers its Download again, and one the
  feed does not carry says so instead of offering a button that cannot work.
  
  All of it now asks one question — `packageIsInStore` — where three call sites
  previously answered it three different ways, one of which ("does it contribute a
  surface") is not the same question: a package that is present but carries no
  `index.html` serves nothing while its bytes are right there, and reporting that
  as missing files sends the operator looking for the wrong problem.
  
  This is the honest-reporting half of the fix. Bringing the packages back by
  themselves — a copy in the storage destination, restored at boot — is separate
  and still to come; what changes here is that the loss stops being silent.
- Updated dependencies [e8f3d8f]
- Updated dependencies [8e50f36]
- Updated dependencies [5b84085]
  - @adminium/i18n@0.2.12
  - @adminium/meta@0.2.12
  - @adminium/engine@0.2.12
  - @adminium/llm@0.2.12
  - @adminium/adapter-mysql@0.2.12
  - @adminium/adapter-postgres@0.2.12
  - @adminium/adapter-sqlite@0.2.12
  - @adminium/schema-import@0.2.12
  - @adminium/add-on-contracts@0.2.12
  - @adminium/manifest@0.2.12

## 0.2.11

### Patch Changes

- b847dfc: **An add-on can own a page in the dashboard, and a row in the sidebar for it.**
  
  Until now an add-on could fill a slot inside somebody else's screen, and nothing
  more: the manifest schema refused `pages` outright, and the five sidebar groups
  were a closed set written out in five places. So a feature large enough to need
  its own screen had to be built into Adminium itself, whatever the plan said.
  
  An add-on's manifest may now declare `pages` — each one a module in its own
  bundle, with a title, an icon and where it belongs in the rail — and
  `navGroups`, if it would rather bring a group of its own than join one. A page
  that names no group lands in **Library**. Several pages of one add-on can sit
  together under a heading the add-on brought with it, and that heading carries
  its own label, so nothing in the engine has to know the words.
  
  The page itself runs as a page, not as an iframe with a border: the dashboard
  publishes its React, its UI kit, its router, its query client, its translations
  and its own helpers to the bundle, so the add-on renders inside the shell with
  one React, one cache and one history. The module is served over an
  authenticated route and pinned to the fingerprint recorded when the add-on was
  installed — a package edited on disk afterwards is refused rather than run.
  
  Every way this can fail says which one it is. Not installed, switched off, no
  page at that address, the package does not ship the file it names, the module
  would not load, the page itself threw: six sentences, six different answers, and
  a blank screen is not one of them.
- Updated dependencies [b847dfc]
  - @adminium/add-on-contracts@0.2.11
  - @adminium/manifest@0.2.11
  - @adminium/adapter-mysql@0.2.11
  - @adminium/adapter-postgres@0.2.11
  - @adminium/adapter-sqlite@0.2.11
  - @adminium/engine@0.2.11
  - @adminium/i18n@0.2.11
  - @adminium/llm@0.2.11
  - @adminium/meta@0.2.11
  - @adminium/schema-import@0.2.11

## 0.2.10

### Patch Changes

- 5152556: **A redeploy on a host with no disk no longer leaves bundled add-ons half-loaded, and it names what it lost.**
  On DigitalOcean App Platform, or any container without a volume, every deploy starts with an empty
  data directory. Checked on 0.2.9 with a Postgres meta store:
  
  - The image's bundled add-ons were copied back at boot, but 60 to 90 ms after the add-on runtime
    had already been built without them. So an installed bundled add-on with server code
    (Invoices & Receipts) stayed off until something else rebuilt the runtime, and
    `GET /documents/kinds` answered with an empty list. The runtime is now built after the copy
    finishes.
  - An app restored from `ADMINIUM_BUNDLED_APPS` was copied back after the list of served apps had
    been read, so it was not served. That list is now read again after the copy.
  - An installed package the build does not carry (an uploaded add-on, a version other than the
    bundled one, any app) cannot come back. Studio still listed it as installed and the boot said
    nothing. The boot now logs an error for each one, with its key and version and what to do.
  - Uploading the installed version of an add-on again, which is how its files are put back, now
    also reloads its server code. Before, it stayed off until the add-on was switched off and on.
- 5152556: **On an old Node, the CLI now says so instead of crashing.** On Node 21.5,
  `npx @adminiumjs/adminium` → "In your browser" printed `segmentation fault` and
  nothing else. The SQLite driver, better-sqlite3 13, ships binaries that need
  Node-API 10. Node has Node-API 10 from 22.14, or 23.6 on the 23 line. An older
  Node does not report an error when it loads one. It crashes. npm gave no
  warning first, because the package declared no Node version and
  better-sqlite3's own declaration says `>=22`.
  
  `adminium` now checks the Node version before it loads anything else. On an
  older Node it prints the version it found, the minimum (22.14) and how to
  upgrade, then exits with code 78. The package also declares
  `"engines": { "node": "^22.14.0 || >=23.6.0" }`, so npm warns at install time.
  The documented minimum is now Node.js 22.14 everywhere it is stated.
- 74d5351: **Three findings from the CodeQL backlog, fixed rather than dismissed.** Each was checked against
  the code before being acted on; the rest of the backlog is false positives in the same sweep and
  is being dismissed separately.
  
  - **A version string could burn a minute of CPU.** `EXACT_VERSION_PATTERN` gates which add-on and
    app versions the installer accepts from the catalogue. It repeated
    `[-+][0-9A-Za-z.-]+`, and because that class also contains `-`, `-a-b` could be one segment or
    two — so a version that fails to match backtracks through every split. `0.0.0+` followed by 24
    `--` pairs took **74 seconds** to reject, 22 pairs took 9.7 s and 18 took 207 ms: a clean
    doubling. The tail is now one optional group, which accepts exactly the same strings (checked
    against 119 of them) and rejects the payload in microseconds. The input path is the first-party
    catalogue over https, so this was not reachable by an ordinary caller — but it guarded the
    add-on supply chain with an exponential regex.
  
  - **A translation key could reach `Object.prototype`.** `nestBundle` splits a dotted key and
    assigns down the path, so a key containing `__proto__` wrote through to the prototype and gave
    every object in the process the property. Keys are not always ours: the runtime-translations
    feature stores them in the database, and this is an exported entry point of the package. Nodes
    are now prototype-less, so such a key round-trips as an ordinary own property instead of being
    dropped or escaping.
  
  - **The release rehearsal printed a real secret.** `rehearse-npx.mjs` prints a ready-to-copy
    command including `ADMINIUM_SECRET=`. With the variable unset that is a throwaway value
    generated for the run; with it set — and it is the production secret's own variable — the
    script echoed the operator's real secret to stdout, and from there into scrollback, a screen
    share or a pasted bug report. It now prints `$ADMINIUM_SECRET` when the value came from the
    environment, so the shell expands it and the secret never reaches the terminal.
  
  Both library fixes carry a test that fails against the old code: the version test rejects the
  backtracking payload under a time budget, and the bundle test asserts nothing outside the bundle
  changed.
- 1923ca6: **The decisions behind the architecture become public docs.**
  
  - **A new "Decisions" section** under Anatomy on docs.adminium.dev, with one short page per
    decision that is load-bearing across the codebase: pages are settings rather than generated
    code, one process with no Redis, the three connections and where the meta store lives, the
    add-on trust model, one version for every package, tokens only with no `style` props, the i18n
    rules, the LLM never writing on its own, project code being trusted, and one npm package. Each
    covers the situation the decision was made in, the decision, and what it means for a
    contributor — including what it costs, where it costs something.
  - **The comment rule that follows from it**, on the section's landing page: a comment says what
    the code does and why, and leaves the history to git and to these pages.
  - **Two stale counts fixed.** The anatomy pages said "twenty workspaces" and "fifteen packages";
    there are twenty-one and sixteen.
  - **A docs gate**, in `docs-contract.test.ts`: every page in the section must be linked from both
    the sidebar and the section's index, derived from the filesystem so a new page that nothing
    links is what goes red.
- 5152556: **A password-reset link can no longer be pointed at another site.** A reset
  email's link took its host from the request that asked for it: the `Origin`
  header when there was one, otherwise the request's scheme and `Host`.
  `POST /api/v1/auth/password/forgot` needs no sign-in. Anyone who knew a user's
  email address could send `Origin: https://their-site.example` and Adminium
  mailed that user a genuine reset email whose link, with a working token,
  pointed at the sender's site. One click handed over the account. Invitations
  (`POST /users`, including from an API key), test sends and `url` file
  references built their links the same way.
  
  Those links now use a new instance setting, **Address in email links**
  (`system.publicOrigin`), under Studio → Settings → Email. It fills itself in
  from the browser of an admin who can manage settings, the next time that admin
  finishes first-run setup, signs in or saves a change. It is never filled in
  from `localhost`, and a configuration bundle never carries it. The audit log
  records each time it is filled in. Until it is known, links use the host the
  request was sent to and never the `Origin` header, and `X-Forwarded-Host` still
  counts only from a trusted proxy. If Adminium's port can be reached without
  your proxy, set the address yourself: a direct caller chooses its own `Host`.
  
  `GET` and `PUT /api/v1/settings/email` gain `publicOrigin`. `PUT` refuses a
  value with a path, a query, credentials or a scheme other than http(s) with a
  422, and `null` clears it.
- 4e17715: **The frozen migration checksums now cover every released migration, not just the first ten.**
  `applyMigrations` re-hashes every applied migration on each boot and refuses to start on a
  mismatch, which makes the hash a wire format living in databases nobody here controls. Only
  0001–0010 were pinned, so the twenty-two migrations 0.2.x shipped had nothing guarding them:
  neither an edit to an already-released migration nor a change in tsc's emitted output would have
  been caught for any of them, and either one bricks the boot of every existing install.
  
  - **All 32 published migrations are pinned**, each value read out of the published
    `@adminiumjs/meta` tarball that first shipped it rather than from a local build — the tarball is
    the artifact that actually wrote those rows, whereas a local number only proves the tree agrees
    with itself. The blocks record which release froze which values (0.1.0, 0.2.1, 0.2.2, 0.2.3,
    0.2.6) and which later releases re-shipped them untouched.
  - **All thirteen published versions were unpacked and cross-checked**, prereleases included. Every
    migration hashes identically in every version that carries it, so the emitted output has been
    stable across the whole release history and no shipped migration has ever been edited. That also
    reproduces the ten existing values exactly, which is what shows the method is sound.
    `@adminiumjs/meta` stops being published once the CLI bundles its internal packages, so this
    captures the values while the tarballs are still fetchable, and the header records where the
    next row comes from instead: the same built file, vendored inside the flagship tarball.
  - **A fourth check**: unreleased migrations must sit after every published one, so a new migration
    slotted into the middle of a ledger installs have already run past goes red.
  - **The header now names a third failure that wears the same face.** A development meta store can
    hold migrations no release ever published, applied by whatever the tree looked like that day, and
    `MigrationChecksumDriftError` reads identically whether the cause is that or a real regression.
    One such store, kept while 0.2.x was in flight, carries 0015–0018 stamped `adminium_version`
    0.2.2 although the published 0.2.2 stopped at 0014, with 0018 the one whose source changed
    before release. The first thing to check on a drift error is whether the row's
    `adminium_version` is a release that actually shipped that migration.
- d95d39f: **`@adminiumjs/adminium` now installs as one package.** The CLI carries the eleven internal
  packages it loads inside its own tarball: engine, meta, i18n, llm, schema-import, manifest,
  add-on-contracts, widgets and the three database adapters. An install no longer downloads
  fourteen other `@adminiumjs/*` packages from the registry.
  
  The bundled copies have no dependency lists, and the CLI declares only the third-party libraries
  the server actually loads. So React, Radix, Leaflet, lucide-react, dnd-kit and TanStack Table,
  which the dashboard uses and ships pre-built, are no longer installed with it. A fresh install is
  about 170 packages and 150 MB, down from 245 packages and 220 MB.
  
  - `npm install --omit=optional` now really gives a SQLite-only install. Before, pg and mysql2
    always came in through the adapter packages.
  - The internal packages are no longer published. Their versions already on npm stay there for
    now. `@adminiumjs/public-client`, `@adminiumjs/manifest` and `@adminiumjs/add-on-contracts` are
    still published, for the repos that install them on their own.
- 86535d5: **Comments stop pointing at documents a reader cannot open.**
  
  - **A new gate**, `pnpm check-private-citations`, in `pnpm preflight` and in CI's `verify` job. It
    reads six forms — a plan document filename, a bare plan number with a section or decision, a
    bare section, a plan or milestone task id, a design comp file, a research annex — and holds
    every file with no baseline entry at zero, so new code cannot add one. A recorded count may
    only shrink, and progress has to be recorded, which is what stops it being given back.
  - **13,115 of 16,293 such references are gone**, across 1,679 of the 2,450 files that had one.
    Where the reference was provenance the sentence now stands on its own; where it was doing the
    work of a subject it was reworded. No behaviour changed: a rewrite is refused unless the file's
    compiled output is byte-identical before and after.
  - **The reasoning lives in public now**, one short page per decision under
    [/anatomy/decisions/](https://docs.adminium.dev/anatomy/decisions/), which is what a comment
    links to instead of carrying a backstory.
  - **A citation of something a reader can open spells the section out** — `AGPL section 13`, not
    the section sign, which is the glyph the gate reads.
  - **Two generated files were regenerated from fixed templates** rather than hand-edited:
    `packages/i18n/src/a11y-keys.ts` and the icon core and name list.
  
  **The strings a person actually reads went with them**: the two "not in this build yet" messages
  in all 8 locales (and the dashboard's inline fallbacks, which a gate holds character-identical to
  the bundle), the 31 widget-suggestion reasons Studio shows, the engine's generation notes, the
  three adapters' role hints and not-implemented message, and a handful of validation errors. Six
  lint rules now link the decision page instead of citing a document nobody has.
  
  **A third pass took the count from 3,210 to 1,493**, with non-code, markdown and user-visible
  strings all at zero: 658 test names (AST-precise, so only a test declaration's own name is
  touched), every CHANGELOG — each now carrying a note that its older entries were reworded — the
  CI workflows, CSS, HTML, ignore files and `package.json` prose, and the engine's classification
  reasons, which Studio shows a person to explain why a column was classified as it was.
  
  **The last 1,443 went by hand, and the surface is now 36 references in 10 files** — every one of
  them inside a migration `up`/`down` body, where the bytes are part of a checksum a deployed
  instance verifies at boot, so editing one would refuse to start. Those 36 are what the baseline
  records. The hand pass also repaired what the earlier sweeps had left mid-sentence: a preposition
  or an article against the next punctuation mark, two clauses welded together where the citation
  had joined them, 45 comp markers whose document name had been removed from around them, and
  three widget-suggestion reasons that lost a real descriptor (`team workload`, `shift scheduler`,
  `directory trigger`) along with the citation beside it.
- d95d39f: **Projects: the docs section.**
  
  - **A new "Projects" section** on docs.adminium.dev: creating a project, the folder and every
    `adminium.config.ts` field, page and schema files with the rules that keep the folder and a
    running server in step, `pull` and `check` (with a CI workflow), hooks and actions, pages and
    widgets, and deploying a project to Docker, Render, Fly.io, App Platform, Railway or a plain VPS.
    The two guides written earlier move from `/guides/projects/` into it.
  - **The quickstart is built around `adminium new`**, with `adminium try`, a plain `adminium start`
    and a source checkout as its later sections; the docs home, the intro page, both anatomy pages
    and the self-hosting overview say what a project is and where it fits.
  - **The project a `new` writes** links the deploy page from its README, and the in-app Knowledge
    Base's install article no longer describes only Docker and a source checkout (all 8 locales).
  - **The CLI reference** gains `adminium try --bridge` and `--log-level`, exit code 78, and the
    pinned-version examples name the release that ships project mode.
  - **Two docs gates**, in `docs-contract.test.ts`: the Projects section must be published and fully
    linked in the sidebar, and no page may tell anyone to run the unscoped `npx adminium`, which
    installs an unrelated package.
- d95d39f: **Projects: `adminium eject`.**
  
  - **`adminium eject <address>`** turns a page file into a page written in React: it writes
    `pages/<address>.tsx`, which holds the page file's settings as a constant and draws them with the
    UI kit's `GeneratedPage`, and deletes `pages/<address>.json`. It needs no database, and refuses a
    missing, invalid or turned-off page file, and a page that is already code.
  - **The page keeps its row.** When a page file is deleted and a page of code took its address,
    `adminium dev` (and a server at its next start, or when a conflict is settled for the project's
    copy) turns the page's row into the code's row instead of deleting it: same id, grants, saved
    views, database and data source. Whichever of the file sync and the page build sees the change
    first, the result is the same. Regeneration leaves the page alone.
  - **`GeneratedPage`** gives a config for its page's own table that page's record route and the
    person's add, change and delete permissions, as the generated page had. It uses the id of the page
    it is drawn in.
- d95d39f: **Projects: `adminium new` creates a folder you can open, edit and commit.**
  
  - **Creating a project.** `npx @adminiumjs/adminium new my-admin` creates `my-admin/` and installs
    it. The folder holds:
    - `adminium.config.ts`;
    - a `.env` with a generated secret;
    - an exact `@adminiumjs/adminium` dependency;
    - a Dockerfile that builds on the official image.
  
    `adminium new` with no name makes the current folder the project: it adds files and never
    changes existing ones. `--sample` creates a small demo SQLite database.
  - **Running it.**
    - `adminium dev` runs the project, and restarts it when `adminium.config.ts`, a file it
      imports, or `.env` changes.
    - `adminium build` compiles the config into `.adminium/build`.
    - `adminium start` runs a project from that build.
    - `adminium check` checks a project for CI and exits 2 when something is wrong.
  - **Databases.** The databases listed in `adminium.config.ts` are connected when the project
    starts, marked with their key (new meta migration `0033_connection_project_key`). Their pages
    are generated the first time they connect.
  - **The default command changed.** `adminium` with no command now creates a project; inside one,
    it lists the project's commands. The setup wizard moved to `adminium try`, and `adminium init`
    still runs it.
- d95d39f: **Projects: hooks and actions.**
  
  - **One write path.** Every insert, update and delete Adminium makes in a connected database now
    goes through one service: the data API (single rows, bulk and undo), the public API, automation
    steps and CSV imports. A test fails when a new direct write appears anywhere else. With no hooks,
    every path sends the same statements as before.
  - **Hooks.** A file in a project's `hooks/` (`export default defineHook({ … })`) runs before or
    after a record is created, changed or deleted. Before hooks may change the values or
    `reject(message)`, which fails the write with 422 and the hook's message everywhere, including
    bulk edits, CSV imports (in the error report) and the public API (the new code
    `PUBLIC_WRITE_REJECTED`). After hooks run once the change is saved; their errors are logged and
    shown in Studio. Imports run after hooks only for hooks that set `onImport`. Writes a hook makes
    through `db` run hooks too, and a chain deeper than three is stopped.
  - **Actions.** A file in `actions/` (`export default defineAction({ … })`) adds a button to the
    record page, each row's Actions menu and, with `bulk`, the bulk bar. `GET /api/v1/project/actions`
    lists the ones the caller may run, and `POST /api/v1/project/actions/:id` runs one with the
    person's permission, a time limit and a `project.action` audit entry.
  - **The `db` helper** gives project code `table(name).get/list/insert/update/delete`, which run
    hooks, audit and automations, and `raw` Kysely, which skips them.
  - **Build and reload.** `adminium build` bundles hooks and actions into `.adminium/build/server/`
    with their npm packages. `adminium dev` rebuilds them on save and the server swaps them in
    without a restart. `adminium check` loads them. The desktop app and `adminium try` never load
    project code.
  - **Studio → Settings → Project** (super admins, `GET /api/v1/project/overview`) shows the project
    folder, the loaded hooks and actions, files that did not load, hook errors, and pages changed on
    the server.
  - **`@adminium/widgets`:** `PageCrud` takes `bulkActions`, placed between Export and Delete.
  - **Automation run origins** gain `hook` and `action`.
- d95d39f: **Projects: pages and schema customizations are files.**
  
  - **The files.** A project keeps each page in `pages/<address>.json` and each database's
    customizations in `schema/<database>.json`. Files name databases by their key in
    `adminium.config.ts`, never by an id, so the same files work on every install. Each points at a
    JSON Schema the package ships (`schemas/`), so editors can complete them.
  - **In `adminium dev`** the files are the master copy. A saved file is applied at once without a
    restart. A Studio edit is written back to its file. A file with a mistake is reported with its
    field and not applied.
  - **On a server** (`adminium start` in a project, or its Docker image), deployed files are applied
    at start. A page edited in Studio there is kept and marked "changed on server". Studio → Pages
    shows the command that pulls it, and settles a page changed on both sides.
  - **`adminium pull`** writes the files from the project's database.
    `adminium pull --from <url>` writes the pages a server changed (`GET /api/v1/project/export`,
    with an `ADMINIUM_API_KEY` whose role has the new `system:project:read`, which Admin gets).
  - **`adminium check`** validates every page and schema file with no database.
  - **`adminium new`** in a folder that already holds an instance (or with
    `--import <folder>`) makes its connections the project's databases and writes its pages as files.
  - **New meta migration** `0034_project_files`.
- d95d39f: **Projects: pages and widgets written in React.**
  
  - **Pages.** A project's `pages/<address>.tsx` (`export default definePage({ title, icon, nav,
    component })`) is a page at `/p/<address>`, with a place in the sidebar and the same view grants
    as any page. The server keeps a page row for it (origin `project`); Studio lists it as project
    code and refuses to edit it. A page file and a React page cannot share an address.
  - **Widgets.** `widgets/<name>.tsx` (`defineWidget({ kind: 'cell' | 'card', component })`) is
    `project.<name>`: a page file names it on a table column (`"widget"`) or a dashboard layout item.
    A cell that cannot be drawn shows the plain value with a warning mark; a card that does not load
    shows the widget error state. `adminium check` fails on a widget name that does not exist, or a
    card where a cell goes.
  - **The UI kit**, `@adminiumjs/adminium/ui`: `Page`, `Card`, `Stack`, `Grid`, `Button`, `Input`,
    `Select`, `Switch`, `DataTable`, `Stat`, `EmptyState`, `Icon`, `Link`, `GeneratedPage`, `toast`,
    and the hooks `useRecords`, `useRecord`, `useMutation`, `useCurrentUser` and `useNavigate`. They
    are the dashboard's own components, and the data hooks go through the data API as the person
    looking.
  - **One React.** The dashboard publishes its React, JSX runtime, `react-dom` and the kit on
    `globalThis.__ADMINIUM_ADD_ON_RUNTIME__` (`@adminium/add-on-contracts/runtime`), and a project's
    bundles read them from there, so hooks and context work across project code and the kit.
  - **Build and serve.** `adminium build` bundles pages and widgets for the browser into
    `.adminium/build/client/`, with hashed file names; the server serves them to signed-in people at
    `GET /api/v1/project/client/*`, checks each file against the build before sending it, and lists
    them in `GET /api/v1/bootstrap` (`project.client`) with their integrity. `adminium dev` rebuilds
    them on save, and open dashboards load the new files.
  - **Studio → Settings → Project** lists the project's pages and widgets.
  - **Dashboard:** a page template whose code does not load shows the error card with a Retry
    instead of a skeleton that never ends. The built-in template loaders are a chunk of their own,
    which takes 2.1 KiB gz off the first load. What the dashboard says about a project's code is a
    new, lazily loaded `project` message namespace.
  - **`@adminium/widgets`:** table columns take a `widget`, drawn through `CustomCellProvider`; a
    host app's own card widgets resolve through `ExternalWidgetsProvider`, after the registry.
  - **The project Dockerfile** copies the whole project folder, without `node_modules`, so `start`
    can tell the build is current.
- c0096c0: **A fresh clone runs the admin panel in three commands.**
  
  - **`corepack enable`, `pnpm install`, `pnpm dev`** — and nothing else. `pnpm dev` now runs
    `scripts/dev-setup.mjs` first, which writes a `.env` with an `ADMINIUM_SECRET` (generated once
    and **never** regenerated, because it derives the key that encrypts every stored DSN) and builds
    `.dev/sample.db` from the desktop app's demo company, pointing `ADMINIUM_SOURCE_URL` at it. The
    first boot then connects a database and generates pages instead of opening an empty panel. A
    source you configured yourself, in `.env` or in the shell, is never overridden, and a step that
    cannot run is reported and skipped rather than failing the command.
  - **No separate build step**: `turbo run dev` gains `dependsOn: ["^build"]`.
  - **`CONTRIBUTING.md`, the README and the docs contributing page** are rewritten around those
    three commands, with the comment rule ("say what the code does and why, and leave the history to
    git") and a pointer to the public decision pages. The package maps gain the two workspaces they
    had been missing, `add-on-contracts` and `public-client`.
  - **`pnpm dev-setup --print`** says what the setup step would do without doing it.
- 5152556: **`ADMINIUM_TRUST_PROXY=on` works again on npm installs.** Since Fastify 5.12.1
  (18 August), a fresh `npm install @adminiumjs/adminium` ignored the proxy
  completely. Checked on 0.2.5 behind Caddy: the audit log recorded every request
  as coming from `127.0.0.1`, the session cookie was set over HTTPS without
  `Secure`, and everyone behind the proxy shared one login rate limit. Adminium
  told Fastify to trust "one hop". Fastify 5.12.1 stopped honouring hop counts,
  because a hop count cannot tell the proxy from a client that connects directly
  (GHSA-3m5p-2c4r-xxw2). The Docker image kept working because its lockfile still
  had Fastify 5.12.0. On that version a client that could reach the port directly
  could set its own address, scheme and host.
  
  A connection now counts as the proxy only when it comes from a trusted address,
  and Adminium takes only the address that proxy added to `X-Forwarded-For`. The
  new `ADMINIUM_TRUSTED_PROXIES` lists those addresses. The default,
  `loopback,uniquelocal`, covers a proxy on the same host and one on a Docker or
  other private network. Set it to your proxy's address to trust nothing else.
  From any other address, `X-Forwarded-For`, `X-Forwarded-Proto`,
  `X-Forwarded-Host` and `X-Request-Id` are ignored. A bad entry, or a list set
  while `ADMINIUM_TRUST_PROXY` is off, stops the boot and says why. The desktop app
  removes the variable from the environment it starts the server with, as it
  already does for `ADMINIUM_TRUST_PROXY`.
  
  Fastify is now 5.12.5, and npm installs get at least that. It also brings the
  fixes for GHSA-w2qp-rph6-63g4 and the 5.12.2 and 5.12.5 security releases.
  `@fastify/proxy-addr` is at least 5.1.1 (GHSA-jqcg-44mw-7w3h).
  
  The nginx example in the reverse-proxy guide now sets `X-Forwarded-Host`.
  Without that line, nginx passes on whatever the client sent.
- Updated dependencies [74d5351]
- Updated dependencies [372a4a2]
- Updated dependencies [86535d5]
- Updated dependencies [d95d39f]
- Updated dependencies [d95d39f]
- Updated dependencies [d95d39f]
- Updated dependencies [d95d39f]
- Updated dependencies [d95d39f]
  - @adminium/i18n@0.2.10
  - @adminium/engine@0.2.10
  - @adminium/meta@0.2.10
  - @adminium/add-on-contracts@0.2.10
  - @adminium/llm@0.2.10
  - @adminium/adapter-mysql@0.2.10
  - @adminium/adapter-postgres@0.2.10
  - @adminium/adapter-sqlite@0.2.10
  - @adminium/schema-import@0.2.10
  - @adminium/manifest@0.2.10

## 0.2.9

### Patch Changes

- ad014d7: **Add-ons download from downloads.adminium.dev instead of the npm registry.**
  With browsing online switched on, the catalog comes from
  `https://adminium.dev/marketplace/v2/catalog.json`, and each add-on from
  `https://downloads.adminium.dev/add-ons/<key>/<key>-<version>.tgz`. The server
  builds that address itself from the catalog's key and exact version, and the
  downloaded bytes must still match the sha512 the release recorded before
  anything is unpacked. `registry.npmjs.org` is no longer contacted. Browsing
  online stays off by default, and `ADMINIUM_NETWORK_FEATURES=off` and the
  desktop app's air-gap mode still veto it.
  
  After upgrading, refresh the catalog once. A catalog cached by an earlier
  version is in the old format, so until the refresh the Add-ons page lists only
  what is already on disk, and a download asks for the refresh.
  
  The bundled add-ons in the Docker image and the desktop app are fetched from
  the same host when they are built, against the same pinned hashes.
  
  The sideload card and the app upload step now point to the sha512 fingerprint
  published with each release, instead of `npm pack --json`.
  
  If you filter the audit log: a finished download records `source: 'download'`
  (it was `'npm'`), a download whose bytes do not match is recorded as
  `add-on.verify-refused` (the same action as a refused upload), and download
  failures carry the reasons `TARBALL_NOT_FOUND` and `DOWNLOAD_ADDRESS_MISMATCH`.
  `PACKUMENT_UNREACHABLE`, `VERSION_NOT_PUBLISHED`, `LEDGER_MISMATCH` and
  `FOREIGN_TARBALL_HOST` no longer occur.
- 962671c: **Hosted apps can browse, download and update from the online app catalogue.**
  *Studio → Hosted apps* now lists released apps beside the ones your build
  shipped and the ones you uploaded. Installing one downloads it from
  `https://downloads.adminium.dev/apps/<key>/<key>-<version>.tgz`, checks the
  bytes against the fingerprint the release recorded, unpacks it under the same
  hardened limits as an upload, and then opens the usual install wizard — nothing
  is created in your database until you confirm the schema plan.
  
  Browsing online is **its own switch**, `apps.catalogEnabled`, separate from the
  add-on one and **off by default**: a deployment may want apps listed online and
  add-ons not, or the reverse. `ADMINIUM_NETWORK_FEATURES=off` and the desktop
  app's air-gap mode veto it exactly as they veto the add-on catalogue, and with
  it off nothing from a cached list is offered at all. Browsing stays a disk read;
  **Check for newer** is the separate, explicit action that fetches
  `https://adminium.dev/marketplace/v2/apps.json`.
  
  **Installed apps can be updated.** A newer version — already on disk, or offered
  by the catalogue — puts Update on the app's row. New tables are shown to you as
  DDL before they are created, in the database the app already uses; a table that
  exists but is missing columns the new version needs refuses the update and names
  them; nothing is altered or dropped. The app keeps its row, its connection and
  its mounts, and older versions are removed from disk only after the update
  succeeds.
  
  Every released app declares the oldest Adminium it runs on. A release that needs
  a newer one is listed with the version it needs and cannot be installed, rather
  than being hidden.
  
  New endpoints, all behind `manifests.manage`: `PUT /api/v1/apps/catalog`,
  `POST /api/v1/apps/catalog/refresh`, `POST /api/v1/apps/download` and
  `POST /api/v1/apps/{key}/update`. `GET /api/v1/apps/catalog` keeps its shape and
  gains `source`, `state`, `updateTo`, `updateStaged` and `needsNewerAdminium` per
  row, plus `onlineEnabled` and `catalogFetchedAt`. Audit actions:
  `app.catalog-toggled`, `app.catalog-refreshed`, `app.catalog-refresh-failed`,
  `app.staged` (with `source: 'download'`), `app.verify-refused`,
  `app.download-failed` and `app.updated`.
- 4cba736: **The bundled add-on set moves to 1.0.1, and gains Invoices.** The Docker image
  and the desktop app now bake in seven add-ons instead of six — barcode-labels,
  design-studio, holiday-calendars, import-canva, **invoices**, personalizer and
  shipping-dhl — fetched at build time from `downloads.adminium.dev` against the
  fingerprints the release recorded.
  
  Each of these releases also states the oldest Adminium it runs on truthfully;
  the 1.0.0 files all claimed `1.0.0`, which no released server has ever been.
  Nothing enforces that claim for add-ons yet, but the shipped set no longer lies
  about it.
- ad014d7: **Hosted apps can show pictures stored on another host.** A new
  `ADMINIUM_CSP_IMG_HOSTS` variable names extra origins the Content-Security-Policy
  allows images from, for example `https://images.example.com`.
  
  Adminium sends one policy on everything it serves, and it allowed pictures only
  from Adminium itself and the map tiles its map widgets draw. Hosted app surfaces
  are served under that same policy, so an app whose data links images kept
  elsewhere showed broken pictures. The point-of-sale menu, whose `image_url`
  column points at a CDN, rendered every tile as a broken image, while the same
  build outside Adminium showed them.
  
  The hosts are appended to `img-src` and nothing else in the policy changes.
  Unset, the header is exactly what it was. Each entry must be a scheme and a
  host, with an optional port and a leading `*.` for subdomains. A bare `*`, a
  scheme on its own, a path, or a wildcard over a whole top-level domain stops the
  boot with every refused value named. Either of the first two would let any
  script that lands on the instance send data anywhere as an image request.
- Updated dependencies [ad014d7]
- Updated dependencies [962671c]
  - @adminium/i18n@0.2.9
  - @adminium/meta@0.2.9
  - @adminium/engine@0.2.9
  - @adminium/llm@0.2.9
  - @adminium/adapter-mysql@0.2.9
  - @adminium/adapter-postgres@0.2.9
  - @adminium/adapter-sqlite@0.2.9
  - @adminium/schema-import@0.2.9
  - @adminium/add-on-contracts@0.2.9
  - @adminium/manifest@0.2.9

## 0.2.8

### Patch Changes

- 7b0e544: **Settings → Translations keeps every accessible name it can find.** The server
  refuses to save an empty translation for a string that is a control's accessible
  name, such as an icon-only button's label, a field's label or a tooltip. The
  list of those strings had fallen behind the screens. It held 1,294 keys and
  missed, among others, the app install wizard's labels and the onboarding
  wizard's show-password toggle, so those could be blanked, leaving a control with
  no name.
  
  The list is now built by parsing the source instead of matching two patterns, so
  it also finds a key that reaches a name through a condition, a `??` fallback, a
  translator imported under another name, or a field descriptor. It holds 2,402
  keys. Those strings can still be translated. They just cannot be left empty.
- 3d627e5: **Uploading an add-on asks only for the file and its hash.** The "Upload a
  package" card on Studio → Add-ons used to ask for the add-on key and version as
  well. The server staged the package under whatever was typed, and nothing
  checked the typed key against the manifest. A key that did not match installed
  without complaint and then served no bundle, because an add-on's bundle URLs
  are built from its manifest's key.
  
  The server now reads the key and version from the package's `manifest.json`,
  which is inside the bytes the integrity value verifies. The card shows what it
  read ("Uploaded Holiday Calendars 1.0.0 · Install it from the list above") and
  clears the file and hash for the next package. The hash is still required, and
  still has to come from somewhere other than the file itself, such as
  `npm pack --json`.
  
  The upload now runs the full manifest validator. A manifest that does not
  validate, one from a publisher other than Adminium, or an app's manifest is
  refused on the card instead of after the package is staged. Refusals say what
  was wrong: no `manifest.json`, an integrity value that does not match, or an
  archive that cannot be read (with its reason code).
  
  `POST /api/v1/add-ons/upload`: `key` and `version` are now optional. A caller
  that still sends them has them checked against the manifest, and a mismatch is
  refused with `KEY_MISMATCH` or `VERSION_MISMATCH` before anything is written.
  The reply gains `name`.
- d1d11d4: **Micro-SaaS apps install on Postgres and MySQL.** Reported against 0.2.7:
  installing online-ordering, clinic-desk or hotel-reservations failed at the
  database step with
  
      creating "menu_items" failed: error: foreign key constraint
      "fk_menu_items_category_id" cannot be implemented
  
  The installer created every foreign-key column as `varchar(36)`, the type of an
  `id` key. Every add-on keys its tables with `id`, so add-ons installed fine. The
  apps key theirs with `int` (and hotel-reservations also with `text`), and
  Postgres and MySQL both refuse a foreign key whose column type differs from the
  key it references. SQLite does not check this, which is why the tests passed.
  All five published apps failed on both server engines. Only three were tried.
  
  A foreign-key column now takes its target's key type: the declared type when the
  install creates that table, and the live database type when the table already
  exists. On MySQL, a `text` primary key, and any foreign key that points at one,
  is now `varchar(255)`. MySQL cannot index a `TEXT` column without a prefix length,
  so hotel-reservations' `room_types` would otherwise fail on MySQL even with the
  foreign keys fixed.
  
  A failed install already leaves nothing to clean up. Tables it created before
  the error are skipped on retry, so installing the app again completes it.
- 3d627e5: **Uploading an app asks only for the file.** The install wizard's bundle step
  used to ask for the app key and version. The server staged the bundle under
  whatever was typed, and a key that did not match the bundle's manifest uploaded
  fine, then failed on the next step:
  
      The bundle was uploaded as "clinicx" but its manifest declares "clinic".
  
  The bundle already says which app it is, so the server now reads the key and
  version from its `manifest.json` during the upload and returns them with the
  app's name. The wizard's later steps use what the server returned. Stepping back
  after an upload shows the app it read ("Install Clinic Desk · 0.1.1"), with an
  option to upload a different bundle. The optional integrity field stays.
  
  A manifest that does not validate, or that belongs to an add-on, is now refused
  on the bundle step, where the file was chosen. Both used to be staged and then
  refused at the plan step. Refusals at upload also say what was wrong: no
  `manifest.json`, an integrity value that does not match, or an archive that
  cannot be read (with its reason code), where they used to say only "The
  uploaded bundle was refused."
  
  `POST /api/v1/apps/upload`: `key` and `version` are now optional. A caller that
  still sends them has them checked against the manifest, and a mismatch is
  refused with `KEY_MISMATCH` or `VERSION_MISMATCH` before anything is written.
  The reply gains `name`.
- Updated dependencies [7b0e544]
- Updated dependencies [3d627e5]
- Updated dependencies [3d627e5]
  - @adminium/i18n@0.2.8
  - @adminium/engine@0.2.8
  - @adminium/llm@0.2.8
  - @adminium/adapter-mysql@0.2.8
  - @adminium/adapter-postgres@0.2.8
  - @adminium/adapter-sqlite@0.2.8
  - @adminium/schema-import@0.2.8
  - @adminium/add-on-contracts@0.2.8
  - @adminium/manifest@0.2.8
  - @adminium/meta@0.2.8

## 0.2.7

### Patch Changes

- 5445805: **A dropped Postgres connection no longer takes the server down.** Reported
  against 0.2.6: onboarding moved the meta store onto a remote Postgres, and a
  while later the process died with
  
      Error: read EADDRNOTAVAIL
      Emitted 'error' event on BoundPool instance at: Client.idleListener
  
  `pg` reports a connection that dies as an `'error'` event, and an `'error'`
  event with no listener is an uncaught exception, so the process exits. Anything
  that ends a connection can trigger it: a laptop's network changing (macOS raises
  EADDRNOTAVAIL), a provider's idle cutoff, a failover, `pg_terminate_backend`.
  Which emitter reports the death depends on where the client was:
  
  - **idle in the pool**: the pool emits. The meta store's pool had no listener at
    all, and this was the reported crash. The data pool that reads rows already
    had one.
  - **checked out**: the client itself emits. pg-pool detaches its own listener
    for the checkout and kysely never attaches one, so a connection lost under a
    running statement, inside a transaction, or handed out again before the pool
    noticed crashed the process through **both** pools. The meta store holds a
    client for a whole migration pass and for a relocation's copy.
  
  Both pools now listen on the pool and on every client. A statement that was
  running still rejects with the error, where it is reported, and the next checkout
  opens a fresh connection. MySQL is unaffected: every `mysql2` pool connection
  already listens for its own errors.
- Updated dependencies [5445805]
  - @adminium/adapter-postgres@0.2.7
  - @adminium/adapter-mysql@0.2.7
  - @adminium/adapter-sqlite@0.2.7
  - @adminium/add-on-contracts@0.2.7
  - @adminium/engine@0.2.7
  - @adminium/i18n@0.2.7
  - @adminium/llm@0.2.7
  - @adminium/manifest@0.2.7
  - @adminium/meta@0.2.7
  - @adminium/schema-import@0.2.7

## 0.2.6

### Patch Changes

- ce438a0: Browsing add-ons is a browse surface now, not a list of slugs.
  
  **Two defects, both in the catalog projection.** The browse route derived a
  catalog row's name as `entry.name['en_US']`, but the feed keys rows `en`, `de`,
  `zh-cn` — `en_US` has never been present, so the fallback fired every time and
  every online add-on was labelled with its own slug (`barcode-labels`, not
  `Barcode Labels`). Fixing that one key would still have thrown away the seven
  other translations the feed already carries, so the row is now resolved against
  the caller's locale: exact tag, then the normalised tag (`zh_CN` → `zh-cn`, the
  leg without which both Chinese locales silently render English), then the
  language subtag, then `en`.
  
  **The reply carries what the cache already held.** `categories`, `tagline` and
  `connectKind` were parsed from the feed, cached to disk, and then projected away.
  They are now in the DTO, so the page can show what an add-on is and whether
  installing will ask for a credential — the one permission-shaped fact on a card,
  with everything else about an add-on's reach left to the install plan, which is
  the security surface.
  
  **The page is the comp again.** draws a category rail with per-category counts, a
  search box and a card grid; the shipped page rendered a flat list of names. The
  browse half moves to its own component and gains all three, plus distinct empty
  states for "this build shipped none", "nothing matched your filter" and "the
  catalog is on but found nothing".
  
  Browsing remains a disk read: no page load, category click or search makes an
  outbound request.
- f73fffc: Three message groups leave the eagerly bundled `common` catalogue: `dataio`
  (the import wizard, exports manager and export builder), `files` (the Files
  library and its upload dialog), and `email`. All three are deferred namespaces
  now, fetched by the surface that owns them.
  
  `common` ships in every user's first load, so a key living there is paid for on
  every route by every user no matter how lazy its surface is. 422 keys had
  collected there that no first paint can render — and 143 of them are `email`
  keys whose every call site is in the server's email-template machinery, i.e.
  text a browser can never display.
  
  **Operators with customised translations:** meta migration `0029` re-files
  overrides written against the old `common:dataio.*` / `files.*` / `email.*`
  addresses. Three keys did not move — two page titles that a statically imported
  route factory reads, and the page-files template's upload hint — so overrides on
  those are COPIED to the twin they now resolve through (`common:nav.imports`,
  `common:nav.exports`, `ui:templates.files.uploadsUnavailable`) rather than only
  moved.
  
  Server-rendered email also needed `createServerI18n` to load the deferred set
  explicitly. Without it every non-English recipient would have silently received
  English — silently, because each call site supplies its own English default, so
  there is no missing-key error to notice.
- f2fd258: Email templates become email documents (WS-A/WS-B). Migration 0026 gives
  `adminium_email_templates` a kind (template | campaign), a category, a fixed footer, a
  preheader, a per-document brand, attachments, archiving and starter provenance, and
  adds `adminium_email_blocks` (saved sections) and `adminium_email_runs` (campaign
  runs). The renderer speaks the comp's 24 block types, draws the brand banner and the
  envelope footer, and references the brand mark and Files images by CID; delivery reads
  attachment bytes from the file store right before `sendMail` and fails loudly on a
  missing file. Twelve localizable starters ship behind `GET /email-templates/starters`.
  
  Routes: `PUT /email-templates/:key/:locale` and `POST /email-templates/:key/test-send`
  are retired — the editor saves explicitly through `PUT /email-templates/:id`,
  and a test send carries the on-screen document (`POST /email-templates/:id/test-send`,
  up to ten recipients). New: create (blank or from a starter), duplicate, add a
  language variation, start a campaign from a template, archive/restore, delete
  (a built-in resets instead), export/import of a JSON bundle, and saved blocks
  under `/email-blocks`. Settings gain `email.senders` and
  `email.maxAttachmentBytes`.
  
  Campaigns, phase 1: `POST /email-templates/:id/send` (workspace users, optional
  roles, now or scheduled) creates an `adminium_email_runs` row and one
  `email.campaign-run` job; `POST /email-templates/:id/audience/preview` counts
  recipients and opt-outs; `GET /email-templates/:id/runs` lists a campaign's
  runs; `POST /email-runs/:id/cancel` cancels a scheduled run or cooperatively
  stops a running one. The `email.campaign` notification kind is the opt-out;
  `email.campaign.sent` tells the creator how many were sent and failed.
  
  Dashboard: the Email templates manager is rebuilt to the design (WS-C):
  Templates/Campaigns trays with counts, group by topic or language, gallery and list
  layouts remembered per browser, the actions menu (import, senders, export, settings,
  archived), inline rename, duplicate and delete with Undo, archived mode with restore
  / delete for good / reset to built-in, the New modal with the twelve starters and
  *Your templates* for campaigns, and the import modal. The old autosaving page under
  `pages/builders` is gone; the editor route (`/email-templates/:id`) shows the
  document's facts until the new editor lands.
  
  The Email templates surface's messages move to a deferred `email` namespace
  (`DEFERRED_NAMESPACES`), loaded by its two routes like the studio's: the
  strings no longer ship in every user's entry chunk. `GET /i18n/bundle/:locale/email`
  serves it; the overrides budget counts it.
  
  The editor (39 WS-D/WS-E): a live canvas of the 24 block kinds plus the two
  legacy ones, inline subject and preheader, the inspector's Sections and Design
  tabs (five panels, a rows editor, eight style axes, saved blocks), explicit save
  with `Ctrl/⌘+S`, sixty steps of undo, a discard-changes guard, language
  variations with the mirror question for structural edits, the image picker
  (workspace files, upload with the connection rule, https URLs), workspace
  documents as attachments, test sends of the on-screen document to several
  addresses, and — for a campaign — *Send campaign* (workspace users by role,
  now or scheduled, the live recipient count), the *Scheduled · time* / *Sending
  · N %* chip with an explicit cancel, and live progress on the run's job channel.
  Every string of the surface, the twelve starters and the blank copy are in all
  eight languages. Two guides (`guides/email/`, `guides/email/campaigns/`) document
  templates, campaigns, attachments, senders, opt-out and what is not tracked.
- a828566: **The public surface can generate a value.** A scope resource's `defaults` may
  now carry `{"$generate": "uuid"}` or `{"$generate": "now"}`, resolved
  server-side per request.
  
  Nothing on the public create path generated anything before: add-on DDL emits no
  column defaults, `insertRow` writes what it is handed, and scope `defaults` were
  static JSON — so every add-on table row in existence was written by an add-on's
  server half. An anonymous visitor could not create a row at all, and both ways
  round it are refusals: a writable primary key is a compile error, and browser
  code may not reach `crypto`. This is the smallest primitive that closes it, and
  it is general — every app whose intent rows sit on an `id`-typed table needs
  exactly this, and `created_at` needs it too.
  
  `compileScope` refuses a sentinel that is malformed, names an unknown generator,
  or sits on a column the same resource lists `writable` — a generated value
  exists precisely because the caller may not choose it, and a document that says
  both is a contradiction a reader can resolve two ways. It also now checks
  `defaults` against the schema snapshot, which was the one list it never did.
  
  Two fixes travel with it, both owed with or without any add-on:
  
  - **A public write is published to the widget-data stream.** `routes/data` has
    fanned every write out to `widget-data:<connection>:<table>` since the widget
    registry shipped; the public routes published nothing, so a dashboard page
    bound to a table a customer can write to learned about that write only on its
    next refetch. The row is masked by the same publisher as every other frame on
    that channel.
  - **The sentinels resolve on create and are dropped on update.** `defaults` are
    applied on both paths, which is harmless for a literal and a data-loss bug for
    a generated one: a visitor patching their own row would have been handed a
    fresh primary key each time.
  
  Both generators round-trip on postgres, mysql and sqlite. The instant is
  formatted per dialect — MySQL's `datetime` refuses the ISO form the other two
  want, and no single JavaScript value satisfies all three drivers.
- cb398f1: The Report builder ships at `/report-builder`: a two-collection manager
  plus a block editor, over a new envelope — a report is a header (kicker · title ·
  subtitle) plus an ORDERED ARRAY of self-contained blocks, each with its own title,
  width and visibility, drawn from a palette of 25 kinds. Migration 0030 adds
  `adminium_report_documents` (prefix `rpt`): one table, two kinds (template |
  report), the comp's three-value status (draft | sent | live), a starter key, a
  soft `origin_id`, the manager's `position` and a denormalised `summary`.
  
  Not Scheduled Reports. That surface keeps `/reports`, its `reports.*` keys, the
  `rep` prefix and `system:reports:manage`; this one is `/report-builder`, the
  `reportBuilder` namespace, `adminium_report_documents` and
  `/api/v1/report-documents`, and its writes ride `system:settings:manage` like
  the other two document surfaces. No permission key is added.
  
  Server: nine routes in the invoice surface's shape — list with unfiltered tab
  counts, the twelve starters, detail, create (blank or from a starter), the
  explicit `PUT` save that re-derives the summary, inline rename, duplicate,
  delete, and `POST /:id/from-template`, which copies a template's body into a
  new report and records its origin. The envelope decodes leniently and holds
  both inline-image slots to the existing caps; a block of an unknown kind
  becomes a labelled placeholder rather than a card nobody can explain.
  
  Dashboard: the manager (Templates/Reports trays with counts that ignore the
  search box, client-side search over name · title · kicker, gallery and list
  layouts remembered per browser, four empty states, inline rename, duplicate
  with Undo, delete behind a confirm, the New modal with twelve starters and
  *Your templates* for reports) and the editor (the 25-kind palette, the always-
  light sheet with its background image and tint, the block stack with drag and a
  keyboard reorder, half-width blocks, the *Show in export* flag, an inspector
  whose 25 field groups each carry Width · Show · Delete, explicit save with
  `Ctrl/⌘+S`, sixty steps of undo and a discard guard). A template's primary
  saves; a report's *Publish* saves and marks the row Published. Below `lg` the
  inspector becomes a drawer and the palette an *Add block* sheet.
  
  Two gaps in the design are filled with its own patterns: the image block gains
  the background's Upload / Replace / Remove row, and a KPI metric gains the
  *Delta* field that makes its rendered delta reachable. Two of the design's own
  defects are corrected: the block label/glyph pair is a record with named fields
  (the pair ships swapped for four kinds), and a card's glyph rides its row
  rather than a title match, so renaming a report never changes its icon.
  
  Every string of the surface, the twelve starters and the seeded block content
  are in all eight languages, in a deferred `reportBuilder` namespace loaded by
  its two routes — the strings never ship in a user's entry chunk.
- Updated dependencies [ce438a0]
- Updated dependencies [ce438a0]
- Updated dependencies [ab6314e]
- Updated dependencies [9f47a62]
- Updated dependencies [f73fffc]
- Updated dependencies [8fb86bf]
- Updated dependencies [f2fd258]
- Updated dependencies [8fb86bf]
- Updated dependencies [3a38695]
- Updated dependencies [65f69df]
- Updated dependencies [cb398f1]
- Updated dependencies [ce438a0]
  - @adminium/i18n@0.2.6
  - @adminium/add-on-contracts@0.2.6
  - @adminium/meta@0.2.6
  - @adminium/manifest@0.2.6
  - @adminium/adapter-postgres@0.2.6
  - @adminium/engine@0.2.6
  - @adminium/llm@0.2.6
  - @adminium/adapter-mysql@0.2.6
  - @adminium/adapter-sqlite@0.2.6
  - @adminium/schema-import@0.2.6

## 0.2.5

### Patch Changes

- c5afd13: No functional change — a re-cut of v0.2.4, whose image never promoted: the
  release's with-meta smoke used `docker compose up --wait`, which fails the
  moment the app's first boot exits on a not-yet-ready Postgres — the exact
  startup race `docker-compose.yml` documents as covered by
  `restart: unless-stopped` (the container was healthy, migrated, and had seeded
  all six bundled add-ons two seconds after the verdict). The smoke now polls
  readiness on the design's own terms, and this release is the first whose image
  carries the bundled add-on set on `:latest`.
- @adminium/adapter-mysql@0.2.5
  - @adminium/adapter-postgres@0.2.5
  - @adminium/adapter-sqlite@0.2.5
  - @adminium/add-on-contracts@0.2.5
  - @adminium/engine@0.2.5
  - @adminium/i18n@0.2.5
  - @adminium/llm@0.2.5
  - @adminium/manifest@0.2.5
  - @adminium/meta@0.2.5
  - @adminium/schema-import@0.2.5

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
- @adminium/adapter-mysql@0.2.4
  - @adminium/adapter-postgres@0.2.4
  - @adminium/adapter-sqlite@0.2.4
  - @adminium/add-on-contracts@0.2.4
  - @adminium/engine@0.2.4
  - @adminium/i18n@0.2.4
  - @adminium/llm@0.2.4
  - @adminium/manifest@0.2.4
  - @adminium/meta@0.2.4
  - @adminium/schema-import@0.2.4

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
- 4d68dc9: A package can now reach a deployment over HTTP: browse, refresh, download,
  sideload, discard, upgrade.
  
  The loop had a hole in the middle. The store, the catalog client and the two
  acquisition jobs all existed, and nothing enqueued a download — so a package
  could only arrive through the image's bundled seed, and install had nothing to
  install otherwise. These are the six routes that close it, all behind
  `manifests.manage` and all audited.
  
  **Browse never touches the network.** `GET /add-ons/catalog` is a disk read:
  the packages already staged, merged with whatever the last refresh cached, each
  row labelled with where its bytes would come from and whether anything has to be
  downloaded first. That is what makes the page work identically on an air-gapped
  install, and what stops a page load from becoming an outbound call nobody asked
  for. Refresh and download refuse with a reason when the online catalog is off,
  checked at the route as well as inside the job — an operator pressing a button
  deserves an answer, not a job that reports "disabled" into a log they are not
  reading.
  
  **Sideload runs the identical path as a download.** D4 makes it a first-class
  source rather than an escape hatch, so an uploaded tarball goes through the same
  verify-then-hardened-unpack the npm path uses: same integrity check, same
  allowlist extractor, same tree pin, same staged result. An air-gapped operator
  gets the same guarantees rather than a softer set. The tarball travels as a raw
  `application/octet-stream` body with the two scalars as query parameters,
  because this server has no `@fastify/multipart` and adding one for a single
  route would be a new dependency on the RCE path — the established idiom here is
  a scoped content-type parser plus a route-scoped `bodyLimit`.
  
  **Declining to install is not a dead end.** A staged package can be discarded
  without installing it first, which is the only way downloaded bytes an operator
  decided against ever leave the disk. Discarding the version that is *installed*
  is refused: that path is uninstall, which has different consequences and its own
  confirm.
  
  **Upgrade is a version bump, not a reinstall.** The hosts an add-on is mounted
  on and the credential it was given both survive it. The staged tree is re-hashed
  against its unpack-time pin and re-validated through the full validator, so an
  upgrade cannot smuggle past the publisher gate what an install could not; and
  `attaches` is re-checked, because a new version may have dropped a host this
  instance is currently mounted on and upgrading into that would leave an
  attachment the manifest no longer claims to support. Older version directories
  are pruned only after the upgrade verifies, so a failure anywhere above leaves
  the running version on disk.
  
  One thing the tests found: discarding the only staged version left an empty key
  directory behind, and `keys()` — which matches directory names against the key
  grammar — went on reporting an add-on with no bytes anywhere. It now sweeps the
  key directory when its last version goes, guarded on emptiness so an upgrade
  pruning an old version does not take the key with it.
- 4d68dc9: An add-on can be connected with an API key, and disconnecting proves what it
  promised.
  
  `POST /api/v1/add-ons/:key/connect` takes the add-on's own `secret: true`
  setting values, encrypts them under the add-on credential key, and reports the
  add-on connected. `DELETE` on the same path removes them. Both are behind
  `manifests.manage`, both audited.
  
  **The manifest decides which fields a credential has.** A key it does not
  declare is refused rather than stored, and so is a partial set — a credential
  store that accepts whatever it is sent is one nobody can audit, and a typo'd
  field would otherwise sit there forever looking like a configured secret. A
  non-secret setting sent as a credential is the same mistake and gets the same
  answer: `demo_transport` is configuration, not a key.
  
  The two kinds that are not `api-key` fail differently on purpose. An add-on
  declaring `connect.kind: "none"` is told it needs no connection and works as
  soon as it is enabled — that is a fact about the add-on, not a problem with the
  request. An `oauth2` add-on is told this build cannot complete the flow yet,
  which is a different thing from bad input and should not read as one.
  
  **Disconnect is one delete against a table that holds only secrets.** Nothing
  touches the data source, the manifest row, or its attachments, which is what
  makes "disconnecting keeps your data" a property of the code rather than a
  promise in a dialog. The reply says both halves back, and the add-on stays
  installed and attached with `connected: false`.
  
  The audit row for a connection records the field NAMES and never the values.
  It exists to say a connection was made — not to write the secret a second time,
  into a table with different retention.
  
  **One gap closed on the way past.** Install was calling `addOnManifestSchema`
  rather than `validateManifest`, so it checked the manifest's shape and skipped
  the policy layer — which meant the publisher gate (the control those rulings
  actually name) was not running at install, and neither was
  `FRONTEND_SECRET_LEAK`, the rule standing between a credential and a browser.
  Both run now, on the real installed manifest rather than only in the add-on
  repo's CI.
- 4d68dc9: Add-on egress is now enforced, and an installed bundle is checked on read.
  
  Both were declared and neither was enforced. An add-on's outbound access is an
  exact-hostname allow-list, and until now that list was a field in a JSON
  document nothing consulted at runtime — the validator refuses
  `outbound-http` without a non-empty list, which makes the declaration
  well-formed and stops nothing at the moment a call is made.
  
  **The guard is a predicate, tested as one.** Deciding whether a URL is reachable
  is split out from the client that fetches, because that predicate is where a
  bypass would live and testing it through a fetch mock hides half the cases. It
  refuses a suffix that merely ends with an allowed host and a prefix an allowed
  host merely ends with; credentials in the URL, because `https://evil@allowed/`
  has hostname `allowed` and a guard reading only the hostname passes it; every
  scheme but https; a trailing dot, which is the same host to DNS and would
  otherwise be a free bypass of an exact match; a literal IP, by its own name
  rather than as an ordinary miss, since D14's grammar bans IPs from the list so
  adding one would never help; and a non-default port, because the grammar has no
  way to declare one and permitting it would invent an authority the manifest
  cannot express.
  
  Redirects are refused rather than followed. That is the load-bearing one: a
  hostname check necessarily runs on the URL *before* the request, so `fetch`'s
  default would let an allowed host answer `302 Location: https://anywhere` and be
  obeyed. Responses are metered while streaming, because the add-on runs in this
  process and a body big enough to exhaust memory takes the whole server with it.
  Every refusal lands in the audit log as `add-on.egress-refused`, with the add-on
  as the actor rather than whoever happened to trigger the code path — that row is
  the operator-facing point of the whole guard, since an add-on quietly reaching
  for a host it never declared is exactly what nobody would otherwise find out
  about.
  
  **What it does not do is stated where it can be read.** says an undeclared call
  "fails at the socket". It does not, and it cannot while D13 runs server halves
  in-process: an add-on can reach `globalThis.fetch` or `node:net` directly, and
  nothing short of a process permission model or a child process would stop it. What
  exists is a client that refuses, handed to the add-on so it has no reason to build
  its own. The control against a *hostile* add-on remains the first-party publisher
  gate; this is the control against an honest one with a bug or a dependency that
  phones home. Both are worth having, only one is a sandbox, and neither is called
  one — including in a test that asserts the limit so it sits next to the thing that
  has it.
  
  **Bundle serving pins one hash and re-checks it.** The store already records a
  per-file sha256 when a package is unpacked, so that is the hash the SRI value is
  derived from *and* the hash the bytes are re-checked against on every read —
  one number, so what a host is told to pin and what the server will serve cannot
  drift apart. A bundle edited on the data volume after install is refused rather
  than served into a host page. Only paths the manifest *declares* are servable,
  checked before the store's own containment check sees the request, so asking for
  `package.json` is a 404 rather than a served byte.
  
  The route lives inside `/api/v1` rather than `/add-ons/<key>/client.js`. Everything
  outside `/api/` in this server is invisible to all three route ratchets and inherits
  neither the auth hook nor rate limiting, and since the bundle URL is *served* in the
  list reply rather than hardcoded by a host, its shape was free to choose — so it
  went where the guarantees are. No CSP change was needed either: `script-src` is
  already `'self'` and the bundle is same-origin, so "extends it with the add-on
  origin" describes an origin that does not exist.
- 4d68dc9: Fix: the add-on list and bundle routes were unauthenticated.
  
  `GET /api/v1/add-ons` and `GET /api/v1/add-ons/:key/bundle/*` both carried a
  docblock saying they were authenticated. Neither carried a guard. This server
  has no ambient auth hook — every route guards itself, and a route that names no
  guard has none — so the prose was the entire control.
  
  Anonymously, the first returned every installed add-on: its key and version,
  **whether a credential is stored for it**, the exact hostnames it is permitted
  to contact, and the URL of every bundle it ships. The second then served those
  bundles. Together that is a map of an operator's integrations, and the code
  behind them, handed to anyone who asked for it.
  
  Nothing could have caught it. The route-tree test sees a route's URL and verb
  and never its guards; the RBAC suites test what a guard does rather than which
  routes wear one; and every route exercised in the add-on suite passes through a
  request the harness has already authenticated. It was found by the wave's
  acceptance round trip, on its first real run against a spawned server — which is
  the argument that plan's D6 makes for having one.
  
  Both routes now say `requireAuth`, and the gap is closed two ways rather than
  one: a sweep over the registered route options fails if any add-on route
  declares no guard at all, and an anonymous request to each of the two routes a
  connected host reads expects a 401. The first is the ratchet, the second is the
  behaviour.
  
  This is also why connected add-on mode is a hosted build only. A standalone
  build carries a publishable key and no session; only an app Adminium serves
  itself is on an origin where the operator's session cookie applies.
  
  Three more fixes ride along, all found the same way — by asking a running server
  rather than a suite.
  
  `AddOnOAuthError` is a plain `Error` and no route mapped it, so every OAuth
  refusal rendered as a 500, including "this add-on's manifest points its
  authorize URL at a host it never declared" — sending an operator to read server
  logs for a problem in a manifest. All six of its reasons are client-visible and
  actionable, and they are 422s now.
  
  `GET /add-ons` used to read and re-hash every bundle of every installed add-on
  to produce an integrity value the unpack-time pin already held. Two costs, one
  of them serious: a full read plus a SHA-256 per bundle on a route a host calls
  on every page load, and — because the store's error type is also a plain `Error`
  — a single tampered or truncated file rendered as 500 INTERNAL and took the
  whole list down with it, for every add-on and every user. "Somebody edited a
  package on the data volume" is the one signal that check exists to raise, and it
  was arriving as an internal fault. The list reads the pin now and reports a
  bundle it cannot vouch for by omitting it; the bundle route still re-hashes the
  bytes it actually serves, which is where "checked on read" means something.
  
  `POST /add-ons/upload` buffered up to 32 MB before any guard ran. Body parsing
  precedes `preValidation` and `preHandler`, so both the permission check and the
  CSRF check saw those bytes only after they were in the heap — and the route sat
  in the general API bucket at 300/min rather than the file-bytes bucket at
  30/hour, giving the largest upload in the server the loosest budget in it. It
  now carries an `onRequest` guard, which is the only phase available before the
  parser, and the right bucket.
  
  And the round-trip script itself is added, so the next person does not have to
  build one to find the next defect of this shape.
- 4d68dc9: All three connect kinds now work: OAuth2 lands, host-run, with PKCE.
  
  A subset was refused — *"shipping two of three means one of four add-ons
  cannot be connected, which is a dead entry in a list the user can see"* — so
  this closes it. `import-canva` is connectable.
  
  **Adminium runs the flow, which is what makes acceptance #2 true.** The add-on
  declares where to authorize and gets handed an access token when there is one;
  it never holds the client secret, never sees the code verifier, and never
  performs the exchange. PKCE sits on top of a confidential-client flow
  deliberately: the authorization code travels back through a browser, and a
  verifier the browser never saw is what makes an intercepted code useless alone.
  
  **The OAuth endpoints are held to the add-on's own egress allow-list.** The
  manifest validator requires an `oauth2` connect to declare both URLs and does
  *not* require their hosts to appear in `network.allow` — so an add-on could
  declare a token endpoint at `evil.example` while its allow-list said
  `api.canva.com`, and Adminium would have POSTed a client secret and an
  authorization code to a host the operator never consented to. That is closed
  here, and the exchange goes through the same guarded client an add-on's own
  calls use, so there is one allow-list enforced in one place. It is re-checked on
  refresh, not only at connect.
  
  **Completion is a POST, not a GET callback.** The provider redirects the browser
  to a dashboard page, which reads the query and posts it. That keeps the
  side-effecting route a POST — carrying CSRF protection, the audit marker and
  rate limiting — rather than a GET that mutates, which this server's route
  ratchets would not even see.
  
  The pending flow lives in memory, mirroring `bridge/store.ts`: single-use so a
  replayed code is inert, short-lived, bounded so looping on start cannot grow the
  heap, and never on disk, because the verifier and the client secret are live
  credentials for the ninety seconds someone spends on a consent screen. The
  limitation is stated rather than left to be discovered: a multi-process
  deployment can land the completion on a process that did not start the flow.
  
  Two smaller decisions worth naming. A refresh response that omits
  `refresh_token` means *keep the one you have* — dropping it there would silently
  make the grant one-shot. And the token endpoint's error body is never echoed
  into an error message: an OAuth error routinely reflects the parameters it was
  sent, which here includes a client secret, and that message reaches an
  operator's screen and the log. What an add-on can see of an OAuth credential is
  the access token and nothing else — not the client secret, and not the refresh
  token, which is the long-lived half a compromised add-on could use to mint
  access tokens after being disconnected.
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
- 4d68dc9: Installed add-ons now run: server halves load, contracts resolve, and their
  events become job kinds.
  
  Server halves run IN-PROCESS, unsandboxed, because the first-party publisher
  gate is what does the real work. That is a deliberate ruling rather than an
  inherited one, and because the gate carries the weight, the loading discipline
  is the whole of the control.
  
  A server half is loaded **only** from the installed bundle on local disk,
  **only** at a path the manifest declares, and **only after** the file is
  re-hashed against the pin recorded when the package was unpacked. The refusal
  happens before the import rather than after, which is the difference between
  refusing to run modified bytes and noticing that you did. That check is more
  consequential than the one on the bundle-serving route: that one protects a
  browser, this one protects the server process.
  
  A failure is contained to one add-on. A boot that died because one bundle was
  corrupt would take an entire instance down for one broken integration, which is
  the opposite of the trade this design makes — so every failure becomes a
  reported problem and the rest of the set still loads.
  
  **Two add-ons implementing one contract is normal, not a conflict.**
  `artwork-source@1` already has two, so resolution is a choice rather than a
  lookup, made deterministically by add-on key so two instances of the same
  deployment agree. Slot fills order by `order` then key — never by install
  sequence, which differs between machines. A `single` slot claimed twice records
  SLOT_CONFLICT naming the loser: a silent override would leave an operator
  looking at a slot filled by an add-on they did not expect with nothing anywhere
  saying why.
  
  **Events become job kinds on the shared registry**, namespaced
  `add-on:<key>:<event>` so an add-on called `export` declaring an event `run`
  cannot shadow the exporter. That buys the worker's retries, cooperative
  cancellation and `jobs:<jobId>` progress for free rather than reimplementing
  them worse. The kinds are internal-only for the same reason `add-on-download`
  is: the payload reaches in-process third-party-shaped code, and a `jobs.manage`
  holder able to author it would be feeding that code arbitrary input past
  whatever the emitter would have checked.
  
  The handler contract is defined in that module because nothing else defined it —
  a manifest's `events[]` names `{ on, server }` and says nothing about what the
  module exports. A module that does not implement it is refused and named rather
  than registered: a kind whose handler cannot run is worse than no kind, since
  the job would be enqueued, retried three times, and fail with a message about a
  missing function instead of about a broken add-on.
  
  The credential is resolved per run rather than captured at registration, so one
  rotated or disconnected between boot and now is the one the handler sees. And
  this is where the guarded outbound client finally has a call site: it is what an
  add-on is handed, built from its own manifest so no caller can widen the
  allow-list.
  
  One bug fixed on the way past: `@adminium/manifest` was a devDependency while
  `routes/add-ons` imported it at runtime — and the Dockerfile's `pnpm deploy
  --prod` excludes devDependencies, so the published image would have failed to
  import it. It and `@adminium/add-on-contracts` are now runtime dependencies.
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
  
  **Attachments are a join table.** The wave's plan originally recommended two manifest rows keyed
  `(manifest_key, attached_to)` for an add-on attached to two hosts; that recommendation was withdrawn and the
  join table ratified. Three costs argue against it, and the third only became visible once the table turned
  out to be shipped: two rows mean two copies of the manifest document, which an upgrade must then rewrite
  atomically or leave one host on an older version; the credential FK becomes ambiguous, since a DHL API key
  belongs to the add-on rather than to one of its attachments, so disconnecting "the other one" either orphans
  a secret or deletes a live one; and it requires dropping and recreating the shipped
  `uq_adminium_manifests_manifest_key` across three dialects, against own "never edit a shipped migration". An
  attachment is a many-to-many fact and now has the table that models one. `disabledAt` lives there rather than
  on the manifest, so an add-on can be live on one host and off on another — which a single flag could not
  represent.
  
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
  to `operations` rather than `workspace`: installing an add-on runs its server half
  in this process, which is closer to starting a job than to changing a setting,
  exists precisely to stop it riding on `settings.manage`. The reserved set had four
  hard-coded copies rather than the two that were expected, and one of them is
  production code — `RESERVED_GRANTS` in the dashboard's `rolesApi.ts`, which the
  dashboard cannot import from `@adminium/meta`, so nothing detects drift and a key
  left there is silently dropped from the matrix with no error and no failing test.
  
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
  
  `studio` was always meant to be a namespace that loads lazily when a Studio
  route mounts, with keys of the shape `studio:connect.wizard.testCta`. The
  build never did it. All 971 console
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
- Updated dependencies [36fb706]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [36fb706]
- Updated dependencies [7e5f704]
- Updated dependencies [8ed7972]
- Updated dependencies [ac3f5e7]
- Updated dependencies [37c99f2]
- Updated dependencies [78cf75f]
  - @adminium/i18n@0.2.3
  - @adminium/meta@0.2.3
  - @adminium/manifest@0.2.3
  - @adminium/engine@0.2.3
  - @adminium/add-on-contracts@0.2.3
  - @adminium/llm@0.2.3
  - @adminium/adapter-mysql@0.2.3
  - @adminium/adapter-postgres@0.2.3
  - @adminium/adapter-sqlite@0.2.3
  - @adminium/schema-import@0.2.3

## 0.2.2

### Patch Changes

- d0e2031: Stop an apt outage from taking required CI checks down with it, and stop the VRT
  job from reddening `ci` while it cannot detect anything.
  
  `playwright install --with-deps chromium` stalled on an unreachable Ubuntu mirror
  on 2026-08-18 and ran to the 30-minute job timeout in three jobs at once — `ci`'s
  vrt, and e2e's postgres and mysql legs, two of which are required checks. The
  runs reported as `cancelled`, which reads like "superseded by a newer push", so
  main sat with no green run at HEAD and the summary did not say why.
  
  Caching the browsers is not the fix and `e2e.yml` proves it: it already cached
  `~/.cache/ms-playwright` and hung anyway, because `--with-deps` shells out to apt
  on every run regardless of whether the browser is present. A new composite action
  splits the two halves — apt is one bounded, best-effort attempt that warns and
  continues, and the browser install is required but apt-free and left unwrapped,
  since Playwright's downloader already retries across mirrors and fails fast on
  its own. All seven install sites use it, bounded from the caller.
  
  The vrt job now checks for committed baselines before spending anything. It used
  to install dependencies, install a browser and build the workspace to reach a
  step whose only action at zero baselines is to print a warning — so a job that is
  not a required check, and that cannot detect a regression, was the sole reason
  `ci` was red.
  
  Adds a contract test over `.github/actions/*/action.yml`. `timeout-minutes` is
  not a legal key on a composite-action step and the runner rejects the entire
  manifest when it sees one, so a single bad key breaks every workflow using the
  action. A draft of this change had exactly that and would have hard-failed five
  required checks. Nothing caught it: `actionlint` never visits `.github/actions/`,
  and pointed at an `action.yml` it parses the file as a workflow and exits 0.
- 00f435f: Build the coverage harness has specified since M0 (task) and nothing implemented:
  no `coverage` key in any of the 9 vitest configs, no provider installed, nothing in CI.
  
  Every package with tests now carries `coverage.thresholds`, from a shared base at
  `@adminium/config/vitest`. Nine packages that had tests and no vitest config at
  all — engine, schema-import, llm, tokens, adapter-mysql, adapter-sqlite,
  manifest, add-on-contracts and config — get one.
  
  **The first measurement was wrong, and the reason is the interesting part.**
  Measured with vitest's default excludes, apps/server reports 81.2% over 2,787
  files: 107,165 statements of node_modules and 79,761 of workspace `dist/` are in
  the denominator, and 219 apps/dashboard files are mis-attributed to
  `apps/server/src/...` paths that do not exist on disk. Scoped to its own src it
  is 90.54% over 212 files. `packages/ui` was worse than wrong — it counted ~82,000
  statements of gitignored `storybook-static/`, which exists in the `vrt` job and
  not in `verify`, so the same commit measured 4.66% in one job and 54.64% in
  another. An `exclude` list cannot fix either case; `include: ['src/**']` can, and
  is why it is there.
  
  Floors are `max(floor, measured rounded down)` per axis: green on arrival and
  ratcheting upward only. A floor set numbers would have been red on arrival — which
  is how the VRT and axe gates died the first time. Rounding down is not cosmetic: v8
  totals are not bit-stable between identical runs. `@adminium/ui`,
  `@adminium/widgets` and `@adminium/charts` collect and report but assert nothing.
  
  Two RELEASE-GATE rows record what is still owed, both unchecked: the gap between
  the ratchet floors, and the fact that 9 of 10 performance budgets have no harness
  and no recorded decision either way. The previous state was worse than an unmet
  criterion — with no row, the gate could not fail on it.
  
  Coverage adds ~15% to the test leg, so `verify`'s timeout goes 20 → 25 minutes,
  and summaries upload as an artifact on failure only.
  
  Coverage is enabled by `--coverage` in each package's `test` script rather than
  unconditionally in the config. Thresholds apply to whatever was collected, so a
  deliberate subset legitimately has low coverage: with it always on,
  `vitest run one.test.ts` printed "12 passed" and then exited non-zero on
  "Coverage for statements (0.43%) does not meet global threshold (90%)" — every
  single-file debugging run looked like a failure. The full-suite path, and
  therefore CI's `turbo run test`, is gated exactly as before.
- ca0aa06: Make `source.kind = "view"` exports work, and stop advertising a kind no payload can express.
  
  `exportSourceSchema` accepts three kinds — `table`, `view`, `page` — and the
  OpenAPI document offers all three to clients. Only `table` ever worked. The
  route answered the other two with "Only `source.kind = "table"` exports are
  supported", and `export-run` carried a second copy of the same refusal that
  would throw on any row that reached it another way.
  
  **`view` is now real.** A saved view names no table of its own: it names the PAGE
  it was saved on, and the page carries the binding. So the route resolves view →
  page → `config.source.table`, checks the per-table export grant on the RESOLVED
  table exactly as a direct table export does, and stores the resolved table on the
  row. `export-run` then keys off that resolved table instead of the kind — which
  is what stopped it throwing on a row the route had already accepted and
  authorized. A saved view is a shortcut through the same door, never a way around
  it: an unauthorized caller still gets `TABLE_FORBIDDEN`, and someone else's
  private view is reported absent rather than forbidden, because whether it exists
  is the owner's business.
  
  **A view with a search term is refused, not silently widened.** An export source
  has nowhere to carry a search, so exporting such a view would hand back MORE rows
  than the view displays under the view's own name — the same silent-over-export
  failure the queued path is deliberately unwired to avoid. Sort is dropped
  silently by contrast: ordering changes how the same rows are arranged, not which
  rows they are.
  
  **`page` is refused with the actual reason.** An export source carries `table`,
  `viewId` and `filters` and no field that identifies a page, so the kind cannot be
  satisfied by any payload. It still answers 422, but now says why and points at
  the two kinds that work. Removing it from the vocabulary is a schema change and
  therefore an OpenAPI regeneration, which is left for a commit that can regenerate
  the document cleanly.
- 0dc38fb: Stop secrets surviving the log. The redaction set only ever protected one depth.
  
  `REDACT_PATHS` reads as though `*.password` covers "password at any level".
  It does not — pino's `*` is exactly one level. Measured against the installed
  pino 10.3.1:
  
      { password }             depth 1  -> NOT redacted
      { a: { password } }      depth 2  -> redacted
      { a: { b: { password }}} depth 3  -> NOT redacted
      { users: [{ password }]} array    -> NOT redacted
  
  So every `*.`-prefixed entry — `*.token`, `*.secret`, `*.apiKey`, `*.dsn`,
  `*.bootToken`, `*.ADMINIUM_SECRET` — guarded depth 2 and nothing else.
  `@pinojs/redact`'s own README says "redacts password at any level", which is
  very likely how the list came to be written that way. The obvious repair is a
  trap: `'**.pass'` is accepted by pino's path validator and matches nothing at
  any depth, so it would look applied and redact nothing.
  
  Redaction is now a rule rather than a list: a `formatters.log` hook walks the
  whole object to any depth and through arrays. The path list is kept — it is
  exact for `req.headers.*` and costs nothing — but it is no longer the guarantee.
  
  Fields that were covered at NO depth and now are: `pass` and `passEncrypted`
  (the SMTP credential — the stored ciphertext AND the decrypted plaintext, which
  is the more valuable of the two), `otpauthUrl` (a string carrying the full TOTP
  seed), `recoveryCodes`, `challengeToken`, `secretEncrypted`, and `lastError`
  (driver errors routinely quote the whole connection string — `export/redaction.ts`
  already refused to export it for that reason while the log had no equivalent).
  
  The comment in `email/config.ts` asserting pino redacted the SMTP password is
  corrected. It was false, and it is the kind that stops the next person checking —
  `app.ts` had already documented the very rule it violated, in the `bootToken`
  note directly above the list.
  
  The scrub returns class instances by reference, so the `req` and `err`
  serializers still see real objects (pino runs formatters before serializers, so
  cloning an Error would have cost its message and stack). It is total against
  throwing getters, circular references and depth, and returns the same reference
  when nothing matched. `test/log-redaction.test.ts` drives the real `buildLogger`
  and asserts on the bytes it writes — four of its cases fail against the previous
  state.
- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
- 2684976: Infer the relations a schema implies but never declares, and let an accepted one
  survive the next regeneration.
  
  `RELATION_KINDS` has always listed `inferred-name` and `inferred-join-table`, and
  five consumers branch on them — `detectDomains` unions relations at confidence
  0.8, the column classifier promotes an accepted one to the `fk` semantic,
  `detectHierarchy` looks for a self-referential edge, the Studio remap editor
  renders an "inferred" bucket, and the LLM normalizer builds its heuristic
  baseline from them — but nothing ever wrote one. `model.relations` came
  exclusively from declared foreign keys. On a schema that declares none (MyISAM,
  legacy SQLite, most ORM-generated MySQL) that emptiness cascaded all the way to
  the screen: domains shattered into singletons so every table landed in
  "General", dashboards were skipped for want of a joined time axis, and every
  `*_id` column fell through to `external-id` — a monospaced string where an
  entity chip belonged.
  
  `applyInference` fills that in. Rule 1 resolves `customer_id` onto `customers`,
  scoring the evidence: an exact singular/plural match on an agreeing declared key
  reaches 0.90 and behaves like a declared FK everywhere, while every weakening — a
  role prefix dropped from `shipping_address_id`, a cross-schema hop, a name two
  tables answer to, types that merely rhyme — costs enough to land in the 0.5–0.79
  band instead. That band is the point: all four 0.8 gates exclude it, so a weak
  guess is visible to the remap editor as a suggestion without acting on anything.
  Rule 2 then reads the graph rule 1 just seeded and emits the many-to-many for a
  table that is nothing but two foreign keys. Hierarchy vocabulary (`parent_id`,
  `reports_to`) resolves to its own table, which is what finally lets the tree and
  org-chart triggers fire on a schema with no declared self-FK.
  
  Order is load-bearing and looks circular: join detection reads the `fk` semantic,
  which the column classifier derives from `model.relations`. So inference runs
  first, as its own function — `applyInference` then `applyClassification` — and
  deliberately not inside the classifier, which spreads `...model` and rebuilds
  only `tables`, discarding anything added within it. It runs in exactly one place,
  at introspection, so the snapshot carries the result and a `relation.remove`
  override stays removed instead of being re-derived on every run. A schema that
  declares its foreign keys is left untouched; nothing here ever emits 1.0.
  
  The second half closes a loop that was open at one end. The `relation.add` /
  `relation.remove` overrides were folded in on the read path only, so a relation a
  user accepted in Studio appeared in the schema browser and the data API — and
  then the next regeneration re-parsed the raw snapshot, saw none of it, and
  emitted pages with no FK chip, no related list, and no join. The user's
  correction was visible everywhere except the thing it was made to correct.
  Accepted relations now reach `generatePages` at confidence 1.0 with
  `kind: 'override'`, ahead of the wizard's table filter so an override into an
  excluded table is dropped by the same rule that drops a declared FK. One whose
  table or column the schema has since dropped is skipped with a warning naming it,
  rather than generating a page that cannot load.
- c2e3c6e: Let a v1 prerelease tag run the release pipeline, and never let it take `latest`
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
- Updated dependencies [08df45d]
- Updated dependencies [66f0683]
- Updated dependencies [586426a]
- Updated dependencies [e15787b]
- Updated dependencies [2dffc12]
- Updated dependencies [1d952df]
- Updated dependencies [e52d7da]
- Updated dependencies [08df45d]
- Updated dependencies [d97ac21]
- Updated dependencies [c09848a]
- Updated dependencies [2728dea]
- Updated dependencies [4f297da]
- Updated dependencies [81394c0]
- Updated dependencies [00cd08f]
- Updated dependencies [2684976]
- Updated dependencies [aabc4e1]
- Updated dependencies [ef1c300]
  - @adminium/i18n@0.2.2
  - @adminium/engine@0.2.2
  - @adminium/llm@0.2.2
  - @adminium/schema-import@0.2.2
  - @adminium/adapter-postgres@0.2.2
  - @adminium/adapter-sqlite@0.2.2
  - @adminium/adapter-mysql@0.2.2
  - @adminium/meta@0.2.2

## 0.2.2-rc.0

### Patch Changes

- 00cd08f: Refresh the dependency tree, including four runtime majors.
  
  Runtime dependencies that reach consumers: `i18next` 25 → 26, `pino` 9 → 10, `croner` 9 → 10 and `fastify-type-provider-zod` 6 → 7, alongside `fastify` 5.12, `kysely` 0.29, `pg` 8.23, `mysql2` 3.23, `argon2` 0.45 and the `@fastify/*` plugins. Build tooling moved too — `dependency-cruiser` 18, `@changesets/cli` 3, `@types/better-sqlite3` 9 (now matching the `better-sqlite3` 13 it describes).
  
  `i18next` 26 is the one worth knowing about, because the runtime override layer is built directly on 25's semantics: the reason overrides are applied by rebuilding the instance on each revision bump, rather than mutating the resource store, is that i18next cannot delete a key from a bundle — so the store has no way to express "reset this key to the built-in", which is the most common admin operation. That design still holds under 26, and the 171 `@adminium/i18n` tests pass unchanged. `argon2` 0.45 remains Node-API (`napi_versions: [8]`), so the packaging notes about native addons are unaffected.
  
  This release also carries `builtinLocaleDir`, exported from `@adminium/ui`'s theme barrel, which landed earlier without a changeset of its own.
  
  Several things were deliberately held back rather than swept, each for a measured reason, and are recorded in `.github/dependabot.yml` so they stop arriving weekly: `lucide-react` 1.x (+16.1 KiB gz on the dashboard entry chunk, and it drops the brand icons), the `@radix-ui/*` set (+4.8 KiB gz together), `happy-dom` 20 (breaks a desktop About test that passes on 18), and the `vite` 8 cluster (no stable `electron-vite` accepts it). The entry chunk came out of the sweep 0.6 KiB *smaller* than before, so the size ratchet clicked down with it.
- 2684976: Infer the relations a schema implies but never declares, and let an accepted one
  survive the next regeneration.
  
  `RELATION_KINDS` has always listed `inferred-name` and `inferred-join-table`, and
  five consumers branch on them — `detectDomains` unions relations at confidence
  0.8, the column classifier promotes an accepted one to the `fk` semantic,
  `detectHierarchy` looks for a self-referential edge, the Studio remap editor
  renders an "inferred" bucket, and the LLM normalizer builds its heuristic
  baseline from them — but nothing ever wrote one. `model.relations` came
  exclusively from declared foreign keys. On a schema that declares none (MyISAM,
  legacy SQLite, most ORM-generated MySQL) that emptiness cascaded all the way to
  the screen: domains shattered into singletons so every table landed in
  "General", dashboards were skipped for want of a joined time axis, and every
  `*_id` column fell through to `external-id` — a monospaced string where an
  entity chip belonged.
  
  `applyInference` fills that in. Rule 1 resolves `customer_id` onto `customers`,
  scoring the evidence: an exact singular/plural match on an agreeing declared key
  reaches 0.90 and behaves like a declared FK everywhere, while every weakening — a
  role prefix dropped from `shipping_address_id`, a cross-schema hop, a name two
  tables answer to, types that merely rhyme — costs enough to land in the 0.5–0.79
  band instead. That band is the point: all four 0.8 gates exclude it, so a weak
  guess is visible to the remap editor as a suggestion without acting on anything.
  Rule 2 then reads the graph rule 1 just seeded and emits the many-to-many for a
  table that is nothing but two foreign keys. Hierarchy vocabulary (`parent_id`,
  `reports_to`) resolves to its own table, which is what finally lets the tree and
  org-chart triggers fire on a schema with no declared self-FK.
  
  Order is load-bearing and looks circular: join detection reads the `fk` semantic,
  which the column classifier derives from `model.relations`. So inference runs
  first, as its own function — `applyInference` then `applyClassification` — and
  deliberately not inside the classifier, which spreads `...model` and rebuilds
  only `tables`, discarding anything added within it. It runs in exactly one place,
  at introspection, so the snapshot carries the result and a `relation.remove`
  override stays removed instead of being re-derived on every run. A schema that
  declares its foreign keys is left untouched; nothing here ever emits 1.0.
  
  The second half closes a loop that was open at one end. The `relation.add` /
  `relation.remove` overrides were folded in on the read path only, so a relation a
  user accepted in Studio appeared in the schema browser and the data API — and
  then the next regeneration re-parsed the raw snapshot, saw none of it, and
  emitted pages with no FK chip, no related list, and no join. The user's
  correction was visible everywhere except the thing it was made to correct.
  Accepted relations now reach `generatePages` at confidence 1.0 with
  `kind: 'override'`, ahead of the wizard's table filter so an override into an
  excluded table is dropped by the same rule that drops a declared FK. One whose
  table or column the schema has since dropped is skipped with a warning naming it,
  rather than generating a page that cannot load.
- c2e3c6e: Let a v1 prerelease tag run the release pipeline, and never let it take `latest`
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
- Updated dependencies [00cd08f]
- Updated dependencies [2684976]
- Updated dependencies [aabc4e1]
- Updated dependencies [ef1c300]
  - @adminium/i18n@0.2.2-rc.0
  - @adminium/meta@0.2.2-rc.0
  - @adminium/adapter-postgres@0.2.2-rc.0
  - @adminium/adapter-mysql@0.2.2-rc.0
  - @adminium/adapter-sqlite@0.2.2-rc.0
  - @adminium/engine@0.2.2-rc.0
  - @adminium/llm@0.2.2-rc.0
  - @adminium/schema-import@0.2.2-rc.0

## 0.2.1

### Patch Changes

- 4091a4f: Evict ICU format failures by recency, and hand out copies of them.

  The bounded ring evicted by insertion order rather than recency. A repeat updated its record in place without moving it, while eviction always took the first key — so the message failing most often was the first to go. One bad message in a render loop, which is the exact case the ring exists to surface, was evicted by 49 unrelated one-off failures before an admin could ever see it in the Translations editor. Repeats now re-insert, so key order is recency order and eviction takes the least recently seen.

  `formatFailures()` also handed out live references into the ring, typed `readonly FormatFailure[]` — which protects the array, not the entries. A held result changed under the caller on the next failure, and a caller could write straight into the ring; `GET /i18n/format-errors` was safe only because it serialises immediately. Entries are now copied and typed `readonly Readonly<FormatFailure>[]`. The copy is what provides the guarantee, since `readonly` is erased at runtime.

  Both paths are covered by tests, which this module previously had none of.

- Updated dependencies [4091a4f]
  - @adminium/i18n@0.2.1
  - @adminium/engine@0.2.1
  - @adminium/llm@0.2.1
  - @adminium/adapter-mysql@0.2.1
  - @adminium/adapter-postgres@0.2.1
  - @adminium/adapter-sqlite@0.2.1
  - @adminium/schema-import@0.2.1
  - @adminium/meta@0.2.1

## 0.2.0

### Minor Changes

- 1d7c7b4: Rework the CLI setup wizard's prompts, output, and ending.

  The wizard now has a visual grammar: one continuous vertical rail down the left margin with a glyph per step — `◇` settled, `◆` current, `▲` wants attention. Previously every line printed at column 0, so a seven-step flow read as an undifferentiated transcript with no way to tell decisions from narration. Adds width-correct clipping (styling applied after the clip, since escape codes otherwise measure as visible columns and can be severed mid-sequence), word-boundary wrapping for prose, and a scrolling viewport for long pickers — a frame taller than the terminal cannot be rewound without the redraw eating the lines above it.

  Also lifts the wizard's pre-hidden-table rule into `@adminium/engine` as `isPreHiddenTable`. The Studio hid Adminium's own `adminium_*` store, other tools' migration bookkeeping, and join tables from its first commit, while the CLI wizard was still offering `adminium_users` as a table to build an admin panel over — generation declines to page all three regardless, so that selection could never be honoured. One rule, beside the classifier that assigns the roles, shared by both front doors.

- 1d7c7b4: Runtime translation overrides, add-on contracts, and Studio navigation.

  `@adminium/i18n` gains a runtime override layer (`createI18nWithOverrides`, `mergeOverrides`, `rebuildWithOverrides`, `overrideTag`) alongside runtime locale registration (`setRuntimeLocales`, `resetRuntimeLocales`, `availableLocales`) and format-failure reporting. The compiled bundle and the override tree are held separately and merged in userland, with the instance rebuilt on each revision bump rather than the i18next resource store being mutated: i18next 25 cannot delete a key from a bundle, so the store has no way to express "reset this key to the built-in" — the most common admin operation.

  `@adminium/add-on-contracts` is a new package carrying the add-on slot and provider-contract registries, their types, and conformance suites. `@adminium/manifest` grows the matching vocabulary — `addOnManifestSchema`, `manifestKindSchema`, `isAddOnManifest`, `addOnIssues` and the `AddOnBlock` type — so an add-on manifest is validated by the same path as an app manifest.

### Patch Changes

- 1d7c7b4: Parse Postgres `int8` as a JS number on the meta pool.

  `createPostgresMetaDb` documented that its pool must decode int8 as a number but shipped nothing that could satisfy it, so callers either forgot — every `ts` column arrived as a string and `GET /api/v1/bootstrap` failed against its own reply schema — or reached for a process-global `pg.types.setTypeParser`, which masked the callers that had. `postgresInt8AsNumber(pgModule)` is now exported next to the contract it satisfies: `new Pool({ …, types: postgresInt8AsNumber(pg) })`.

  Scoped to the one pool deliberately. The META schema pins `ts` to epoch milliseconds and `bigint` to values under 2^53, but the server reads the user's own tables through the same `pg` module and their `bigint` ids carry no such promise — a global parser there would be a data-integrity bug in waiting. Structurally typed over the module, so `@adminium/meta` still declares no driver dependency.

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/engine@0.2.0
  - @adminium/meta@0.2.0
  - @adminium/i18n@0.2.0
  - @adminium/adapter-postgres@0.2.0
  - @adminium/adapter-mysql@0.2.0
  - @adminium/adapter-sqlite@0.2.0
  - @adminium/llm@0.2.0
  - @adminium/schema-import@0.2.0

## 0.1.0

### Minor Changes

- First public release: the Adminium CLI/server and its library packages.

### Patch Changes

- Updated dependencies
  - @adminium/adapter-mysql@0.1.0
  - @adminium/adapter-postgres@0.1.0
  - @adminium/adapter-sqlite@0.1.0
  - @adminium/engine@0.1.0
  - @adminium/llm@0.1.0
  - @adminium/meta@0.1.0
  - @adminium/schema-import@0.1.0

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
