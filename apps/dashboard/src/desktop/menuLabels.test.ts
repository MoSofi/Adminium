// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The native-menu localization push (11-electron.md §14).
 *
 * The full path (SPA locale change → `setMenuLabels` → main-process menu
 * rebuild) is 11-T20's Playwright `_electron` suite; here we cover the SPA half
 * in isolation: every menu key resolves through the app translator, the push
 * carries a FULL label set (the shell's `strictObject` refuses a partial one),
 * and there is no bridge to reach off the desktop shell.
 */
import type { AdminiumDesktopApi, DesktopMenuLabels } from '@adminium/desktop/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pushDesktopMenuLabels, resolveMenuLabels } from './menuLabels.js';

/** The §14 key set `DesktopMenuLabels` requires — the shell rejects any subset. */
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
].sort();

afterEach(() => {
  delete (window as { adminiumDesktop?: unknown }).adminiumDesktop;
  vi.restoreAllMocks();
});

describe('resolveMenuLabels (§14)', () => {
  it('resolves every menu key through the translator', () => {
    const labels = resolveMenuLabels((key, fallback) => `${key}|${fallback}`);
    expect(Object.keys(labels).sort()).toEqual(MENU_KEYS);
    expect(labels.file).toBe('desktop.menu.file|File');
    expect(labels['help.about']).toBe('desktop.menu.helpAbout|About Adminium');
  });

  it('degrades to the en-US default when a key has no bundle (t returns fallback)', () => {
    // The dashboard `t(key, fallback)` returns the fallback before i18n init or
    // when a bundle is missing — the labels then mirror menu.ts's boot menu.
    const labels = resolveMenuLabels((_key, fallback) => fallback);
    expect(labels.file).toBe('File');
    expect(labels['file.newDatabase']).toBe('New local database…');
    expect(labels['help.checkForUpdates']).toBe('Check for Updates…');
  });
});

describe('pushDesktopMenuLabels (§14)', () => {
  it('is a no-op off the desktop shell (no bridge)', () => {
    // window.adminiumDesktop is unset ⇒ getDesktopApi() is null ⇒ nothing pushed.
    expect(() => pushDesktopMenuLabels()).not.toThrow();
  });

  it('pushes a full label set to the shell when the bridge is present', () => {
    const setMenuLabels = vi.fn<AdminiumDesktopApi['setMenuLabels']>(() => Promise.resolve());
    (window as unknown as { adminiumDesktop: Partial<AdminiumDesktopApi> }).adminiumDesktop = {
      setMenuLabels,
    };

    pushDesktopMenuLabels();

    expect(setMenuLabels).toHaveBeenCalledTimes(1);
    const pushed = setMenuLabels.mock.calls[0]?.[0] as DesktopMenuLabels;
    // All 14 keys, each a non-empty string — the shell's strictObject would
    // reject anything less, leaving the native menu in English.
    expect(Object.keys(pushed).sort()).toEqual(MENU_KEYS);
    for (const value of Object.values(pushed)) expect(value).toBeTruthy();
  });
});
