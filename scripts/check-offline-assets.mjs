#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline asset gate, deliverable 1 of:
 *
 * > `scripts/check-offline-assets.mjs` — scans the packaged app's renderer +
 * > dashboard build for `https?://` string literals outside an allowlist (docs
 * > deep-links, `shell.openExternal` targets). Runs in CI on every desktop build.
 *
 * The promise has two halves since the app also serves project folders, and
 * the gate checks each against its own list:
 *
 *  - THE CLASSIC WORKSPACE MAKES NO REQUEST. "The desktop build must be fully
 *    functional with the network cable unplugged, forever": the window, the
 *    dashboard and the main process name no remote address at all.
 *  - A PROJECT REACHES A SHORT, WRITTEN LIST, each address for one thing a
 *    person did: the npm registry once for a project's packages, the place an
 *    app was copied from, a picture site the person asked for, and the model
 *    they connected. That list is {@link PROJECT_REACHES}; the code that serves
 *    a project is scanned against it, so a new address there fails here and is
 *    read by someone before it ships. Without that half, this gate stayed
 *    green while "no request, ever" stopped being true of the app.
 *
 * One request is the app's own and is neither: git, fetched from its
 * publisher's releases on GitHub when a person with none says yes
 * (apps/desktop/src/main/git.ts). `github.com` was already on the list below
 * for the links the About screen opens; that one address is also dialled, once,
 * on a yes, and the file it sends must match a hash written in the app.
 *
 * What follows was written for the first half and holds for both. The offline smoke test proves that for the paths it
 * walks; this gate covers what a smoke test structurally cannot — a remote asset
 * on a page nobody clicked during the run. A `<link>` to Google Fonts on the login
 * screen, a CDN `<script>` in a rarely-hit route, a tile server behind a widget
 * the test never places: all green in a smoke test, all broken at 30,000 feet. So
 * this reads the BUILT BYTES and enumerates every URL in them.
 *
 * WHY IT REPORTS UNKNOWN HOSTS RATHER THAN JUST THE KNOWN-BAD ONES. A deny-list
 * only catches the CDNs someone thought of in July 2026. The failure this gate
 * exists to prevent — a dependency, or a hurried commit, adding a remote asset
 * nobody reviewed — is by definition one nobody thought of. So the default answer
 * is NO, and the allowlist below is the complete, reviewed set of URLs the product
 * is permitted to ship. It is short because almost nothing qualifies.
 *
 * The cost is honest and known: a dependency bump that adds a new URL string turns
 * this red, and someone has to look at it and either allowlist it with a reason or
 * remove it. That is the gate working, not the gate misfiring.
 *
 * WIRED (a gate nobody runs is not a gate — see the repo's "green but broken"
 * lesson):
 *   - `apps/desktop`'s `build` script runs it immediately after `electron-vite
 * build`, so "runs on every desktop build" is literal, locally and in CI;
 *   - root `package.json` exposes `pnpm run check-offline-assets`, which
 *     `.github/workflows/ci.yml` calls as a named step after the turbo build —
 *     matching how `check-deps` is wired.
 *
 * Usage: node scripts/check-offline-assets.mjs [--root <dir>]...
 *   --root          scan this directory instead of the defaults (repeatable). Used by
 *                   the test suite to point the scanner at a fixture.
 *   --project-root  the same, as code that serves a project (PROJECT_REACHES applies).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What ships to a user with no network, and therefore what must be clean.
 *
 * All three are REQUIRED: a scanner that silently finds nothing to scan is the
 * worst possible outcome — a permanently green gate over an unchecked build. If a
 * root is missing, the build did not run, and that is an error rather than a pass.
 */
const DEFAULT_ROOTS = [
  {
    path: 'apps/desktop/out/renderer',
    why: 'the shell\'s pre-server splash + crash pages — these render BEFORE any server exists, so a remote asset here is a blank window, not a slow one',
    build: 'pnpm --filter @adminium/desktop build',
  },
  {
    path: 'apps/desktop/out/dashboard',
    why: 'the dashboard build the packaged app actually serves over loopback (electron.vite.config.ts copies it here)',
    build: 'pnpm --filter @adminium/desktop build',
  },
  {
    path: 'apps/dashboard/dist',
    why: 'the SPA build itself — the same artifact self-host serves, scanned at its source so a dashboard-only change fails here rather than one package later',
    build: 'pnpm --filter @adminium/dashboard build',
  },
  {
    // Added 2026-08-29. The three roots above
    // are all RENDERER output: everything this gate has ever looked at runs in
    // Chromium. The MAIN process was never scanned, so `updates.mode:
    // 'disabled'` ⇒ "zero non-loopback requests" — the desktop's headline
    // offline promise — rested entirely on a runtime smoke test, with no
    // build-time check that a remote URL had not been linked into the process
    // that makes the requests.
    path: 'apps/desktop/out/main',
    kind: 'classic',
    why: 'the Electron MAIN process — the updater, the window lifecycle and the utilityProcess supervisor. A remote URL reachable here is a request made with no renderer involved, which no renderer-only scan can see',
    build: 'pnpm --filter @adminium/desktop build',
  },
  {
    // The code that serves a PROJECT inside the app: it installs packages,
    // copies apps and looks for pictures. It may name what PROJECT_REACHES
    // lists and nothing else.
    path: 'apps/server/dist/project',
    kind: 'project',
    why: 'what makes, installs and builds a project folder: the one place the npm registry and an app\'s source are named',
    build: 'pnpm --filter @adminium/server build',
  },
  {
    path: 'apps/server/dist/designer',
    kind: 'project',
    why: 'Adminium Designer\'s server side: its installs, its picture search and its preview',
    build: 'pnpm --filter @adminium/server build',
  },
];

