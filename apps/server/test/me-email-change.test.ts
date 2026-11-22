// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CHANGING YOUR OWN SIGN-IN ADDRESS. The password alone no longer moves it: a
 * link goes to the NEW address, and the old address stays in force until the
 * person opens that link while signed in to this account. So nobody can claim
 * an address they cannot read, and somebody who only receives the mail cannot
 * hand their address to another person's account by clicking it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFirstSuperAdmin, emailChangesRepo, passwordResetsRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { hashToken } from '../src/auth/sessions.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

interface Delivery {
  userId: string;
  email: string;
  token: string;
  expiresAt: number;
}

describe.each(META_ENGINES.map((engine) => [engine.name, engine] as const))('changing your own sign-in address — %s', (_name, engine) => {
  let handle: MetaHandle;
  let meta: MetaDb;
  let app: AdminiumServer;
  let seq = 0;
  const mailed: Delivery[] = [];

  const next = () => {
    seq += 1;
    return seq;
  };
  const address = (who: string) => `${who}${String(next())}@example.com`;

  async function attempt(email: string) {
    return app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.88.${String(Math.floor(next() / 200))}.${String(seq % 200)}`, payload: { email, password: ADMIN_PASSWORD } });
  }

  async function person(): Promise<{ user: User; cookie: string }> {
    const email = address('staff');
    const user = await usersRepo(meta).create({ email, name: 'Sam Lee', passwordHash: await adminPasswordHash() });
    const res = await attempt(email);
    expect(res.statusCode, res.body).toBe(200);
    return { user, cookie: sessionCookie(res.headers['set-cookie']) };
  }

  const ask = (cookie: string, email: string, password = ADMIN_PASSWORD) => app.inject({ method: 'PATCH', url: '/api/v1/me', headers: { cookie }, payload: { email, password } });
  const confirm = (cookie: string | null, token: string) => app.inject({ method: 'POST', url: '/api/v1/me/email/confirm', headers: cookie === null ? {} : { cookie }, payload: { token } });
  const stored = async (id: string) => (await usersRepo(meta).findById(id))!.email;

  beforeAll(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    meta = handle.meta;
    await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: 'Ava Reyes', passwordHash: await adminPasswordHash() });
    app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta, onEmailChangeToken: (delivery) => mailed.push(delivery) });
    await app.ready();
  }, 120_000);

  afterEach(() => {
    mailed.length = 0;
  });

  afterAll(async () => {
    if (!engine.available) return;
    await app.close();
    await handle.destroy();
  });

  it.skipIf(!engine.available)('the password alone changes nothing: the old address still signs in and the link goes to the new one', async () => {
    const { user, cookie } = await person();
    const wanted = address('new');
    const res = await ask(cookie, `  ${wanted.toUpperCase()} `);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ data: { user: { email: user.email }, emailChange: { pendingEmail: wanted } } });
    expect(await stored(user.id)).toBe(user.email);
    expect(mailed).toHaveLength(1);
    expect(mailed[0]).toMatchObject({ userId: user.id, email: wanted });
    expect((await attempt(user.email)).statusCode).toBe(200);
    expect((await attempt(wanted)).statusCode).toBe(401);
  });

  it.skipIf(!engine.available)('a wrong password sends nothing', async () => {
    const { user, cookie } = await person();
    expect((await ask(cookie, address('new'), 'not-the-password')).statusCode).toBe(401);
    expect(mailed).toHaveLength(0);
    expect(await stored(user.id)).toBe(user.email);
  });

  it.skipIf(!engine.available)('opening the link while signed in moves the address, once', async () => {
    const { user, cookie } = await person();
    const wanted = address('new');
    await ask(cookie, wanted);
    const res = await confirm(cookie, mailed[0]!.token);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ data: { user: { email: wanted } } });
    expect(await stored(user.id)).toBe(wanted);
    expect((await attempt(wanted)).statusCode).toBe(200);
    expect((await attempt(user.email)).statusCode).toBe(401);
    expect((await confirm(cookie, mailed[0]!.token)).statusCode).toBe(410);
  });

  it.skipIf(!engine.available)('the link is no use to anybody else: not signed in, or signed in as another account', async () => {
    const { user, cookie } = await person();
    const stranger = await person();
    const wanted = address('new');
    await ask(cookie, wanted);
    const { token } = mailed[0]!;
    expect((await confirm(null, token)).statusCode).toBe(401);
    expect((await confirm(stranger.cookie, token)).statusCode).toBe(410);
    expect(await stored(user.id)).toBe(user.email);
    expect(await stored(stranger.user.id)).toBe(stranger.user.email);
    // Neither try spent it: its owner can still use it.
    expect((await confirm(cookie, token)).statusCode).toBe(200);
  });

  it.skipIf(!engine.available)('a pending address is not reserved; whoever really holds it first keeps it', async () => {
    const first = await person();
    const second = await person();
    const wanted = address('new');
    await ask(first.cookie, wanted);
    await ask(second.cookie, wanted);
    expect((await confirm(second.cookie, mailed[1]!.token)).statusCode).toBe(200);
    const late = await confirm(first.cookie, mailed[0]!.token);
    expect(late.statusCode, late.body).toBe(409);
    expect(await stored(first.user.id)).toBe(first.user.email);
    expect(await stored(second.user.id)).toBe(wanted);
  });

  it.skipIf(!engine.available)('an address already in use is refused before anything is sent', async () => {
    const { cookie } = await person();
    const taken = await person();
    expect((await ask(cookie, taken.user.email)).statusCode).toBe(409);
    expect(mailed).toHaveLength(0);
  });

  it.skipIf(!engine.available)('asking again replaces the earlier link, and an expired link does not work', async () => {
    const { user, cookie } = await person();
    await ask(cookie, address('new'));
    const second = address('new');
    await ask(cookie, second);
    expect((await confirm(cookie, mailed[0]!.token)).statusCode).toBe(410);
    await meta.db.updateTable('adminium_email_changes').set({ expiresAt: Date.now() - 1 }).where('userId', '=', user.id).execute();
    expect((await confirm(cookie, mailed[1]!.token)).statusCode).toBe(410);
    expect(await stored(user.id)).toBe(user.email);
  });

  it.skipIf(!engine.available)('one account cannot have more than five links an hour sent to other people’s addresses', async () => {
    const { cookie } = await person();
    for (let round = 0; round < 5; round += 1) expect((await ask(cookie, address('new'))).statusCode).toBe(200);
    expect(mailed).toHaveLength(5);
    expect((await ask(cookie, address('new'))).statusCode).toBe(429);
    expect(mailed).toHaveLength(5);
    // The last link still works: being refused another did not take it away.
    expect((await confirm(cookie, mailed[4]!.token)).statusCode).toBe(200);
  });

  it.skipIf(!engine.available)('an administrator setting the address ends a link the person was waiting on', async () => {
    const { user, cookie } = await person();
    await ask(cookie, address('new'));
    await emailChangesRepo(meta).clear(user.id);
    expect((await confirm(cookie, mailed[0]!.token)).statusCode).toBe(410);
    expect(await stored(user.id)).toBe(user.email);
  });

  it.skipIf(!engine.available)('a password-reset link mailed to the old address dies when the address moves', async () => {
    const { user, cookie } = await person();
    const resetToken = 'rst_for_the_old_mailbox';
    const reset = await passwordResetsRepo(meta).create({ userId: user.id, kind: 'reset', tokenHash: hashToken(resetToken), expiresAt: Date.now() + 3_600_000 });
    await ask(cookie, address('new'));
    // Only asking leaves it alone: the old address is still the account's.
    expect(await passwordResetsRepo(meta).findValidByTokenHash(reset.tokenHash)).not.toBeNull();
    expect((await confirm(cookie, mailed[0]!.token)).statusCode).toBe(200);
    expect(await passwordResetsRepo(meta).findValidByTokenHash(reset.tokenHash)).toBeNull();
  });

  it.skipIf(!engine.available)('with no way to send mail it is refused, and nothing is left waiting', async () => {
    const quiet = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    await quiet.ready();
    try {
      const { user } = await person();
      const signedIn = await quiet.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.89.0.1', payload: { email: user.email, password: ADMIN_PASSWORD } });
      const cookie = sessionCookie(signedIn.headers['set-cookie']);
      const res = await quiet.inject({ method: 'PATCH', url: '/api/v1/me', headers: { cookie }, payload: { email: address('new'), password: ADMIN_PASSWORD } });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ error: { details: { reason: 'EMAIL_NOT_CONFIGURED' } } });
      expect(await stored(user.id)).toBe(user.email);
      expect(await meta.db.selectFrom('adminium_email_changes').selectAll().where('userId', '=', user.id).execute()).toEqual([]);
    } finally {
      await quiet.close();
    }
  });

  it.skipIf(!engine.available)('a name saved beside an unchanged address still saves at once', async () => {
    const { user, cookie } = await person();
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: { cookie }, payload: { name: 'Sam L.' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ data: { user: { name: 'Sam L.', email: user.email } } });
    expect(mailed).toHaveLength(0);
  });
});
