/**
 * Native application menu (11-electron.md §14). Structure owned by 11-T05;
 * 11-T19 wires the localization.
 *
 * ─── How this menu is localized, and why not by importing @adminium/i18n ─────
 *
 * §14: "All labels localized via @adminium/i18n bundles at menu build time; menu
 * rebuilds on locale change." The shell cannot do that directly — the
 * `desktop-shell-only` rule (`.dependency-cruiser.cjs`) lets `apps/desktop`
 * import `@adminium/server` and nothing else, so `@adminium/i18n` is off-limits
 * here exactly as `@adminium/tokens` and `@adminium/dashboard` are. And it
 * should be: the locale the menu must follow is the one the USER picked in the
 * SPA (10-i18n-theming.md's ThemeProvider owns that axis), not `app.getLocale()`
 * — only the renderer knows it, and only the renderer knows when it changes.
 *
 * So the renderer resolves these labels through its own i18n and pushes the
 * result over §4's `setMenuLabels` ({@link DesktopMenuLabels}); `main/index.ts`
 * rebuilds the menu from them. This module holds ZERO translations beyond the
 * en-US fallback below, which is the boot menu (there is no SPA yet at §2.2 step
 * 6) and the safety net for any key a push omits. {@link menuTranslator} is the
 * seam: hand it the pushed labels and it becomes the {@link MenuTranslate} the
 * template already accepts.
 *
 * §14 has two rules that are easy to miss and expensive to get wrong, and both
 * are load-bearing in the structure below —
 *
 *  1. The Edit menu must use the standard ROLES. Without them ⌘C/⌘V do nothing
 *     on macOS, in every text field in the app, including the password field in
 *     the first-run wizard. Roles are how Electron reaches Chromium's native
 *     editing commands; a `click` handler is not a substitute, and the failure
 *     is invisible on Windows and Linux, where the OS handles the keystrokes
 *     whether or not a menu item claims them.
 *  2. Native accelerators stay confined to these items so they cannot collide
 *     with the SPA's keyboard vocabulary (⌘K, G-chords, J/K, ⌘E —
 *     `designs/Shortcuts Panel.dc.html`), which the dashboard owns and this
 *     shell must not touch. A native accelerator WINS: it fires in the main
 *     process and the keystroke never reaches the page, so a collision does not
 *     merely double-fire, it silently deletes an in-app shortcut. ⌘K is
 *     deliberately NOT a native accelerator, and {@link RESERVED_SPA_ACCELERATORS}
 *     is asserted against the built template by the unit suite.
 *
 * {@link appMenuTemplate} is pure and exported for that test: it returns the
 * template rather than installing it, so the whole structure is inspectable
 * without an Electron instance to hang a menu on.
 */

import { Menu, shell, type MenuItemConstructorOptions } from 'electron';

import type { DesktopMenuLabelKey, DesktopMenuLabels } from '../preload/api.js';

// ─── Labels (§14: "All labels localized via @adminium/i18n") ─────────────────

/**
 * Every string the menu shows that is OURS to translate.
 *
 * The key set is the shared contract's {@link DesktopMenuLabelKey}, not a
 * private union: the same keys the renderer resolves from `@adminium/i18n` and
 * pushes back over `setMenuLabels` (see the module header). Aliased rather than
 * re-declared so there is exactly one list, pinned by `main/ipc.ts`'s
 * `_MenuLabelsMatchSchema` assertion.
 *
 * ROLE ITEMS ARE ABSENT ON PURPOSE. `{ role: 'copy' }` carries a label supplied
 * and localized by the OS itself; giving it one of ours would replace a string
 * the platform already translated into the user's language with a string we
 * would then have to translate into all eight. The labels here are only for the
 * items that are ours: the top-level titles and the File/Help commands.
 */
export type MenuLabelKey = DesktopMenuLabelKey;

/** The labels hook: an i18n-backed one is built by {@link menuTranslator}. */
export type MenuTranslate = (key: MenuLabelKey) => string;

/**
 * en-US, and the fallback for {@link buildAppMenu} until 11-T19 lands. Ellipses
 * are the single-character U+2026, and the ones that carry it are exactly the
 * items that open a further dialog — a platform convention on every OS we ship.
 */
export const EN_US_MENU_LABELS: Readonly<Record<MenuLabelKey, string>> = Object.freeze({
  file: 'File',
  'file.newDatabase': 'New local database…',
  'file.openSqlite': 'Open SQLite file…',
  'file.backupNow': 'Back up now…',
  'file.restore': 'Restore from backup…',
  edit: 'Edit',
  view: 'View',
  window: 'Window',
  help: 'Help',
  'help.docs': 'Adminium Docs',
  'help.shortcuts': 'Keyboard Shortcuts',
  'help.logs': 'Show Logs',
  'help.checkForUpdates': 'Check for Updates…',
  'help.about': 'About Adminium',
});