/**
 * WHAT THIS GATE DELIBERATELY DOES NOT SCAN, AND WHY (amended).
 *
 * Plan 32 asked for "the main-process/server bundle". The main process is now
 * covered above. **The server is not, and should not be** — two reasons, both
 * structural rather than expedient:
 *
 *  1. THERE IS NO SERVER BUNDLE. `electron.vite.config.ts` externalizes
 *     `@adminium/server` on purpose ("`@adminium/server` runs unmodified —
 *     bundling modifies it"), so it ships from node_modules and produces no
 *     build output for a scanner to point at.
 *  2. MORE IMPORTANTLY, THE SERVER'S URLS FAIL THIS GATE'S PREMISE. Every
 *     ALLOWED_HOSTS entry certifies that a string is NEVER FETCHED. The server
 *     contains `telemetry.adminium.dev` (fetched when telemetry is on),
 *     `api.github.com` (fetched when the update check is on) and now
 *     `adminium.dev` + `downloads.adminium.dev` (fetched when the add-on catalog
 *     is on). Allowlisting those would mean writing "never fetched" next to four
 *     hostnames that are fetched — which does not tighten this gate, it empties
 *     it, and it would do so silently for every future entry too.
 *
 * The server's offline guarantee is a DIFFERENT KIND OF CLAIM — "off means
 * zero calls", not "this string is inert" — and it is proved where such a claim
 * can actually be proved: `telemetry-network-isolation.test.ts` and
 * `add-on-network-isolation.test.ts`, which replace fetch/net/http/https with
 * recording throwers and assert the recorder stays empty. Plan says as much
 * itself ("the primary isolation proof remains the extended network-isolation
 * test either way").
 */

/**
 * Only files that can ISSUE a request. Scripts and stylesheets are executed and
 * parsed by the browser; HTML is what loads them.
 *
 * `.map` is excluded on purpose, and it is the one exclusion worth arguing: a
 * sourcemap embeds the ORIGINAL sources, comments and all, so scanning them would
 * flag every URL this repo cites in a header — including the ones in this
 * file's own dependency chain. Devtools fetch a sourcemap only when a human opens
 * them, and nothing in it is ever evaluated. Fonts, images and other binaries are
 * excluded for the same reason: they are the assets, not the loaders of assets.
 */
const SCANNED_EXTENSIONS = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.css']);

/**
 * Every `http(s)://…` literal, however it is quoted — INCLUDING the escaped form
 * `https:\/\/…`, which is what a URL inside a JSON string baked into a bundle
 * looks like. Without the `\\?`, `https:\/\/tile.openstreetmap.org` was invisible
 * to a gate whose entire job is to notice `tile.openstreetmap.org`.
 */
