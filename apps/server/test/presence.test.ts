// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /presence`: what the dashboard sends once a minute while a person is
 * using it, where `ADMINIUM_PRESENCE` is on. For signed-in staff only, and a
 * 204 with nothing else. `/system/info` says whether the dashboard sends it.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';
import { makeEnv } from './helpers.js';

let fixture: AuthTestApp | undefined;

afterEach(async () => {
  await fixture?.destroy();
  fixture = undefined;
});

describe('GET /api/v1/presence', () => {
  it('refuses anybody not signed in', async () => {
    fixture = await buildAuthApp();
    const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/presence' });
    expect(res.statusCode).toBe(401);
  });

  it('answers a signed-in person with an empty 204', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);
    const res = await fixture.app.inject({ method: 'GET', url: '/api/v1/presence', headers: { cookie: cookie ?? '' } });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('is for staff, kept while public pages are hidden', async () => {
    fixture = await buildAuthApp();
    const row = fixture.app.routeAudience.rows().find((one) => one.method === 'GET' && one.url === '/api/v1/presence');
    expect(row?.audience).toBe('staff');
  });
});

describe('/system/info presence', () => {
  it('is off unless the operator switches it on', async () => {
    fixture = await buildAuthApp();
    const off = await fixture.app.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(off.json<{ presence: boolean }>().presence).toBe(false);
    await fixture.destroy();

    fixture = await buildAuthApp({ env: makeEnv({ ADMINIUM_PRESENCE: 'on' }) });
    const on = await fixture.app.inject({ method: 'GET', url: '/api/v1/system/info' });
    expect(on.json<{ presence: boolean }>().presence).toBe(true);
  });
});
