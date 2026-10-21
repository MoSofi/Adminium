// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Push the native menu's localized labels to the Electron shell ("All labels
 * localized via @adminium/i18n bundles … menu rebuilds on locale change").
 *
 * ─── Why the RENDERER resolves these, not the shell ──────────────────────────
 *
 * The desktop shell cannot import `@adminium/i18n` (`.dependency-cruiser.cjs`'s
 * `desktop-shell-only` rule — `apps/desktop` may import `@adminium/server` and
 * nothing else), and the locale the menu must follow is the one the USER picked
 * in this SPA — the axis `ThemeProvider` owns, which only the renderer knows
 * and only the renderer knows when it changes. So the SPA resolves the menu
 * strings through its own `t()` and pushes the map over `setMenuLabels`;
 * `apps/desktop/src/main/index.ts` rebuilds the native menu from it
 * (`menu.ts`'s `menuTranslator`).
 *
 * On self-host and Cloud there is no shell — `getDesktopApi()` returns `null` and
 * this is a no-op, exactly as this same one bundle must behave in a browser
 * (detection contract).
 *
 * The keys are the shared contract's {@link DesktopMenuLabelKey}, so a menu item
 * this SPA forgets to resolve is a compile error here (the return type is a full
 * `Record`), not a menu item that silently stays English at runtime. The
 * fallbacks mirror `menu.ts`'s `EN_US_MENU_LABELS` so a pre-i18n call (or a
 * missing bundle) degrades to the same English the boot menu shows.
 */
import type { DesktopMenuLabelKey, DesktopMenuLabels, DesktopStopWords } from '@adminium/desktop/api';

import { getDesktopApi } from '../lib/desktop-runtime.js';
import { getI18nInstance, t as appTranslate } from '../i18n/t.js';

/**
 * The i18n key and en-US fallback for each menu label. They live in the
 * `desktop` namespace, which the app's own Start screen also reads: one set of
 * words for both pages that push the menu.
 */
const MENU_LABEL_SOURCES: ReadonlyArray<{
  readonly key: DesktopMenuLabelKey;
  readonly i18nKey: string;
  readonly fallback: string;
}> = [
  { key: 'file', i18nKey: 'desktop:menu.file', fallback: 'File' },
  { key: 'file.newDatabase', i18nKey: 'desktop:menu.fileNewDatabase', fallback: 'New local database…' },
  { key: 'file.openSqlite', i18nKey: 'desktop:menu.fileOpenSqlite', fallback: 'Open SQLite file…' },
  { key: 'file.backupNow', i18nKey: 'desktop:menu.fileBackupNow', fallback: 'Back up now…' },
  { key: 'file.restore', i18nKey: 'desktop:menu.fileRestore', fallback: 'Restore from backup…' },
  { key: 'edit', i18nKey: 'desktop:menu.edit', fallback: 'Edit' },
  { key: 'view', i18nKey: 'desktop:menu.view', fallback: 'View' },
  { key: 'window', i18nKey: 'desktop:menu.window', fallback: 'Window' },
  { key: 'help', i18nKey: 'desktop:menu.help', fallback: 'Help' },
  { key: 'help.docs', i18nKey: 'desktop:menu.helpDocs', fallback: 'Adminium Docs' },
  { key: 'help.shortcuts', i18nKey: 'desktop:menu.helpShortcuts', fallback: 'Keyboard Shortcuts' },
  { key: 'help.logs', i18nKey: 'desktop:menu.helpLogs', fallback: 'Show Logs' },
  { key: 'help.checkForUpdates', i18nKey: 'desktop:menu.helpCheckForUpdates', fallback: 'Check for Updates…' },
  { key: 'help.about', i18nKey: 'desktop:menu.helpAbout', fallback: 'About Adminium' },
  // The native About box and the menu's update check. `{version}` / `{current}` are the shell's to fill.
  { key: 'dialog.ok', i18nKey: 'desktop:dialog.ok', fallback: 'OK' },
  { key: 'dialog.version', i18nKey: 'desktop:dialog.aboutVersion', fallback: 'Version {version}' },
  { key: 'update.none.title', i18nKey: 'desktop:dialog.updateNoneTitle', fallback: 'You’re up to date' },
  { key: 'update.none.detail', i18nKey: 'desktop:dialog.updateNoneDetail', fallback: 'Adminium {version} is the newest version.' },
  { key: 'update.available.title', i18nKey: 'desktop:dialog.updateAvailableTitle', fallback: 'Adminium {version} is available' },
  { key: 'update.available.detail', i18nKey: 'desktop:dialog.updateAvailableDetail', fallback: 'You have version {current}.' },
  { key: 'update.download', i18nKey: 'desktop:dialog.updateDownload', fallback: 'Download and Install' },
  { key: 'update.openPage', i18nKey: 'desktop:dialog.updateOpenPage', fallback: 'Open Download Page' },
  { key: 'update.later', i18nKey: 'desktop:dialog.updateLater', fallback: 'Later' },
  { key: 'update.ready.title', i18nKey: 'desktop:dialog.updateReadyTitle', fallback: 'The update is ready' },
  { key: 'update.ready.detail', i18nKey: 'desktop:dialog.updateReadyDetail', fallback: 'Restart Adminium to finish installing it.' },
  { key: 'update.restart', i18nKey: 'desktop:dialog.updateRestart', fallback: 'Restart Now' },
  { key: 'update.error.title', i18nKey: 'desktop:dialog.updateErrorTitle', fallback: 'Couldn’t check for updates' },
  { key: 'update.error.detail', i18nKey: 'desktop:dialog.updateErrorDetail', fallback: 'Check your internet connection and try again.' },
  { key: 'update.downloadFailed.title', i18nKey: 'desktop:dialog.updateDownloadFailedTitle', fallback: 'The update couldn’t be downloaded' },
];

