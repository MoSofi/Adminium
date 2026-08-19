// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-run wizard's pure rules (11-electron.md §6, task 11-T07). Four of
 * them are worth a test each because they decide something the user cannot
 * undo, or cannot see:
 *
 *  - `slugPreview` MIRRORS the server's `slugFor`. The preview it draws is the
 *    filename the server will create, so a drift is a screen that lies.
 *  - `sourceCardValid` is the Continue button. It gates on the SLUG, not the
 *    name, because the server 422s a name with no slug.
 *  - `isNetworkSharePath` warns, and must warn on nothing else: a warning that
 *    fires on a USB stick teaches the user to dismiss warnings.
 *  - the sessionStorage trio makes the wizard refresh-safe and must degrade to
 *    a non-resumable wizard rather than throw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DESKTOP_SETUP_STEP_IDS,
  INITIAL_DESKTOP_SETUP_STATE,
  clearDesktopSetupState,
  desktopSetupStepLabel,
  isNetworkSharePath,
  formatCount,
  loadDesktopSetupState,
  localeFromNavigator,
  nameFromSqlitePath,
  saveDesktopSetupState,
  slugPreview,
  sourceCardValid,
  sqliteDsn,
  type DesktopSetupState,
} from './desktopSetupState.js';

/** Set by the storage-failure test; undone here so the next test sees a real store. */
let restoreStorage: (() => void) | null = null;

