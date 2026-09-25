// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The emailed sign-in link, under the attacks a review found — over the wire,
 * on every engine this run can reach.
 *
 * - An address spelled with accents that MySQL's collation reads as a
 *   client's is a stranger's: it mails no one, and never gets past the caps.
 * - A language whose template is switched off still sends (in US English), and
 *   nothing a stranger can reach then answers apart from a client.
 * - Every code of an address is tried at most five times, however many links
 *   are open, and ten guesses a day lock the code path, in parallel too.
 * - A session opened by a link ends when the address on the person's row
 *   stops being the one it was sent to, even when nothing announced it.
 * - A link asks for a new one once, within a day of being sent.
 */
import { publicChallengesRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { addressKey, codeBinding, codeKey, hashAddress, hashCode } from '../src/public-api/claim-code.js';
import { solveProof } from '../src/public-api/proof.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { LINK_CODE_FAILURES_DAY, SIGN_IN_LINK_JOB_KIND, linkSubject, tryLinkCode } from '../src/public-api/sign-in-link.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      { ref: 'clients', columns: [id, { ref: 'contact_name', type: 'text', maxLength: 120 }, { ref: 'email', type: 'text', maxLength: 254, unique: true }] },
      { ref: 'deliverables', columns: [id, { ref: 'client_id', type: 'fk', references: 'clients' }, { ref: 'title', type: 'text', maxLength: 120 }] },
    ]),
    publicAccess: [
      { table: 'clients', methods: ['GET'], select: ['contact_name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
      { table: 'deliverables', methods: ['GET'], select: ['id', 'title'], claimedBy: { table: 'clients', column: 'client_id' }, level: 'verified' },
    ],
  };
}

async function mail(meta: MetaDb) {
  const jobs = await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute();
  return jobs.map((job) => {
    const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { templateKey: string; envelope: string };
    const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; text: string };
    return { template: payload.templateKey, to: envelope.to, text: envelope.text };
  });
}

