# @adminium/desktop

## 0.2.12

### Patch Changes

- Updated dependencies [8e50f36]
- Updated dependencies [5b84085]
  - @adminium/server@0.2.12
  - @adminium/adapter-mysql@0.2.12
  - @adminium/adapter-postgres@0.2.12
  - @adminium/adapter-sqlite@0.2.12

## 0.2.11

### Patch Changes

- Updated dependencies [b847dfc]
  - @adminium/server@0.2.11
  - @adminium/adapter-mysql@0.2.11
  - @adminium/adapter-postgres@0.2.11
  - @adminium/adapter-sqlite@0.2.11

## 0.2.10

### Patch Changes

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
- Updated dependencies [5152556]
- Updated dependencies [5152556]
- Updated dependencies [74d5351]
- Updated dependencies [1923ca6]
- Updated dependencies [5152556]
- Updated dependencies [4e17715]
- Updated dependencies [d95d39f]
- Updated dependencies [86535d5]
- Updated dependencies [d95d39f]
- Updated dependencies [d95d39f]
- Updated dependencies [d95d39f]
- Updated dependencies [d95d39f]
- Updated dependencies [d95d39f]
- Updated dependencies [d95d39f]
- Updated dependencies [c0096c0]
- Updated dependencies [5152556]
  - @adminium/server@0.2.10
  - @adminium/adapter-mysql@0.2.10
  - @adminium/adapter-postgres@0.2.10
  - @adminium/adapter-sqlite@0.2.10

## 0.2.9

### Patch Changes

- 4cba736: **The bundled add-on set moves to 1.0.1, and gains Invoices.** The Docker image
  and the desktop app now bake in seven add-ons instead of six — barcode-labels,
  design-studio, holiday-calendars, import-canva, **invoices**, personalizer and
  shipping-dhl — fetched at build time from `downloads.adminium.dev` against the
  fingerprints the release recorded.
  
  Each of these releases also states the oldest Adminium it runs on truthfully;
  the 1.0.0 files all claimed `1.0.0`, which no released server has ever been.
  Nothing enforces that claim for add-ons yet, but the shipped set no longer lies
  about it.
- Updated dependencies [ad014d7]
- Updated dependencies [962671c]
- Updated dependencies [4cba736]
- Updated dependencies [ad014d7]
  - @adminium/server@0.2.9
  - @adminium/adapter-mysql@0.2.9
  - @adminium/adapter-postgres@0.2.9
  - @adminium/adapter-sqlite@0.2.9

## 0.2.8

### Patch Changes

- Updated dependencies [7b0e544]
- Updated dependencies [3d627e5]
- Updated dependencies [d1d11d4]
- Updated dependencies [3d627e5]
  - @adminium/server@0.2.8
  - @adminium/adapter-mysql@0.2.8
  - @adminium/adapter-postgres@0.2.8
  - @adminium/adapter-sqlite@0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies [5445805]
  - @adminium/server@0.2.7
  - @adminium/adapter-postgres@0.2.7
  - @adminium/adapter-mysql@0.2.7
  - @adminium/adapter-sqlite@0.2.7

## 0.2.6

### Patch Changes

- Updated dependencies [ce438a0]
- Updated dependencies [f73fffc]
- Updated dependencies [f2fd258]
- Updated dependencies [65f69df]
- Updated dependencies [a828566]
- Updated dependencies [cb398f1]
  - @adminium/server@0.2.6
  - @adminium/adapter-postgres@0.2.6
  - @adminium/adapter-mysql@0.2.6
  - @adminium/adapter-sqlite@0.2.6

## 0.2.5

### Patch Changes

- Updated dependencies [c5afd13]
  - @adminium/server@0.2.5
  - @adminium/adapter-mysql@0.2.5
  - @adminium/adapter-postgres@0.2.5
  - @adminium/adapter-sqlite@0.2.5

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
- Updated dependencies [a44a0ff]
  - @adminium/server@0.2.4
  - @adminium/adapter-mysql@0.2.4
  - @adminium/adapter-postgres@0.2.4
  - @adminium/adapter-sqlite@0.2.4

