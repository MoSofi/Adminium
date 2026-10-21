// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The native-menu localization push.
 *
 * The full path (SPA locale change → `setMenuLabels` → main-process menu
 * rebuild) is Playwright `_electron` suite; here we cover the SPA half in
 * isolation: every menu key resolves through the app translator, the push
 * carries a FULL label set (the shell's `strictObject` refuses a partial one),
 * and there is no bridge to reach off the desktop shell.
 */
import type { AdminiumDesktopApi, DesktopMenuLabels } from '@adminium/desktop/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createI18n, loadLocaleBundle } from '@adminium/i18n';

import { setI18nInstance } from '../i18n/t.js';
import { pushDesktopMenuLabels, pushDesktopStopWords, resolveMenuLabels, resolveStopWords } from './menuLabels.js';

/** The key set `DesktopMenuLabels` requires — the shell rejects any subset. */
const MENU_KEYS = [
  'file',
  'file.newDatabase',
  'file.openSqlite',
  'file.backupNow',
  'file.restore',
  'edit',
  'view',
  'window',
  'help',
  'help.docs',
  'help.shortcuts',
  'help.logs',
  'help.checkForUpdates',
  'help.about',
  // The native About box and the menu's update check.
  'dialog.ok',
  'dialog.version',
  'update.none.title',
  'update.none.detail',
  'update.available.title',
  'update.available.detail',
  'update.download',
  'update.openPage',
  'update.later',
  'update.ready.title',
  'update.ready.detail',
  'update.restart',
  'update.error.title',
  'update.error.detail',
  'update.downloadFailed.title',
].sort();

afterEach(() => {
  delete (window as { adminiumDesktop?: unknown }).adminiumDesktop;
  vi.restoreAllMocks();
});

describe('resolveMenuLabels', () => {
  it('resolves every menu key through the translator', () => {
    const labels = resolveMenuLabels((key, fallback) => `${key}|${fallback}`);
    expect(Object.keys(labels).sort()).toEqual(MENU_KEYS);
    expect(labels.file).toBe('desktop:menu.file|File');
    expect(labels['help.about']).toBe('desktop:menu.helpAbout|About Adminium');
  });

  it('degrades to the en-US default when a key has no bundle (t returns fallback)', () => {
    // The dashboard `t(key, fallback)` returns the fallback before i18n init or
    // when a bundle is missing — the labels then mirror menu.ts's boot menu.
    const labels = resolveMenuLabels((_key, fallback) => fallback);
    expect(labels.file).toBe('File');
    expect(labels['file.newDatabase']).toBe('New local database…');
    expect(labels['help.checkForUpdates']).toBe('Check for Updates…');
    // The shell fills the placeholders, so they cross as written.
    expect(labels['update.available.title']).toBe('Adminium {version} is available');
  });
});

describe('the words in another language', () => {
  afterEach(() => {
    setI18nInstance(null);
  });

  it('come from the desktop namespace, with the placeholders kept for the shell', async () => {
    const warn = vi.spyOn(console, 'warn');
    setI18nInstance(await createI18n({ locale: 'de_DE', loadBundle: loadLocaleBundle }));
    const setMenuLabels = vi.fn<AdminiumDesktopApi['setMenuLabels']>(() => Promise.resolve());
    (window as unknown as { adminiumDesktop: Partial<AdminiumDesktopApi> }).adminiumDesktop = { setMenuLabels };

    pushDesktopMenuLabels();
    await vi.waitFor(() => expect(setMenuLabels).toHaveBeenCalledTimes(1));
    const pushed = setMenuLabels.mock.calls[0]?.[0] as DesktopMenuLabels;
    expect(pushed.file).toBe('Datei');
    expect(pushed['update.none.detail']).toBe('Adminium {version} ist die neueste Version.');
    expect(pushed['update.available.detail']).toBe('Installiert ist Version {current}.');
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('ICU'));
  });
});

describe('pushDesktopMenuLabels', () => {
  it('is a no-op off the desktop shell (no bridge)', () => {
    // window.adminiumDesktop is unset ⇒ getDesktopApi() is null ⇒ nothing pushed.
    expect(() => pushDesktopMenuLabels()).not.toThrow();
  });

  it('pushes a full label set to the shell when the bridge is present', async () => {
    const setMenuLabels = vi.fn<AdminiumDesktopApi['setMenuLabels']>(() => Promise.resolve());
    (window as unknown as { adminiumDesktop: Partial<AdminiumDesktopApi> }).adminiumDesktop = {
      setMenuLabels,
    };

    pushDesktopMenuLabels();
    await vi.waitFor(() => expect(setMenuLabels).toHaveBeenCalledTimes(1));

    const pushed = setMenuLabels.mock.calls[0]?.[0] as DesktopMenuLabels;
    // Every key, each a non-empty string — the shell's strictObject would
    // reject a missing menu key, leaving the native menu in English.
    expect(Object.keys(pushed).sort()).toEqual(MENU_KEYS);
    for (const value of Object.values(pushed)) expect(value).toBeTruthy();
  });
});

describe('the quit and close questions’ words', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'adminiumDesktop');
  });

  it('are resolved through the translator, every one', () => {
    const words = resolveStopWords((key) => `<${key}>`);
    expect(Object.keys(words)).toHaveLength(13);
    expect(words.shareAnyway).toBe('<desktop.stop.shareAnyway>');
    expect(words.turn).toBe('<desktop.stop.turn>');
    expect(words.keepWorking).toBe('<desktop.stop.keepWorking>');
    expect(resolveStopWords((_key, fallback) => fallback).closeAnyway).toBe('Close anyway');
  });

  it('are handed to the app where it takes them, and nowhere else', async () => {
    // A browser, and an app older than the call: nothing happens.
    pushDesktopStopWords();
    Object.defineProperty(window, 'adminiumDesktop', { value: { project: {} } as unknown as AdminiumDesktopApi, configurable: true });
    pushDesktopStopWords();

    const setStopWords = vi.fn(() => Promise.reject(new Error('closed')));
    Object.defineProperty(window, 'adminiumDesktop', { value: { project: { setStopWords } } as unknown as AdminiumDesktopApi, configurable: true });
    pushDesktopStopWords();
    expect(setStopWords).toHaveBeenCalledWith(expect.objectContaining({ quitAnyway: 'Quit anyway' }));
    await Promise.resolve();
  });
});
