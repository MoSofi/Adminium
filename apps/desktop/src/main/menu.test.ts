/**
 * 11-T05's menu suite (11-electron.md §14).
 *
 * `appMenuTemplate` is pure and returns the template rather than installing it,
 * which is what lets §14's two rules be asserted without an Electron instance to
 * hang a menu on. Both rules fail SILENTLY in production — a missing Edit role
 * means ⌘C does nothing on macOS and throws nothing anywhere, and an accelerator
 * collision swallows an in-app shortcut without a trace — so a test is the only
 * thing that catches either one.
 */

import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';

import {
  DOCS_URL,
  EN_US_MENU_LABELS,
  RESERVED_SPA_ACCELERATORS,
  appMenuTemplate,
  collectAccelerators,
  collectRoles,
  type BuildAppMenuOptions,
  type MenuLabelKey,
} from './menu.js';

const template = (over: Partial<BuildAppMenuOptions> = {}): MenuItemConstructorOptions[] =>
  appMenuTemplate({ platform: 'darwin', isDev: false, openExternal: () => {}, ...over });

const PLATFORMS = ['darwin', 'win32', 'linux'] as const;

/** The submenu of the top-level item whose label matches, on any platform. */
function menu(
  built: readonly MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions[] {
  const found = built.find((item) => item.label === label);
  if (found === undefined || !Array.isArray(found.submenu)) {
    throw new Error(`no "${label}" menu with a submenu`);
  }
  return found.submenu;
}

describe('appMenuTemplate (§14)', () => {
  it.each(PLATFORMS)('has §14\'s five menus on %s', (platform) => {
    const built = template({ platform });
    const labels = built.map((item) => item.label);
    // §14: "File (…) · Edit (…) · View (…) · Window (standard) · Help (…)".
    for (const key of ['file', 'edit', 'view', 'window', 'help'] as const) {
      expect(labels).toContain(EN_US_MENU_LABELS[key]);
    }
  });

  it('puts the app menu first on macOS only', () => {
    // The mac app menu must be index 0 or the OS renders it as an ordinary menu.
    expect(template({ platform: 'darwin' })[0]?.role).toBe('appMenu');
    for (const platform of ['win32', 'linux'] as const) {
      expect(collectRoles(template({ platform }))).not.toContain('appMenu');
    }
  });
});

// ─── §14 rule 1: the Edit menu must use the standard roles ───────────────────

describe('the Edit menu (§14 rule 1)', () => {
  it.each(PLATFORMS)('uses the native editing roles on %s', (platform) => {
    // §14: "Edit (standard roles — required for ⌘C/⌘V on mac)". Roles are how
    // Electron reaches Chromium's native editing commands. Without them ⌘C/⌘V do
    // nothing on macOS in every text field in the app — including the password
    // field in the first-run wizard — and nothing anywhere reports it.
    const roles = collectRoles(menu(template({ platform }), EN_US_MENU_LABELS.edit));
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'delete']) {
      expect(roles).toContain(role);
    }
  });

  it('adds the mac-only editing roles on darwin and nowhere else', () => {
    expect(collectRoles(menu(template({ platform: 'darwin' }), EN_US_MENU_LABELS.edit))).toEqual(
      expect.arrayContaining(['pasteAndMatchStyle', 'startSpeaking', 'stopSpeaking']),
    );
    for (const platform of ['win32', 'linux'] as const) {
      const roles = collectRoles(menu(template({ platform }), EN_US_MENU_LABELS.edit));
      expect(roles).not.toContain('pasteAndMatchStyle');
      expect(roles).not.toContain('startSpeaking');
    }
  });

  it.each(PLATFORMS)('gives no Edit item a click handler or a label on %s', (platform) => {
    // Two failure modes in one assertion. A `click` handler on an editing item
    // means someone reimplemented copy/paste by hand instead of using the role.
    // A `label` overrides the string the OS already localized into the user's
    // language — with one of ours, which would then owe eight translations.
    for (const item of menu(template({ platform }), EN_US_MENU_LABELS.edit)) {
      if (item.role === undefined) continue;
      expect(item.click).toBeUndefined();
      expect(item.label).toBeUndefined();
    }
  });
});

// ─── §14 rule 2: no collision with the SPA's keyboard vocabulary ─────────────