afterEach(() => {
  restoreStorage?.();
  restoreStorage = null;
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe('slugPreview', () => {
  it('lowercases and hyphenates the words of a name', () => {
    expect(slugPreview('Northline Orders')).toBe('northline-orders');
  });

  it('strips diacritics rather than dropping the letters that carry them', () => {
    expect(slugPreview('Café München')).toBe('cafe-munchen');
  });

  it('collapses runs of punctuation and trims the leading/trailing hyphens', () => {
    expect(slugPreview('  --Orders // 2026!!  ')).toBe('orders-2026');
  });

  it('is empty for a name with no sluggable character — which is what the server 422s', () => {
    expect(slugPreview('!!!')).toBe('');
    expect(slugPreview('   ')).toBe('');
  });

  it('caps the slug at 48 characters', () => {
    const slug = slugPreview('a'.repeat(80));
    expect(slug).toHaveLength(48);
  });
});

describe('desktopSetupStepLabel', () => {
  it('names every step §6 orders, with no id falling through', () => {
    expect(DESKTOP_SETUP_STEP_IDS.map(desktopSetupStepLabel)).toEqual([
      'Welcome',
      'Your first database',
      'Your account',
      'Generate',
    ]);
  });
});

describe('isNetworkSharePath', () => {
  it('warns on the shapes that cannot be anything but a share', () => {
    expect(isNetworkSharePath(String.raw`\\fileserver\team\orders.sqlite`)).toBe(true);
    expect(isNetworkSharePath('smb://fileserver/team/orders.sqlite')).toBe(true);
    expect(isNetworkSharePath('AFP://fileserver/team/orders.sqlite')).toBe(true);
    expect(isNetworkSharePath('nfs://fileserver/team/orders.sqlite')).toBe(true);
  });

  it('stays quiet on /Volumes — a USB stick must not train the user to dismiss it', () => {
    expect(isNetworkSharePath('/Volumes/Backup/orders.sqlite')).toBe(false);
    expect(isNetworkSharePath('/Users/ava/orders.sqlite')).toBe(false);
    expect(isNetworkSharePath(String.raw`C:\Users\ava\orders.sqlite`)).toBe(false);
  });

  it('does not mistake a lone backslash pair for a UNC path', () => {
    // `\\` with nothing after it names no host, so it names no share.
    expect(isNetworkSharePath(String.raw`\\`)).toBe(false);
    expect(isNetworkSharePath(String.raw`\\\\`)).toBe(false);
  });
});

describe('sourceCardValid', () => {
  const state = (overrides: Partial<DesktopSetupState>): DesktopSetupState => ({
    ...INITIAL_DESKTOP_SETUP_STATE,
    ...overrides,
  });

  it('refuses Continue until a card is chosen', () => {
    expect(sourceCardValid(state({ source: null }))).toBe(false);
  });

  it('gates card 1 on the slug, not on the name', () => {
    // "!!!" is a non-empty name with an empty slug; the server would 422 it.
    expect(sourceCardValid(state({ source: 'local', localName: '!!!' }))).toBe(false);
    expect(sourceCardValid(state({ source: 'local', localName: 'Orders' }))).toBe(true);
  });

  it('gates card 2 on a picked file', () => {
    expect(sourceCardValid(state({ source: 'open-sqlite' }))).toBe(false);
    expect(sourceCardValid(state({ source: 'open-sqlite', sqliteFile: '/tmp/x.sqlite' }))).toBe(true);
  });

  it('gates card 3 on both a name and a DSN, ignoring whitespace-only entries', () => {
    expect(sourceCardValid(state({ source: 'remote', remoteName: 'Prod', remoteDsn: '   ' }))).toBe(false);
    expect(sourceCardValid(state({ source: 'remote', remoteName: '  ', remoteDsn: 'postgres://x' }))).toBe(
      false,
    );
    expect(
      sourceCardValid(state({ source: 'remote', remoteName: 'Prod', remoteDsn: 'postgres://x' })),
    ).toBe(true);
  });

  it('lets the demo card through with no form at all', () => {
    expect(sourceCardValid(state({ source: 'demo' }))).toBe(true);
  });
});

describe('sqliteDsn / nameFromSqlitePath', () => {
  it('registers the file in place, as a `sqlite:` DSN over its absolute path', () => {
    expect(sqliteDsn('/Users/ava/data/orders.sqlite')).toBe('sqlite:/Users/ava/data/orders.sqlite');
  });

  it('proposes the basename without its extension as the connection name', () => {
    expect(nameFromSqlitePath('/Users/ava/data/orders.sqlite')).toBe('orders');
    expect(nameFromSqlitePath('/Users/ava/data/orders.sqlite3')).toBe('orders');
    expect(nameFromSqlitePath('/Users/ava/data/orders.DB')).toBe('orders');
  });

  it('reads a Windows path', () => {
    expect(nameFromSqlitePath(String.raw`C:\Users\ava\orders.db`)).toBe('orders');
  });

  it('keeps an extensionless filename, and never proposes an empty name', () => {
    expect(nameFromSqlitePath('/Users/ava/data/orders')).toBe('orders');
    // `.sqlite` alone would strip to '' — the basename is the honest fallback.
    expect(nameFromSqlitePath('/Users/ava/data/.sqlite')).toBe('.sqlite');
  });
});

describe('the wizard in sessionStorage', () => {
  it('round-trips a partially filled wizard across a refresh', () => {
    const state: DesktopSetupState = {
      ...INITIAL_DESKTOP_SETUP_STATE,
      step: 'account',
      source: 'local',
      localName: 'Orders',
    };
    saveDesktopSetupState(state);
    expect(loadDesktopSetupState()).toEqual(state);
  });

  it('starts at the initial state when nothing was stored', () => {
    expect(loadDesktopSetupState()).toEqual(INITIAL_DESKTOP_SETUP_STATE);
  });

  it('fills the gaps of an older stored shape from the initial state', () => {
    // A wizard resumed after an upgrade that added a field must not resume with
    // that field `undefined`.
    window.sessionStorage.setItem('adminium-desktop-setup', JSON.stringify({ step: 'database' }));
    const loaded = loadDesktopSetupState();
    expect(loaded.step).toBe('database');
    expect(loaded.enrichSections).toEqual(INITIAL_DESKTOP_SETUP_STATE.enrichSections);
    expect(loaded.singleUser).toBe(true);
  });

  it('falls back to the initial state for a corrupt or non-object entry', () => {
    window.sessionStorage.setItem('adminium-desktop-setup', 'not json');
    expect(loadDesktopSetupState()).toEqual(INITIAL_DESKTOP_SETUP_STATE);
    window.sessionStorage.setItem('adminium-desktop-setup', 'null');
    expect(loadDesktopSetupState()).toEqual(INITIAL_DESKTOP_SETUP_STATE);
  });

  it('clears the resume point', () => {
    saveDesktopSetupState({ ...INITIAL_DESKTOP_SETUP_STATE, step: 'generate' });
    clearDesktopSetupState();
    expect(loadDesktopSetupState()).toEqual(INITIAL_DESKTOP_SETUP_STATE);
  });

  it('degrades to a non-resumable wizard when storage throws', () => {
    const boom = (): never => {
      throw new DOMException('QuotaExceededError');
    };
    const real = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: { getItem: boom, setItem: boom, removeItem: boom },
    });
    restoreStorage = () => {
      if (real === undefined) delete (window as { sessionStorage?: unknown }).sessionStorage;
      else Object.defineProperty(window, 'sessionStorage', real);
    };
    expect(() => {
      saveDesktopSetupState(INITIAL_DESKTOP_SETUP_STATE);
    }).not.toThrow();
    expect(loadDesktopSetupState()).toEqual(INITIAL_DESKTOP_SETUP_STATE);
    expect(() => {
      clearDesktopSetupState();
    }).not.toThrow();
  });
});

describe('localeFromNavigator', () => {
  it('matches an exact BCP-47 tag', () => {
    expect(localeFromNavigator('en-US')).toBe('en_US');
    expect(localeFromNavigator('de-DE')).toBe('de_DE');
  });

  it('is case-insensitive', () => {
    expect(localeFromNavigator('DE-de')).toBe('de_DE');
  });

  it('falls back to the language subtag rather than to English', () => {
    // `de-AT` ships no bundle; German is the right answer, English is not.
    expect(localeFromNavigator('de-AT')).toBe('de_DE');
  });

  it('is null for a language this build does not ship', () => {
    // The honest answer — the caller then leaves the picker on the default
    // instead of asserting that a Swahili speaker asked for English.
    expect(localeFromNavigator('sw-KE')).toBeNull();
  });

  it('reads navigator.language when no tag is passed', () => {
    vi.stubGlobal('navigator', { language: 'fr-FR' });
    expect(localeFromNavigator()).toBe('fr_FR');
  });
});

describe('formatCount', () => {
  it('groups the seeded-row count for the OS locale', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(formatCount(1234)).toBe('1,234');
    vi.stubGlobal('navigator', { language: 'de-DE' });
    expect(formatCount(1234)).toBe('1.234');
  });
});