const URL_PATTERN = /\bhttps?:(?:\\?\/){2}[^\s"'`<>()\\]+/gi;

/**
 * Scheme-relative URLs — `//fonts.googleapis.com/css2?family=Inter`.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Every pattern in this file used to require a literal `https?://`, so a URL
 * written without a scheme was invisible to all of them. That is not an exotic
 * form: `//fonts.googleapis.com/css2` is the CANONICAL historical Google Fonts
 * embed, it is what half the snippets on the web still say, and on our
 * loopback-served page it resolves to `http://fonts.googleapis.com/…` — a real
 * remote request. A fixture with a protocol-relative Google Fonts <link>, a
 * gstatic preconnect and a jsDelivr <script> passed this gate clean, which
 * defeated all four BLOCKED_HOSTS entries — the very hosts the list above says
 * an allowlist entry must never be able to cover. Nothing catches it at runtime
 * either: there is no CSP on the SPA, and `will-navigate` governs navigation,
 * not subresources.
 *
 * ─── WHY IT IS NOT JUST `\/\/[^\s]+` ────────────────────────────────────────
 *
 * `//` is also the JavaScript line comment. A bare match would flag every
 * comment in every bundle. So a hit requires BOTH:
 *
 *  1. a preceding `"`, `'`, `` ` `` or `(` — a URL is a string or a `url(…)`
 *     argument; a comment is neither. This is what excludes `// see the note above`.
 *  2. a DOTTED host immediately after the slashes — `//fonts.googleapis.com`,
 *     never `//` or `//#sourceMappingURL` or `// eslint-disable`.
 *
 * Both conditions have to hold, which is why a comment cannot satisfy it: even
 * `"// text"` fails (2), and `//a.b` in a comment fails (1).
 */
const PROTOCOL_RELATIVE_PATTERN =
  /(?<=["'`(])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#][^\s"'`<>()\\]*)?/gi;

/**
 * Hosts that fail even if a future edit adds them to the allowlist below.
 *
 * This list is redundant with the allowlist — an unknown host already fails — and
 * that redundancy is the point: it guards the guard. These are the names an
 * allowlist entry must never be able to cover, so the day someone is fighting a
 * red build at 6pm and reaches for the allowlist, the ones that would silently
 * void the offline guarantee reject the shortcut and say why.
 */
const BLOCKED_HOSTS = [
  {
    test: /(^|\.)fonts\.googleapis\.com$/,
    why: 'the offline contract\'s fonts row: Manrope/JetBrains Mono/IBM Plex Sans Arabic are self-hosted woff2 in @adminium/tokens. A Google Fonts stylesheet means unstyled text offline',
  },
  {
    test: /(^|\.)fonts\.gstatic\.com$/,
    why: 'the offline contract\'s fonts row: where Google Fonts serves the actual woff2. Same failure, one hop later',
  },
  {
    test: /(^|\.)tile\.openstreetmap\.org$/,
    why: "the offline contract\'s maps row: OpenStreetMap's own tile server. Its presence means a map is reaching for tiles — the desktop app resolves map-* to the tilegram precisely so nothing does",
  },
  {
    test: /(^|\.)(openfreemap\.org|cartocdn\.com)$/,
    why:
      "the offline contract\'s maps row: a map server's address written INTO the build. The map server is the operator's (ADMINIUM_MAP_SERVER) and reaches a signed-in page through the session " +
      '(bootstrap.maps), only while maps are on; the content security policy allows that one origin and no other. An address in the bundle is a second source of truth the policy knows nothing about, ' +
      'and in the desktop app a map that could ask for it. The default server and the one it replaced are named here so neither can come back by a constant',
  },
  {
    test: /(^|\.)(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|code\.jquery\.com)$/,
    why: 'the offline contract\'s icons row: "no CDN <script>/<link> allowed". Everything the app runs is bundled; a package CDN means it is not',
  },
];

/**
 * The complete set of URLs the built product is permitted to contain, by host.
 *
 * ── TWO KINDS OF ENTRY, AND THE DIFFERENCE MATTERS ──────────────────────────
 *
 * **INERT (the original kind, and still the default).** The string is NEVER
 * FETCHED BY THE APP — an identifier, an error message, a placeholder, or a
 * link a human clicks that opens in the system browser. Adding one means
 * claiming exactly that, in the `why`.
 *
 * **OPT-IN OUTBOUND (added 2026-08-29 with the main-process root).** The string
 * IS fetched — but only by a feature that is off by default, individually
 * disableable, and whose off-state is asserted at RUNTIME by a test that records
 * connection attempts. These entries carry `optIn: true` and must name the
 * switch and the test in the `why`.
 *
 * The second kind exists because scanning the main process made it necessary and
 * honest: the update check really does reach `api.github.com`, and writing
 * "never fetched" beside it to keep the gate green would have quietly converted
 * every future entry into a lie too. Naming the category instead keeps the
 * inert claim strong — the day someone adds an opt-in entry, they have to say
 * which switch turns it off and which test proves it.
 *
 * The bar for `optIn` is deliberately high: off by default, individually
 * disableable, runtime-asserted. A host that is merely "usually not used" does
 * not qualify and cannot ship.
 */
/*
 * AN ENTRY MAY BE NARROWER THAN ITS HOST (`onlyPath`). Most entries certify a
 * whole host ("this name is never fetched"). Some certify ONE STRING — a link
 * a person taps, a line of an error message — on a host that serves a great
 * deal else, and for those the host alone is too wide: `maps.apple.com` was
 * allowed for an `<a href>` and so also passed as an `img.src`, an `import()`
 * and a `fetch()`. An entry with `onlyPath` covers its host only where
 *   1. what follows the host (path, query, fragment) matches `onlyPath`, and
 *   2. the string is not written where JavaScript loads it
 *      ({@link LOADED_IN_SCRIPT}): the argument of `fetch(`, `import(`,
 *      `importScripts(`, `new Worker(`…, or the value of a `src`.
 * Anything else on that host fails by a rule of its own, so the report says
 * the host is known and what about this use of it is not.
 */
const ALLOWED_HOSTS = [
  {
    test: /^www\.w3\.org$/,
    why: 'XML namespace URIs (SVG, MathML, xlink) — identifiers React and every icon write into the DOM. A namespace is never dereferenced',
  },
  {
    test: /^json-schema\.org$/,
    why: 'JSON Schema dialect identifiers ($schema) emitted by Zod. Identifiers, same as above',
  },
  {
    test: /^www\.figma\.com$/,
    why: 'the placeholder of the Designer\'s "From Figma…" link field, showing the shape of a link to paste. Text in an input, never requested: the server reads Figma, the window does not',
  },
  {
    test: /^docs\.adminium\.dev$/,
    why: 'the docs site. Docs links open the SYSTEM BROWSER via shell.openExternal — the app never embeds remote content',
  },
  {
    test: /^github\.com$/,
    why: 'the AGPL-3.0 source link and the releases page on the About screen. shell.openExternal, same as the docs',
  },
  {
    test: /^www\.openstreetmap\.org$/,
    why: 'the map\'s "open this place on a map" link for a device with no maps app (widgets families/geo/map-shapes.ts mapsSiteHref). An anchor the person presses, opened outside the app (shell.openExternal, same as the docs); nothing is requested from it. The map\'s TILES are a different host, named by the operator and switched off in the desktop build',
  },
  {
    test: /^(react\.dev|www\.i18next\.com|locize\.com)$/,
    why: 'error-message and attribution strings baked into React and i18next. Printed to a console, never requested',
  },
  {
    test: /^reactflow\.dev$/,
    why:
      'the React Flow attribution badge in the schema diagram (@xyflow/react, studio/remap/diagram/DiagramMode.tsx). Same kind as the react.dev entry above and, in the desktop build, the same kind as docs/github: ' +
      'the library renders `<a href="https://reactflow.dev?utm_source=attribution" target="_blank" rel="noopener noreferrer">React Flow</a>` in a corner Panel, plus the identical string in a `data-message` attribute. ' +
      'An anchor is not a fetch, and the navigation lockdown means a click cannot navigate the window either: `setWindowOpenHandler` allows only `http://127.0.0.1:<port>` and hands everything else to `shell.openExternal`, i.e. the system browser. ' +
      'Offline the badge still renders and a click simply fails in the browser, so nothing about the diagram degrades. NOTE the attribution is shown DELIBERATELY — DiagramMode sets `proOptions={{ hideAttribution: false }}`, and xyflow asks that it only be hidden under a React Flow Pro subscription. ' +
      'Hiding it would remove this entry\'s subject; that is a licensing decision, not a way to quiet this gate',
  },
  {
    // Deliberately NOT `^\$\{e\}flow\.dev$`. `e` is a MINIFIER-CHOSEN name —
    // the source is `` `https://${lib}flow.dev/error#001` `` in @xyflow/system —
    // so pinning the letter would make this entry fall off on any terser or
    // dependency bump, and the gate would go red for a string that had not
    // changed. The host is anchored on `flow.dev` instead, which is what makes
    // it narrow: a future `${config.remoteHost}` still fails, exactly as the
    // `${hostname}` entry below intends for its own four.
    test: /^\$\{[A-Za-z_$][\w$]*\}flow\.dev$/,
    why:
      'React Flow\'s own error text: `error001: (lib = \'react\') => `…Help: https://${lib}flow.dev/error#001`` in @xyflow/system, which minifies to `https://${e}flow.dev/error#001`. ' +
      'Same kind as the react.dev entry above — a string thrown or printed to a console when a developer nests a component wrong. Never fetched, and unreachable at all in a correctly mounted tree',
  },
  {
    test: /^(nyc3\.digitaloceanspaces\.com|fly\.storage\.tigris\.dev|s3\.us-west-004\.backblazeb2\.com|s3\.eu-central-1\.wasabisys\.com)$/,
    why:
      'the four non-AWS S3 presets in the storage-destination editor (studio/storage/storageApi.ts S3_PRESETS). The same kind as api.groq.com below: text in a settings form. ' +
      'Three are `endpointHint` only — placeholder attributes on an input whose value is the empty string — and Tigris is the one preset that also carries a default `endpoint`, i.e. a value that is written into the DRAFT when an admin picks that provider. ' +
      'The dashboard never dials any of them: every request this surface makes goes to loopback `/api/v1/storage/...`, INCLUDING the "test connection" probe (`POST /api/v1/storage/destinations/test`), which is deliberately server-side so credentials never leave the server. ' +
      'An admin who selects a preset, types their keys and saves has configured their OWN bucket, and it is the server — not scanned here, by this file\'s own design — that talks to it. That is configuration, not a remote asset the product ships. ' +
      'They are NOT `optIn`: that category\'s bar is a named default-off switch plus a runtime test recording connection attempts, and a settings placeholder does not meet it and does not need to',
  },
  {
    test: /^api\.groq\.com$/,
    why: 'a provider catalog base URL. The offline contract\'s LLM row: provider-API mode is opt-in and labeled "requires internet"; unconfigured, this is a placeholder in a settings form',
  },
  {
    test: /^api\.adminium\.app$/,
    why: 'the example request in the API-keys quick-start snippet — sample text in a <pre>, addressed to the user\'s own instance',
  },
  {
    test: /^maps\.apple\.com$/,
    // The one address that is written: a position handed to the maps app.
    onlyPath: /^\/\?ll=/,
    why:
      'the "Open in my maps app" link beside a place in the map\'s list, on Apple devices (families/geo/map-shapes.ts mapsAppHref; everywhere else the link is `geo:`, which is no URL at all). ' +
      'An `<a href>` a person taps to hand one position to their own maps app. The app itself never asks this host for anything: no fetch, no image, no script',
  },
  {
    test: /^(maplibre\.org|wiki\.openstreetmap\.org)$/,
    // The two strings as MapLibre writes them: its home page, and one wiki page.
    onlyPath: /^(\/?|\/wiki\/This_map_requires_WebGL)$/,
    why:
      'two strings baked into MapLibre GL JS (maplibre-gl, loaded only when a map is drawn). `maplibre.org` is the href of its optional logo control, an anchor this app never adds; ' +
      '`wiki.openstreetmap.org/wiki/This_map_requires_WebGL` is printed in its "no WebGL" error message. Neither is requested. ' +
      'THE MAP SERVER IS NOT HERE AND MUST NEVER BE: its address comes with the session (bootstrap.maps), is written nowhere in the bundle, and the default one is on the must-fail list above',
  },
  // ── Loopback: not remote at all ──────────────────────────────────────────
  {
    test: /^127\.0\.0\.1(:.*)?$/,
    why: 'the embedded server on loopback — the address the shell dials to reach its OWN utilityProcess. Never leaves the machine, and the offline build depends on it working',
  },
  {
    // Scoped to the four placeholders that actually exist rather than a blanket
    // `${...}`: the whole value of this gate is that a NEW remote URL fails it,
    // and `^\$\{.*\}$` would wave through a future `${config.remoteHost}`.
    test: /^\$\{(hostname|entry\.address|message\.host|host)\}(:.*)?$/,
    why:
      'URL templates whose host is filled in at runtime from an address this machine already owns, so the literal in the bundle has no origin at all. ' +
      'All four are accounted for: `${hostname}` and `${entry.address}` build the LAN-share URL from a local network interface (main/lan.ts:96); ' +
      '`${message.host}` is the address the embedded server reports it BOUND to, echoed back over IPC (main/server-manager.ts:604); `${host}` is the same in the server\'s own boot log. ' +
      'None can resolve to a remote origin — a change that made one able to would show up here as a new, unmatched literal',
  },
  // ── Opt-in outbound (see the two-kinds note above) ───────────────────────
  {
    test: /^api\.github\.com$/,
    optIn: true,
    why:
      'the desktop update check (apps/desktop/src/main/updates.ts). FETCHED, and the entry says so: this is the first `optIn` entry and the reason that category exists. ' +
      'It is off unless the user turns it on, `updates.mode: \'disabled\'` is a hard veto, and the guarantee that disabled means ZERO non-loopback requests is asserted at runtime by the offline smoke test — ' +
      'not by this gate, which can only see that the string is present. Scanning the main process is what surfaced it; it was invisible while this gate looked only at renderer output',
  },
  {
    test: /^adminium\.dev$/,
    optIn: true,
    why:
      'the add-on catalog feed (apps/server/src/add-ons/catalog.ts). Listed for the day the server is scanned or a main-process surface links it — it is fetched ONLY when the default-off ' +
      '`addOns.catalogEnabled` setting is on AND `ADMINIUM_NETWORK_FEATURES` is on, either veto being sufficient. `add-on-network-isolation.test.ts` records connection attempts and asserts the recorder stays empty under either',
  },
  {
    test: /^downloads\.adminium\.dev$/,
    optIn: true,
    why:
      'the add-on files, the other half of the add-on catalog. Same two vetoes and the same recording-thrower proof as adminium.dev above. ' +
      'An INSTALL-TIME dependency only — nothing reaches it at boot or at serve time, so a deployment that never downloads an add-on never contacts it',
  },
  {
    test: /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
    why: 'loopback. The desktop renderer loads http://127.0.0.1:<port>. Ollama\'s :11434 default in the LLM provider catalog is the same shape — a local process, not a network',
  },
  {
    test: /^\[\$\{/,
    why: "Zod's cidrv6 validator does `new URL(`http://[${addr}]`)` to parse a candidate address. A URL constructor call on a template literal — no host, no request. The bracket prefix keeps this from covering any real name",
  },
  {
    test: /(^|\.)(example\.(com|net|org|gov)|acme\.dev)$|\.(example|invalid|test|localhost)$/,
    why: 'demo and placeholder data (webhook fixtures, the media family\'s broken-image poster, doc snippets). RFC 2606/6761 reserves these names so they can never resolve — which is exactly why the fixtures use them',
  },
  {
    test: /^…$/,
    why: 'the ellipsis placeholder in the link-list widget\'s URL input ("https://…"), translated into all 8 locales. An input placeholder — the string is rendered as a hint, and the ellipsis is not a hostname anything could resolve',
  },
];

/**
 * What a PROJECT's server may reach, beyond the list above: the whole of it.
 *
 * Each entry is one thing a person did, said in `when`. An address that is not
 * here and not in ALLOWED_HOSTS fails the gate in the code that serves a
 * project; and every address here STILL FAILS in the classic workspace's own
 * outputs (the window, the dashboard, the main process), which is how "the
 * classic workspace makes no request" stays checked.
 */
const PROJECT_REACHES = [
  {
    test: /^registry\.npmjs\.org$/,
    when: 'a project\'s packages are installed: once for a new project, again when a package is added or the folder came from another machine. The one registry the carried npm is pointed at',
  },
  {
    test: /^(codeload\.)?github(\.com)?$/,
    when: 'the person starts from an app in the catalogue: its archive is fetched from the repository the catalogue names, at the version\'s tag (and the pattern that recognizes such an address)',
  },
  {
    test: /^(api|images|www)\.pexels\.com$|^(api\.)?unsplash\.com$|^api\.openverse\.org$|^\$\{unsplash_host\}$/,
    when: 'the Designer looks for pictures for a project\'s screens: only a site the person allowed, with their own key where the site needs one; the licence pages are links',
  },
  {
    test: /^api\.figma\.com$/,
    when: 'the person imports a frame from Figma in the Designer, or the Designer reads a part of one in their turn: with their own token, and only while network features are on',
  },
  {
    test: /^localhost:\$\{string$/,
    when: 'never leaves the machine: the preview\'s own name, the same port as the Designer\'s under `localhost`',
  },
  {
    test: /^$|^\[\^$/,
    when: 'not an address: a bare scheme prefix (`\'https://\'`, where a typed address is checked) and the start of a pattern that tests for one (`https:\\/\\/[^…]`). No host follows, so nothing can be asked for',
  },
];

/**
 * Absolute URLs in ASSET-LOADING POSITIONS. Unlike everything above, these fail
 * regardless of host: the allowlist certifies that a string is never fetched, and
 * a `<script src>` is the compiled proof that it is. the offline contract\'s icons row, "no CDN
 * `<script>`/`<link>` allowed by CSP" — asserted at build time rather than trusted
 * to a CSP header the packaged app would have to get right at runtime.
 *
 * `(?:https?:)?` in all three: the SCHEME IS OPTIONAL. In an asset position the
 * `//` is unambiguous — an `href`, a `url(…)` and an `@import` are never a
 * JavaScript comment — so this needs none of {@link PROTOCOL_RELATIVE_PATTERN}'s
 * guards, and a scheme-relative `<link>` to Google Fonts fails here on position
 * alone, before any host is even consulted.
 */
const ASSET_POSITION_PATTERNS = [
  {
    id: 'html-remote-tag',
    test: /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']?((?:https?:)?\/\/[^"'>\s]+)/gi,
    why: 'a remote <script>/<link>: the page cannot render without the network',
    extensions: ['.html', '.htm'],
  },
  {
    id: 'css-remote-url',
    test: /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi,
    why: 'a stylesheet fetching a remote asset (font, image)',
    extensions: ['.css', '.html', '.htm'],
  },
  {
    id: 'css-remote-import',
    test: /@import\s+(?:url\(\s*)?["']((?:https?:)?\/\/[^"']+)/gi,
    why: 'a stylesheet @import-ing a remote stylesheet — how Google Fonts is usually added',
    extensions: ['.css', '.html', '.htm'],
  },
];

/**
 * What comes just before a URL literal when JavaScript LOADS it rather than
 * shows it: tested against the text up to the literal. An `<a href>` and a
 * string in a message are not here; a `src` is (an image, a script, a frame),
 * in a property (`img.src=`), an object (`{src:`) or markup in a string.
 */
const LOADED_IN_SCRIPT =
  /(?:(?:\bfetch|\bimport|\bimportScripts|\bnew\s+(?:Worker|SharedWorker|Request|EventSource|WebSocket|Image))\s*\(\s*|(?:^|[^\w$])src\s*[=:]\s*)["'`]?$/;

/** How much text before a literal is looked at for {@link LOADED_IN_SCRIPT}. */
const LOADED_LOOKBEHIND = 64;

/** What follows the host in a URL literal: path, query and fragment, as written. */
function restOf(url) {
  const normalized = url.replace(/\\\//g, '/');
  const afterScheme = normalized.startsWith('//') ? normalized.slice(2) : normalized.slice(normalized.indexOf('://') + 3);
  const start = afterScheme.search(/[/?#]/);
  // A URL that ends an English sentence: the full stop is not part of it.
  return start === -1 ? '' : afterScheme.slice(start).replace(/[.,;:!]+$/, '');
}

/**
 * The host of a URL literal, lowercased, port kept.
 *
 * The port stays because `localhost:11434` reads as itself in a report, and the
 * allowlist patterns that care about ports say so. Trailing punctuation is
 * stripped: a URL at the end of an English sentence in a bundled string is common
 * and `docs.adminium.dev.` is not a different host.
 */
function hostOf(url) {
  // `https:\/\/host` → `https://host`. A URL inside a JSON string in a bundle is
  // escaped, and the host is the same host either way.
  const normalized = url.replace(/\\\//g, '/');
  // Scheme-relative (`//host/…`) is checked FIRST rather than by searching for
  // `://`: a `//host/?next=http://elsewhere` would otherwise report `elsewhere`
  // as the host and allowlist the wrong name.
  const afterScheme = normalized.startsWith('//')
    ? normalized.slice(2)
    : normalized.slice(normalized.indexOf('://') + 3);
  const end = afterScheme.search(/[/?#]/);
  const authority = end === -1 ? afterScheme : afterScheme.slice(0, end);
  // Drop any userinfo (`user:pass@host`) — the host is what gets connected to.
  const at = authority.lastIndexOf('@');
  return authority
    .slice(at + 1)
    .replace(/[.,;:!]+$/, '')
    .toLowerCase();
}

function matches(rules, host) {
  return rules.find((rule) => rule.test.test(host));
}

/** Every scannable file under `dir`, recursively. */
function scannableFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scannableFiles(full));
    else if (SCANNED_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

/** Repo-relative when it is in the repo; absolute otherwise (a `--root` fixture). */
function displayPath(file) {
  const rel = relative(repoRoot, file);
  return rel.startsWith('..') ? file : rel;
}

function checkFile(file, kind = 'classic') {
  const violations = [];
  const text = readFileSync(file, 'utf8');
  const where = displayPath(file);
  const ext = extname(file).toLowerCase();

  for (const rule of ASSET_POSITION_PATTERNS) {
    if (!rule.extensions.includes(ext)) continue;
    // Fresh lastIndex per file: these are module-level /g regexes.
    rule.test.lastIndex = 0;
    for (const match of text.matchAll(rule.test)) {
      violations.push({ file: where, url: match[1], rule: rule.id, why: rule.why });
    }
  }

  // Both literal shapes go through the SAME host rules. A scheme-relative
  // `//fonts.googleapis.com` is a Google Fonts request exactly as much as the
  // `https://` spelling is, so BLOCKED_HOSTS must see it too — the four names it
  // guards were fully bypassable by dropping six characters.
  const literals = [...text.matchAll(URL_PATTERN), ...text.matchAll(PROTOCOL_RELATIVE_PATTERN)];
  for (const match of literals) {
    const url = match[0];
    const host = hostOf(url);
    const blocked = matches(BLOCKED_HOSTS, host);
    if (blocked !== undefined) {
      violations.push({ file: where, url, rule: 'blocked-host', why: blocked.why });
      continue;
    }
    const allowed = matches(ALLOWED_HOSTS, host);
    if (allowed !== undefined) {
      // An entry for one string, not for its whole host: see the note above ALLOWED_HOSTS.
      if (allowed.onlyPath === undefined) continue;
      if (!allowed.onlyPath.test(restOf(url))) {
        violations.push({
          file: where,
          url,
          rule: 'allowed-host-other-address',
          why: `'${host}' is allowed for one address only (${String(allowed.onlyPath)}), and this is another. What is allowed there: ${allowed.why}`,
        });
        continue;
      }
      const before = text.slice(Math.max(0, match.index - LOADED_LOOKBEHIND), match.index);
      if (LOADED_IN_SCRIPT.test(before)) {
        violations.push({
          file: where,
          url,
          rule: 'allowed-host-loaded',
          why: `'${host}' is allowed as a link or a printed string, never as something the app loads, and here it is a fetch, an import or a src. What is allowed there: ${allowed.why}`,
        });
      }
      continue;
    }
    if (kind === 'project' && matches(PROJECT_REACHES, host) !== undefined) continue;
    if (kind !== 'project' && matches(PROJECT_REACHES, host) !== undefined) {
      violations.push({
        file: where,
        url,
        rule: 'project-address-in-the-classic-workspace',
        why: `'${host}' is an address only a project's server may reach (PROJECT_REACHES). Here it is in the classic workspace's own output, which makes no request at all`,
      });
      continue;
    }
    {
      violations.push({
        file: where,
        url,
        rule: kind === 'project' ? 'unlisted-project-address' : 'unallowlisted-host',
        why: `'${host}' is not in the allowlist. If this URL is never fetched by the app (an identifier, an error string, a placeholder, or a shell.openExternal target), add it to ALLOWED_HOSTS in scripts/check-offline-assets.mjs with the reason. If it IS fetched, it cannot ship: the desktop build has to work offline, forever`,
      });
    }
  }
  return violations;
}

function parseRoots(argv) {
  const roots = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--root' && argv[i] !== '--project-root') continue;
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${argv[i]} needs a directory`);
    roots.push({ path: value, kind: argv[i] === '--project-root' ? 'project' : 'classic', why: `passed with ${argv[i]}`, build: null });
    i += 1;
  }
  return roots.length > 0 ? roots : DEFAULT_ROOTS;
}

function main() {
  const roots = parseRoots(process.argv.slice(2));
  const violations = [];
  let scanned = 0;

  for (const root of roots) {
    const dir = resolve(repoRoot, root.path);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      console.error(`[offline-assets] MISSING BUILD OUTPUT: ${root.path}`);
      console.error(`  what it is: ${root.why}`);
      if (root.build !== null) console.error(`  build it:   ${root.build}`);
      console.error('  Refusing to pass: a scan with nothing to scan is not a check.');
      process.exit(1);
    }
    const files = scannableFiles(dir);
    scanned += files.length;
    for (const file of files) violations.push(...checkFile(file, root.kind ?? 'classic'));
  }

  if (violations.length > 0) {
    // One URL in one shared module lands in every chunk that imports it, so
    // reporting per occurrence buries one mistake under a dozen identical
    // paragraphs. Group by the thing a human has to decide about — the URL —
    // and list where it surfaced underneath.
    const byUrl = new Map();
    for (const violation of violations) {
      const key = `${violation.rule}\x00${violation.url}`;
      const group = byUrl.get(key) ?? { ...violation, files: [] };
      group.files.push(violation.file);
      byUrl.set(key, group);
    }

    console.error(`\n[offline-assets] ${byUrl.size} violation(s) — the offline contract\n`);
    for (const group of byUrl.values()) {
      console.error(`  ✗ ${group.url}`);
      console.error(`    rule: ${group.rule}`);
      console.error(`    why:  ${group.why}`);
      const shown = [...new Set(group.files)];
      for (const file of shown.slice(0, 5)) console.error(`    in:   ${file}`);
      if (shown.length > 5) console.error(`    in:   …and ${shown.length - 5} more file(s)`);
      console.error('');
    }
    console.error('The desktop build must work with the network cable unplugged, forever.\n');
    process.exit(1);
  }

  console.log(
    `[offline-assets] ok — ${scanned} file(s) across ${roots.length} build output(s); every URL literal is allowlisted.`,
  );
}

main();