const linkOf = (text: string) => ({ token: /\/c#([A-Za-z0-9_-]{43})/.exec(text)![1]!, code: /\b(\d{6})\b/.exec(text)![1]! });

describe.each(LEGS)('the sign-in link, hardened — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let ip = 0;
  const from = () => {
    ip += 1;
    return `10.${String((ip >> 16) & 255)}.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const proof = async () => {
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=claim', remoteAddress: from(), headers: served.headers() });
    const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return `${c.id}.${solveProof(c.salt, c.difficulty)}`;
  };
  const send = async (url: string, payload: Record<string, unknown>, opts: { proof?: boolean; session?: string } = {}) =>
    served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/public${url}`,
      remoteAddress: from(),
      headers: served.headers(opts.session, opts.proof === false ? {} : { 'x-adminium-proof': await proof() }),
      payload,
    });
  const drain = async () => {
    const queued = await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', SIGN_IN_LINK_JOB_KIND).where('status', '=', 'pending').orderBy('createdAt').execute();
    const entry = served.composed.jobs.registry.get(SIGN_IN_LINK_JOB_KIND)!;
    for (const job of queued) {
      await entry.run(entry.schema.parse(typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload), {} as never);
      await h.meta.db.deleteFrom('adminium_jobs').where('id', '=', job.id).execute();
    }
  };
  const linksTo = async (to: string) => (await mail(h.meta)).filter((m) => m.template === 'sign-in-link' && m.to === to);
  const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    for (const [name, email] of [
      ['Ada Lovelace', 'ada@example.com'],
      ['Cy Kent', 'cy@example.com'],
      ['Dee Dee', 'dee@example.com'],
      ['Eve Eng', 'eve@example.com'],
      ['Fay Fox', 'fay@example.com'],
    ]) {
      await h.rows(`insert into ${h.real('clients')} (contact_name, email) values ('${name}', '${email}')`);
    }
    await h.rows(`insert into ${h.real('deliverables')} (client_id, title) values (4, 'Eve logo')`);
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://studio.example.com');
    await settingsRepo(h.meta).set('email.smtp', { host: 'localhost', port: 587, user: 'p', passEncrypted: encryptSecret('x', emailSecretKey(TEST_SECRET)), from: 'S <n@s.test>', secure: false } as never);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skipIf(!available)('mails only the address as its client spelled it, whatever the collation reads alike', async () => {
    for (const email of ['ada@example.com', 'ADA@EXAMPLE.COM', 'adà@example.com', 'ádá@example.com', 'âda@example.com', 'ada@exámple.com', 'ada@examplé.com', 'adá@example.com']) {
      expect((await send('/claim/link', { email })).statusCode).toBe(202);
    }
    await drain();
    // Two to her exact address (the upper-case one is the same address); no look-alike reached her.
    expect(await linksTo('ada@example.com')).toHaveLength(2);
    expect((await mail(h.meta)).filter((m) => m.template === 'sign-in-link')).toHaveLength(2);
  });

  it.skipIf(!available)('sends in US English when a language’s template is off, and answers a stranger alike', async () => {
    await h.meta.db.updateTable('adminium_email_templates').set({ enabled: 0 as never }).where('key', '=', 'sign-in-link').where('locale', '=', 'de_DE').execute();
    expect((await send('/claim/link', { email: 'dee@example.com', lang: 'de' })).statusCode).toBe(202);
    expect((await send('/claim/link', { email: 'zed@example.com', lang: 'de' })).statusCode).toBe(202);
    await drain();
    expect(await linksTo('dee@example.com')).toHaveLength(1);
    const known = await send('/claim/link/verify', { email: 'dee@example.com', code: '123456' === linkOf((await linksTo('dee@example.com'))[0]!.text).code ? '654321' : '123456' }, { proof: false });
    const unknown = await send('/claim/link/verify', { email: 'zed@example.com', code: '123456' }, { proof: false });
    expect(unknown.statusCode).toBe(known.statusCode);
    expect(served.codeOf(unknown)).toBe(served.codeOf(known));
  });

  it.skipIf(!available)('holds the code path to ten guesses a day, in parallel too', async () => {
    for (let i = 0; i < 3; i += 1) expect((await send('/claim/link', { email: 'cy@example.com' })).statusCode).toBe(202);
    await drain();
    const codes = (await linksTo('cy@example.com')).map((m) => linkOf(m.text).code);
    let wrong = 100_000;
    const guess = () => {
      do wrong += 1;
      while (codes.includes(String(wrong)));
      return String(wrong);
    };
    const answers = await Promise.all(Array.from({ length: 30 }, () => send('/claim/link/verify', { email: 'cy@example.com', code: guess() }, { proof: false })));
    // Each of them either was a guess counted against the day, or refused before it was compared.
    expect(answers.filter((a) => served.codeOf(a) === 'PUBLIC_CODE_WRONG').length).toBeLessThanOrEqual(LINK_CODE_FAILURES_DAY);
    expect(served.codeOf(await send('/claim/link/verify', { email: 'cy@example.com', code: codes[0]! }, { proof: false }))).toBe('PUBLIC_CLAIM_LOCKED');

    // The desk sees the lock on Cy's record, kept by his address, and lifts it.
    const desk = await usersRepo(h.meta).create({ email: `desk-${dialect}@studio.dev`, name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: desk.email, password: ADMIN_PASSWORD } });
    const cookie = sessionCookie(login.headers['set-cookie']);
    const clients = (await createPublicViews(h.meta).viewFor(h.connectionId))!.table(h.real('clients')).id;
    const lockUrl = `/api/v1/data/${h.connectionId}/${encodeURIComponent(clients)}/2/claim-lock`;
    expect((await served.composed.app.inject({ method: 'GET', url: lockUrl, headers: { cookie } })).json()).toMatchObject({ locked: true });
    expect((await served.composed.app.inject({ method: 'DELETE', url: lockUrl, headers: { cookie } })).statusCode).toBe(200);
    expect((await served.composed.app.inject({ method: 'GET', url: lockUrl, headers: { cookie } })).json()).toMatchObject({ locked: false });
    expect(served.codeOf(await send('/claim/link/verify', { email: 'cy@example.com', code: guess() }, { proof: false }))).not.toBe('PUBLIC_CLAIM_LOCKED');
  });

  it.skipIf(!available)('ends a link’s session when the address on the row is not the one the link went to', async () => {
    expect((await send('/claim/link', { email: 'eve@example.com' })).statusCode).toBe(202);
    await drain();
    const { token } = linkOf((await linksTo('eve@example.com')).at(-1)!.text);
    const session = ((await send('/claim/link/verify', { token }, { proof: false })).json() as { data: { session: string } }).data.session;
    const deliverables = () => served.get(`/records/${h.real('deliverables')}_verified`, session);
    expect((await deliverables()).statusCode).toBe(200);
    // Changed where no record event is heard (an import, a direct statement).
    await h.rows(`update ${h.real('clients')} set email = 'eve@elsewhere.example.com' where id = 4`);
    vi.useFakeTimers({ toFake: ['Date'] });
    tick(61_000);
    expect((await deliverables()).statusCode).toBe(404);
  });

  it.skipIf(!available)('asks for a new link once from a link, and only within a day of it being sent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect((await send('/claim/link', { email: 'fay@example.com' })).statusCode).toBe(202);
    await drain();
    const first = linkOf((await linksTo('fay@example.com')).at(-1)!.text).token;
    expect((await send('/claim/link/resend', { token: first })).statusCode).toBe(202);
    await drain();
    expect(await linksTo('fay@example.com')).toHaveLength(2);
    // The same old link again: nothing more.
    tick(16 * 60_000);
    expect((await send('/claim/link/resend', { token: first })).statusCode).toBe(202);
    await drain();
    expect(await linksTo('fay@example.com')).toHaveLength(2);
    // The new one, a day and more later: nothing either.
    const second = linkOf((await linksTo('fay@example.com')).at(-1)!.text).token;
    tick(25 * 60 * 60_000);
    expect((await send('/claim/link/resend', { token: second })).statusCode).toBe(202);
    await drain();
    expect(await linksTo('fay@example.com')).toHaveLength(2);
  });
});