## 0.2.3

### Patch Changes

- 6f714be: The offline-assets gate now scans the Electron main process.
  
  It never did. All three roots it checked — `out/renderer`, `out/dashboard`,
  `apps/dashboard/dist` — are renderer output, so everything the gate has ever
  looked at runs in Chromium. The main process is where the update check, the
  window lifecycle and the utilityProcess supervisor live: the code that actually
  makes requests. `updates.mode: 'disabled'` ⇒ "zero non-loopback requests" is the
  desktop's headline offline promise, and it rested entirely on a runtime smoke
  test, with no build-time check that a remote URL had not been linked into the
  process doing the requesting.
  
  Adding the root surfaced exactly what you would expect and forced one honest
  decision. `api.github.com` is in there, and it is genuinely fetched — by the
  opt-in update check. Every existing allowlist entry certifies that a string is
  NEVER FETCHED, so filing a fetched host under that claim to keep the build green
  would have quietly converted the entry format into a lie, and every future entry
  with it. So `ALLOWED_HOSTS` now has two labelled kinds: *inert*, the original
  claim, unchanged; and *opt-in outbound* (`optIn: true`), which must name the
  switch that turns the feature off and the runtime test that proves the off-state.
  Naming the second category is what keeps the first one strong. The bar is
  deliberately high — off by default, individually disableable, runtime-asserted —
  and a host that is merely "usually not used" does not qualify.
  
  The remaining literals were loopback and LAN-share URL templates whose host is
  filled in at runtime from an address the machine already owns. Their entry is
  scoped to the four placeholders that actually exist rather than a blanket
  `${...}`, because the entire value of this gate is that a new remote URL fails
  it, and `^\$\{.*\}$` would wave through a future `${config.remoteHost}`.
  
  The server is deliberately still not scanned, and should not be. There is no
  server bundle — `electron.vite.config.ts` externalizes `@adminium/server` on
  purpose so it runs unmodified — and more importantly the server's hostnames fail
  this gate's premise wholesale: it legitimately reaches telemetry, the update
  feed, and now the add-on catalog, each behind its own switch. That is a different
  kind of claim ("off means zero calls", not "this string is inert") and it is
  proved where such a claim can be proved, by the network-isolation suites that
  replace fetch and node's net/http/https with recording throwers and assert the
  recorder stays empty.
- Updated dependencies [36fb706]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [4d68dc9]
- Updated dependencies [7e5f704]
- Updated dependencies [8ed7972]
- Updated dependencies [37c99f2]
  - @adminium/server@0.2.3
  - @adminium/adapter-mysql@0.2.3
  - @adminium/adapter-postgres@0.2.3
  - @adminium/adapter-sqlite@0.2.3

## 0.2.2

### Patch Changes

- Give the `desktop-v*` release series ownership of GitHub's Latest pointer.
  
  `release.yml` now creates `v*` releases with `--latest=false`, pinned by a
  contract test in `docker-contract.test.ts` so a comment is no longer the only
  thing protecting it. The desktop publish step is
  `gh release edit <tag> --draft=false --latest`, and the draft's own checklist is
  generated with the correct command for the tag: a prerelease gets `--draft=false`
  without `--latest`, because GitHub refuses the Latest pointer to a prerelease and
  an rc must never be what stable installs resolve.
  
  This half is what rescues installs already in the field: their resolution logic
  is frozen in the shipped binary and only ever asks `/releases/latest`. The
  pointer was moved to `desktop-v0.2.1` on 2026-08-19, so those installs now
  resolve a release that actually carries installers.
  
  Also derives `--prerelease` from the tag in `desktop-release.yml`, which
  previously marked an `-rc` desktop tag as a stable release.

