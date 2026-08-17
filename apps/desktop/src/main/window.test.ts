// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 11-T05's unit suite: the §2.4 posture, the navigation lockdown, the §14
 * window-state clamp, and the two static pages' offline contract (§7).
 *
 * A real Electron app cannot be launched headlessly (see vitest.config.ts), so
 * `createWindowManager` itself is 11-T20's Playwright `_electron` suite to
 * cover. What is covered HERE is every decision it makes — which is the part
 * that can be wrong in a way nobody notices.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_PERMISSIONS,
  EXTERNAL_SCHEMES,
  WEB_PREFERENCES,
  clampWindowState,
  crashRenderScript,
  decideNavigation,
  isPermissionAllowed,
  jsonForScript,
  originOf,
  parseCrashAction,
  type DisplayArea,
  type WindowState,
} from './window.js';
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from './config.js';

const APP_ORIGIN = 'http://127.0.0.1:52341';

// ─── §2.4 posture ────────────────────────────────────────────────────────────

describe('WEB_PREFERENCES (§2.4)', () => {
  // Each of these is its own acceptance criterion ("Renderer security:
  // contextIsolation on, sandbox on, nodeIntegration off …"), so each is its own
  // assertion rather than one object snapshot: a snapshot updated in bulk is how
  // a posture regression gets approved by accident.
  it.each([
    ['contextIsolation', true],
    ['nodeIntegration', false],
    ['sandbox', true],
    ['webSecurity', true],
    ['allowRunningInsecureContent', false],
    ['webviewTag', false],
    ['experimentalFeatures', false],
  ] as const)('%s is %s', (key, value) => {
    expect(WEB_PREFERENCES[key]).toBe(value);
  });

  it('is frozen, so a caller cannot weaken the shared posture in place', () => {
    expect(Object.isFrozen(WEB_PREFERENCES)).toBe(true);
  });
});

// ─── §2.4 permission handler ─────────────────────────────────────────────────

describe('isPermissionAllowed (§2.4)', () => {
  it('denies every Chromium permission, including ones Chromium has not shipped yet', () => {
    // §2.4: "Permission request handler denies all Chromium permission prompts
    // (camera, geolocation, notifications use native paths instead)."
    const permissions = [
      'media',
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'pointerLock',
      'fullscreen',
      'openExternal',
      'clipboard-read',
      'clipboard-sanitized-write',
      'display-capture',
      'idle-detection',
      'hid',
      'serial',
      'usb',
      'window-management',
      // The point of the list being an allow-list: an unlisted permission — one
      // a future Chromium adds under a name nobody here has heard — is denied by
      // default rather than by having been remembered.
      'some-permission-invented-in-2027',
    ];
    for (const permission of permissions) {
      expect(isPermissionAllowed(permission)).toBe(false);
    }
  });

  it('has an empty allow-list', () => {
    expect(ALLOWED_PERMISSIONS.size).toBe(0);
  });
});

// ─── §2.4 navigation lockdown ────────────────────────────────────────────────

