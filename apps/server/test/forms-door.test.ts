// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The forms door's own routes, over a catalog a test hands in: the content
 * policy every answer carries (exact, in both modes), the headers, the
 * bundle's files and their refusals, the loader, the human check (an unknown
 * form gets one that looks like a real one), the page that stands in when the
 * bundle was never built, and the reachability gate.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseForm } from '@adminium/add-on-contracts/forms';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';

import type { FormLookup, FormsCatalog } from '../src/forms/catalog.js';
import { customerHostAllows, isHostReservedPath } from '../src/plugins/surfaces.js';
import { checkProof, proofKey, solveProof } from '../src/public-api/proof.js';
import { EMBED_MAX_AGE_SECONDS, formProofKeyId, formsDoorRoutes, HARDER_DIFFICULTY, xContentPolicy } from '../src/routes/forms-door/index.js';
import { ANONYMOUS, FIT_OUT, SHOWROOM, SHOWROOM_SETTINGS } from './forms-door.helpers.js';
import { TEST_SECRET } from './helpers.js';

const HTML = '<!doctype html><html><head><title>Form</title></head><body><noscript><p>This form needs JavaScript.</p></noscript><div id="x-root"></div></body></html>';
const HOST = 'forms.meridian.example';

function lookupOf(definition: unknown, settings: unknown, id: string, slug: string): FormLookup {
  const parsed = parseForm(definition, settings);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { state: 'live', live: { id, slug, addOn: 'forms', connectionId: 'conn_1', form: parsed.form } };
}

const FORMS: Record<string, FormLookup> = {
  'showroom-visit': lookupOf(SHOWROOM, SHOWROOM_SETTINGS, 'frm_1', 'showroom-visit'),
  'fit-out': lookupOf(FIT_OUT, ANONYMOUS, 'frm_2', 'fit-out'),
  'old-offer': { state: 'closed' },
};

const catalog: FormsCatalog = {
  find: async (slug) => FORMS[slug] ?? { state: 'unavailable' },
  draft: async () => null,
  liveSlugs: async () => [],
  forget: () => true,
};