describe('accelerators (§14 rule 2)', () => {
  it.each(PLATFORMS)('claims none of the SPA\'s shortcuts on %s', (platform) => {
    // §14: "⌘K is deliberately NOT a native accelerator." A native accelerator
    // WINS — it fires in the main process and the keystroke never reaches the
    // page — so a collision does not double-fire, it silently deletes an in-app
    // shortcut (`designs/Shortcuts Panel.dc.html`).
    const claimed = collectAccelerators(template({ platform, isDev: true }));
    for (const reserved of RESERVED_SPA_ACCELERATORS) {
      expect(claimed).not.toContain(reserved);
    }
  });

  it('reserves the command palette explicitly', () => {
    expect(RESERVED_SPA_ACCELERATORS).toContain('CmdOrCtrl+K');
  });

  it.each(PLATFORMS)('claims no accelerator twice on %s', (platform) => {
    // Two items on one chord: the second is dead, and which one that is depends
    // on menu order rather than on anything anyone decided.
    const claimed = collectAccelerators(template({ platform, isDev: true }));
    expect(claimed).toEqual([...new Set(claimed)]);
  });

  it('uses CmdOrCtrl, never a bare Cmd or Ctrl', () => {
    // A bare `Command+N` is dead on Windows and Linux; a bare `Ctrl+N` collides
    // with nothing on mac but is not the key mac users press.
    for (const platform of PLATFORMS) {
      for (const accelerator of collectAccelerators(template({ platform, isDev: true }))) {
        expect(accelerator).not.toMatch(/(^|\+)(Command|Cmd|Ctrl|Control)\+/);
      }
    }
  });
});

// ─── §14 View: dev tools in dev builds only ──────────────────────────────────

describe('the View menu (§14)', () => {
  it('offers §14\'s zoom and reload items', () => {
    // §14: "View (Reload, Actual Size/Zoom In/Out, Toggle Developer Tools …)".
    const roles = collectRoles(menu(template(), EN_US_MENU_LABELS.view));
    expect(roles).toEqual(expect.arrayContaining(['reload', 'resetZoom', 'zoomIn', 'zoomOut']));
  });

  it.each(PLATFORMS)('hides the dev tools in a production build on %s', (platform) => {
    // §14: "Toggle Developer Tools **in dev builds only**". In production it is
    // a support-call generator and a way to run arbitrary script against the
    // loopback origin — i.e. against a live, authenticated session.
    expect(collectRoles(template({ platform, isDev: false }))).not.toContain('toggleDevTools');
    expect(collectRoles(template({ platform, isDev: true }))).toContain('toggleDevTools');
  });
});

// ─── File / Help ─────────────────────────────────────────────────────────────

describe('the File menu (§14)', () => {
  it('offers §14\'s four commands plus Close', () => {
    const items = menu(template(), EN_US_MENU_LABELS.file);
    const labels = items.map((item) => item.label);
    for (const key of [
      'file.newDatabase',
      'file.openSqlite',
      'file.backupNow',
      'file.restore',
    ] as const) {
      expect(labels).toContain(EN_US_MENU_LABELS[key]);
    }
    expect(collectRoles(items)).toContain('close');
  });

  it('puts Quit in the File menu everywhere except macOS', () => {
    // On mac Quit lives in the app menu; repeating it in File is not a thing mac
    // apps do, and §14's "Close Window / Quit" is the cross-platform shape.
    expect(collectRoles(menu(template({ platform: 'darwin' }), EN_US_MENU_LABELS.file))).not.toContain(
      'quit',
    );
    for (const platform of ['win32', 'linux'] as const) {
      expect(collectRoles(menu(template({ platform }), EN_US_MENU_LABELS.file))).toContain('quit');
    }
  });

  it('disables a command with no handler instead of hiding it', () => {
    // A half-wired menu should look like a feature that is not ready, not like
    // one that does not exist — and an item that vanishes is unreportable.
    const items = menu(template({ handlers: {} }), EN_US_MENU_LABELS.file);
    const newDatabase = items.find((item) => item.label === EN_US_MENU_LABELS['file.newDatabase']);
    expect(newDatabase?.enabled).toBe(false);

    const wired = menu(template({ handlers: { newDatabase: () => {} } }), EN_US_MENU_LABELS.file);
    expect(wired.find((i) => i.label === EN_US_MENU_LABELS['file.newDatabase'])?.enabled).toBe(true);
  });

  it('routes a wired command to its handler', () => {
    let opened = 0;
    const items = menu(
      template({ handlers: { openSqlite: () => (opened += 1) } }),
      EN_US_MENU_LABELS.file,
    );
    const item = items.find((i) => i.label === EN_US_MENU_LABELS['file.openSqlite']);
    // Electron passes (menuItem, browserWindow, event); none is used.
    (item?.click as unknown as () => void)();
    expect(opened).toBe(1);
  });
});