describe('decideNavigation (§2.4)', () => {
  it('only lets https: out to the system browser', () => {
    // §2.4: "every other URL goes to shell.openExternal after an allowlist check
    // (`https:` only)". openExternal hands the string to the OS.
    expect([...EXTERNAL_SCHEMES]).toEqual(['https:']);
  });

  it.each([
    // ── the app itself ──
    ['the app root', `${APP_ORIGIN}/`, 'allow'],
    ['an app route', `${APP_ORIGIN}/studio/connections`, 'allow'],
    ['an app route with a query', `${APP_ORIGIN}/?bootToken=abc`, 'allow'],
    ['an app API call', `${APP_ORIGIN}/api/v1/system/info`, 'allow'],

    // ── external, and safe to hand to the OS ──
    ['the docs site', 'https://docs.adminium.dev', 'external'],
    ['any https page', 'https://example.com/a/b?c=d#e', 'external'],

    // ── external, and NOT safe to hand to the OS ──
    // Plain http off-origin is not on the https-only allowlist, so it is denied
    // rather than opened: §2.4 allows exactly one http origin, ours.
    ['plain http elsewhere', 'http://example.com/', 'deny'],
    // file: through openExternal opens a local file with the OS handler.
    ['a file url', 'file:///etc/passwd', 'deny'],
    ['a local html file', 'file:///Users/ava/evil.html', 'deny'],
    // These three have opaque origins — `new URL(...).origin === "null"` — which
    // is exactly why decideNavigation refuses to treat "null" as an origin match.
    ['a javascript url', 'javascript:alert(document.cookie)', 'deny'],
    ['a data url', 'data:text/html,<script>alert(1)</script>', 'deny'],
    // OS-level handlers. On Windows these have historically been an RCE path.
    ['an smb share', 'smb://attacker/share', 'deny'],
    ['a mailto link', 'mailto:ava@adminium.io', 'deny'],
    ['a custom scheme', 'ms-msdt:/id PCWDiagnostic', 'deny'],
    ['garbage', 'not a url at all', 'deny'],
    ['an empty string', '', 'deny'],

    // ── the look-alikes: the whole reason this compares URL.origin ──
    // Every one of these passes a `startsWith`/`includes` check on the href.
    ['a look-alike subdomain', 'http://127.0.0.1.evil.com/', 'deny'],
    ['a look-alike over https', 'https://127.0.0.1.evil.com/', 'external'],
    ['the origin in a fragment', 'https://evil.com/#http://127.0.0.1:52341', 'external'],
    ['the origin in a query', 'https://evil.com/?r=http://127.0.0.1:52341/', 'external'],
    ['the origin as userinfo', 'http://127.0.0.1:52341@evil.com/', 'deny'],
    ['the origin as a path', 'https://evil.com/http://127.0.0.1:52341', 'external'],
    // A second local service is not us. `origin` pins the port.
    ['loopback on another port', 'http://127.0.0.1:8080/', 'deny'],
    // localhost resolves to the same interface but is a different origin, and
    // §2.4 names 127.0.0.1. Cookies are origin-scoped: allowing both would mean
    // two session jars.
    ['localhost by name', 'http://localhost:52341/', 'deny'],
    ['loopback over https', 'https://127.0.0.1:52341/', 'external'],
    ['the ipv6 loopback', 'http://[::1]:52341/', 'deny'],
  ] as const)('%s → %s', (_name, url, expected) => {
    expect(decideNavigation(url, APP_ORIGIN).action).toBe(expected);
  });

  it('allows nothing before the server has a port', () => {
    // showBoot()/showCrash() clear the origin: during boot there is no app, so
    // there is nothing that could legitimately be it.
    expect(decideNavigation(`${APP_ORIGIN}/`, null).action).toBe('deny');
    // https still escapes to the browser — a docs link on the crash page works.
    expect(decideNavigation('https://docs.adminium.dev', null).action).toBe('external');
  });

  it('never hands a denied URL to the OS', () => {
    // The regression this pins: a refactor that reads `decision.url` without
    // checking `decision.action` would pass javascript:/file:/smb: to
    // shell.openExternal. Only the 'external' branch carries a url at all.
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'smb://x/y', 'http://evil.com']) {
      expect(decideNavigation(url, APP_ORIGIN)).not.toHaveProperty('url');
    }
  });

  it('does not treat an opaque origin as the app origin', () => {
    // `new URL('data:…').origin` is the STRING "null". If appOrigin were ever
    // that string, every data:/javascript:/file: URL would be same-origin.
    expect(decideNavigation('data:text/html,x', 'null').action).toBe('deny');
    expect(decideNavigation('javascript:alert(1)', 'null').action).toBe('deny');
  });

  it('denies blob: even though it INHERITS the app origin', () => {
    // This is why the scheme is checked separately from the origin, and it is
    // not hypothetical — it is a bug this suite caught:
    //
    //   new URL('blob:http://127.0.0.1:52341/x').origin === 'http://127.0.0.1:52341'
    //
    // A blob: URL reports the origin of the URL inside it, so an origin-only
    // check calls it same-origin and navigates the window to a document the page
    // minted with URL.createObjectURL — attacker-authored markup executing
    // inside the origin that holds the session cookie. §2.4 allows
    // "http://127.0.0.1:<port>"; a blob: URL is not that, whatever its origin
    // says.
    expect(new URL(`blob:${APP_ORIGIN}/abc-123`).origin).toBe(APP_ORIGIN); // the trap
    expect(decideNavigation(`blob:${APP_ORIGIN}/abc-123`, APP_ORIGIN).action).toBe('deny');
    // ...and it is not handed to the OS either.
    expect(decideNavigation(`blob:${APP_ORIGIN}/abc-123`, APP_ORIGIN)).not.toHaveProperty('url');
  });

  it('denies a filesystem: URL, which inherits an origin the same way', () => {
    // Same family as blob:, different scheme. The scheme check covers both
    // without either having to be enumerated.
    expect(decideNavigation(`filesystem:${APP_ORIGIN}/temporary/x`, APP_ORIGIN).action).toBe('deny');
  });
});

