// SPDX-License-Identifier: AGPL-3.0-only
/**
 * App keys: `adm_app_`, a phone app's. Valid with no Origin, refused from any
 * browser, with a visitor's reach and limits (never a server key's), shown
 * again like a browser key, rotated as its own kind. A stored kind this
 * server does not know answers nothing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publicKeysRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import {
  generatePublishableKey,
  hasVisitorReach,
  isPhoneAppKey,
  keyKindOf,
  managedKeyKind,
  refusesBrowserHeaders,
  servedToPages,
  storedKeyKind,
} from '../src/public-api/keys.js';
import { endpointRateKeyFor } from '../src/public-api/limiter.js';
import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

const SPEC: SourceSpec = {
  ddl: {
    sqlite: ['CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body VARCHAR(100) NOT NULL)'],
    postgres: ['CREATE TABLE notes (id serial PRIMARY KEY, body varchar(100) NOT NULL)'],
    mysql: ['CREATE TABLE notes (id INT AUTO_INCREMENT PRIMARY KEY, body VARCHAR(100) NOT NULL)'],
  },
  seed: ["INSERT INTO notes (body) VALUES ('one')"],
};
const sqlite = SOURCE_LEGS.find((l) => l.dialect === 'sqlite') as (typeof SOURCE_LEGS)[number];

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

const read = (s: ServedSource, token: string, headers: Record<string, string> = {}) =>
  s.app.inject({ method: 'GET', url: '/api/v1/public/records/notes', headers: { authorization: `Bearer ${token}`, ...headers } });

/**
 * A browser key made through the API, turned into an app key in the store:
 * the API never makes one (an app's install does), and the gate is what is
 * under test here.
 */
async function appKey(s: ServedSource): Promise<{ id: string; token: string; browserToken: string }> {
  const res = await s.app.inject({
    method: 'POST',
    url: '/api/v1/public-keys',
    headers: { cookie: s.cookie },
    payload: { name: 'Phone', connectionId: s.connectionId, access: [{ ref: 'notes', methods: ['GET'] }] },
  });
  expect(res.statusCode, res.body).toBe(201);
  const { key, token: browserToken } = res.json() as { key: { id: string }; token: string };
  const next = generatePublishableKey('app');
  const row = await publicKeysRepo(s.meta).findById(key.id);
  await publicKeysRepo(s.meta).rotate(key.id, { prefix: next.prefix, tokenHash: next.tokenHash, tokenEncrypted: row?.tokenEncrypted ?? 'x' });
  await s.meta.db.updateTable('adminium_public_keys').set({ kind: 'app' }).where('id', '=', key.id).execute();
  return { id: key.id, token: next.token, browserToken };
}

describe('the three kinds, as the two questions read them', () => {
  it('an app key has a visitor’s reach and is refused from a browser; a page is never served one', () => {
    expect(keyKindOf(generatePublishableKey('app').token)).toBe('app');
    expect(generatePublishableKey('app').token.startsWith('adm_app_')).toBe(true);
    expect([hasVisitorReach('browser'), hasVisitorReach('app'), hasVisitorReach('server')]).toEqual([true, true, false]);
    expect([refusesBrowserHeaders('browser'), refusesBrowserHeaders('app'), refusesBrowserHeaders('server')]).toEqual([false, true, true]);
    expect([servedToPages('browser'), servedToPages('app'), servedToPages('server')]).toEqual([true, false, false]);
    expect([isPhoneAppKey('browser'), isPhoneAppKey('app'), isPhoneAppKey('server')]).toEqual([false, true, false]);
  });

  it('a stored word this server does not know is no kind to a request, and a browser key to the code that manages keys', () => {
    expect(storedKeyKind('app')).toBe('app');
    expect(storedKeyKind('desktop')).toBeNull();
    expect(storedKeyKind(null)).toBeNull();
    expect(managedKeyKind('desktop')).toBe('browser');
    expect(managedKeyKind('app')).toBe('app');
  });

  it('an app key is counted per visitor, as a browser key is', () => {
    const id = { keyId: 'pbk_1', ref: 'orders', ip: '198.51.100.7' };
    expect(endpointRateKeyFor({ ...id, kind: 'app' })).toBe(endpointRateKeyFor({ ...id, kind: 'browser' }));
    expect(endpointRateKeyFor({ ...id, kind: 'app' })).not.toBe(endpointRateKeyFor({ ...id, kind: 'server' }));
  });

  it('no file but keys.ts compares a key’s kind with a word', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !path.endsWith(join('public-api', 'keys.ts'))) {
          readFileSync(path, 'utf8')
            .split('\n')
            .forEach((line, index) => {
              if (/[kK]ind\s*[!=]==?\s*'(browser|server)'|'(browser|server)'\s*[!=]==?\s*[\w.]*[kK]ind/.test(line)) found.push(`${path.slice(src.length + 1)}:${String(index + 1)}`);
            });
        }
      }
    };
    walk(src);
    // A new comparison belongs in keys.ts, as one of its questions: a third kind met a dozen of these, each false for it.
    expect(found).toEqual([]);
  });
});

