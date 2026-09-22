// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server keys: `adm_srv_`, valid with no Origin, refused from any browser,
 * shown once, rotated as its own kind, and the only kind a service-role
 * endpoint may be granted to.
 */

import { auditRepo, publicKeysRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

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

async function createKey(s: ServedSource, body: Record<string, unknown>) {
  return s.app.inject({
    method: 'POST',
    url: '/api/v1/public-keys',
    headers: { cookie: s.cookie },
    payload: { name: 'Worker', connectionId: s.connectionId, access: [{ ref: 'notes', methods: ['GET'] }], ...body },
  });
}

const read = (s: ServedSource, token: string, headers: Record<string, string> = {}) =>
  s.app.inject({ method: 'GET', url: '/api/v1/public/records/notes', headers: { authorization: `Bearer ${token}`, ...headers } });

describe('server keys [sqlite]', () => {
  it('work with no Origin, and are refused with any browser provenance', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    const res = await createKey(s, { kind: 'server' });
    expect(res.statusCode, res.body).toBe(201);
    const { key, token } = res.json() as { key: { id: string; kind: string; prefix: string }; token: string };
    expect(token.startsWith('adm_srv_')).toBe(true);
    expect(key).toMatchObject({ kind: 'server' });
    // Stored hash-only.
    expect((await publicKeysRepo(s.meta).findById(key.id))?.tokenEncrypted).toBe('');

    expect((await read(s, token)).statusCode).toBe(200);
    for (const headers of [{ origin: PUBLIC_ORIGIN }, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-mode': 'cors' }]) {
      const refused = await read(s, token, headers);
      expect(refused.statusCode).toBe(403);
      expect((refused.json() as { error: { code: string; message: string } }).error).toMatchObject({
        code: 'PUBLIC_ORIGIN_REFUSED',
        message: 'A server key cannot be used from a browser.',
      });
    }

    // A browser key is still refused with no Origin.
    const browser = (await createKey(s, {})).json() as { token: string };
    expect(browser.token.startsWith('adm_pub_')).toBe(true);
    expect((await read(s, browser.token)).statusCode).toBe(403);
    expect((await read(s, browser.token, { origin: PUBLIC_ORIGIN })).statusCode).toBe(200);
  }, 90_000);

  it('reveal answers 409 without an audit row; rotate keeps the kind', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    const { key, token } = (await createKey(s, { kind: 'server' })).json() as { key: { id: string }; token: string };

    const reveal = await s.app.inject({ method: 'GET', url: `/api/v1/public-keys/${key.id}/reveal`, headers: { cookie: s.cookie } });
    expect(reveal.statusCode).toBe(409);
    const audits = await auditRepo(s.meta).list({ limit: 50 });
    expect(audits.some((r) => r.action === 'public-key.reveal')).toBe(false);

    const rotate = await s.app.inject({ method: 'POST', url: `/api/v1/public-keys/${key.id}/rotate`, headers: { cookie: s.cookie } });
    expect(rotate.statusCode).toBe(200);
    const next = (rotate.json() as { token: string }).token;
    expect(next.startsWith('adm_srv_')).toBe(true);
    expect((await publicKeysRepo(s.meta).findById(key.id))?.tokenEncrypted).toBe('');
    expect((await read(s, token)).statusCode).toBe(401);
    expect((await read(s, next)).statusCode).toBe(200);
  }, 90_000);

  it('a service-role endpoint is grantable to a server key only; a server key takes no app or origins', async () => {
    served = await sqlite.serve(SPEC);
    const s = served;
    const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
    const def = JSON.parse(
      (list.json() as { endpoints: { ref: string; definition: string }[] }).endpoints.find((e) => e.ref === 'notes')?.definition ?? '{}',
    ) as Record<string, unknown>;
    const save = await s.app.inject({
      method: 'PUT',
      url: `/api/v1/public-endpoints/${s.connectionId}/notes`,
      headers: { cookie: s.cookie },
      payload: { definition: JSON.stringify({ ...def, auth: { role: 'service_role' } }) },
    });
    expect(save.statusCode, save.body).toBe(200);

    const browser = await createKey(s, {});
    expect(browser.statusCode).toBe(422);
    expect(JSON.stringify(browser.json())).toContain('KEY_SERVICE_ROLE_BROWSER');
    const server = await createKey(s, { kind: 'server' });
    expect(server.statusCode, server.body).toBe(201);
    expect((await read(s, (server.json() as { token: string }).token)).statusCode).toBe(200);

    const bound = await createKey(s, { kind: 'server', appKey: 'shop' });
    expect(bound.statusCode).toBe(422);
    expect(JSON.stringify(bound.json())).toContain('KEY_SERVER_APP_BOUND');
    const narrowed = await createKey(s, { kind: 'server', origins: [PUBLIC_ORIGIN] });
    expect(JSON.stringify(narrowed.json())).toContain('KEY_SERVER_ORIGINS');
  }, 90_000);
});