/**
 * `{version}` and `{current}` are the shell's to fill. They are ICU arguments to
 * the translator, so each is handed itself back: the text crosses as written,
 * without an ICU warning for a missing value.
 */
const KEPT_PLACEHOLDERS = { version: '{version}', current: '{current}' } as const;

/** Resolve every menu label through the app translator. Exported for tests. */
export function resolveMenuLabels(
  translate: (key: string, fallback: string, args?: Record<string, unknown>) => string = appTranslate,
): DesktopMenuLabels {
  const out = {} as Record<DesktopMenuLabelKey, string>;
  for (const { key, i18nKey, fallback } of MENU_LABEL_SOURCES) {
    out[key] = translate(i18nKey, fallback, KEPT_PLACEHOLDERS);
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
  // The `desktop` namespace is loaded on demand: read it in first, so the push
  // carries the current language rather than the English fallbacks.
  const words = getI18nInstance()?.loadNamespaces('desktop') ?? Promise.resolve();
  void words
    .catch(() => {
      // No bundle: the fallbacks are English, which is what the menu had.
    })
    .then(() => api.setMenuLabels(resolveMenuLabels()))
    .catch(() => {
      // The shell logs its own failures; a menu that stays in the previous
      // locale is not worth a console error in the SPA.
    });
}

/**
 * The quit and close questions (a native dialog, asked by the app while a
 * project is in the middle of something), in the current language. Same road
 * as the menu, for the same reason: the app holds no translations.
 */
export function resolveStopWords(translate: (key: string, fallback: string) => string = appTranslate): DesktopStopWords {
  return {
    turn: translate('desktop.stop.turn', 'The Designer is in the middle of a turn.'),
    start: translate('desktop.stop.start', 'An app is being added to this project.'),
    save: translate('desktop.stop.save', 'Your changes are being saved.'),
    restore: translate('desktop.stop.restore', 'An earlier version is being put back.'),
    style: translate('desktop.stop.style', 'The style is being changed.'),
    other: translate('desktop.stop.other', 'This project is being changed.'),
    quitDetail: translate('desktop.stop.quitDetail', 'If you quit now it is stopped where it is. What was already written stays.'),
    closeDetail: translate('desktop.stop.closeDetail', 'If you close the project now it is stopped where it is. What was already written stays.'),
    quitAnyway: translate('desktop.stop.quitAnyway', 'Quit anyway'),
    closeAnyway: translate('desktop.stop.closeAnyway', 'Close anyway'),
    keepWorking: translate('desktop.stop.keepWorking', 'Keep working'),
    shareDetail: translate('desktop.stop.shareDetail', 'If you share now it is stopped where it is. What was already written stays.'),
    shareAnyway: translate('desktop.stop.shareAnyway', 'Stop and share'),
  };
}

/** Handed over with the menu, at boot and at every change of language. Nothing in an app older than the call. */
export function pushDesktopStopWords(): void {
  const setStopWords = getDesktopApi()?.project?.setStopWords;
  if (setStopWords === undefined) return;
  void setStopWords(resolveStopWords()).catch(() => {
    // The question is then asked in the language it had: not worth a console error.
  });
}