describe('originOf', () => {
  it('reduces the boot URL to the origin nav is locked to', () => {
    // The URL index.ts builds at §2.2 step 8 carries the boot token; the origin
    // must not.
    expect(originOf('http://127.0.0.1:52341/?bootToken=deadbeef')).toBe(APP_ORIGIN);
    expect(originOf('http://127.0.0.1:52341/desktop/setup')).toBe(APP_ORIGIN);
  });

  it('is null for anything unusable, which decideNavigation reads as "allow nothing"', () => {
    expect(originOf('not a url')).toBeNull();
    expect(originOf('data:text/html,x')).toBeNull();
    expect(originOf('file:///tmp/boot.html')).toBeNull();
  });
});

// ─── Crash-page actions (§2.2 step 9) ────────────────────────────────────────

describe('parseCrashAction (§2.2 step 9)', () => {
  const page = 'file:///Applications/Adminium.app/Contents/out/renderer/crash.html';

  it.each([
    ['retry', `${page}?action=retry`, 'retry'],
    ['logs', `${page}?action=logs`, 'logs'],
    ['quit', `${page}?action=quit`, 'quit'],
  ] as const)('reads the %s button', (_name, target, expected) => {
    expect(parseCrashAction(target, page)).toBe(expected);
  });

  it.each([
    ['an unknown action', `${page}?action=rm-rf`],
    ['no action', page],
    ['an empty action', `${page}?action=`],
    // Another file on disk cannot drive the crash actions.
    ['a different local page', 'file:///tmp/evil.html?action=quit'],
    // And neither can the loopback SPA: `?action=quit` there resolves against
    // ITS origin, so it never reaches the file: branch.
    ['the loopback app', `${APP_ORIGIN}/?action=quit`],
    ['a remote page', 'https://evil.com/?action=quit'],
    ['garbage', 'nonsense'],
  ] as const)('ignores %s', (_name, target) => {
    expect(parseCrashAction(target, page)).toBeNull();
  });
});

// ─── The crash payload (§2.2 steps 7 and 9) ──────────────────────────────────

describe('crashRenderScript (§2.2 steps 7 and 9)', () => {
  const base = { reason: 'The server stopped.', canRestart: true };

  it('carries the payload as JSON data, not as interpolated code', () => {
    const script = crashRenderScript({
      ...base,
      logPath: '/Users/ava/Library/Logs/Adminium/adminium-server.log',
      excerpt: ['line one', 'line two'],
    });
    expect(script).toContain('"reason":"The server stopped."');
    expect(script).toContain('"canRestart":true');
    expect(script).toContain('adminium-server.log');
  });

  it.each([
    // The excerpt is RAW SERVER LOG OUTPUT — the string in this app most likely
    // to contain something adversarial-shaped. Each of these would end the
    // literal and start executing if the payload were interpolated as text.
    ['a quote and a semicolon', 'error: "boom"; alert(1)'],
    ['a script close tag', '</script><img src=x onerror=alert(1)>'],
    ['a backslash', 'C:\\Users\\ava\\evil'],
    ['a template literal', '${process.exit(1)}'],
    ['a newline', 'line one\nline two'],
    // U+2028/U+2029 are legal inside a JSON string and are LINE TERMINATORS in
    // JavaScript: unescaped, they end the statement mid-literal.
    ['a line separator', 'before\u2028alert(1)//after'],
    ['a paragraph separator', 'before\u2029alert(1)//after'],
  ] as const)('neutralizes %s in the log excerpt', (_name, line) => {
    const script = crashRenderScript({ ...base, excerpt: [line] });
    // The payload survives as data...
    expect(JSON.parse(jsonForScript([line]) as string)).toEqual([line]);
    // ...and the two characters that would break out of the literal are gone.
    expect(script).not.toContain('\u2028');
    expect(script).not.toContain('\u2029');
    expect(script).not.toContain('</script');
    // The script is still syntactically whole — a broken-out payload would not
    // parse. `Function` compiles without executing.
    expect(() => new Function(script)).not.toThrow();
  });

  it('produces a parseable script for every crash shape', () => {
    const shapes = [
      base,
      { ...base, canRestart: false },
      { ...base, logPath: '/tmp/a.log' },
      { ...base, excerpt: [] },
      { ...base, logPath: '/tmp/a.log', excerpt: ['a', 'b'], canRestart: false },
    ];
    for (const shape of shapes) {
      expect(() => new Function(crashRenderScript(shape))).not.toThrow();
    }
  });
});

