/**
 * Push the native menu's localized labels to the Electron shell (11-electron.md
 * §14: "All labels localized via @adminium/i18n bundles … menu rebuilds on
 * locale change").
 *
 * ─── Why the RENDERER resolves these, not the shell ──────────────────────────
 *
 * The desktop shell cannot import `@adminium/i18n` (`.dependency-cruiser.cjs`'s
 * `desktop-shell-only` rule — `apps/desktop` may import `@adminium/server` and
 * nothing else), and the locale the menu must follow is the one the USER picked
 * in this SPA — the axis `ThemeProvider` owns (10-i18n-theming.md §7.4), which
 * only the renderer knows and only the renderer knows when it changes. So the
 * SPA resolves the menu strings through its own `t()` and pushes the map over
 * §4's `setMenuLabels`; `apps/desktop/src/main/index.ts` rebuilds the native
 * menu from it (`menu.ts`'s `menuTranslator`).
 *
 * On self-host and Cloud there is no shell — `getDesktopApi()` returns `null` and
 * this is a no-op, exactly as this same one bundle must behave in a browser (§4
 * detection contract).
 *
 * The keys are the shared contract's {@link DesktopMenuLabelKey}, so a menu item
 * this SPA forgets to resolve is a compile error here (the return type is a full
 * `Record`), not a menu item that silently stays English at runtime. The
 * fallbacks mirror `menu.ts`'s `EN_US_MENU_LABELS` so a pre-i18n call (or a
 * missing bundle) degrades to the same English the boot menu shows.
 */
import type { DesktopMenuLabelKey, DesktopMenuLabels } from '@adminium/desktop/api';

import { getDesktopApi } from '../lib/desktop-runtime.js';
import { t as appTranslate } from '../i18n/t.js';

/** The i18n key (in the `common` bundle) and en-US fallback for each menu label. */
const MENU_LABEL_SOURCES: ReadonlyArray<{
  readonly key: DesktopMenuLabelKey;
  readonly i18nKey: string;
  readonly fallback: string;
}> = [
  { key: 'file', i18nKey: 'desktop.menu.file', fallback: 'File' },
  { key: 'file.newDatabase', i18nKey: 'desktop.menu.fileNewDatabase', fallback: 'New local database…' },
  { key: 'file.openSqlite', i18nKey: 'desktop.menu.fileOpenSqlite', fallback: 'Open SQLite file…' },
  { key: 'file.backupNow', i18nKey: 'desktop.menu.fileBackupNow', fallback: 'Back up now…' },
  { key: 'file.restore', i18nKey: 'desktop.menu.fileRestore', fallback: 'Restore from backup…' },
  { key: 'edit', i18nKey: 'desktop.menu.edit', fallback: 'Edit' },
  { key: 'view', i18nKey: 'desktop.menu.view', fallback: 'View' },
  { key: 'window', i18nKey: 'desktop.menu.window', fallback: 'Window' },
  { key: 'help', i18nKey: 'desktop.menu.help', fallback: 'Help' },
  { key: 'help.docs', i18nKey: 'desktop.menu.helpDocs', fallback: 'Adminium Docs' },
  { key: 'help.shortcuts', i18nKey: 'desktop.menu.helpShortcuts', fallback: 'Keyboard Shortcuts' },
  { key: 'help.logs', i18nKey: 'desktop.menu.helpLogs', fallback: 'Show Logs' },
  { key: 'help.checkForUpdates', i18nKey: 'desktop.menu.helpCheckForUpdates', fallback: 'Check for Updates…' },
  { key: 'help.about', i18nKey: 'desktop.menu.helpAbout', fallback: 'About Adminium' },
];

/** Resolve every menu label through the app translator. Exported for tests. */
export function resolveMenuLabels(
  translate: (key: string, fallback: string) => string = appTranslate,
): DesktopMenuLabels {
  const out = {} as Record<DesktopMenuLabelKey, string>;
  for (const { key, i18nKey, fallback } of MENU_LABEL_SOURCES) {
    out[key] = translate(i18nKey, fallback);
  }
  return out;
}

/**
 * Resolve and push the labels to the shell, if there is one. Fire-and-forget:
 * the native menu rebuild is not something the SPA awaits, and a rejected push
 * (the window closing mid-locale-change) is not the renderer's to surface.
 */
export function pushDesktopMenuLabels(): void {
  const api = getDesktopApi();
  if (api === null) return;
  void api.setMenuLabels(resolveMenuLabels()).catch(() => {
    // The shell logs its own failures (§9); a menu that stays in the previous
    // locale is not worth a console error in the SPA.
  });
}
