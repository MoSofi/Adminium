// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's own catalogue, and the two properties that make it safe to hand
 * one to the host: the add-on's words are readable, and no add-on can read
 * another's.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import { addOnNamespaceFor, registerMessages } from './messages.js';

const GERMAN = {
  'en-US': { 'manager.title': 'Invoices', 'editor.save': 'Save invoice' },
  'de-DE': { 'manager.title': 'Rechnungen', 'editor.save': 'Rechnung speichern' },
};

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe('an add-on catalogue', () => {
  it('reads its own words back, in the running language', () => {
    restore = installTestI18n();
    const t = registerMessages('invoices', GERMAN);
    expect(t('manager.title', 'fallback')).toBe('Invoices');
  });

  it('answers from the fallback when i18n never booted', () => {
    // A unit test harness has no instance. Raw keys on screen would be the
    // alternative, and they are worse than English.
    const t = registerMessages('invoices', GERMAN);
    expect(t('manager.title', 'Invoices')).toBe('Invoices');
  });

  it('cannot read another add-on’s words, even under the same key', () => {
    // The whole reason the caller never names the namespace.
    restore = installTestI18n();
    const invoices = registerMessages('invoices', {
      'en-US': { 'manager.title': 'Invoices' },
    });
    const documents = registerMessages('documents', {
      'en-US': { 'manager.title': 'Documents' },
    });
    expect(invoices('manager.title', 'x')).toBe('Invoices');
    expect(documents('manager.title', 'x')).toBe('Documents');
  });

  it('derives the namespace from the add-on key, never from the add-on', () => {
    expect(addOnNamespaceFor('invoices')).toBe('addon.invoices');
    expect(addOnNamespaceFor('documents')).not.toBe(addOnNamespaceFor('invoices'));
  });

  it('re-registering replaces a key rather than merging the old value back', () => {
    // `addResourceBundle` would keep the stale copy; an upgrade in another tab
    // is exactly when that would bite, and silently.
    restore = installTestI18n();
    registerMessages('invoices', { 'en-US': { 'manager.title': 'Old' } });
    const t = registerMessages('invoices', { 'en-US': { 'manager.title': 'New' } });
    expect(t('manager.title', 'x')).toBe('New');
  });
});