- Fix the desktop auto-updater, which was broken for every shipped install on all
  three platforms.
  
  electron-updater's GitHub provider resolves the release to update to through
  `/releases/latest`. That is a single stored pointer for the whole repository,
  and this repository publishes two interleaved tag series — `v*` for npm/Docker
  and `desktop-v*` for the app. The pointer sat on `v0.2.1`, an npm release
  carrying no installers, so every install resolved that tag and then 404'd
  fetching `latest-mac.yml`. Because the failure is in tag resolution, before a
  per-platform channel file is chosen, Windows and Linux failed identically.
  `vPrefixedTagName: false` did not prevent it and never could: electron-updater
  reads that option nowhere.
  
  The app now resolves its own release — newest `desktop-v*` entry from the
  releases LIST endpoint, drafts and prereleases skipped, selected by highest
  version rather than list position — and pins electron-updater to that one
  release's asset directory with a `generic` feed. This is the same read
  `apps/server/src/telemetry/update-check.ts` already performs for the server
  series, for the same documented reason.
  
  Details that are load-bearing rather than incidental:
  
  - The feed sets `useMultipleRangeRequest: false`. `BaseGitHubProvider` hardcodes
    it; the generic branch would infer it true for a github.com URL, and GitHub's
    asset CDN answers a multipart Range with HTTP 501 — which would silently
    degrade every delta download to a full one.
  - The resolved release body is carried into the `update-available` event. The
    generic provider back-fills neither `releaseNotes` nor `releaseName`, and the
    published `latest*.yml` carry neither key, so it is now the only source of
    in-app release notes.
  - A feed that cannot be read maps to `error`, never `none` — a rate-limited API
    rendering as "You are on the latest version." would be the same class of
    falsehood in a new place.
  - The tag pattern is anchored and stable-only. Under the generic provider
    `allowPrerelease` is read by nothing, so the pattern is the only guard that
    cannot be forgotten at publish time.
  - Feed resolution happens per check, not at construction, so a long-running app
    sees a release published after launch — and a `disabled` boot still makes no
    outbound call.
  - The release list is PAGINATED, and that is not incidental. The list is
    repository-wide and date-sorted, and the `v*` series is far denser than
    `desktop-v*`; reading a single page would work until 100 npm releases sat
    newer than the newest desktop release, at which point our tag falls out of the
    window and every install silently stops updating. Reading one repo-wide window
    and hoping the sparse series is inside it is the same assumption
    `/releases/latest` made.
  - Resolution runs on Electron's `net.fetch`, not Node's global `fetch`.
    electron-updater downloads through Chromium's network stack, which honours the
    system/PAC proxy, proxy authentication and the OS trust store; undici honours
    none of them. Resolving on undici while downloading on Chromium would fail
    every check on a managed machine even though the download would have worked.
  - The request carries a 10 s timeout, and a `Link: rel="next"` that points off
    `api.github.com` is never followed.

## 0.2.1

### Patch Changes

- Updated dependencies [4091a4f]
  - @adminium/server@0.2.1
  - @adminium/adapter-mysql@0.2.1
  - @adminium/adapter-postgres@0.2.1
  - @adminium/adapter-sqlite@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
- Updated dependencies [1d7c7b4]
  - @adminium/server@0.2.0
  - @adminium/adapter-postgres@0.2.0
  - @adminium/adapter-mysql@0.2.0
  - @adminium/adapter-sqlite@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies
  - @adminium/adapter-mysql@0.1.0
  - @adminium/adapter-postgres@0.1.0
  - @adminium/adapter-sqlite@0.1.0
  - @adminium/server@0.1.0

---

*A note on the entries above.* Some of them cited the internal work plan this
repository was built from — a document filename, a section, or a task id. That
plan was never published, so those citations were dead ends for every reader but
their author, and they were reworded on 2026-09-17. No entry's substance
changed: only the references went. The reasoning they pointed at is public now,
one short page per decision, at
<https://docs.adminium.dev/anatomy/decisions/>.