describe('the forms door routes', () => {
  let meta: MetaDb;
  let app: FastifyInstance | undefined;
  let spa: string;
  let websites: string[];

  async function start(opts: { built?: boolean; networkFeatures?: boolean } = {}): Promise<void> {
    if (opts.built !== false) {
      mkdirSync(join(spa, 'x', 'assets'), { recursive: true });
      writeFileSync(join(spa, 'x', 'index.html'), HTML);
      writeFileSync(join(spa, 'x', 'embed.js'), 'window.adminium={};');
      writeFileSync(join(spa, 'x', 'assets', 'x-abc123.js'), 'console.log(1);');
      writeFileSync(join(spa, 'x', 'assets', 'x-abc123.css'), 'body{}');
      writeFileSync(join(spa, 'index.html'), '<p>the dashboard</p>');
    }
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('spaRoot', spa);
    // The dashboard's own frame rule, set before the door answers, as helmet does.
    app.addHook('onRequest', async (_request, reply) => {
      void reply.header('x-frame-options', 'SAMEORIGIN');
    });
    await app.register(
      formsDoorRoutes({
        meta,
        catalog,
        secret: TEST_SECRET,
        storage: { read: async () => Readable.from([]) },
        websites: async () => websites,
        networkFeatures: opts.networkFeatures ?? true,
        desktop: false,
        trustProxy: false,
      }),
    );
    await app.ready();
  }

  const get = (url: string, headers: Record<string, string> = {}) => app!.inject({ method: 'GET', url, headers: { host: HOST, ...headers } });

  beforeEach(async () => {
    app = undefined;
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    await settingsRepo(meta).set('system.publicOrigin', `https://${HOST}`, { updatedBy: null });
    spa = mkdtempSync(join(tmpdir(), 'forms-door-'));
    websites = [];
  });

  afterEach(async () => {
    await app?.close();
    await meta.db.destroy();
    rmSync(spa, { recursive: true, force: true });
  });

  it('allows scripts, styles and fonts from the door’s own files only, no form, base or outside call, and no frame', () => {
    expect(xContentPolicy('https://forms.meridian.example')).toBe(
      [
        "default-src 'none'",
        'script-src https://forms.meridian.example/x/assets/',
        'style-src https://forms.meridian.example/x/assets/',
        'font-src https://forms.meridian.example/x/assets/',
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    );
    expect(xContentPolicy('https://forms.meridian.example', ['https://shop.example', 'https://www.meridian.example'])).toBe(
      [
        "default-src 'none'",
        'script-src https://forms.meridian.example/x/assets/',
        'style-src https://forms.meridian.example/x/assets/',
        'font-src https://forms.meridian.example/x/assets/',
        "img-src 'self' data:",
        "connect-src 'self'",
        'frame-ancestors https://shop.example https://www.meridian.example',
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    );
  });

  it('answers every page with its own policy, no cache, no referrer, and never the dashboard’s frame rule', async () => {
    await start();
    for (const url of ['/x/forms/showroom-visit', '/x/forms/showroom-visit?frame=1', '/x/forms/api/showroom-visit', '/x/forms/api/showroom-visit/challenge', '/x/nothing']) {
      const answer = await get(url);
      expect(answer.headers['content-security-policy'], url).toBe(xContentPolicy(`http://${HOST}`));
      expect(answer.headers['cache-control'], url).toBe('no-store');
      expect(answer.headers['referrer-policy'], url).toBe('no-referrer');
      expect(answer.headers['x-content-type-options'], url).toBe('nosniff');
      expect(answer.headers['x-frame-options'], url).toBeUndefined();
    }
  });

  it('lets the listed websites frame a form drawn for a frame, and nothing else', async () => {
    websites = ['https://shop.example'];
    await start();
    const framed = await get('/x/forms/showroom-visit?frame=1');
    expect(framed.headers['content-security-policy']).toBe(xContentPolicy(`http://${HOST}`, ['https://shop.example']));
    // The same form outside a frame, its API, another page with ?frame=1, and a frame value that is not 1: framed by nobody.
    for (const url of ['/x/forms/showroom-visit', '/x/forms/showroom-visit?frame=true', '/x/forms/api/showroom-visit?frame=1', '/x/nothing?frame=1']) {
      expect((await get(url)).headers['content-security-policy'], url).toBe(xContentPolicy(`http://${HOST}`));
    }
    // A frame asks which websites it may answer; outside a frame it is not told.
    expect((await get('/x/forms/api/showroom-visit?frame=1')).json()).toMatchObject({ frameOrigins: ['https://shop.example'] });
    expect((await get('/x/forms/api/showroom-visit')).json()).not.toHaveProperty('frameOrigins');
  });

  it('serves its own hashed files for good, and nothing outside them', async () => {
    await start();
    const file = await get('/x/assets/x-abc123.js');
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await get('/x/assets/x-abc123.css')).headers['content-type']).toBe('text/css; charset=utf-8');
    for (const url of ['/x/assets/missing.js', '/x/assets/..%2Findex.html', '/x/assets/%2E%2E/%2E%2E/index.html', '/x/assets/x-abc123.html', '/x/assets/a%00.js']) {
      const answer = await get(url);
      expect(answer.statusCode, url).toBe(404);
      expect(answer.body, url).not.toContain('the dashboard');
    }
  });

  it('serves the website loader for a few minutes, to any site', async () => {
    await start();
    const loader = await get('/x/embed.js');
    expect(loader.statusCode).toBe(200);
    expect(loader.body).toBe('window.adminium={};');
    expect(loader.headers['cache-control']).toBe(`public, max-age=${String(EMBED_MAX_AGE_SECONDS)}`);
    expect(loader.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('says the page is not available, and never names the software, when the bundle was never built', async () => {
    await start({ built: false });
    const answer = await get('/x/forms/showroom-visit');
    expect(answer.statusCode).toBe(503);
    expect(answer.body).toContain('This page isn’t available right now.');
    expect(answer.body.toLowerCase()).not.toContain('adminium');
    expect((await get('/x/embed.js')).statusCode).toBe(404);
    expect((await get('/x/assets/x-abc123.js')).statusCode).toBe(404);
  });

  it('hands out a human check bound to the form, harder when the form asks; an unknown form gets one that looks the same', async () => {
    await start();
    const key = proofKey(TEST_SECRET);
    const real = (await get('/x/forms/api/showroom-visit/challenge')).json() as { id: string; salt: string; difficulty: number; expiresAt: number };
    const unknown = (await get('/x/forms/api/no-such-form/challenge')).json() as typeof real;
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(real).sort());
    expect(unknown.difficulty).toBe(real.difficulty);
    expect(real.difficulty).toBe(16);
    // Solved, it holds for this form and for no other, and for nothing but sending a form.
    const proof = `${real.id}.${solveProof(real.salt, real.difficulty)}`;
    const at = Date.now();
    expect(checkProof(key, proof, { keyId: formProofKeyId({ addOn: 'forms', id: 'frm_1' }), purpose: 'form', now: at }).ok).toBe(true);
    expect(checkProof(key, proof, { keyId: formProofKeyId({ addOn: 'forms', id: 'frm_2' }), purpose: 'form', now: at }).ok).toBe(false);
    expect(checkProof(key, proof, { keyId: formProofKeyId({ addOn: 'forms', id: 'frm_1' }), purpose: 'pay', now: at }).ok).toBe(false);
    // A form that asks for the harder check refuses an easier one.
    expect(checkProof(key, proof, { keyId: formProofKeyId({ addOn: 'forms', id: 'frm_1' }), purpose: 'form', now: at, difficulty: HARDER_DIFFICULTY }).ok).toBe(false);
    const harder = (await get('/x/forms/api/fit-out/challenge')).json() as typeof real;
    expect(harder.difficulty).toBe(HARDER_DIFFICULTY);
  });

  it('keeps the answer and file doors shut, writing nothing', async () => {
    await start();
    for (const part of ['answers', 'files']) {
      const answer = await app!.inject({ method: 'POST', url: `/x/forms/api/showroom-visit/${part}`, headers: { host: HOST }, payload: { qname: 'Marta' } });
      expect(answer.statusCode, part).toBe(404);
      expect(answer.json(), part).toMatchObject({ state: 'unavailable' });
    }
  });

  it('while network features are off, every page and call is "not available", the human check included', async () => {
    await start({ networkFeatures: false });
    expect((await get('/x/forms/showroom-visit')).statusCode).toBe(404);
    expect((await get('/x/forms/api/showroom-visit')).statusCode).toBe(404);
    expect((await get('/x/forms/api/old-offer')).statusCode).toBe(404);
    expect((await get('/x/forms/api/showroom-visit/challenge')).statusCode).toBe(404);
  });

  it('words the page for a browser with no script in the language asked', async () => {
    await start();
    const german = await get('/x/forms/showroom-visit?lang=de-DE');
    expect(german.body).toContain('Dieses Formular braucht JavaScript.');
    const closed = await get('/x/forms/old-offer', { 'accept-language': 'fr-FR' });
    expect(closed.body).toContain('Ce formulaire est fermé.');
    const gone = await get('/x/forms/nope', { 'accept-language': 'ar-EG' });
    expect(gone.statusCode).toBe(404);
    expect(gone.body).toContain('هذه الصفحة غير متاحة.');
  });

  it('keeps /x/ the door’s on every host: no app surface answers for its pages, its loader or its files', () => {
    for (const side of ['staff', 'customer'] as const) {
      for (const path of ['/x', '/x/embed.js', '/x/assets/x-abc.js', '/x/forms/showroom-visit', '/x/forms/api/showroom-visit']) expect(isHostReservedPath(path, side), `${side} ${path}`).toBe(true);
      expect(isHostReservedPath('/xmas', side)).toBe(false);
    }
    for (const path of ['/x', '/x/embed.js', '/x/assets/x-abc.js', '/x/forms/showroom-visit']) expect(customerHostAllows(path, 'clients'), path).toBe(true);
  });
});
