#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline asset gate — 11-electron.md §7, deliverable 1 of 11-T09:
 *
 * > `scripts/check-offline-assets.mjs` — scans the packaged app's renderer +
 * > dashboard build for `https?://` string literals outside an allowlist (docs
 * > deep-links, `shell.openExternal` targets). Runs in CI on every desktop build.
 *
 * §7's promise is that "the desktop build must be fully functional with the
 * network cable unplugged, forever". The offline smoke test (11-T18) proves that
 * for the paths it walks; this gate covers what a smoke test structurally cannot —
 * a remote asset on a page nobody clicked during the run. A `<link>` to Google
 * Fonts on the login screen, a CDN `<script>` in a rarely-hit route, a tile server
 * behind a widget the test never places: all green in a smoke test, all broken at
 * 30,000 feet. So this reads the BUILT BYTES and enumerates every URL in them.
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
 *     build`, so §7's "runs on every desktop build" is literal, locally and in CI;
 *   - root `package.json` exposes `pnpm run check-offline-assets`, which
 *     `.github/workflows/ci.yml` calls as a named step after the turbo build —
 *     matching how `check-deps` is wired.
 *
 * Usage: node scripts/check-offline-assets.mjs [--root <dir>]...
 *   --root  scan this directory instead of the defaults (repeatable). Used by the
 *           test suite to point the scanner at a fixture.
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
    why: 'the shell\'s pre-server splash + crash pages (§2.2 step 6) — these render BEFORE any server exists, so a remote asset here is a blank window, not a slow one',
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
    // Added 2026-08-29 (32-add-on-distribution.md §4.5). The three roots above
    // are all RENDERER output: everything this gate has ever looked at runs in
    // Chromium. The MAIN process was never scanned, so `updates.mode:
    // 'disabled'` ⇒ "zero non-loopback requests" — the desktop's headline
    // offline promise — rested entirely on a runtime smoke test, with no
    // build-time check that a remote URL had not been linked into the process
    // that makes the requests.
    path: 'apps/desktop/out/main',
    why: 'the Electron MAIN process — the updater, the window lifecycle and the utilityProcess supervisor. A remote URL reachable here is a request made with no renderer involved, which no renderer-only scan can see',
    build: 'pnpm --filter @adminium/desktop build',
  },
];

/**
 * WHAT THIS GATE DELIBERATELY DOES NOT SCAN, AND WHY (32 §4.5, amended).
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
 *     `adminium.dev` + `registry.npmjs.org` (fetched when the add-on catalog is
 *     on). Allowlisting those would mean writing "never fetched" next to four
 *     hostnames that are fetched — which does not tighten this gate, it empties
 *     it, and it would do so silently for every future entry too.
 *
 * The server's offline guarantee is a DIFFERENT KIND OF CLAIM — "off means
 * zero calls", not "this string is inert" — and it is proved where such a claim
 * can actually be proved: `telemetry-network-isolation.test.ts` and
 * `add-on-network-isolation.test.ts`, which replace fetch/net/http/https with
 * recording throwers and assert the recorder stays empty. Plan 32 §4.5 says as
 * much itself ("the primary isolation proof remains the extended
 * network-isolation test either way").
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
 *     argument; a comment is neither. This is what excludes `// see §7 above`.
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
 * that redundancy is the point: it guards the guard. These are the four §7 names
 * an allowlist entry must never be able to cover, so the day someone is fighting a
 * red build at 6pm and reaches for the allowlist, the four that would silently
 * void the offline guarantee reject the shortcut and say why.
 */
const BLOCKED_HOSTS = [
  {
    test: /(^|\.)fonts\.googleapis\.com$/,
    why: '§7 fonts row: Manrope/JetBrains Mono/IBM Plex Sans Arabic are self-hosted woff2 in @adminium/tokens. A Google Fonts stylesheet means unstyled text offline',
  },
  {
    test: /(^|\.)fonts\.gstatic\.com$/,
    why: '§7 fonts row: where Google Fonts serves the actual woff2. Same failure, one hop later',
  },
  {
    test: /(^|\.)tile\.openstreetmap\.org$/,
    why: "§7 maps row: Leaflet's default tile server. Its presence means a map is reaching for tiles — the desktop app resolves map-* to the tilegram precisely so nothing does",
  },
  {
    test: /(^|\.)(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|code\.jquery\.com)$/,
    why: '§7 icons row: "no CDN <script>/<link> allowed". Everything the app runs is bundled; a package CDN means it is not',
  },
];

