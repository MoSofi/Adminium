// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RULES OF FOUND PEOPLE THAT NEED NO DATABASE: the day a person must be
 * told by, which language they are told in, what counts as a shared inbox,
 * a purpose with a link in it, a source by name, and the Object link's seal.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { deriveKey } from '../src/config/secrets.js';
import { tellByOf } from '../src/leads/found-store.js';
import { plainSentence, purposeOf, readLeadsSettingsRow } from '../src/leads/installs.js';
import { makeObjectToken, readObjectToken } from '../src/leads/object-token.js';
import { genericAddress } from '../src/leads/people.js';
import { yearsAfter } from '../src/leads/sweep.js';
import { sourceName, tellLanguages } from '../src/leads/tell-words.js';

const KEY = 'object-link-key-for-tests';

describe('the day a found person must be told by', () => {
  it('is one month on, less a day, on the install’s clock', () => {
    expect(tellByOf(Date.UTC(2026, 6, 21, 9), 'Europe/London')).toBe('2026-08-20');
    expect(tellByOf(Date.UTC(2026, 11, 31, 9), 'UTC')).toBe('2027-01-30');
  });

  it('clamps to the end of a shorter month before the day is taken off', () => {
    expect(tellByOf(Date.UTC(2026, 0, 31, 9), 'UTC')).toBe('2026-02-27');
    expect(tellByOf(Date.UTC(2028, 0, 31, 9), 'UTC')).toBe('2028-02-28');
  });

  it('counts from the day it is on the install’s clock, not on the server’s', () => {
    // 23:30 UTC on 21 July is already 22 July in Oslo.
    expect(tellByOf(Date.UTC(2026, 6, 21, 23, 30), 'Europe/Oslo')).toBe('2026-08-21');
    expect(tellByOf(Date.UTC(2026, 6, 21, 23, 30), 'UTC')).toBe('2026-08-20');
  });
});

describe('the keeping time', () => {
  it('ends so many calendar years on, 29 February becoming 28 February', () => {
    expect(new Date(yearsAfter(Date.UTC(2026, 6, 21, 9), 3)).toISOString()).toBe('2029-07-21T09:00:00.000Z');
    expect(new Date(yearsAfter(Date.UTC(2028, 1, 29, 9), 1)).toISOString()).toBe('2029-02-28T09:00:00.000Z');
  });

  it('is read from the settings row, 3 years when it is not one of 1 to 10', () => {
    expect(readLeadsSettingsRow(null)).toMatchObject({ peopleOn: false, keepYears: 3, keepYearsSet: null });
    expect(readLeadsSettingsRow({ people_on: 1, keep_years: 5 })).toMatchObject({ peopleOn: true, keepYears: 5, keepYearsSet: 5 });
    expect(readLeadsSettingsRow({ people_on: true, keep_years: 12 })).toMatchObject({ keepYears: 3, keepYearsSet: null });
  });
});

describe('the language a found person is told in', () => {
  const both = { 'en-US': 'To offer drawing boards.', 'fr-FR': 'Pour proposer des tables à dessin.' };

  it('is their company’s country’s, when the purpose is written in it', () => {
    expect(tellLanguages('FR', 'en-US', both)).toEqual(['fr-FR']);
    expect(tellLanguages('fr', 'de-DE', both)).toEqual(['fr-FR']);
  });

  it('else the install’s and English, each only when the purpose is written in it', () => {
    expect(tellLanguages('NO', 'de-DE', { ...both, 'de-DE': 'Um Zeichentische anzubieten.' })).toEqual(['de-DE', 'en-US']);
    expect(tellLanguages('NO', 'en-US', both)).toEqual(['en-US']);
    expect(tellLanguages('FR', 'en-US', { 'en-US': 'To offer drawing boards.' })).toEqual(['en-US']);
    expect(tellLanguages(null, 'de-DE', both)).toEqual(['en-US']);
    expect(tellLanguages('NO', 'en-US', {})).toEqual([]);
  });
});

