// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN SMALL PAGE, IN ITS OWN SANDBOX.
 *
 * Served only while the add-on is attached to an installed app and on there.
 * Its policy sandboxes it however it is opened, names only the outside hosts
 * the add-on declared, lets only this host and the listed websites frame it,
 * and sends the page's origin as a referrer. The app's own pages keep their
 * policy: no outside host reaches them.
 */
import { settingsRepo } from '@adminium/meta';
import { framedPagePolicy, framedPageSchema } from '@adminium/add-on-contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { cardsKitManifest, shopManifest } from './fixtures/cards-kit/index.js';
import { builtAddOn } from './add-ons/harness.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const SCRIPT = 'document.title = "ready";';
const page = {
  script: 'dist/frame.js',
  title: 'Reviews <box>',
  evalScripts: true as const,
  hosts: { script: ['https://maps.googleapis.com'], connect: ['https://places.googleapis.com'], img: ['https://*.googleusercontent.com'], style: ['https://fonts.googleapis.com'], font: ['https://fonts.gstatic.com'] },
};
const framed = (over: Record<string, unknown> = {}) => {
  const manifest = cardsKitManifest({ compatibility: { minAdminiumVersion: '0.3.71' } });
  return { ...manifest, addOn: { ...(manifest['addOn'] as Record<string, unknown>), framedPage: page, ...over } };
};
const policyOf = (res: { headers: Record<string, unknown> }) => String(res.headers['content-security-policy']);
const directive = (policy: string, name: string) => policy.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';

const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
const trustOnly = (keys: string) => {
  process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = keys;
};
const trustBack = () => {
  if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
};

