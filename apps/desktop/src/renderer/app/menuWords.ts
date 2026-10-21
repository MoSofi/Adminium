// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The menu bar's words, and those of the About box and the menu's update check,
 * in the language of the app's own pages.
 *
 * The shell holds no translations: whatever page the window shows sends them.
 * A project's dashboard did, but the Start screen did not, so its menu stayed
 * English. These pages read the same `desktop` words the dashboard reads
 * (`apps/dashboard/src/desktop/menuLabels.ts` lists the same keys).
 *
 * Each word is a call with a literal key and its English, like every other word of these
 * pages, so the pages' source test holds it to the English file.
 */
import type { I18nInstance } from '@adminium/i18n';

import type { DesktopMenuLabels } from '../../preload/api.js';

/** Every word, in the page's language. A key a language lacks shows its English, which is what the shell had. */
export function menuWords(i18n: Pick<I18nInstance, 't'>): DesktopMenuLabels {
  const translate = i18n.t.bind(i18n);
  // `{version}` and `{current}` are the shell's to fill. They are ICU arguments here, so each is handed itself
  // back: the text crosses as written.
  const t = (key: string, fallback: string): string =>
    translate(key, { defaultValue: fallback, version: '{version}', current: '{current}' });
  return {
    file: t('desktop:menu.file', 'File'),
    'file.newDatabase': t('desktop:menu.fileNewDatabase', 'New local database…'),
    'file.openSqlite': t('desktop:menu.fileOpenSqlite', 'Open SQLite file…'),
    'file.backupNow': t('desktop:menu.fileBackupNow', 'Back up now…'),
    'file.restore': t('desktop:menu.fileRestore', 'Restore from backup…'),
    edit: t('desktop:menu.edit', 'Edit'),
    view: t('desktop:menu.view', 'View'),
    window: t('desktop:menu.window', 'Window'),
    help: t('desktop:menu.help', 'Help'),
    'help.docs': t('desktop:menu.helpDocs', 'Adminium Docs'),
    'help.shortcuts': t('desktop:menu.helpShortcuts', 'Keyboard Shortcuts'),
    'help.logs': t('desktop:menu.helpLogs', 'Show Logs'),
    'help.checkForUpdates': t('desktop:menu.helpCheckForUpdates', 'Check for Updates…'),
    'help.about': t('desktop:menu.helpAbout', 'About Adminium'),
    'dialog.ok': t('desktop:dialog.ok', 'OK'),
    'dialog.version': t('desktop:dialog.aboutVersion', 'Version {version}'),
    'update.none.title': t('desktop:dialog.updateNoneTitle', 'You’re up to date'),
    'update.none.detail': t('desktop:dialog.updateNoneDetail', 'Adminium {version} is the newest version.'),
    'update.available.title': t('desktop:dialog.updateAvailableTitle', 'Adminium {version} is available'),
    'update.available.detail': t('desktop:dialog.updateAvailableDetail', 'You have version {current}.'),
    'update.download': t('desktop:dialog.updateDownload', 'Download and Install'),
    'update.openPage': t('desktop:dialog.updateOpenPage', 'Open Download Page'),
    'update.later': t('desktop:dialog.updateLater', 'Later'),
    'update.ready.title': t('desktop:dialog.updateReadyTitle', 'The update is ready'),
    'update.ready.detail': t('desktop:dialog.updateReadyDetail', 'Restart Adminium to finish installing it.'),
    'update.restart': t('desktop:dialog.updateRestart', 'Restart Now'),
    'update.error.title': t('desktop:dialog.updateErrorTitle', 'Couldn’t check for updates'),
    'update.error.detail': t('desktop:dialog.updateErrorDetail', 'Check your internet connection and try again.'),
    'update.downloadFailed.title': t('desktop:dialog.updateDownloadFailedTitle', 'The update couldn’t be downloaded'),
  };
}

/** Send the words to the shell. Fire-and-forget: a menu left in English is not worth an error on the page. */
export function pushMenuWords(i18n: Pick<I18nInstance, 't'>, api: { setMenuLabels(labels: DesktopMenuLabels): Promise<void> }): void {
  void api.setMenuLabels(menuWords(i18n)).catch(() => {});
}
