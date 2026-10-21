// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

import { aboutDetail, createAboutDialogs, fill, type AskOptions, type AboutDialogsDeps } from './about.js';
import { EN_US_MENU_LABELS, menuTranslator } from './menu.js';
import type { UpdateManager } from './updates.js';

const t = menuTranslator(null);
const VERSIONS = { app: '0.3.31', electron: '44.4.5', chrome: '140.0', node: '22.20.0' };

/** A dialog that answers with the given buttons in turn, and records what it was shown. */
function harness(answers: number[], over: Partial<AboutDialogsDeps> = {}) {
  const shown: AskOptions[] = [];
  const opened: string[] = [];
  const dialogs = createAboutDialogs({
    ask: (options) => {
      shown.push(options);
      return Promise.resolve(answers.shift() ?? options.cancelId);
    },
    openExternal: (url) => opened.push(url),
    releasesUrl: 'https://example.test/releases',
    versions: VERSIONS,
    canSelfUpdate: true,
    ...over,
  });
  return { dialogs, shown, opened };
}

function manager(result: Awaited<ReturnType<UpdateManager['checkForUpdates']>>, over: Partial<UpdateManager> = {}): UpdateManager {
  return {
    checkForUpdates: vi.fn(() => Promise.resolve(result)),
    downloadUpdate: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
    dispose: vi.fn(),
    ...over,
  };
}

describe('fill', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fill('Adminium {version} ({x})', { version: '1.2.3' })).toBe('Adminium 1.2.3 ({x})');
  });
});

describe('the About box', () => {
  it('shows the version and the engines', () => {
    const detail = aboutDetail(t, VERSIONS);
    expect(detail).toContain('Version 0.3.31');
    expect(detail).toContain('Electron 44.4.5');
    expect(detail).toContain('AGPL-3.0');
  });

  it('offers Check for Updates only when a check exists, and runs it', async () => {
    const without = harness([0]);
    await without.dialogs.about({ t });
    expect(without.shown[0]?.buttons).toEqual([EN_US_MENU_LABELS['dialog.ok']]);

    const check = vi.fn();
    const withCheck = harness([1]);
    await withCheck.dialogs.about({ t, check });
    expect(withCheck.shown[0]?.buttons).toEqual([EN_US_MENU_LABELS['dialog.ok'], EN_US_MENU_LABELS['help.checkForUpdates']]);
    expect(check).toHaveBeenCalledOnce();
  });

  it('does not check when closed with OK', async () => {
    const check = vi.fn();
    await harness([0]).dialogs.about({ t, check });
    expect(check).not.toHaveBeenCalled();
  });
});

describe('a check from the menu', () => {
  it('says so when the app is up to date', async () => {
    const h = harness([]);
    await h.dialogs.checkForUpdates({ t, manager: manager({ status: 'none' }) });
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]?.message).toBe(EN_US_MENU_LABELS['update.none.title']);
    expect(h.shown[0]?.detail).toBe('Adminium 0.3.31 is the newest version.');
  });

  it('says it could not check, and can open the download page', async () => {
    const h = harness([1]);
    await h.dialogs.checkForUpdates({ t, manager: manager({ status: 'error' }) });
    expect(h.shown[0]?.type).toBe('warning');
    expect(h.shown[0]?.message).toBe(EN_US_MENU_LABELS['update.error.title']);
    expect(h.opened).toEqual(['https://example.test/releases']);
  });

  it('downloads, then restarts when asked', async () => {
    const h = harness([0, 0]);
    const m = manager({ status: 'available', version: '0.3.32' });
    await h.dialogs.checkForUpdates({ t, manager: m });
    expect(h.shown[0]?.message).toBe('Adminium 0.3.32 is available');
    expect(h.shown[0]?.detail).toBe('You have version 0.3.31.');
    expect(m.downloadUpdate).toHaveBeenCalledOnce();
    expect(h.shown[1]?.message).toBe(EN_US_MENU_LABELS['update.ready.title']);
    expect(m.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('does nothing more on Later', async () => {
    const h = harness([1]);
    const m = manager({ status: 'available', version: '0.3.32' });
    await h.dialogs.checkForUpdates({ t, manager: m });
    expect(m.downloadUpdate).not.toHaveBeenCalled();
    expect(h.shown).toHaveLength(1);
  });

  it('keeps the update for later after it is downloaded', async () => {
    const h = harness([0, 1]);
    const m = manager({ status: 'available', version: '0.3.32' });
    await h.dialogs.checkForUpdates({ t, manager: m });
    expect(m.downloadUpdate).toHaveBeenCalledOnce();
    expect(m.quitAndInstall).not.toHaveBeenCalled();
  });

  it('sends an install that cannot replace itself to the download page', async () => {
    const h = harness([0], { canSelfUpdate: false });
    const m = manager({ status: 'available', version: '0.3.32' });
    await h.dialogs.checkForUpdates({ t, manager: m });
    expect(h.shown[0]?.buttons[0]).toBe(EN_US_MENU_LABELS['update.openPage']);
    expect(m.downloadUpdate).not.toHaveBeenCalled();
    expect(h.opened).toEqual(['https://example.test/releases']);
  });

  it('says so when the download fails', async () => {
    const log = vi.fn();
    const h = harness([0, 0], { log });
    const m = manager(
      { status: 'available', version: '0.3.32' },
      { downloadUpdate: vi.fn(() => Promise.reject(new Error('disk full'))) },
    );
    await h.dialogs.checkForUpdates({ t, manager: m });
    expect(h.shown[1]?.type).toBe('error');
    expect(h.shown[1]?.message).toBe(EN_US_MENU_LABELS['update.downloadFailed.title']);
    expect(h.shown[1]?.detail).toBe('disk full');
    expect(m.quitAndInstall).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
  });

  it('runs one check at a time', async () => {
    let finish: (value: { status: 'none' }) => void = () => {};
    const m = manager({ status: 'none' });
    vi.mocked(m.checkForUpdates).mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    const h = harness([]);
    const first = h.dialogs.checkForUpdates({ t, manager: m });
    await h.dialogs.checkForUpdates({ t, manager: m });
    expect(m.checkForUpdates).toHaveBeenCalledOnce();
    finish({ status: 'none' });
    await first;
    await h.dialogs.checkForUpdates({ t, manager: m });
    expect(m.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('uses the pushed language', async () => {
    const h = harness([]);
    const german = menuTranslator({ 'update.none.title': 'Alles aktuell' } as never);
    await h.dialogs.checkForUpdates({ t: german, manager: manager({ status: 'none' }) });
    expect(h.shown[0]?.message).toBe('Alles aktuell');
    // A key the push left out falls back to English.
    expect(h.shown[0]?.buttons).toEqual(['OK']);
  });
});
