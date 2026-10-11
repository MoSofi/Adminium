// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The phone side's preview on this machine: `/apps/<key>/mobile/`.
 *
 * It is Expo's export for the web, served from a build folder of its own to
 * the person at this computer and to nobody else: `adminium dev` listens on
 * every address, and the preview is not for the network. What is proved is
 * who gets it, which files of the build folder it gives, and the two small
 * documents an open preview asks for.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotFoundError } from '../src/errors.js';
import { registerPhonePreview } from '../src/plugins/phone-preview.js';
import { buildPhone } from '../src/project/apps/phone-build.js';
import { phoneBuildDir } from '../src/project/apps/phone.js';
import { scaffoldApp } from '../src/project/apps/scaffold-app.js';
import { APP_VERSION } from '../src/version.js';
import { buildFixturePhone, phoneProject, standIn, type StandIn } from './phone-fixtures.js';

let root: string;
let app: FastifyInstance;
let fake: StandIn;
let appStamp: string | null;
let surface: () => Promise<Record<string, unknown> | null>;
const SURFACE = { baseUrl: '', publishableKey: 'adm_pub_x', tables: {} };

beforeEach(async () => {
  root = phoneProject('adminium-phone-preview-');
  fake = standIn();
  appStamp = 'a1';
  surface = async () => SURFACE;
  app = Fastify();
  // As a server with no dashboard has it: `reply.sendFile`, and no route of its own.
  await app.register(fastifyStatic, { serve: false });
  app.decorate('customerSurfaceConfig', async () => surface());
  registerPhonePreview(app, { root, appBuild: (key) => (key === 'shop' ? appStamp : null) });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

/** Ask as the person at this computer does, unless told otherwise. */
const get = (url: string, from: { host?: string; remoteAddress?: string } = {}) =>
  app.inject({ method: 'GET', url, headers: { host: from.host ?? 'localhost:4600' }, remoteAddress: from.remoteAddress ?? '127.0.0.1' });
const preview = (...rest: string[]): string => join(phoneBuildDir(root, 'shop'), ...rest);

describe('who the phone preview answers', () => {
  beforeEach(async () => {
    await buildFixturePhone(root, 'shop', fake);
  });

  it.each([
    ['localhost:4600', '127.0.0.1'],
    ['localhost', '127.0.0.1'],
    ['LOCALHOST:4600', '127.0.0.1'],
    ['127.0.0.1:4600', '127.0.0.1'],
    ['127.0.0.1', '::1'],
    ['[::1]:4600', '::1'],
    ['localhost:4600', '::ffff:127.0.0.1'],
  ])('answers %s asked from %s', async (host, remoteAddress) => {
    const answer = await get('/apps/shop/mobile/', { host, remoteAddress });
    expect(answer.statusCode).toBe(200);
    expect(answer.body).toContain('<title>Phone 1</title>');
  });

  it.each([
    ['this machine’s address on the network', '192.168.7.20:4600', '127.0.0.1'],
    ['a name that points here', 'my-mac.local:4600', '127.0.0.1'],
    ['a name that only starts like this machine’s', 'localhost.evil.example', '127.0.0.1'],
    ['another machine asking by this machine’s name', 'localhost:4600', '192.168.7.31'],
    ['another machine asking by address', '192.168.7.20:4600', '192.168.7.31'],
  ])('is not there for %s', async (_what, host, remoteAddress) => {
    for (const url of ['/apps/shop/mobile/', '/apps/shop/mobile', '/apps/shop/mobile/_expo/static/app.js', '/apps/shop/mobile/dev-build.json', '/apps/shop/mobile/surface-config.json']) {
      const answer = await get(url, { host, remoteAddress });
      expect(answer.statusCode, url).toBe(404);
      expect(answer.body, url).not.toContain('Phone 1');
      expect(answer.body, url).not.toContain('adm_pub_x');
    }
  });
});

describe('what the phone preview gives', () => {
  beforeEach(async () => {
    await buildFixturePhone(root, 'shop', fake);
  });

  it('sends the address without its slash to the one with it', async () => {
    const answer = await get('/apps/shop/mobile');
    expect(answer.statusCode).toBe(302);
    expect(answer.headers.location).toBe('/apps/shop/mobile/');
  });

  it('gives the page at its root, by name, and for a path that names no file: the app’s own screens', async () => {
    for (const url of ['/apps/shop/mobile/', '/apps/shop/mobile/index.html', '/apps/shop/mobile/menu', '/apps/shop/mobile/orders/12']) {
      const answer = await get(url);
      expect(answer.statusCode, url).toBe(200);
      expect(answer.headers['content-type'], url).toContain('text/html');
      expect(answer.body, url).toContain('<title>Phone 1</title>');
      expect(answer.headers['referrer-policy'], url).toBe('no-referrer');
    }
  });

  // A BUG IN src, left failing on purpose: src/plugins/phone-preview.ts:74 sets `cache-control: no-store` and then
  // answers with `reply.sendFile` (lines 75 and 78), and @fastify/static writes its own `public, max-age=0` over it.
  // So the page and the build's files may be kept by a browser, where the file's own comment says "Never kept".
  // `sendFile(file, root, { cacheControl: false })` would leave the header as set. Take `.fails` off with the fix.
  it('the page and the files of a build are never kept by the browser', async () => {
    for (const url of ['/apps/shop/mobile/', '/apps/shop/mobile/menu', '/apps/shop/mobile/_expo/static/app.js']) {
      expect((await get(url)).headers['cache-control'], url).toBe('no-store');
    }
  });

  it('gives a file of the build by its name', async () => {
    const answer = await get('/apps/shop/mobile/_expo/static/app.js');
    expect(answer.statusCode).toBe(200);
    expect(answer.body).toBe('console.log("phone")');
    expect(answer.headers['content-type']).toContain('javascript');
  });

  it('a file asked for by name that is not there is not the page', async () => {
    for (const url of ['/apps/shop/mobile/_expo/static/gone.js', '/apps/shop/mobile/logo.png', '/apps/shop/mobile/x.html']) {
      const answer = await get(url);
      expect(answer.statusCode, url).toBe(404);
      expect(answer.body, url).not.toContain('Phone 1');
    }
  });

  it('never gives the build’s own stamp, a dot file, or anything reached by climbing out', async () => {
    writeFileSync(preview('.secret'), 'hidden');
    mkdirSync(preview('.well-known'), { recursive: true });
    writeFileSync(preview('.well-known', 'x.txt'), 'hidden');
    writeFileSync(join(root, 'secret.txt'), 'outside');
    const stamp = readFileSync(preview('adminium-phone.json'), 'utf8');
    for (const url of [
      '/apps/shop/mobile/adminium-phone.json',
      '/apps/shop/mobile/_expo/..%2fadminium-phone.json',
      '/apps/shop/mobile/_expo%2f..%2fadminium-phone.json',
      '/apps/shop/mobile/.secret',
      '/apps/shop/mobile/.well-known/x.txt',
      '/apps/shop/mobile/_expo/..%2f.secret',
      '/apps/shop/mobile/..%2f..%2f..%2f..%2fsecret.txt',
      '/apps/shop/mobile/..%2f..%2f..%2f..%2fpackage.json',
      '/apps/shop/mobile/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret.txt',
      '/apps/shop/mobile/..%2f..%2f..%2f..%2fapps%2fshop%2fmobile%2fpackage.json',
      '/apps/shop/mobile/..%5c..%5csecret.txt',
      '/apps/shop/mobile/%00.js',
      '/apps/shop/mobile/%zz.js',
    ]) {
      const answer = await get(url);
      expect([400, 404], url).toContain(answer.statusCode);
      for (const kept of [stamp.trim(), 'hidden', 'outside', '"my-admin"', 'shop-mobile']) expect(answer.body, url).not.toContain(kept);
    }
  });

  it('a key that is no app’s name is not there', async () => {
    for (const url of ['/apps/Shop/mobile/', '/apps/..%2fshop/mobile/', '/apps/s/mobile/', '/apps/nobody/mobile/']) {
      expect((await get(url)).statusCode, url).toBe(404);
    }
  });
});

describe('before there is a phone preview', () => {
  it('an app with no phone side has none, under any of its addresses', async () => {
    scaffoldApp({ root, key: 'plain', name: 'Plain', sides: [], version: APP_VERSION });
    for (const url of ['/apps/plain/mobile/', '/apps/plain/mobile/index.html', '/apps/plain/mobile/dev-build.json', '/apps/plain/mobile/surface-config.json']) {
      expect((await get(url)).statusCode, url).toBe(404);
    }
  });

  it('a phone side that has code and no App.tsx has none, though a build is on disk', async () => {
    await buildFixturePhone(root, 'shop', fake);
    rmSync(join(root, 'apps/shop/mobile/App.tsx'));
    expect((await get('/apps/shop/mobile/')).statusCode).toBe(404);
    expect((await get('/apps/shop/mobile/_expo/static/app.js')).statusCode).toBe(404);
  });

  it('a phone side that is not built yet has no page and no file', async () => {
    for (const url of ['/apps/shop/mobile/', '/apps/shop/mobile/index.html', '/apps/shop/mobile/menu', '/apps/shop/mobile/_expo/static/app.js']) {
      const answer = await get(url);
      expect(answer.statusCode, url).toBe(404);
      expect(answer.json(), url).toEqual({ error: { code: 'NOT_FOUND', message: 'There is no phone preview here.' } });
      expect(answer.headers['cache-control'], url).toBe('no-store');
    }
  });
});

describe('what an open preview asks for', () => {
  it('dev-build.json names the phone build and the app’s own stamp, and moves when either does', async () => {
    const before = await get('/apps/shop/mobile/dev-build.json');
    expect(before.statusCode).toBe(200);
    expect(before.headers['cache-control']).toBe('no-store');
    expect(before.json()).toEqual({ build: '-:a1' });

    const first = await buildFixturePhone(root, 'shop', fake);
    const one = (await get('/apps/shop/mobile/dev-build.json')).json<{ build: string }>();
    expect(one).toEqual({ build: `${(first as { build: string }).build}:a1` });

    // The phone side was built again.
    writeFileSync(join(root, 'apps/shop/mobile/App.tsx'), 'export function App() { return null; }\n');
    const second = await buildPhone(root, 'shop', { run: fake.run });
    const two = (await get('/apps/shop/mobile/dev-build.json')).json<{ build: string }>();
    expect(two).toEqual({ build: `${(second as { build: string }).build}:a1` });
    expect(two.build).not.toBe(one.build);

    // The app was applied again.
    appStamp = 'a2';
    expect((await get('/apps/shop/mobile/dev-build.json')).json()).toEqual({ build: `${(second as { build: string }).build}:a2` });
    appStamp = null;
    expect((await get('/apps/shop/mobile/dev-build.json')).json()).toEqual({ build: `${(second as { build: string }).build}:-` });
  });

  it('surface-config.json is the customer’s own document, built or not', async () => {
    const answer = await get('/apps/shop/mobile/surface-config.json');
    expect(answer.statusCode).toBe(200);
    expect(answer.headers['cache-control']).toBe('no-store');
    expect(answer.json()).toEqual(SURFACE);
  });

  it('surface-config.json is not there for an app that has no customer document', async () => {
    surface = async () => {
      throw new NotFoundError();
    };
    expect((await get('/apps/shop/mobile/surface-config.json')).statusCode).toBe(404);
    surface = async () => null;
    const none = await get('/apps/shop/mobile/surface-config.json');
    expect(none.statusCode).toBe(404);
    expect(none.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'There is no phone preview here.' } });
  });

  it('any other failure of the customer document is a failure, not a missing page', async () => {
    surface = async () => {
      throw new Error('the database is away');
    };
    expect((await get('/apps/shop/mobile/surface-config.json')).statusCode).toBe(500);
  });
});
