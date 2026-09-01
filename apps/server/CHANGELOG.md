# @adminium/server

## 0.2.4

### Patch Changes

- a44a0ff: The ghcr image and the desktop build now carry the six first-party add-ons as
  a pre-verified bundled set.
  
  The boot seed (32 D3) has existed since the store landed, but nothing ever put
  a bundle where it looks — every image and installer shipped an empty Add-ons
  page and called the air-gap story done. Now a release script
  (`scripts/release/fetch-add-ons-bundle.mjs`) downloads the six tarballs at
  build time against exact version + sha512 pins
  (`scripts/release/add-ons-bundle.json`, copied from the release ledger — never
  `latest`, no redirects, timing-safe digest comparison, refusal on any
  unpinnable entry), and writes the flat
  `<key>-<version>.tgz` + `.tgz.integrity` layout the seed reads. The Docker
  build parks it at `/app/add-ons-bundle`, which the runtime stage's CWD makes
  the server's own default; desktop-release.yml parks it in
  `resources/add-ons-bundle` next to the demo seed.
  
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
  the policy layer — which meant the publisher gate (24 D13 / 26 D4, the control
  those rulings actually name) was not running at install, and neither was
  `FRONTEND_SECRET_LEAK`, the rule standing between a credential and a browser.
  Both run now, on the real installed manifest rather than only in the add-on
  repo's CI.
- 4d68dc9: Add-on egress is now enforced, and an installed bundle is checked on read.
  
  Both were declared and neither was enforced. 24 D14 rules that an add-on's
  outbound access is an exact-hostname allow-list, and until now that list was a
  field in a JSON document nothing consulted at runtime — the validator refuses
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
  
  **What it does not do is stated where it can be read.** §5.5 says an undeclared
  call "fails at the socket". It does not, and it cannot while D13 runs server
  halves in-process: an add-on can reach `globalThis.fetch` or `node:net`
  directly, and nothing short of a process permission model or a child process
  would stop it. What exists is a client that refuses, handed to the add-on so it
  has no reason to build its own. The control against a *hostile* add-on remains
  the first-party publisher gate; this is the control against an honest one with a
  bug or a dependency that phones home. Both are worth having, only one is a
  sandbox, and neither is called one — including in a test that asserts the limit
  so it sits next to the thing that has it.
  
  **Bundle serving pins one hash and re-checks it.** The store already records a
  per-file sha256 when a package is unpacked, so that is the hash the SRI value is
  derived from *and* the hash the bytes are re-checked against on every read —
  one number, so what a host is told to pin and what the server will serve cannot
  drift apart. A bundle edited on the data volume after install is refused rather
  than served into a host page. Only paths the manifest *declares* are servable,
  checked before the store's own containment check sees the request, so asking for
  `package.json` is a 404 rather than a served byte.
  
  The route lives inside `/api/v1` rather than at §5.4's `/add-ons/<key>/client.js`.
  Everything outside `/api/` in this server is invisible to all three route
  ratchets and inherits neither the auth hook nor rate limiting, and since the
  bundle URL is *served* in the list reply rather than hardcoded by a host, its
  shape was free to choose — so it went where the guarantees are. No CSP change
  was needed either: `script-src` is already `'self'` and the bundle is same-origin,
  so §5.4's "extends it with the add-on origin" describes an origin that does not
  exist.
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
  
  26 D2 refuses a subset — *"shipping two of three means one of four add-ons
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
  
  O1 was ratified in-process, on the recommendation the plan records — 24 D13's
  first-party publisher gate is what does the real work. This implements that
  ruling, and because it does, the loading discipline is the whole of the control.
  
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
- 00f435f: Build the coverage harness 15-quality.md §1 has specified since M0 (task 15-T01)
  and nothing implemented: no `coverage` key in any of the 9 vitest configs, no
  provider installed, nothing in CI.
  
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
  
  Floors are `max(§1 floor, measured rounded down)` per axis: green on arrival and
  ratcheting upward only. A floor set at §1's numbers would have been red on
  arrival — which is how the VRT and axe gates died the first time. Rounding down
  is not cosmetic: v8 totals are not bit-stable between identical runs.
  `@adminium/ui`, `@adminium/widgets` and `@adminium/charts` collect and report but
  assert nothing, per §1.
  
  Two RELEASE-GATE rows record what is still owed, both unchecked: the gap between
  the ratchet and §1's floors, and the fact that 9 of 10 performance budgets have
  no harness and no recorded decision either way. The previous state was worse than
  an unmet criterion — with no row, the gate could not fail on it.
  
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
