// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A lead source add-on's keys, one per source in its one credential
 * envelope, and the readable state beside them: each source's key read apart
 * ("Key not set" on one beside a saved key on another), a key replaced or
 * removed without touching the others, an envelope that is not a sources
 * envelope read as holding none (parsed, never cast), and each source's
 * defaults before anything was saved for it.
 */
import { describe, expect, it } from 'vitest';

import { SOURCE_KEY_MAX, lastFour, sourceKey, sourceSecretSchema, withSourceKey } from '../src/lead-sources/keys.js';
import type { LeadSourceEntry } from '../src/lead-sources/pending-types.js';
import { DEFAULT_DAILY_CAP, DEFAULT_PERSON_SHARE, defaultSourceState, emptySourcesState, needsKey, sourceStateOf, sourcesDocName } from '../src/lead-sources/state.js';

const envelope = (secret: unknown) => ({ kind: 'api-key' as const, secret: secret as Record<string, unknown>, expiresAt: null, scopes: null });

const REGISTER: LeadSourceEntry = { id: 'companies-house', hosts: ['api.company-information.service.gov.uk'], key: 'companies_house_key', gives: ['find', 'fill'], window: { calls: 600, seconds: 300 } };
const PEOPLE: LeadSourceEntry = { id: 'hunter', hosts: ['api.hunter.io'], key: 'hunter_key', gives: ['people'], paid: true };
const OPEN: LeadSourceEntry = { id: 'sirene', hosts: ['recherche-entreprises.api.gouv.fr'], gives: ['find', 'fill'] };
const WEBSITE: LeadSourceEntry = { id: 'website', reads: 'website', gives: ['fill'] };

describe("a lead source add-on's keys", () => {
  it('reads "Key not set" on one source beside a saved key on another, both apart, in one envelope', () => {
    const saved = envelope(withSourceKey(null, 'companies-house', '  test-key-companies-1  '));
    expect(saved.secret).toEqual({ sources: 1, 'companies-house': { key: 'test-key-companies-1' } });
    expect(sourceKey(saved, 'companies-house')).toBe('test-key-companies-1');
    expect(sourceKey(saved, 'hunter')).toBeNull();

    const both = envelope(withSourceKey(saved, 'hunter', 'test-key-people-2'));
    expect(sourceKey(both, 'companies-house')).toBe('test-key-companies-1');
    expect(sourceKey(both, 'hunter')).toBe('test-key-people-2');
  });

  it('replaces or removes one key and keeps every other as it was', () => {
    const both = envelope(withSourceKey(envelope(withSourceKey(null, 'companies-house', 'test-key-companies-1')), 'hunter', 'test-key-people-2'));
    const replaced = envelope(withSourceKey(both, 'hunter', 'test-key-people-3'));
    expect(sourceKey(replaced, 'hunter')).toBe('test-key-people-3');
    expect(sourceKey(replaced, 'companies-house')).toBe('test-key-companies-1');
    const removed = envelope(withSourceKey(replaced, 'hunter', null));
    expect(removed.secret).toEqual({ sources: 1, 'companies-house': { key: 'test-key-companies-1' } });
    // An empty paste removes, as a removal does.
    expect(envelope(withSourceKey(removed, 'companies-house', '   ')).secret).toEqual({ sources: 1 });
  });

  it('reads an envelope that is not a sources envelope as holding no key, and starts a new one over it', () => {
    const generic = envelope({ hunter_key: 'test-key-people-2' });
    expect(sourceKey(generic, 'hunter')).toBeNull();
    expect(sourceKey(envelope({ sources: 2, hunter: { key: 'x' } }), 'hunter')).toBeNull();
    expect(sourceKey(envelope({ sources: 1, hunter: { key: 'x', more: 1 } }), 'hunter')).toBeNull();
    expect(sourceKey(envelope({ sources: 1, 'Not An Id': { key: 'x' } }), 'hunter')).toBeNull();
    expect(withSourceKey(generic, 'hunter', 'test-key-people-2')).toEqual({ sources: 1, hunter: { key: 'test-key-people-2' } });
  });

  it('never names the version mark or a malformed id as a source, and refuses a key too long to keep', () => {
    expect(() => withSourceKey(null, 'sources', 'x')).toThrow(/source id/);
    expect(() => withSourceKey(null, 'Hunter', 'x')).toThrow(/source id/);
    expect(sourceKey(envelope({ sources: 1 }), 'sources')).toBeNull();
    expect(() => withSourceKey(null, 'hunter', 'k'.repeat(SOURCE_KEY_MAX + 1))).toThrow();
    expect(sourceSecretSchema.safeParse({ sources: 1, hunter: { key: 'k'.repeat(SOURCE_KEY_MAX) } }).success).toBe(true);
  });

  it('shows the last four of a key, never more', () => {
    expect(lastFour('test-key-companies-1')).toBe('es-1');
    expect(lastFour('abcd')).toBe('');
  });
});

describe("each source's state before anything was saved", () => {
  it('is off until a key is saved, on at once for a source that needs none; a paid source is capped', () => {
    expect(needsKey(REGISTER)).toBe(true);
    expect(needsKey(OPEN)).toBe(false);
    expect(needsKey(WEBSITE)).toBe(false);
    expect(defaultSourceState(REGISTER)).toEqual({ lastFour: null, savedAt: null, checkedAt: null, verdict: null, on: false, dailyCap: null, personShare: DEFAULT_PERSON_SHARE });
    expect(defaultSourceState(PEOPLE)).toMatchObject({ on: false, dailyCap: DEFAULT_DAILY_CAP, personShare: 50 });
    expect(defaultSourceState(OPEN)).toMatchObject({ on: true, dailyCap: null });
    expect(defaultSourceState(WEBSITE)).toMatchObject({ on: true, dailyCap: null });
  });

  it("reads a source the document names as the document says, and one it does not with its defaults", () => {
    const document = { ...emptySourcesState(), sources: { hunter: { lastFour: '9xQ4', savedAt: 1, checkedAt: 2, verdict: 'accepted' as const, on: true, dailyCap: 40, personShare: 25 } } };
    expect(sourceStateOf(document, PEOPLE)).toMatchObject({ lastFour: '9xQ4', on: true, dailyCap: 40, personShare: 25 });
    expect(sourceStateOf(document, REGISTER)).toEqual(defaultSourceState(REGISTER));
    expect(sourcesDocName('mft_01')).toBe('add-on-sources:mft_01');
  });
});
