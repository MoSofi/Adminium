// SPDX-License-Identifier: AGPL-3.0-only
/**
 * First-run super-admin bootstrap (M10-T04) — the whole attack surface of a
 * self-hosted first boot, so this suite is written against the ATTACK, not just
 * the happy path:
 *
 *  - a fresh install reports `required: true` and accepts exactly one super admin;
 *  - a SECOND call is 409 forever — never a second super admin;
 *  - a CONCURRENT double-submit resolves to exactly one 201 + one 409 (the
 *    `system.superAdminCreatedAt` PRIMARY KEY claim, not a check-then-act read);
 *  - deleting every user does NOT re-open the endpoint (the claim is permanent);
 *  - telemetry stays OFF unless consent explicitly says otherwise.
 *
 * Drives the real routes over `app.inject` on an in-memory SQLite meta store.
 */

import BetterSqlite3 from 'better-sqlite3';
import {
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  settingsRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { makeEnv, type InjectPayload } from './helpers.js';

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  // buildServer wires /setup/* + /about itself whenever a meta store is present
  // — this is the same registration a real `adminium start` gets.
  const app = await buildServer({ env: makeEnv(), metaDb: meta, logger: false });
  await app.ready();
  return { app, meta };
}

const GOOD = { email: 'ada@adminium.test', password: 'correct-horse-battery', name: 'Ada' };