/**
 * The complete set of URLs the built product is permitted to contain, by host.
 *
 * ── TWO KINDS OF ENTRY, AND THE DIFFERENCE MATTERS ──────────────────────────
 *
 * **INERT (the original kind, and still the default).** The string is NEVER
 * FETCHED BY THE APP — an identifier, an error message, a placeholder, or a
 * link a human clicks that opens in the system browser (§2.4). Adding one means
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
    test: /^docs\.adminium\.dev$/,
    why: 'the docs site (14-docs-site.md). §2.4: docs links open the SYSTEM BROWSER via shell.openExternal — the app never embeds remote content',
  },
  {
    test: /^github\.com$/,
    why: 'the AGPL-3.0 source link and the releases page on the About screen (§13). shell.openExternal, same as the docs',
  },
  {
    test: /^(react\.dev|www\.i18next\.com|locize\.com|leafletjs\.com)$/,
    why: 'error-message and attribution strings baked into React, i18next and Leaflet. Printed to a console or an attribution corner, never requested',
  },
  {
    test: /^api\.groq\.com$/,
    why: '06-llm-assist.md provider catalog base URL. §7 LLM row: provider-API mode is opt-in and labeled "requires internet"; unconfigured, this is a placeholder in a settings form',
  },
  {
    test: /^api\.adminium\.app$/,
    why: 'the example request in the API-keys quick-start snippet (M10-T06) — sample text in a <pre>, addressed to the user\'s own instance',
  },
  {
    test: /^\{s\}\.basemaps\.cartocdn\.com$/,
    why:
      'map-bubble\'s basemap tiles (families/geo/geo-lib.ts CARTO_TILES) — the ONE entry here that is a real remote asset, so it gets the long reason. ' +
      'It cannot be removed: a bubble map on self-host is a bubble map, and it needs tiles. It is safe in the OFFLINE build because nothing ever reads it there — ' +
      '§7\'s registry fallback (registry/offline.ts) resolves every map-* id to map-choropleth-grid before the lazy ref is touched, so MapBubble never mounts, ' +
      'never imports Leaflet, and never constructs a tileLayer from this template. The string rides along in the bundle as dead weight; the guarantee is that no ' +
      'code path reaches it, and 11-T18\'s offline smoke test asserts the runtime half (zero tile requests). Note the {s} — this matches Leaflet\'s subdomain ' +
      'template EXACTLY, so a plain cartocdn.com URL added by hand would not be covered by this entry and would fail the gate',
  },
  // ── Loopback: not remote at all ──────────────────────────────────────────
  {
    test: /^127\.0\.0\.1(:.*)?$/,
    why: 'the embedded server on loopback — the address the shell dials to reach its OWN utilityProcess (§2.1). Never leaves the machine, and the offline build depends on it working',
  },
  {
    // Scoped to the four placeholders that actually exist rather than a blanket
    // `${...}`: the whole value of this gate is that a NEW remote URL fails it,
    // and `^\$\{.*\}$` would wave through a future `${config.remoteHost}`.
    test: /^\$\{(hostname|entry\.address|message\.host|host)\}(:.*)?$/,
    why:
      'URL templates whose host is filled in at runtime from an address this machine already owns, so the literal in the bundle has no origin at all. ' +
      'All four are accounted for: `${hostname}` and `${entry.address}` build the LAN-share URL from a local network interface (main/lan.ts:96, §5); ' +
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
      'the add-on catalog feed (32-add-on-distribution.md D2/D8; apps/server/src/add-ons/catalog.ts). Listed for the day the server is scanned or a main-process surface links it — it is fetched ONLY when the default-off ' +
      '`addOns.catalogEnabled` setting is on AND `ADMINIUM_NETWORK_FEATURES` is on, either veto being sufficient. `add-on-network-isolation.test.ts` records connection attempts and asserts the recorder stays empty under either',
  },
  {
    test: /^registry\.npmjs\.org$/,
    optIn: true,
    why:
      'the npm packument + tarball, the other half of the add-on catalog (D2). Same two vetoes and the same recording-thrower proof as adminium.dev above. ' +
      'npm is an INSTALL-TIME dependency only — nothing reaches it at boot or at serve time, so a deployment that never installs an add-on never contacts it',
  },
  {
    test: /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
    why: 'loopback. §1 principle 3: the desktop renderer loads http://127.0.0.1:<port>. Ollama\'s :11434 default in the LLM provider catalog is the same shape — a local process, not a network',
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
 * Absolute URLs in ASSET-LOADING POSITIONS. Unlike everything above, these fail
 * regardless of host: the allowlist certifies that a string is never fetched, and
 * a `<script src>` is the compiled proof that it is. §7 icons row, "no CDN
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

function checkFile(file) {
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
    if (matches(ALLOWED_HOSTS, host) === undefined) {
      violations.push({
        file: where,
        url,
        rule: 'unallowlisted-host',
        why: `'${host}' is not in the allowlist. If this URL is never fetched by the app (an identifier, an error string, a placeholder, or a shell.openExternal target), add it to ALLOWED_HOSTS in scripts/check-offline-assets.mjs with the reason. If it IS fetched, it cannot ship — §7`,
      });
    }
  }
  return violations;
}

function parseRoots(argv) {
  const roots = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--root') continue;
    const value = argv[i + 1];
    if (value === undefined) throw new Error('--root needs a directory');
    roots.push({ path: value, why: 'passed with --root', build: null });
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
    for (const file of files) violations.push(...checkFile(file));
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

    console.error(`\n[offline-assets] ${byUrl.size} violation(s) — 11-electron.md §7\n`);
    for (const group of byUrl.values()) {
      console.error(`  ✗ ${group.url}`);
      console.error(`    rule: ${group.rule}`);
      console.error(`    why:  ${group.why}`);
      const shown = [...new Set(group.files)];
      for (const file of shown.slice(0, 5)) console.error(`    in:   ${file}`);
      if (shown.length > 5) console.error(`    in:   …and ${shown.length - 5} more file(s)`);
      console.error('');
    }
    console.error('The desktop build must work with the network cable unplugged, forever (§7).\n');
    process.exit(1);
  }

  console.log(
    `[offline-assets] ok — ${scanned} file(s) across ${roots.length} build output(s); every URL literal is allowlisted.`,
  );
}

main();
