// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's customer screen in a frame on the owner's website
 * (`plugins/surface-frame.ts`): which addresses a listed website may load, on
 * every way the page is reached, and what every `frame=1` answer carries.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { connectionsRepo, publicKeysRepo, publicScopesRepo, settingsRepo } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { forgetListedWebsites } from '../src/forms/websites.js';
import { asksForFrame, pathAfterMount } from '../src/plugins/surface-frame.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { buildAuthApp, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

const SITE = 'https://lumenstudio.example';
const OTHER = 'https://www.lumenstudio.example';
const MAPPED = 'book.lumenstudio.example';
const EMBED = { paths: ['/', { path: '/book', label: 'Book a service' }, '/reviews'], modes: ['inline', 'button', 'floating'] };

let dist: string;
let surfacesDir: string;
let surfaces: HostedSurface[];
let t: AuthTestApp | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-frame-dash-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><html><body>dashboard</body></html>', 'utf8');
  surfacesDir = await mkdtemp(join(tmpdir(), 'adminium-frame-surfaces-'));
  for (const side of ['staff', 'customer']) {
    await mkdir(join(surfacesDir, 'bookings', side), { recursive: true });
    await writeFile(join(surfacesDir, 'bookings', side, 'index.html'), `<!doctype html><html><body data-side="${side}"></body></html>`, 'utf8');
  }
  surfaces = discoverSurfaces(surfacesDir);
});