describe('app keys [sqlite]', () => {
  it('work with no Origin, and are refused with any browser provenance', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    const { token, browserToken } = await appKey(s);

    expect((await read(s, token)).statusCode).toBe(200);
    for (const headers of [{ origin: PUBLIC_ORIGIN }, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-mode': 'cors' }, { 'sec-fetch-dest': 'empty' }]) {
      const refused = await read(s, token, headers);
      expect(refused.statusCode, JSON.stringify(headers)).toBe(403);
      expect((refused.json() as { error: { code: string; message: string } }).error).toMatchObject({
        code: 'PUBLIC_ORIGIN_REFUSED',
        message: 'An app key cannot be used from a browser.',
      });
    }
    // The token it replaced is nobody's now, from a browser or not.
    expect((await read(s, browserToken, { origin: PUBLIC_ORIGIN })).statusCode).toBe(401);
  }, 90_000);

  it('the stored kind must be the one the token says, and a kind nobody knows answers nothing', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    // Each key's row is changed before its first use: a resolved key is kept for a while.
    for (const kind of ['browser', 'server', 'desktop']) {
      const { id, token } = await appKey(s);
      await s.meta.db.updateTable('adminium_public_keys').set({ kind }).where('id', '=', id).execute();
      // The token says "app", so the gate asks no Origin of it; the row disagrees, and it is nobody's key.
      expect((await read(s, token)).statusCode, kind).toBe(401);
      expect((await read(s, token, { origin: PUBLIC_ORIGIN })).statusCode, kind).toBe(403);
    }
  }, 90_000);

  it('is listed as an app key, shown again, and rotated to another app key', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    const { id, token } = await appKey(s);

    const list = await s.app.inject({ method: 'GET', url: '/api/v1/public-keys', headers: { cookie: s.cookie } });
    expect(list.statusCode, list.body).toBe(200);
    expect(JSON.stringify(list.json())).toContain('"kind":"app"');

    const rotate = await s.app.inject({ method: 'POST', url: `/api/v1/public-keys/${id}/rotate`, headers: { cookie: s.cookie } });
    expect(rotate.statusCode, rotate.body).toBe(200);
    const next = (rotate.json() as { token: string }).token;
    expect(next.startsWith('adm_app_')).toBe(true);
    expect((await read(s, token)).statusCode).toBe(401);
    expect((await read(s, next)).statusCode).toBe(200);
    expect((await read(s, next, { origin: PUBLIC_ORIGIN })).statusCode).toBe(403);

    const reveal = await s.app.inject({ method: 'GET', url: `/api/v1/public-keys/${id}/reveal`, headers: { cookie: s.cookie } });
    expect(reveal.statusCode, reveal.body).toBe(200);
    expect((reveal.json() as { token: string }).token).toBe(next);
  }, 90_000);

  it('the API makes no app key: an app’s install does', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/public-keys',
      headers: { cookie: s.cookie },
      payload: { name: 'Phone', kind: 'app', connectionId: s.connectionId, access: [{ ref: 'notes', methods: ['GET'] }] },
    });
    // Refused at the door: `kind` is `browser` or `server` there.
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain('adm_app_');
  }, 90_000);
});