describe('first-run super-admin bootstrap (M10-T04)', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  const postSetup = (payload: InjectPayload) =>
    t.app.inject({ method: 'POST', url: '/api/v1/setup/super-admin', payload });

  const getState = () => t.app.inject({ method: 'GET', url: '/api/v1/setup/state' });

  it('a fresh install reports setup required, with the password policy', async () => {
    const res = await getState();
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { required: boolean; passwordMinLength: number } };
    expect(body.data.required).toBe(true);
    expect(body.data.passwordMinLength).toBe(10); // registry default
  });

  it('creates the super admin, signs the wizard in, and closes setup', async () => {
    const res = await postSetup(GOOD);
    expect(res.statusCode, res.body).toBe(201);

    const body = res.json() as { data: { user: { id: string; email: string; name: string } } };
    expect(body.data.user.email).toBe('ada@adminium.test');
    expect(body.data.user.name).toBe('Ada');
    // No password material may ride back out on the created-user view.
    expect(JSON.stringify(body)).not.toContain(GOOD.password);
    expect(body.data.user).not.toHaveProperty('passwordHash');

    // The wizard lands signed in rather than bouncing to /login.
    expect(res.headers['set-cookie']).toBeDefined();
    expect(String(res.headers['set-cookie'])).toContain('adminium_session=');

    // Really a super admin, not just a user.
    const user = await usersRepo(t.meta).findByEmail('ada@adminium.test');
    expect(user).not.toBeNull();
    const roles = await rolesRepo(t.meta).rolesForUser(user?.id ?? '');
    expect(roles.map((r) => r.slug)).toEqual(['super-admin']);

    // And setup is now closed.
    const state = await getState();
    expect((state.json() as { data: { required: boolean } }).data.required).toBe(false);
  });

  it('a SECOND call is 409 and never creates a second super admin', async () => {
    expect((await postSetup(GOOD)).statusCode).toBe(201);

    const second = await postSetup({
      email: 'mallory@evil.test',
      password: 'another-long-password',
      name: 'Mallory',
    });
    expect(second.statusCode, second.body).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('CONFLICT');

    expect(await usersRepo(t.meta).count()).toBe(1);
    expect(await usersRepo(t.meta).findByEmail('mallory@evil.test')).toBeNull();
  });

  /**
   * HONEST SCOPE. Both requests really are in flight before either completes,
   * but this harness runs on better-sqlite3, whose Kysely driver serializes
   * every query through one mutex-guarded connection — so it cannot force the
   * interleaving that breaks a naive check-then-act guard, and this test would
   * pass against one. It is a route-level regression guard (the API resolves a
   * double-submit to one 201 + one 409 and never two admins), NOT the proof
   * that the race is closed.
   *
   * The proof lives in packages/meta/test/bootstrap.test.ts — the same storm in
   * the dialect-parameterized suite, whose PostgreSQL and MySQL legs genuinely
   * interleave and fail without the `system.superAdminCreatedAt` claim.
   */
  it('a CONCURRENT double-submit yields exactly one 201 and one 409', async () => {
    const [a, b] = await Promise.all([
      postSetup({ email: 'first@adminium.test', password: 'a-long-enough-password' }),
      postSetup({ email: 'second@adminium.test', password: 'a-long-enough-password' }),
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes, `${a.body}\n${b.body}`).toEqual([201, 409]);

    // The decisive assertion: exactly one user exists, and they hold super-admin.
    expect(await usersRepo(t.meta).count()).toBe(1);
    const winner = a.statusCode === 201 ? a : b;
    const winnerEmail = (winner.json() as { data: { user: { email: string; id: string } } }).data.user;
    const roles = await rolesRepo(t.meta).rolesForUser(winnerEmail.id);
    expect(roles.map((r) => r.slug)).toEqual(['super-admin']);

    // The loser's transaction rolled back whole — no orphan user row.
    const loserEmail =
      winnerEmail.email === 'first@adminium.test' ? 'second@adminium.test' : 'first@adminium.test';
    expect(await usersRepo(t.meta).findByEmail(loserEmail)).toBeNull();
  });

  it('an N-way concurrent storm still yields exactly one super admin', async () => {
    // Each racer from its own address: `/setup/super-admin` sits in the §6
    // `auth-login` bucket (5/min per ip), and 8 racers from one ip would 429
    // before the claim race this test exists for even runs.
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        t.app.inject({
          method: 'POST',
          url: '/api/v1/setup/super-admin',
          payload: { email: `racer${String(i)}@adminium.test`, password: 'a-long-enough-password' },
          remoteAddress: `10.99.1.${String(i + 1)}`,
        }),
      ),
    );
    expect(attempts.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(attempts.filter((r) => r.statusCode === 409)).toHaveLength(7);
    expect(await usersRepo(t.meta).count()).toBe(1);
  });

  it('deleting every user does NOT re-open the endpoint (the claim is permanent)', async () => {
    expect((await postSetup(GOOD)).statusCode).toBe(201);

    // The scenario the claim exists for: an operator (or an attacker with a
    // data-only foothold) empties adminium_users. A user-count-only gate would
    // hand the next anonymous caller a fresh super admin.
    await t.meta.db.deleteFrom('adminium_users').execute();
    expect(await usersRepo(t.meta).count()).toBe(0);

    const state = await getState();
    expect((state.json() as { data: { required: boolean } }).data.required).toBe(false);

    const retry = await postSetup({ email: 'mallory@evil.test', password: 'another-long-password' });
    expect(retry.statusCode, retry.body).toBe(409);
    expect(await usersRepo(t.meta).count()).toBe(0);
  });

  it('rejects a password below the auth.passwordMinLength policy, leaving setup open', async () => {
    const res = await postSetup({ email: 'ada@adminium.test', password: 'short' });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');

    expect(await usersRepo(t.meta).count()).toBe(0);
    // A rejected attempt must NOT burn the one-shot claim.
    expect((await getState()).json()).toMatchObject({ data: { required: true } });
    expect((await postSetup(GOOD)).statusCode).toBe(201);
  });

  it('rejects a malformed email and unknown body keys', async () => {
    expect((await postSetup({ email: 'not-an-email', password: 'a-long-enough-password' })).statusCode).toBe(422);
    expect(
      (await postSetup({ ...GOOD, isSuperAdmin: true, roles: ['super-admin'] })).statusCode,
      'unknown keys must be rejected, not silently dropped, next to super-admin creation',
    ).toBe(422);
    expect(await usersRepo(t.meta).count()).toBe(0);
  });

  it('leaves telemetry and the update check OFF when no consent is supplied', async () => {
    expect((await postSetup(GOOD)).statusCode).toBe(201);
    const settings = settingsRepo(t.meta);
    expect(await settings.get('telemetry.enabled')).toBe(false);
    expect(await settings.get('updates.checkEnabled')).toBe(false);
  });

  it('records the consent answers when the wizard supplies them', async () => {
    const res = await postSetup({ ...GOOD, consent: { telemetry: true, updateCheck: false } });
    expect(res.statusCode, res.body).toBe(201);
    const settings = settingsRepo(t.meta);
    expect(await settings.get('telemetry.enabled')).toBe(true);
    expect(await settings.get('updates.checkEnabled')).toBe(false);
  });

  it('a losing racer cannot rewrite the winner’s telemetry answer', async () => {
    const [a, b] = await Promise.all([
      postSetup({ email: 'first@adminium.test', password: 'a-long-enough-password', consent: { telemetry: false, updateCheck: false } }),
      postSetup({ email: 'second@adminium.test', password: 'a-long-enough-password', consent: { telemetry: true, updateCheck: true } }),
    ]);

    const winner = a.statusCode === 201 ? a : b;
    const winnerSaidYes =
      (winner.json() as { data: { user: { email: string } } }).data.user.email === 'second@adminium.test';

    // Consent is written only after the claim is won, so the stored answer is
    // always the winner's — a loser cannot flip telemetry on behind their back.
    expect(await settingsRepo(t.meta).get('telemetry.enabled')).toBe(winnerSaidYes);
  });
});