afterAll(async () => {
  for (const dir of [dist, surfacesDir]) await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

async function install(fixture: AuthTestApp, embed: unknown, id = 'mft_bookings', slug = '', connectionId: string | null = null): Promise<void> {
  await fixture.meta.db
    .insertInto('adminium_manifests')
    .values({
      id,
      manifestKey: 'bookings',
      version: '1.0.0',
      source: 'file',
      manifest: JSON.stringify({ key: 'bookings', frontends: [{ side: 'staff', kind: 'spa' }, { side: 'customer', kind: 'spa', ...(embed === null ? {} : { embed }) }] }),
      licenseKeyEncrypted: null,
      connectionId,
      status: 'installed',
      kind: 'app',
      scopeKey: connectionId ?? 'none',
      instanceSlug: slug,
      packageIntegrity: null,
      packageFileId: null,
      installedBy: null,
      installedAt: 0,
      updatedAt: 0,
    } as never)
    .execute();
}

async function list(fixture: AuthTestApp, origins: string[]): Promise<void> {
  await settingsRepo(fixture.meta).set('publicPages.websites', origins.map((origin) => ({ origin, addedBy: null, addedAt: 1 })), { updatedBy: null });
  forgetListedWebsites(fixture.meta);
}

async function build(embed: unknown = EMBED, origins: string[] = [SITE, OTHER]): Promise<AuthTestApp> {
  t = await buildAuthApp({ staticRoot: dist, surfaces });
  await install(t, embed);
  await list(t, origins);
  return t;
}

const get = (fixture: AuthTestApp, url: string, host = 'localhost') => fixture.app.inject({ method: 'GET', url, headers: { host, 'sec-fetch-dest': 'iframe', accept: 'text/html' } });
const ancestors = (res: { headers: Record<string, unknown> }) => /frame-ancestors ([^;]*)/.exec(String(res.headers['content-security-policy']))?.[1];

function expectListed(res: Awaited<ReturnType<typeof get>>): void {
  expect(res.statusCode).toBe(200);
  expect(ancestors(res)).toBe(`'self' ${SITE} ${OTHER}`);
  expect(res.headers['x-frame-options']).toBeUndefined();
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['x-robots-tag']).toBe('noindex');
  expect(res.headers['etag']).toBeUndefined();
  expect(res.headers['last-modified']).toBeUndefined();
}

function expectRefused(res: Awaited<ReturnType<typeof get>>): void {
  expect(ancestors(res)).toBe("'self'");
  expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
}

describe('what counts as asking for a frame', () => {
  it('is one frame=1', () => {
    expect(asksForFrame('/a?frame=1')).toBe(true);
    expect(asksForFrame('/a?x=1&frame=1')).toBe(true);
    for (const url of ['/a', '/a?frame=0', '/a?frame=1&frame=1', '/a?frame', '/a?xframe=1']) expect(asksForFrame(url), url).toBe(false);
  });
});

describe('the path after the mount', () => {
  const surface = { appKey: 'bookings', side: 'customer' as const, prefix: '/apps/bookings/customer' };

  it('reads all three shapes', () => {
    expect(pathAfterMount('/apps/bookings/customer', surface)).toBe('/');
    expect(pathAfterMount('/apps/bookings/customer/', surface)).toBe('/');
    expect(pathAfterMount('/apps/bookings/customer/book', surface)).toBe('/book');
    expect(pathAfterMount('/apps/bookings/second/customer', surface)).toBe('/');
    expect(pathAfterMount('/apps/bookings/second/customer/book', surface)).toBe('/book');
    expect(pathAfterMount('/book', surface)).toBe('/book');
  });

  it('is no path of this side for another app or side', () => {
    expect(pathAfterMount('/apps/other/customer/book', surface)).toBeNull();
    expect(pathAfterMount('/apps/bookings/staff/book', surface)).toBeNull();
    expect(pathAfterMount('/apps/bookings/second/staff/book', surface)).toBeNull();
  });
});

describe('a declared screen', () => {
  it('may be framed by a listed website, with frame=1, and its answer is never kept or indexed', async () => {
    const fixture = await build();
    for (const url of ['/apps/bookings/customer/book?frame=1', '/apps/bookings/customer/?frame=1', '/apps/bookings/customer/reviews?lang=de&frame=1&mode=inline', '/apps/bookings/customer/book?service=gel&frame=1']) {
      expectListed(await get(fixture, url));
    }
  });

  it('on a mapped customer host too', async () => {
    const fixture = await build();
    await settingsRepo(fixture.meta).set('surfaces.domains', { [MAPPED]: { appKey: 'bookings', side: 'customer' } }, { updatedBy: null });
    fixture.app.surfaceSettings?.invalidate();
    expectListed(await get(fixture, '/book?frame=1', MAPPED));
    expectListed(await get(fixture, '/?frame=1', MAPPED));
    expectRefused(await get(fixture, '/visits?frame=1', MAPPED));
  });

  it('is not framed without frame=1, and that answer stays as it was', async () => {
    const fixture = await build();
    const res = await get(fixture, '/apps/bookings/customer/book');
    expectRefused(res);
    expect(res.headers['x-robots-tag']).toBeUndefined();
    expect(res.headers['cache-control']).not.toBe('no-store');
  });

  it('is not framed by a second frame=1, or another value', async () => {
    const fixture = await build();
    expectRefused(await get(fixture, '/apps/bookings/customer/book?frame=1&frame=1'));
    expectRefused(await get(fixture, '/apps/bookings/customer/book?frame=2'));
  });
});

describe('everything else', () => {
  it('a screen not declared: refused, and still neither kept nor indexed', async () => {
    const fixture = await build();
    for (const url of ['/apps/bookings/customer/visits?frame=1', '/apps/bookings/customer/b?frame=1', '/apps/bookings/customer/book/?frame=1', '/apps/bookings/customer/book/x?frame=1', '/apps/bookings/customer/b%6Fok?frame=1']) {
      const res = await get(fixture, url);
      expectRefused(res);
      expect(res.headers['cache-control'], url).toBe('no-store');
      expect(res.headers['x-robots-tag'], url).toBe('noindex');
    }
  });

  it('the staff side, whatever it asks', async () => {
    const fixture = await build();
    const res = await get(fixture, '/apps/bookings/staff/book?frame=1');
    expect(ancestors(res)).toBe("'self'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('an app that declares nothing', async () => {
    expectRefused(await get(await build(null), '/apps/bookings/customer/book?frame=1'));
  });

  it('with no website listed, nobody else may frame it', async () => {
    expectRefused(await get(await build(EMBED, []), '/apps/bookings/customer/book?frame=1'));
  });

  it('a stored manifest that cannot be read frames nothing', async () => {
    const fixture = await build();
    await fixture.meta.db.updateTable('adminium_manifests').set({ manifest: 'not json' } as never).where('id', '=', 'mft_bookings').execute();
    expectRefused(await get(fixture, '/apps/bookings/customer/book?frame=1'));
  });

  it('a listed line can never add a directive, or be read as a replacement pattern', async () => {
    const fixture = await build(EMBED, [SITE, 'https://a;sandbox', "https://$'.example"]);
    const res = await get(fixture, '/apps/bookings/customer/book?frame=1');
    expect(ancestors(res)).toBe(`'self' ${SITE}`);
    expect(String(res.headers['content-security-policy'])).not.toContain('sandbox');
  });

  it('a website taken off the list loses the frame', async () => {
    const fixture = await build();
    expectListed(await get(fixture, '/apps/bookings/customer/book?frame=1'));
    await list(fixture, [SITE]);
    expect(ancestors(await get(fixture, '/apps/bookings/customer/book?frame=1'))).toBe(`'self' ${SITE}`);
  });
});

describe('the config the frame reads', () => {
  async function bound(fixture: AuthTestApp): Promise<void> {
    const env = makeEnv();
    const crypto = dsnCryptoFromSecret(env.ADMINIUM_SECRET);
    const conn = await connectionsRepo(fixture.meta, crypto).create({ name: 'src', engine: 'postgres', introspectDsn: 'postgres://ro:s@db/prod', dataDsn: 'postgres://rw:s@db/prod' });
    const scope = await publicScopesRepo(fixture.meta).create({ connectionId: conn.id, side: 'customer', name: 'portal', timezone: 'Europe/London', document: JSON.stringify({ version: 1 }) }, 1000);
    const generated = generatePublishableKey();
    await publicKeysRepo(fixture.meta).create({ name: 'portal key', prefix: generated.prefix, tokenHash: generated.tokenHash, tokenEncrypted: sealPublishableKey(crypto, generated.token), scopeId: scope.id, side: 'customer', appKey: 'bookings' }, 1000);
  }

  it('hands the list to a read that says frame=1, and to no other', async () => {
    const fixture = await build();
    await bound(fixture);
    const framed = await fixture.app.inject({ method: 'GET', url: '/apps/bookings/customer/surface-config.json?frame=1' });
    expect(framed.json().frameOrigins).toEqual([SITE, OTHER]);
    const plain = await fixture.app.inject({ method: 'GET', url: '/apps/bookings/customer/surface-config.json' });
    expect(plain.json().frameOrigins).toBeUndefined();
  });

  it('hands nothing for an app that declares no screens', async () => {
    const fixture = await build(null);
    await bound(fixture);
    const framed = await fixture.app.inject({ method: 'GET', url: '/apps/bookings/customer/surface-config.json?frame=1' });
    expect(framed.statusCode).toBe(200);
    expect(framed.json().frameOrigins).toBeUndefined();
  });
});
