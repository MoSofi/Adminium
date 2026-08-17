// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Session lifetime rules (08-server-api.md §2.1): 7-day idle timeout from
 * `last_seen_at`, 30-day absolute cap from creation — both answering 401
 * SESSION_EXPIRED (distinct from the UNAUTHENTICATED no-session case). Uses
 * fake `Date` only (real timers keep fastify.inject and argon2 happy).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS } from '../src/auth/sessions.js';
import { buildAuthApp, login, type AuthTestApp } from './auth-helpers.js';

const DAY_MS = 86_400_000;

let fixture: AuthTestApp | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-12T08:00:00Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  await fixture?.destroy();
  fixture = undefined;
});

function advance(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

async function getSession(app: AuthTestApp['app'], cookie: string) {
  return app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
}

describe('session idle + absolute expiry', () => {
  it('expires after 7 idle days with SESSION_EXPIRED', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);

    advance(SESSION_IDLE_TTL_MS - 60_000); // just inside the idle window
    const alive = await getSession(fixture.app, cookie ?? '');
    expect(alive.statusCode).toBe(200);

    advance(SESSION_IDLE_TTL_MS + 60_000); // 7d+ since the touch above
    const expired = await getSession(fixture.app, cookie ?? '');
    expect(expired.statusCode).toBe(401);
    expect((expired.json() as { error: { code: string } }).error.code).toBe('SESSION_EXPIRED');
  });

  it('activity slides the idle window: regular use outlives 7 days', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);

    // 3 visits, 6 days apart — 18 days total, never 7 days idle.
    for (let i = 0; i < 3; i += 1) {
      advance(6 * DAY_MS);
      const res = await getSession(fixture.app, cookie ?? '');
      expect(res.statusCode).toBe(200);
    }
  });

  it('the 30-day absolute cap wins even when the session is kept active', async () => {
    fixture = await buildAuthApp();
    const { cookie } = await login(fixture.app);

    // Touch every 5 days — the idle window never lapses...
    for (let day = 5; day <= 30; day += 5) {
      advance(5 * DAY_MS);
      const res = await getSession(fixture.app, cookie ?? '');
      if (day < 30) {
        expect(res.statusCode, `expected day ${day} to still be active`).toBe(200);
      } else {
        // ...but at the 30-day absolute deadline the session is gone.
        expect(res.statusCode).toBe(401);
        expect((res.json() as { error: { code: string } }).error.code).toBe('SESSION_EXPIRED');
      }
    }
  });

  it('SESSION_ABSOLUTE_TTL_MS lands as expires_at on the stored row', async () => {
    fixture = await buildAuthApp();
    const start = Date.now();
    await login(fixture.app);
    const row = await fixture.meta.db.selectFrom('adminium_sessions').selectAll().executeTakeFirst();
    expect(row?.expiresAt).toBe(start + SESSION_ABSOLUTE_TTL_MS);
  });
});