describe('a code typed against an address’s links', () => {
  it('tries every open code at most five times: after five wrong guesses, no code opens', async () => {
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    const { connectionsRepo, createSqliteMetaDb, firstRun, publicKeysRepo, publicScopesRepo } = await import('@adminium/meta');
    const { dsnCryptoFromSecret } = await import('../src/connections/crypto.js');
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const connection = await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({ name: 'src', engine: 'postgres', introspectDsn: 'postgres://a:b@db/x', dataDsn: 'postgres://a:b@db/x' });
    const scope = await publicScopesRepo(meta).create({ connectionId: connection.id, side: 'customer', name: 's', timezone: 'UTC', document: '{"version":1,"resources":[]}' });
    const key = await publicKeysRepo(meta).create({ name: 'k', prefix: 'adm_pub_trytest', tokenHash: 'h'.repeat(64), tokenEncrypted: 'x', scopeId: scope.id, side: 'customer' });
    const secret = codeKey(TEST_SECRET);
    const subject = linkSubject(hashAddress(addressKey(TEST_SECRET), 'cy@example.com'));
    const repo = publicChallengesRepo(meta);
    const now = Date.now();
    const codes = ['111111', '222222', '333333'];
    for (const [i, code] of codes.entries()) {
      const at = now + i;
      await repo.create({ keyId: key.id, ref: 'clients', destinationHash: 'd', codeHash: hashCode(secret, codeBinding({ sessionId: null, purpose: 'link', createdAt: at }), code), expiresAt: now + 60_000, sessionId: null, purpose: 'link', subject, tokenHash: String(i).repeat(64) }, at);
    }
    const open = async () => repo.openLinks(subject, key.id, now + 10);
    for (let i = 0; i < 5; i += 1) {
      expect((await tryLinkCode({ meta, codeSecret: secret, open: await open(), code: '000000', now: now + 10 })).outcome).toBe('wrong');
    }
    // The oldest email's own code: it has been compared five times already.
    expect((await tryLinkCode({ meta, codeSecret: secret, open: await open(), code: codes[0]!, now: now + 10 })).outcome).toBe('expired');
    await meta.db.destroy();
  });

  it('counts a day’s guesses with a conditional step: thirty at once, ten counted', async () => {
    const BetterSqlite3 = (await import('better-sqlite3')).default;
    const { connectionsRepo, createSqliteMetaDb, firstRun, publicKeysRepo, publicScopesRepo } = await import('@adminium/meta');
    const { dsnCryptoFromSecret } = await import('../src/connections/crypto.js');
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const connection = await connectionsRepo(meta, dsnCryptoFromSecret(TEST_SECRET)).create({ name: 'src', engine: 'postgres', introspectDsn: 'postgres://a:b@db/x', dataDsn: 'postgres://a:b@db/x' });
    const scope = await publicScopesRepo(meta).create({ connectionId: connection.id, side: 'customer', name: 's', timezone: 'UTC', document: '{"version":1,"resources":[]}' });
    const key = await publicKeysRepo(meta).create({ name: 'k', prefix: 'adm_pub_daytest', tokenHash: 'h'.repeat(64), tokenEncrypted: 'x', scopeId: scope.id, side: 'customer' });
    const repo = publicChallengesRepo(meta);
    const answers = await Promise.all(Array.from({ length: 30 }, () => repo.chargeDailyTry('addr:x', key.id, LINK_CODE_FAILURES_DAY)));
    expect(answers.filter(Boolean)).toHaveLength(LINK_CODE_FAILURES_DAY);
    expect(await repo.dailyTries('addr:x')).toBe(LINK_CODE_FAILURES_DAY);
    // The desk lifts it.
    await repo.clearSubject('addr:x');
    expect(await repo.dailyTries('addr:x')).toBe(0);
    expect(await repo.chargeDailyTry('addr:x', key.id, LINK_CODE_FAILURES_DAY)).toBe(true);
    await meta.db.destroy();
  });
});
