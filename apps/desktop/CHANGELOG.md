# @adminium/desktop

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