describe('what is a shared inbox, not a person', () => {
  it('knows the shared local parts in the sources’ languages, with a qualifier too', () => {
    for (const address of ['info@kestrel-yard.dev', 'Sales@kestrel-yard.dev', 'kontakt@fjordlys.dev', 'accueil@saone-clair.dev', 'info-uk@kestrel-yard.dev', 'contact2@kestrel-yard.dev']) {
      expect(genericAddress(address), address).toBe(true);
    }
  });

  it('takes a person’s own address for a person’s', () => {
    for (const address of ['petra.lindqvist@kestrel-yard.dev', 'omar@kestrel-yard.dev', 'info.desk@kestrel-yard.dev', 'sales.jones@kestrel-yard.dev']) {
      expect(genericAddress(address), address).toBe(false);
    }
  });
});

describe('why found people are kept', () => {
  it('is one plain sentence: a version holding a link is left out', () => {
    expect(plainSentence('To offer your studio drawing boards.')).toBe(true);
    for (const text of ['See https://www.meridian.example/offer', 'Visit www.meridian.example', 'Write to sales@meridian.example', 'Go to meridian.com today']) expect(plainSentence(text), text).toBe(false);
    expect(purposeOf(JSON.stringify({ 'en-US': 'To offer drawing boards.', 'fr-FR': 'Voir https://x.example', 'xx-YY': 'Nope' }))).toEqual({ 'en-US': 'To offer drawing boards.' });
    expect(purposeOf({ 'de-DE': '   ' })).toEqual({});
  });
});

describe('a source by name', () => {
  it('is its id in words and the host it is asked at', () => {
    expect(sourceName('hunter', ['api.hunter.io'])).toBe('Hunter (hunter.io)');
    expect(sourceName('companies-house', ['api.company-information.service.gov.uk'])).toBe('Companies house (company-information.service.gov.uk)');
    expect(sourceName('website', [])).toBe('Website');
  });
});

describe('the Object link', () => {
  const claim = { address: ' Petra.Lindqvist@Kestrel-Yard.dev ', installId: 'mft_1', found: '42', foundAt: 1_785_000_000_123, language: 'fr-FR' };

  it('reads back what it was made with, the address sealed in it, and when the row says they were found', () => {
    const token = makeObjectToken(KEY, 'ins_1', claim);
    expect(token).not.toContain('petra');
    expect(readObjectToken(KEY, 'ins_1', token)).toEqual({ address: 'petra.lindqvist@kestrel-yard.dev', installId: 'mft_1', found: '42', foundAt: 1_785_000_000_123, language: 'fr-FR' });
  });

  it('is dead without the moment the row was found: an id alone names whoever holds it now', () => {
    const token = makeObjectToken(KEY, 'ins_1', claim);
    const [payload] = token.split('~') as [string, string];
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    delete body['t'];
    const text = Buffer.from(JSON.stringify(body)).toString('base64url');
    const signature = createHmac('sha256', deriveKey(KEY, 'adminium:object-token:sign:v1', 'sign')).update(text).digest('base64url');
    expect(readObjectToken(KEY, 'ins_1', `${text}~${signature}`)).toBeNull();
  });

  it('is dead when changed by one character, made by another install or with another key', () => {
    const token = makeObjectToken(KEY, 'ins_1', claim);
    const [payload, signature] = token.split('~') as [string, string];
    const flip = (text: string, at: number) => `${text.slice(0, at)}${text[at] === 'A' ? 'B' : 'A'}${text.slice(at + 1)}`;
    expect(readObjectToken(KEY, 'ins_1', `${flip(payload, 5)}~${signature}`)).toBeNull();
    expect(readObjectToken(KEY, 'ins_1', `${payload}~${flip(signature, 10)}`)).toBeNull();
    expect(readObjectToken(KEY, 'ins_2', token)).toBeNull();
    expect(readObjectToken('another-key', 'ins_1', token)).toBeNull();
    expect(readObjectToken(KEY, 'ins_1', 'not-a-token')).toBeNull();
  });
});
