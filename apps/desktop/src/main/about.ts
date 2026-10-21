// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The native About box and the update check started from the menu.
 *
 * Both are dialogs the shell draws itself, so they work on every screen: the
 * Start screen and an open project have no `/about` page to go to, and before
 * this the About item there was disabled.
 *
 * A check from the menu always ends in an answer — up to date, an update to
 * download, or "could not check". The scheduled checks stay silent; they are
 * not something the person asked for.
 *
 * Electron-free: the dialog, the browser and the updater are handed in, so the
 * whole flow is testable without a window.
 */

import type { UpdateManager } from './updates.js';
import type { MenuTranslate } from './menu.js';

/** The parts of `Electron.MessageBoxOptions` these dialogs use. */
export interface AskOptions {
  type: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

export interface AboutDialogsDeps {
  /** Show a message box; resolves to the index of the button chosen. */
  ask: (options: AskOptions) => Promise<number>;
  /** Open a page in the system browser. */
  openExternal: (url: string) => void;
  /** Where a newer version can be downloaded by hand. */
  releasesUrl: string;
  /** `app.getVersion()` and the engine versions, for the About box. */
  versions: { app: string; electron: string; chrome: string; node: string };
  /** Whether this install can replace itself (deb/rpm cannot). */
  canSelfUpdate: boolean;
  /** Where a failure is written down. */
  log?: ((line: string) => void) | undefined;
}

export interface AboutDialogs {
  /** The About box. `check` adds its "Check for Updates…" button. */
  about(input: { t: MenuTranslate; check?: (() => void) | undefined }): Promise<void>;
  /** A check the person asked for, answered in a dialog. One at a time. */
  checkForUpdates(input: { t: MenuTranslate; manager: UpdateManager }): Promise<void>;
}

/** Fill `{name}` placeholders. A missing value leaves the placeholder, which is easier to spot than a blank. */
export function fill(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** The About box's body: the version, the engines under it, and the licence. */
export function aboutDetail(t: MenuTranslate, versions: AboutDialogsDeps['versions']): string {
  return [
    fill(t('dialog.version'), { version: versions.app }),
    '',
    `Electron ${versions.electron} · Chromium ${versions.chrome} · Node ${versions.node}`,
    'adminium.dev · AGPL-3.0',
  ].join('\n');
}

export function createAboutDialogs(deps: AboutDialogsDeps): AboutDialogs {
  const log = deps.log ?? ((): void => {});
  /** A second click while a check is still running would stack a second set of dialogs. */
  let checking = false;

  const about: AboutDialogs['about'] = async ({ t, check }) => {
    const buttons = check === undefined ? [t('dialog.ok')] : [t('dialog.ok'), t('help.checkForUpdates')];
    const chosen = await deps.ask({
      type: 'info',
      title: t('help.about'),
      message: 'Adminium',
      detail: aboutDetail(t, deps.versions),
      buttons,
      defaultId: 0,
      cancelId: 0,
    });
    if (chosen === 1) check?.();
  };

  /** "Download and Install", then "Restart Now" once it is down. */
  const download = async (t: MenuTranslate, manager: UpdateManager): Promise<void> => {
    try {
      await manager.downloadUpdate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[updater] menu download failed: ${message}`);
      const chosen = await deps.ask({
        type: 'error',
        title: t('help.checkForUpdates'),
        message: t('update.downloadFailed.title'),
        detail: message,
        buttons: [t('dialog.ok'), t('update.openPage')],
        defaultId: 0,
        cancelId: 0,
      });
      if (chosen === 1) deps.openExternal(deps.releasesUrl);
      return;
    }
    const chosen = await deps.ask({
      type: 'info',
      title: t('help.checkForUpdates'),
      message: t('update.ready.title'),
      detail: t('update.ready.detail'),
      buttons: [t('update.restart'), t('update.later')],
      defaultId: 0,
      cancelId: 1,
    });
    if (chosen === 0) manager.quitAndInstall();
  };

  const checkForUpdates: AboutDialogs['checkForUpdates'] = async ({ t, manager }) => {
    if (checking) return;
    checking = true;
    try {
      const result = await manager.checkForUpdates();
      const current = deps.versions.app;

      if (result.status === 'none') {
        await deps.ask({
          type: 'info',
          title: t('help.checkForUpdates'),
          message: t('update.none.title'),
          detail: fill(t('update.none.detail'), { version: current }),
          buttons: [t('dialog.ok')],
          defaultId: 0,
          cancelId: 0,
        });
        return;
      }

      if (result.status === 'error') {
        const chosen = await deps.ask({
          type: 'warning',
          title: t('help.checkForUpdates'),
          message: t('update.error.title'),
          detail: t('update.error.detail'),
          buttons: [t('dialog.ok'), t('update.openPage')],
          defaultId: 0,
          cancelId: 0,
        });
        if (chosen === 1) deps.openExternal(deps.releasesUrl);
        return;
      }

      // `available`. An install that cannot replace itself is sent to the download page instead.
      const chosen = await deps.ask({
        type: 'info',
        title: t('help.checkForUpdates'),
        message: fill(t('update.available.title'), { version: result.version ?? '' }),
        detail: fill(t('update.available.detail'), { current }),
        buttons: [deps.canSelfUpdate ? t('update.download') : t('update.openPage'), t('update.later')],
        defaultId: 0,
        cancelId: 1,
      });
      if (chosen !== 0) return;
      if (!deps.canSelfUpdate) {
        deps.openExternal(deps.releasesUrl);
        return;
      }
      await download(t, manager);
    } finally {
      checking = false;
    }
  };

  return { about, checkForUpdates };
}