describe('an add-on\'s framed page', () => {
  let h: Harness;
  let served: Served;
  const get = (url: string) => served.composed.app.inject({ method: 'GET', url, headers: { host: 'studio.example.com' } });

  beforeAll(async () => {
    trustOnly('cards-kit');
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    await h.stageApp(shopManifest({ addOns: { suggests: [{ key: 'cards-kit', range: '*', reason: { 'en-US': 'Cards.' } }] } }));
    expect((await h.install('shop', '1.0.0')).statusCode).toBe(200);
    await h.stageAddOn(framed(), { bundled: true, files: { 'dist/frame.js': SCRIPT } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'cards-kit', version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    await settingsRepo(h.meta).set('publicPages.websites', [{ origin: 'https://lumen.example', addedBy: null, addedAt: 1 }]);
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
  }, 120_000);
  afterAll(async () => {
    trustBack();
    await served.close();
    await h.close();
  });

  it('answers a page with nothing in it but its title and its script', async () => {
    const res = await get('/x/add-on-frame/cards-kit');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<script src="/x/add-on-frame/cards-kit/frame.js" defer></script>');
    expect(res.body).toContain('<title>Reviews &lt;box&gt;</title>');
    expect(res.body).not.toContain('<box>');
  });

  it('is sandboxed by its own policy, however it is opened', async () => {
    const policy = policyOf(await get('/x/add-on-frame/cards-kit'));
    expect(directive(policy, 'sandbox')).toBe('sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(policy).not.toContain('allow-same-origin');
    expect(directive(policy, 'default-src')).toBe("default-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(policy, 'form-action')).toBe("form-action 'none'");
  });

  it('reaches only the hosts the add-on named, and its own one script', async () => {
    const policy = policyOf(await get('/x/add-on-frame/cards-kit'));
    const script = directive(policy, 'script-src');
    expect(script).toMatch(/https?:\/\/studio\.example\.com\/x\/add-on-frame\/cards-kit\/frame\.js/);
    expect(script).toContain('https://maps.googleapis.com');
    expect(script).toContain("'unsafe-eval'");
    expect(script).not.toContain("'self'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(directive(policy, 'connect-src')).toBe('connect-src https://places.googleapis.com');
    expect(directive(policy, 'font-src')).toBe('font-src https://fonts.gstatic.com');
    expect(directive(policy, 'frame-src')).toBe('');
  });

  it('may be framed by this host and the listed websites, and by nobody else', async () => {
    const ancestors = directive(policyOf(await get('/x/add-on-frame/cards-kit')), 'frame-ancestors');
    expect(ancestors).toMatch(/^frame-ancestors https?:\/\/studio\.example\.com https:\/\/lumen\.example$/);
  });

  it('keeps nothing and says what it is', async () => {
    const res = await get('/x/add-on-frame/cards-kit');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('serves its script to a page with no origin of its own', async () => {
    const res = await get('/x/add-on-frame/cards-kit/frame.js');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toBe(SCRIPT);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('says nothing of an add-on that has no such page, or that nobody has', async () => {
    expect((await get('/x/add-on-frame/nobody')).statusCode).toBe(404);
    expect((await get('/x/add-on-frame/nobody/frame.js')).statusCode).toBe(404);
    expect((await get('/x/add-on-frame/NOT_A_KEY')).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('leaves every other page under its own policy, byte for byte', async () => {
    const withIt = String((await get('/api/v1/healthz')).headers['content-security-policy']);
    expect(withIt).not.toContain('googleapis');
    expect(withIt).not.toContain('unsafe-eval');
    const bare = await addOnHarness('sqlite', { unbuiltWords: {} });
    const plain = await servePublic(bare as never, null, { ADMINIUM_DATA_DIR: bare.dataDir });
    try {
      const without = await plain.composed.app.inject({ method: 'GET', url: '/api/v1/healthz', headers: { host: 'studio.example.com' } });
      expect(withIt).toBe(String(without.headers['content-security-policy']));
    } finally {
      await plain.close();
      await bare.close();
    }
  });

  it('serves no page for a package Adminium cannot vouch for', async () => {
    const hand = cardsKitManifest({ key: 'hand-kit', compatibility: { minAdminiumVersion: '0.3.71' } });
    await h.stageAddOn({ ...hand, addOn: { ...(hand['addOn'] as Record<string, unknown>), framedPage: page } }, { files: { 'dist/frame.js': SCRIPT } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'hand-kit', version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    expect((await get('/x/add-on-frame/hand-kit')).statusCode).toBe(404);
    expect((await get('/x/add-on-frame/hand-kit/frame.js')).statusCode).toBe(404);
  });

  it('is gone the moment the add-on is switched off for its app', async () => {
    await h.meta.db.updateTable('adminium_manifest_attachments' as never).set({ disabledAt: new Date().toISOString() } as never).execute();
    expect((await get('/x/add-on-frame/cards-kit')).statusCode).toBe(404);
    expect((await get('/x/add-on-frame/cards-kit/frame.js')).statusCode).toBe(404);
  });
});

const googleReviews = builtAddOn('google-reviews');

describe.skipIf(googleReviews === null)('the built Google reviews add-on', () => {
  let h: Harness;
  let served: Served;
  let keyId = '';
  const get = (url: string) => served.composed.app.inject({ method: 'GET', url, headers: { host: 'studio.example.com' } });
  const read = () => served.composed.app.inject({ method: 'GET', url: '/api/v1/public/records/google_reviews_places', remoteAddress: '10.8.0.1', headers: served.headers() });

  beforeAll(async () => {
    trustOnly('google-reviews');
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    await h.stageApp(shopManifest({ key: 'bookings', version: '0.2.0', compatibility: { minAdminiumVersion: '0.3.71', engines: ['postgres', 'mysql', 'sqlite'] }, addOns: { suggests: [{ key: 'google-reviews', range: '*', reason: { 'en-US': 'Reviews.' } }] }, frontends: [{ side: 'staff', kind: 'none' }], publicAccess: [{ table: 'products', methods: ['GET'], select: ['id', 'name'] }] }));
    const installed = await h.install('bookings', '0.2.0');
    expect(installed.statusCode, installed.body).toBe(200);
    keyId = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    const add = googleReviews!;
    const script = readFileSync(join(process.env['ADMINIUM_ADD_ONS_REPO']!, 'packages', 'google-reviews', 'dist', 'frame.js'), 'utf8');
    await h.stageAddOn(add.manifest, { bundled: true, files: { ...add.files, 'dist/frame.js': script } });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'google-reviews', version: add.version, attachTo: ['bookings'], publicAccess: true } });
    expect(added.statusCode, added.body).toBe(200);
    served = await servePublic(h as never, keyId, { ADMINIUM_DATA_DIR: h.dataDir });
  }, 120_000);
  afterAll(async () => {
    trustBack();
    await served.close();
    await h.close();
  });

  it('is served as its own sandboxed page, reaching only Google', async () => {
    const page = await get('/x/add-on-frame/google-reviews');
    expect(page.statusCode, page.body).toBe(200);
    const policy = policyOf(page);
    expect(policy).toContain('sandbox allow-scripts');
    expect(directive(policy, 'script-src')).toContain('https://maps.googleapis.com');
    const script = await get('/x/add-on-frame/google-reviews/frame.js');
    expect(script.statusCode).toBe(200);
    expect(script.body).toContain('adminium-google-reviews');
  });

  it('tells a signed-out visitor the place only once its owner restricted the key, and only for this app', async () => {
    await h.rows("insert into google_reviews_places (app, place_id, browser_key, restricted, on_booking, on_reviews, on_site) values ('bookings', 'ChIJ7wLmn0p_j4AR3lumenSF2', 'AIzaSyLumenStudioExampleKey00', 0, 1, 1, 0), ('another', 'ChIJanotherAppsPlace000', 'AIzaSyAnotherAppsKeyExample00', 1, 1, 1, 0)");
    expect(((await read()).json() as { data: unknown[] }).data).toEqual([]);
    await h.rows("update google_reviews_places set restricted = 1 where app = 'bookings'");
    const rows = ((await read()).json() as { data: Record<string, unknown>[] }).data;
    expect(rows.map((row) => row['place_id'])).toEqual(['ChIJ7wLmn0p_j4AR3lumenSF2']);
    expect(Object.keys(rows[0]!).sort()).toEqual(['browser_key', 'on_booking', 'on_reviews', 'on_site', 'place_id']);
  });
});

describe('what a framed page may name', () => {
  const parse = (hosts: Record<string, unknown>, more: Record<string, unknown> = {}) => framedPageSchema.safeParse({ script: 'dist/frame.js', title: 'A box', hosts, ...more }).success;

  it('takes https hosts, with at most one leading wildcard', () => {
    expect(parse({ script: ['https://maps.googleapis.com', 'https://*.gstatic.com'] })).toBe(true);
  });

  it.each(['*', 'https://*', 'http://maps.googleapis.com', "'unsafe-inline'", 'https://a.b/path', 'https://a.b; script-src *', 'https://*.*.b.c', 'data:', 'blob:'])('refuses %s', (host) => {
    expect(parse({ script: [host] })).toBe(false);
  });

  it('refuses a script outside the build, and a directive it does not know', () => {
    expect(parse({}, { script: '../secret.js' })).toBe(false);
    expect(parse({}, { script: 'https://evil.example/x.js' })).toBe(false);
    expect(parse({ worker: ['https://a.b'] })).toBe(false);
  });

  it('never allows inline scripts, and evaluates only when it says so', () => {
    const policy = framedPagePolicy('https://s.example', 'k', { script: 'dist/frame.js', title: 'A', hosts: {} }, []);
    expect(policy).toContain('script-src https://s.example/x/add-on-frame/k/frame.js;');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain('frame-ancestors https://s.example');
  });
});