// ─── §14 window state ────────────────────────────────────────────────────────

/** A 2560×1440 primary at the origin, plus a 1920×1080 to its left. */
const PRIMARY: DisplayArea = { x: 0, y: 0, width: 2560, height: 1440 };
const LEFT: DisplayArea = { x: -1920, y: 0, width: 1920, height: 1080 };
const LAPTOP: DisplayArea = { x: 0, y: 0, width: 1366, height: 768 };

const state = (over: Partial<WindowState> = {}): WindowState => ({
  x: 100,
  y: 100,
  width: 1440,
  height: 900,
  maximized: false,
  ...over,
});

describe('clampWindowState (§14)', () => {
  it('keeps a window that is fully on a display exactly where it was', () => {
    expect(clampWindowState(state(), [PRIMARY])).toEqual(state());
  });

  it('restores onto a secondary display at negative coordinates', () => {
    // The regression here would be a clamp that assumed the desktop starts at
    // (0,0): a monitor arranged to the LEFT of the primary has negative x, and
    // "clamp x to >= 0" would yank every window off it onto the primary.
    const saved = state({ x: -1800, y: 100 });
    expect(clampWindowState(saved, [PRIMARY, LEFT])).toEqual(saved);
  });

  it.each([
    ['far below every display', { x: 100, y: 9000 }],
    ['far to the right', { x: 9000, y: 100 }],
    ['far above', { x: 100, y: -9000 }],
    ['on an unplugged display to the left', { x: -4000, y: 100 }],
  ] as const)('drops the position of a window %s', (_name, position) => {
    // §14's "off-screen correction". The window would be unreachable: there is
    // no in-app recovery, because the window that would show it is the one that
    // is gone. Dropping x/y hands Electron its own centering.
    const clamped = clampWindowState(state(position), [PRIMARY]);
    expect(clamped.x).toBeUndefined();
    expect(clamped.y).toBeUndefined();
    // The size is still honoured — only the position was unusable.
    expect(clamped).toMatchObject({ width: 1440, height: 900, maximized: false });
  });

  it('drops the position when only an unreachable sliver would be on screen', () => {
    // Reachability is not "any overlap": a window with 8px on screen has no
    // grabbable title bar, so it is off-screen for every purpose the user has.
    const clamped = clampWindowState(state({ x: 2552, y: 100 }), [PRIMARY]);
    expect(clamped.x).toBeUndefined();
  });

  it('keeps a window that overlaps a display by a grabbable amount', () => {
    // ...but a window hanging off the right edge with a few hundred px still on
    // screen is one the user can drag back, so it is clamped, not discarded.
    const clamped = clampWindowState(state({ x: 2200, y: 100 }), [PRIMARY]);
    expect(clamped.x).toBe(2560 - 1440); // pulled fully onto the display
    expect(clamped.y).toBe(100);
  });

  it('picks the display the window mostly lived on, not the primary', () => {
    // Straddling: 1440 wide at x=-1000 puts 920px on LEFT and 440px on PRIMARY.
    const clamped = clampWindowState(state({ x: -1000, y: 100 }), [PRIMARY, LEFT]);
    // Clamped onto LEFT (its right edge is x=0), not dragged onto the primary.
    expect(clamped.x).toBe(-1440);
    expect(clamped.y).toBe(100);
  });

  it.each([
    ['a width below the minimum', { width: 400 }, { width: MIN_WINDOW_WIDTH }],
    ['a height below the minimum', { height: 300 }, { height: MIN_WINDOW_HEIGHT }],
    ['both below the minimum', { width: 1, height: 1 }, { width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT }],
  ] as const)('grows %s to §14\'s 1024×700', (_name, saved, expected) => {
    expect(clampWindowState(state(saved), [PRIMARY])).toMatchObject(expected);
  });

  it('shrinks a window restored onto a smaller display', () => {
    // Undocking a 2560-wide monitor and opening on the laptop panel. Without
    // this the window is wider than the screen and its right edge — where the
    // close button is on Windows and Linux — is unreachable at any position.
    const clamped = clampWindowState(state({ x: 0, y: 0, width: 2400, height: 1300 }), [LAPTOP]);
    expect(clamped.width).toBe(1366);
    expect(clamped.height).toBe(768);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });

  it('never shrinks below the minimum, even on a display smaller than it', () => {
    // §14's 1024×700 is a product constraint and Electron enforces it at
    // minWidth/minHeight regardless, so returning less than it here would just
    // be a lie the caller has to re-fix. The position clamp must not invert.
    const tiny: DisplayArea = { x: 0, y: 0, width: 800, height: 600 };
    const clamped = clampWindowState(state({ x: 0, y: 0 }), [tiny]);
    expect(clamped.width).toBe(MIN_WINDOW_WIDTH);
    expect(clamped.height).toBe(MIN_WINDOW_HEIGHT);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });

  it('leaves a first-run state without a position for Electron to center', () => {
    const first: WindowState = { width: 1440, height: 900, maximized: false };
    expect(clampWindowState(first, [PRIMARY])).toEqual(first);
  });

  it('carries maximized through untouched', () => {
    // A maximized window is by construction on a real display; applying it is
    // Electron's job, and the bounds under it are the ones to restore on unmax.
    expect(clampWindowState(state({ maximized: true }), [PRIMARY]).maximized).toBe(true);
    expect(clampWindowState(state({ x: 9000, maximized: true }), [PRIMARY]).maximized).toBe(true);
  });

  it('keeps a good position when there are no displays to check against', () => {
    // Without a layout, "off-screen" has no answer — and dropping the position
    // would be a regression on every normal launch. Only the minimum applies.
    expect(clampWindowState(state(), [])).toEqual(state());
    expect(clampWindowState(state({ width: 10 }), [])).toMatchObject({ width: MIN_WINDOW_WIDTH, x: 100 });
  });

  it('is idempotent — re-clamping a clamped state changes nothing', () => {
    // Every launch clamps what the last launch saved, so a clamp that drifted
    // would walk the window a little further each time the app opened.
    const displays = [PRIMARY, LEFT];
    for (const saved of [state(), state({ x: 9000 }), state({ x: 2200 }), state({ width: 1 })]) {
      const once = clampWindowState(saved, displays);
      expect(clampWindowState(once, displays)).toEqual(once);
    }
  });
});