const defaultTranslate: MenuTranslate = (key) => EN_US_MENU_LABELS[key];

/**
 * A {@link MenuTranslate} backed by labels the renderer pushed
 * ({@link DesktopMenuLabels}, §4 `setMenuLabels`), with the en-US fallback
 * behind every key.
 *
 * `null`/`undefined` labels — the boot menu, before the SPA has pushed anything
 * (§2.2 step 6) — collapse to the en-US default. A partial map falls back
 * per-key, so a locale bundle that is missing one string shows that one item in
 * en-US rather than blanking it; the parity gate (`packages/i18n`) makes a
 * missing key a red test long before it reaches here, but a native menu with a
 * blank item is a worse failure than a briefly-English one, so the fallback
 * stays.
 */
export function menuTranslator(labels?: Partial<DesktopMenuLabels> | null): MenuTranslate {
  if (labels === null || labels === undefined) return defaultTranslate;
  return (key) => labels[key] ?? EN_US_MENU_LABELS[key];
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * What the menu's own commands do. Every one of them belongs to another track —
 * File is 11-T07's wizard flows and 11-T12's backup coordinator, Help is
 * 11-T16's updater and 11-T18's About panel — so they arrive as callbacks and
 * this module holds no opinion about any of them. All optional: an unwired
 * handler renders its item DISABLED rather than absent, so a half-built menu
 * looks like a feature that is not ready instead of one that does not exist.
 */
export interface MenuHandlers {
  newDatabase?: (() => void) | undefined;
  openSqlite?: (() => void) | undefined;
  backupNow?: (() => void) | undefined;
  restore?: (() => void) | undefined;
  shortcuts?: (() => void) | undefined;
  showLogs?: (() => void) | undefined;
  checkForUpdates?: (() => void) | undefined;
  about?: (() => void) | undefined;
}

/**
 * §14: "Adminium Docs ↗" opens the system browser. `https:` only, per §2.4's
 * external-link policy.
 *
 * MUST equal `@adminium/dashboard`'s `kb/docsLinks.ts` `DOCS_BASE_URL`, which
 * calls itself "the one place the docs site's origin is written down" and is
 * right to — this is a second place, and it exists only because the shell may
 * not import the dashboard (`.dependency-cruiser.cjs`'s `desktop-shell-only`
 * rule: `apps/desktop` may import `@adminium/server` and nothing else). Change
 * both together; `menu.test.ts` pins the value so the drift is a red test rather
 * than a Help menu that lands on a parked domain.
 *
 * No `/docs` suffix: 14-docs-site.md §3 puts the site AT `docs.adminium.dev`, so
 * the origin is the docs home (the same URL `DOCS_SEARCH_URL` resolves to).
 *
 * NOT covered by `check-offline-assets.mjs`: that scanner's roots are the
 * renderer and dashboard builds (§7), never `out/main`, so nothing here is
 * checked against its allowlist. An earlier version of this comment claimed it
 * was, which is how `adminium.io` — a host the scanner does not allow and would
 * have failed on sight — survived in the shipped Help menu.
 */
export const DOCS_URL = 'https://docs.adminium.dev';

export interface BuildAppMenuOptions {
  /** `process.platform`. Drives the mac app menu and the mac-only Edit items. */
  platform: NodeJS.Platform;
  /** §14: "Toggle Developer Tools **in dev builds only**". */
  isDev: boolean;
  /** §14 label localization. Defaults to {@link EN_US_MENU_LABELS} until 11-T19. */
  t?: MenuTranslate | undefined;
  handlers?: MenuHandlers | undefined;
  /** Injected for the unit suite; defaults to `shell.openExternal`. */
  openExternal?: ((url: string) => void) | undefined;
}

/**
 * Accelerators the SPA owns (`designs/Shortcuts Panel.dc.html`) and the native
 * menu must never claim. Asserted against {@link appMenuTemplate} in the tests —
 * see rule 2 in the module header for why a collision is silent and total.
 */
export const RESERVED_SPA_ACCELERATORS: readonly string[] = [
  // The command palette. §14: "⌘K is deliberately NOT a native accelerator."
  'CmdOrCtrl+K',
  // Inline edit.
  'CmdOrCtrl+E',
];

// ─── The template (pure) ─────────────────────────────────────────────────────

/**
 * §14's menu bar: File · Edit · View · Window · Help, plus the macOS app menu.
 *
 * Pure — it builds the template and installs nothing, which is what lets the
 * unit suite assert the two §14 rules without an Electron instance.
 */
export function appMenuTemplate(opts: BuildAppMenuOptions): MenuItemConstructorOptions[] {
  const t = opts.t ?? defaultTranslate;
  const handlers = opts.handlers ?? {};
  const openExternal = opts.openExternal ?? ((url: string) => void shell.openExternal(url));
  const isMac = opts.platform === 'darwin';

  /** An unwired command is disabled, not missing — see {@link MenuHandlers}. */
  const command = (
    key: MenuLabelKey,
    handler: (() => void) | undefined,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    label: t(key),
    ...(accelerator === undefined ? {} : { accelerator }),
    enabled: handler !== undefined,
    click: () => handler?.(),
  });

  const template: MenuItemConstructorOptions[] = [];

  // ── macOS app menu ──
  // Hand-built rather than `role: 'appMenu'` for one reason: `role: 'about'`
  // opens Electron's own about panel, and §13 specifies OURS (app + server +
  // migration + Electron versions, data dir, AGPL notice, third-party notices).
  // The rest of the submenu is the mac convention and must stay in this order.
  if (isMac) {
    template.push({
      role: 'appMenu',
      submenu: [
        command('help.about', handlers.about),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  // ── File ──
  template.push({
    label: t('file'),
    submenu: [
      command('file.newDatabase', handlers.newDatabase, 'CmdOrCtrl+N'),
      command('file.openSqlite', handlers.openSqlite, 'CmdOrCtrl+O'),
      { type: 'separator' },
      // Shift+⌘B rather than ⌘S: there is no "document" here to save, and ⌘S in
      // a data app reads as "commit this row", which is the SPA's to define.
      command('file.backupNow', handlers.backupNow, 'CmdOrCtrl+Shift+B'),
      command('file.restore', handlers.restore),
      { type: 'separator' },
      // §14: "Close Window / Quit". On mac Quit lives in the app menu above and
      // repeating it in File is not a thing mac apps do.
      { role: 'close' },
      ...(isMac ? [] : [{ role: 'quit' } as MenuItemConstructorOptions]),
    ],
  });

  // ── Edit ──
  // Roles only. See rule 1 in the module header: these are the bridge to
  // Chromium's native editing commands, and without them ⌘C/⌘V are dead on mac.
  template.push({
    label: t('edit'),
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? ([
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { role: 'selectAll' },
            { type: 'separator' },
            { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
          ] satisfies MenuItemConstructorOptions[])
        : ([
            { role: 'delete' },
            { type: 'separator' },
            { role: 'selectAll' },
          ] satisfies MenuItemConstructorOptions[])),
    ],
  });

  // ── View ──
  // §14 names exactly these: "Reload, Actual Size/Zoom In/Out, Toggle Developer
  // Tools in dev builds only". `forceReload` is deliberately absent — it drops
  // the SPA's session-scoped caches for no benefit the user can perceive — and
  // so is `toggleDevTools` in production, where it is a support-call generator
  // and a way to run arbitrary script against the loopback origin.
  template.push({
    label: t('view'),
    submenu: [
      { role: 'reload' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(opts.isDev
        ? ([{ type: 'separator' }, { role: 'toggleDevTools' }] satisfies MenuItemConstructorOptions[])
        : []),
    ],
  });

  // ── Window ── §14: "Window (standard)".
  template.push({ role: 'windowMenu', label: t('window') });

  // ── Help ──
  template.push({
    role: 'help',
    label: t('help'),
    submenu: [
      {
        // §14 renders this "Adminium Docs ↗"; the arrow is the affordance for
        // §2.4's rule that it leaves the app for the system browser.
        label: `${t('help.docs')} ↗`,
        click: () => {
          openExternal(DOCS_URL);
        },
      },
      // §14: "opens the in-app Shortcuts Panel" — the SPA's own ⌘/ surface, so
      // no accelerator here; the panel already owns one.
      command('help.shortcuts', handlers.shortcuts),
      { type: 'separator' },
      command('help.logs', handlers.showLogs),
      command('help.checkForUpdates', handlers.checkForUpdates),
      // On mac About is in the app menu, where the platform puts it.
      ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, command('help.about', handlers.about)]),
    ],
  });

  return template;
}

/** Build {@link appMenuTemplate} and install it as the application menu. */
export function buildAppMenu(opts: BuildAppMenuOptions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(opts)));
}

// ─── Introspection (for the §14 accelerator test) ────────────────────────────

/** Every accelerator the template claims, submenus included. */
export function collectAccelerators(
  template: readonly MenuItemConstructorOptions[],
): string[] {
  const found: string[] = [];
  for (const item of template) {
    if (typeof item.accelerator === 'string') found.push(item.accelerator);
    if (Array.isArray(item.submenu)) found.push(...collectAccelerators(item.submenu));
  }
  return found;
}

/** Every `role` the template uses, submenus included. */
export function collectRoles(template: readonly MenuItemConstructorOptions[]): string[] {
  const found: string[] = [];
  for (const item of template) {
    if (typeof item.role === 'string') found.push(item.role);
    if (Array.isArray(item.submenu)) found.push(...collectRoles(item.submenu));
  }
  return found;
}
