// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Per visitor"'s parts (`views/visitor.ts`): the cookie is read only under
 * its own name for the address it came on, and only a well-formed value; the
 * id kept is a keyed hash, never the value; the banner's words are the
 * engine's default in each of the eight languages until the owner writes
 * their own, field by field, and the wording version follows the words; and
 * only the install's public address and a mapped pages host are its own
 * pages.
 */
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';

import { bannerLocaleOf, bannerWords, BANNER_DEFAULT, newVisitor, ownPagesHost, visitorIdOf, visitorKey, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE_S } from '../src/views/visitor.js';
import { TEST_SECRET } from './helpers.js';

describe('the visitor\'s cookie and banner', () => {
  let meta: MetaDb;
  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
  });

  it('reads the cookie by the name its address gives it, and keeps only a keyed hash of its value', () => {
    const key = visitorKey(TEST_SECRET);
    const made = newVisitor(key);
    expect(made.value).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(made.id).toMatch(/^[0-9a-f]{64}$/);
    expect(made.id).not.toContain(made.value);
    expect(visitorIdOf(key, { protocol: 'https', headers: { cookie: `adminium_session=s; ${VISITOR_COOKIE}=${made.value}` } })).toBe(made.id);
    // The plain-http name is not read on https, nor the https name on http.
    expect(visitorIdOf(key, { protocol: 'https', headers: { cookie: `adm_v=${made.value}` } })).toBeNull();
    expect(visitorIdOf(key, { protocol: 'http', headers: { cookie: `adm_v=${made.value}` } })).toBe(made.id);
    // A value that is no visitor's shape names nobody; another secret, another id.
    expect(visitorIdOf(key, { protocol: 'https', headers: { cookie: `${VISITOR_COOKIE}=<script>` } })).toBeNull();
    expect(visitorIdOf(visitorKey(`${TEST_SECRET}x`), { protocol: 'https', headers: { cookie: `${VISITOR_COOKIE}=${made.value}` } })).not.toBe(made.id);
    // At most six months.
    expect(VISITOR_COOKIE_MAX_AGE_S).toBeLessThanOrEqual(183 * 24 * 60 * 60);
  });

  it('words the banner with the engine\'s default in each language until the owner writes their own, and versions the words', async () => {
    const english = await bannerWords(meta, 'en-US');
    expect(english).toMatchObject({ ...BANNER_DEFAULT, language: 'en-US' });
    const german = await bannerWords(meta, 'de-DE');
    expect(german.title).toBe('Dürfen wir uns an Ihren Besuch erinnern?');
    // The German default never says "notieren".
    expect(german.text).not.toMatch(/notier/i);
    const arabic = await bannerWords(meta, 'ar-EG');
    expect(arabic.title).toBe('هل نتذكر زيارتك؟');
    await settingsRepo(meta).set('privacy.banner', { 'en-US': { yes: 'Sure' } });
    const owned = await bannerWords(meta, 'en-US');
    expect(owned).toMatchObject({ title: BANNER_DEFAULT.title, yes: 'Sure', no: 'No' });
    expect(owned.version).not.toBe(english.version);
    expect(owned.version.length).toBeLessThanOrEqual(32);
    // Another language keeps its default and its version.
    expect((await bannerWords(meta, 'de-DE')).version).toBe(german.version);
    expect([bannerLocaleOf('de-DE'), bannerLocaleOf('de'), bannerLocaleOf('pt-BR'), bannerLocaleOf(null)]).toEqual(['de-DE', 'de-DE', 'en-US', 'en-US']);
  });

  it('counts only the public address and a mapped pages host as the install\'s own pages', async () => {
    const settings = settingsRepo(meta);
    expect(await ownPagesHost(meta, { host: 'crm.meridian.example' })).toBe(false);
    await settings.set('system.publicOrigin', 'https://crm.meridian.example');
    await settings.set('surfaces.pageHosts', { 'pages.meridian.example': { home: '/x/pages/home' } });
    expect(await ownPagesHost(meta, { host: 'crm.meridian.example' })).toBe(true);
    expect(await ownPagesHost(meta, { host: 'CRM.Meridian.example' })).toBe(true);
    expect(await ownPagesHost(meta, { host: 'pages.meridian.example' })).toBe(true);
    expect(await ownPagesHost(meta, { host: 'shop.meridian.example' })).toBe(false);
  });
});