// ─── §7 offline contract for the static pages ────────────────────────────────

const html = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../renderer/${name}`, import.meta.url)), 'utf8');

/**
 * The page with its HTML comments removed.
 *
 * Both files carry long headers explaining what they must never do — "no
 * <script> at all", "copyTokenCss copies fonts.css but NOT the fonts/ tree" —
 * and a structural assertion run over the raw source matches that prose and
 * fails on a correct page. The comments are documentation; the markup is the
 * contract.
 */
const markup = (name: string): string => html(name).replace(/<!--[\s\S]*?-->/g, '');

describe('boot.html / crash.html (§7 offline guarantee)', () => {
  it.each(['boot.html', 'crash.html'])('%s references no remote origin', (name) => {
    // §7: "fully functional with the network cable unplugged, forever". These
    // two are shown BEFORE a server exists, so they cannot reach even loopback.
    // scripts/check-offline-assets.mjs (11-T09) gates the packaged build; this
    // catches it at the source, where the fix is cheap.
    const remote = markup(name).match(/https?:\/\/[^"'\s)]+/g) ?? [];
    // The CSP keyword `'self'` and the doctype are not URLs; nothing else may be.
    expect(remote).toEqual([]);
    expect(markup(name)).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\./);
  });

  it.each(['boot.html', 'crash.html'])('%s loads no script', (name) => {
    // Both run under `script-src 'none'`. crash.html is filled by
    // executeJavaScript from the main process instead — see its header.
    expect(markup(name)).not.toMatch(/<script/i);
    expect(html(name)).toContain("script-src 'none'");
  });

  it.each(['boot.html', 'crash.html'])('%s links only the copied token CSS', (name) => {
    const links = markup(name).match(/<link[^>]*href="([^"]+)"/g) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toContain('./tokens/tokens.css');
    // fonts.css is deliberately NOT linked: copyTokenCss copies the stylesheet
    // but not the src/fonts/ tree its @font-face rules point at, so every one of
    // them would miss. See boot.html's header.
    expect(markup(name)).not.toContain('fonts.css');
  });

  it('crash.html states the failure and offers all three actions without any script', () => {
    const source = markup('crash.html');
    // The degradation contract: if the injection never runs, the page still
    // says what happened and still offers a way out. Actions start VISIBLE and
    // are only ever hidden by the script (§2.2 step 9's spent crash budget).
    expect(source).toContain('Adminium could not start its server');
    for (const action of ['retry', 'logs', 'quit']) {
      expect(source).toMatch(new RegExp(`href="\\?action=${action}"[^>]*data-slot="${action}"`));
    }
    // ...and none of the three carries a `hidden` attribute in the static file.
    expect(source).not.toMatch(/href="\?action=[a-z]+"[^>]*hidden/);
  });

  it('crash.html has every slot crashRenderScript writes to', () => {
    // The two halves are wired by string, so nothing else would catch a rename.
    const source = markup('crash.html');
    const script = crashRenderScript({ reason: 'x', canRestart: true });
    const slots = [...script.matchAll(/(?:set|toggle)\('([a-z-]+)'/g)].map((m) => m[1]);
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(source).toContain(`data-slot="${slot}"`);
    }
  });
});

// ─── Token drift (the one duplication in this track's deliverable) ───────────

/** `--name: value` pairs from the body of the first block matching `selector`. */
function declarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`no ${selector} block found`);
  const open = css.indexOf('{', start);
  const body = css.slice(open + 1, css.indexOf('}', open));
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[match[1] as string] = normalize(match[2] as string);
  }
  return out;
}

/** `rgba(255,255,255,.07)` and `rgba(255, 255, 255, 0.07)` are the same colour. */
function normalize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/(^|[^0-9])\./g, '$10.');
}

describe('pinned dark tokens match @adminium/tokens', () => {
  // boot.html/crash.html re-declare a handful of tokens.css's dark values under
  // `@media (prefers-color-scheme: dark)`, because tokens.css exposes them under
  // `[data-theme="dark"]` and these pages have no script to set that attribute —
  // they run before the server that stores the preference exists.
  //
  // That is a duplication, so it is a drift risk, so it is a test. Read off the
  // filesystem rather than imported: .dependency-cruiser.cjs's
  // `desktop-shell-only` rule bans the shell from importing @adminium/tokens,
  // and a test that created that edge would break a repo gate to check a colour.
  const tokensCss = readFileSync(
    fileURLToPath(new URL('../../../../packages/tokens/src/tokens.css', import.meta.url)),
    'utf8',
  );
  const canonical = declarations(tokensCss, '[data-theme="dark"]');

  it('the canonical dark block was actually found', () => {
    // Guard against the test silently passing on an empty set if tokens.css is
    // ever restructured — vacuous truth is the failure mode of a drift test.
    expect(Object.keys(canonical).length).toBeGreaterThan(10);
  });

  it.each(['boot.html', 'crash.html'])('%s pins values that still match tokens.css', (name) => {
    const pinned = declarations(html(name), '@media (prefers-color-scheme: dark)');
    expect(Object.keys(pinned).length).toBeGreaterThan(0);
    for (const [token, value] of Object.entries(pinned)) {
      expect(canonical, `${name} pins ${token}, which tokens.css no longer defines`).toHaveProperty(token);
      expect(value, `${name}'s ${token} has drifted from @adminium/tokens`).toBe(canonical[token]);
    }
  });
});