describe('the Help menu (§14)', () => {
  // The docs site's real origin (14-docs-site.md §3; `apps/docs/astro.config.mjs`
  // `site:`; the dashboard's `kb/docsLinks.ts` `DOCS_BASE_URL`).
  //
  // Pinned as a LITERAL, deliberately. Asserting `DOCS_URL === DOCS_URL` is what
  // the rest of this suite already does by construction, and it is exactly why
  // the Help menu shipped pointing at `adminium.io` — a placeholder domain from
  // the demo persona — while every test stayed green: nothing ever compared the
  // constant to the address the docs are actually served from. `out/main` is
  // outside check-offline-assets.mjs's roots (§7), so this literal is the only
  // gate on that value.
  const DOCS_ORIGIN = 'https://docs.adminium.ai';

  it('opens the docs in the system browser over https', () => {
    // §14: "Adminium Docs ↗" — and §2.4: external links go to the system
    // browser, https only.
    expect(DOCS_URL.startsWith('https://')).toBe(true);
    expect(DOCS_URL).toBe(DOCS_ORIGIN);

    const opened: string[] = [];
    const items = menu(template({ openExternal: (url) => opened.push(url) }), EN_US_MENU_LABELS.help);
    const docs = items.find((item) => item.label?.startsWith(EN_US_MENU_LABELS['help.docs']));
    // §14 renders it with the "leaves the app" affordance.
    expect(docs?.label).toContain('↗');
    (docs?.click as unknown as () => void)();
    expect(opened).toEqual([DOCS_URL]);
  });

  it('carries §14\'s remaining Help items', () => {
    const labels = menu(template(), EN_US_MENU_LABELS.help).map((item) => item.label);
    for (const key of ['help.shortcuts', 'help.logs', 'help.checkForUpdates'] as const) {
      expect(labels).toContain(EN_US_MENU_LABELS[key]);
    }
  });

  it('gives the Shortcuts Panel no accelerator', () => {
    // §14: it "opens the in-app Shortcuts Panel" — a surface the SPA already
    // binds a key to. A native accelerator here would take that key away from it.
    const item = menu(template(), EN_US_MENU_LABELS.help).find(
      (i) => i.label === EN_US_MENU_LABELS['help.shortcuts'],
    );
    expect(item?.accelerator).toBeUndefined();
  });

  it('puts About where each platform puts it', () => {
    // mac: the app menu, per the platform convention. Elsewhere: Help, per §14.
    const mac = template({ platform: 'darwin' });
    expect(menu(mac, EN_US_MENU_LABELS.help).map((i) => i.label)).not.toContain(
      EN_US_MENU_LABELS['help.about'],
    );
    const appMenu = mac[0]?.submenu;
    expect(Array.isArray(appMenu) ? appMenu.map((i) => i.label) : []).toContain(
      EN_US_MENU_LABELS['help.about'],
    );

    for (const platform of ['win32', 'linux'] as const) {
      expect(menu(template({ platform }), EN_US_MENU_LABELS.help).map((i) => i.label)).toContain(
        EN_US_MENU_LABELS['help.about'],
      );
    }
  });

  it('never uses Electron\'s built-in about panel', () => {
    // `role: 'about'` opens Electron's default panel; §13 specifies OURS (app +
    // server + migration + Electron versions, data dir, AGPL notice, third-party
    // notices), so About must be a click handler on every platform.
    for (const platform of PLATFORMS) {
      expect(collectRoles(template({ platform }))).not.toContain('about');
    }
  });
});

// ─── The labels hook (§14: "All labels localized via @adminium/i18n") ────────

describe('the labels hook', () => {
  it('renders every label through t()', () => {
    // 11-T19 swaps in an i18n-backed `t` and rebuilds on locale change. This
    // asserts the seam exists — that no label is a string literal the hook
    // cannot reach — by making `t` return something no literal would be.
    const seen: MenuLabelKey[] = [];
    const built = appMenuTemplate({
      platform: 'darwin',
      isDev: false,
      openExternal: () => {},
      t: (key) => {
        seen.push(key);
        return `[${key}]`;
      },
    });
    // Every top-level title came from the hook.
    for (const item of built) {
      if (item.role === 'appMenu') continue;
      expect(item.label).toMatch(/^\[/);
    }
    // And the hook was asked for the File/Help commands too, not just titles.
    expect(seen).toEqual(expect.arrayContaining(['file.newDatabase', 'help.logs', 'help.about']));
  });

  it('has an en-US string for every key it can be asked for', () => {
    // The fallback until 11-T19 lands, and the source list it will translate.
    for (const [key, value] of Object.entries(EN_US_MENU_LABELS)) {
      expect(value, `${key} has no en-US label`).toBeTruthy();
    }
  });
});
