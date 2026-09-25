// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Signing in by an emailed link, over the wire, through an app installed by
 * the real installer, on every engine this run can reach.
 *
 * What it holds: a typed address alone opens nothing (`/public/claim` makes no
 * session); asking for a link answers the same for a client and a stranger and
 * mails only the client; the link works once, for twenty minutes, and only
 * from Continue — reading the name spends nothing; three links live at once;
 * the code on another device locks after ten wrong tries a day while the link
 * still works; "Email me a new link" goes only to the link's own address; the
 * desk changing the address ends the sessions, takes the links back and tells
 * the old address; the link names the app's own address and never the host the
 * request came in on; a session lasts half an hour idle and ends on sign-out.
 */
import { connectionTenantConfig, publicChallengesRepo, publicSessionsRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicRateLimiter, rateKeyFor } from '../src/public-api/limiter.js';
import { solveProof } from '../src/public-api/proof.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { LINK_PURPOSE, SIGN_IN_LINK_JOB_KIND } from '../src/public-api/sign-in-link.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function linkManifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'clients',
        columns: [
          id,
          { ref: 'contact_name', type: 'text', maxLength: 120 },
          { ref: 'email', type: 'text', maxLength: 254, unique: true },
          { ref: 'company', type: 'text', maxLength: 120, nullable: true },
        ],
      },
      { ref: 'deliverables', columns: [id, { ref: 'client_id', type: 'fk', references: 'clients' }, { ref: 'title', type: 'text', maxLength: 120 }] },
    ]),
    publicAccess: [
      { table: 'clients', methods: ['GET'], select: ['contact_name', 'company'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
      { table: 'deliverables', methods: ['GET'], select: ['id', 'title'], claimedBy: { table: 'clients', column: 'client_id' }, level: 'verified' },
    ],
  };
}

const PUBLIC_ORIGIN = 'https://studio.example.com';

/** Mail queued so far: who it went to, its template and text. */
async function mail(meta: MetaDb) {
  const jobs = await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute();
  return jobs.map((job) => {
    const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { templateKey: string; envelope: string };
    const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string; html?: string };
    return { template: payload.templateKey, to: envelope.to, subject: envelope.subject, text: envelope.text, html: envelope.html ?? '' };
  });
}

/** The token and the code of a sign-in link email. */
function linkOf(message: { text: string; html: string }): { url: string; token: string; code: string } {
  const url = /(https?:\/\/\S+\/c#[A-Za-z0-9_-]{43})/.exec(message.text + message.html)?.[1];
  const code = /\b(\d{6})\b/.exec(message.text)?.[1];
  expect(url, message.text).toBeDefined();
  return { url: url!, token: url!.slice(-43), code: code! };
}

describe.each(LEGS)('signing in by an emailed link — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let ip = 0;
  const now = () => Date.now();

  /** A fresh human check for a claim, as the page solves one. */
  const proof = async () => {
    const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=claim', remoteAddress: from(), headers: served.headers() });
    const challenge = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}`;
  };
  /** A request from its own address, so one visitor's limit never stands in for the thing under test. */
  const from = () => {
    ip += 1;
    return `10.${String((ip >> 16) & 255)}.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const send = async (url: string, payload: Record<string, unknown>, opts: { proof?: boolean; session?: string; host?: string } = {}) =>
    served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/public${url}`,
      remoteAddress: from(),
      headers: served.headers(opts.session, {
        ...(opts.proof === false ? {} : { 'x-adminium-proof': await proof() }),
        ...(opts.host === undefined ? {} : { host: opts.host }),
      }),
      payload,
    });
  const ask = (email: string, host?: string) => send('/claim/link', { email }, host === undefined ? {} : { host });
  /** Run the link jobs the requests queued, as the worker would. */
  const drain = async () => {
    const queued = await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', SIGN_IN_LINK_JOB_KIND).where('status', '=', 'pending').orderBy('createdAt').execute();
    const entry = served.composed.jobs.registry.get(SIGN_IN_LINK_JOB_KIND)!;
    for (const job of queued) {
      const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
      await entry.run(entry.schema.parse(payload), {} as never);
      await h.meta.db.deleteFrom('adminium_jobs').where('id', '=', job.id).execute();
    }
    return queued.length;
  };
  const links = async (to: string) => (await mail(h.meta)).filter((m) => m.template === 'sign-in-link' && m.to === to);
  const sessionCount = async () => Number((await h.meta.db.selectFrom('adminium_public_sessions').select((eb) => eb.fn.countAll().as('n')).executeTakeFirst())?.n ?? 0);
  const tick = (ms: number) => vi.setSystemTime(new Date(now() + ms));
  const deliverables = (session: string) => served.get(`/records/${h.real('deliverables')}_verified`, session);

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, linkManifest());
    const made = h.reply['publicAccess'] as { keyId: string };
    await h.rows(`insert into ${h.real('clients')} (contact_name, email, company) values ('Ada Lovelace', 'ada@example.com', 'Engines Ltd')`);
    await h.rows(`insert into ${h.real('clients')} (contact_name, email) values ('Ben Ames', 'Ben@Example.org')`);
    await h.rows(`insert into ${h.real('deliverables')} (client_id, title) values (1, 'Ada logo')`);
    await h.rows(`insert into ${h.real('deliverables')} (client_id, title) values (2, 'Ben logo')`);
    await settingsRepo(h.meta).set('system.publicOrigin', PUBLIC_ORIGIN);
    await settingsRepo(h.meta).set('email.smtp', {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
      from: 'Studio <no-reply@studio.test>',
      secure: false,
    } as never);
    served = await servePublic(h, made.keyId);
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skipIf(!available)('opens nothing from a typed address: the claim route makes no session', async () => {
    const config = await served.get('/config');
    expect((config.json() as { data: { claim: unknown } }).data.claim).toEqual({ strategy: 'email-link', ref: `${h.real('clients')}_claimed`, match: ['email'], verify: 'email-link' });
    const before = await sessionCount();
    for (const email of ['ada@example.com', 'nobody@example.com']) {
      const res = await send('/claim', { match: { email } });
      expect(res.statusCode, res.body).toBe(403);
      expect(served.codeOf(res)).toBe('PUBLIC_CLAIM_UNAVAILABLE');
    }
    // Nor do the code steps of a found session exist here.
    expect(served.codeOf(await send('/claim/code', { purpose: 'verify' }, { proof: false }))).toBe('PUBLIC_CLAIM_UNAVAILABLE');
    expect(await sessionCount()).toBe(before);
  });

  it.skipIf(!available)('answers a client and a stranger alike, and mails only the client', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Two addresses that mask alike: the answers must be byte for byte the same.
    const known = await ask('ada@example.com');
    const unknown = await ask('axe@example.com');
    expect(known.statusCode, known.body).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(unknown.body).toBe(known.body);
    expect(known.json()).toEqual({ data: { sentTo: 'a•••@e•••.com' } });
    // Nothing was looked up yet: both are queued work.
    expect(await drain()).toBe(2);
    const sent = await links('ada@example.com');
    expect(sent).toHaveLength(1);
    expect(await links('axe@example.com')).toHaveLength(0);
    // Both addresses hold one challenge each — the stranger's a decoy nobody was sent.
    const challenges = await h.meta.db.selectFrom('adminium_public_challenges').selectAll().where('purpose', '=', LINK_PURPOSE).execute();
    expect(challenges).toHaveLength(2);
    // Stored as hashes: no address, no token, no code in the table.
    expect(JSON.stringify(challenges)).not.toMatch(/ada@|axe@/);
    // The link names the app's own guest side, the token in the fragment.
    const link = linkOf(sent[0]!);
    expect(link.url).toBe(`${PUBLIC_ORIGIN}/apps/studio/customer/c#${link.token}`);
    expect(sent[0]!.subject).toContain('sign-in link');
  });

  it.skipIf(!available)('greets by first name without spending the link, then opens a verified session once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { token } = linkOf((await links('ada@example.com')).at(-1)!);
    const before = await sessionCount();
    for (let i = 0; i < 2; i += 1) {
      const peek = await send('/claim/link/peek', { token }, { proof: false });
      expect(peek.statusCode, peek.body).toBe(200);
      expect(peek.json()).toEqual({ data: { firstName: 'Ada' } });
    }
    expect(await sessionCount()).toBe(before);
    const opened = await send('/claim/link/verify', { token }, { proof: false });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string; level: string } }).data;
    expect(session.level).toBe('verified');
    // Her own rows, at the verified level, and nobody else's.
    expect(((await deliverables(session.session)).json() as { data: unknown[] }).data).toEqual([{ id: 1, title: 'Ada logo' }]);
    // Once.
    for (const url of ['/claim/link/verify', '/claim/link/peek']) {
      const again = await send(url, { token }, { proof: false });
      expect(again.statusCode).toBe(410);
      expect(served.codeOf(again)).toBe('LINK_EXPIRED');
    }
    // A token nobody was sent: the same answer.
    const nonsense = await send('/claim/link/verify', { token: 'A'.repeat(43) }, { proof: false });
    expect(nonsense.statusCode).toBe(410);
    expect(nonsense.body).toBe((await send('/claim/link/verify', { token }, { proof: false })).body);
  });

  it.skipIf(!available)('lasts twenty minutes; the session half an hour idle, and ends on sign-out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick(24 * 60 * 60_000); // a fresh day for Ada's caps
    expect((await ask('ada@example.com')).statusCode).toBe(202);
    await drain();
    const first = linkOf((await links('ada@example.com')).at(-1)!);
    expect((await ask('ada@example.com')).statusCode).toBe(202);
    await drain();
    const second = linkOf((await links('ada@example.com')).at(-1)!);
    tick(21 * 60_000);
    expect(served.codeOf(await send('/claim/link/verify', { token: first.token }, { proof: false }))).toBe('LINK_EXPIRED');
    expect(served.codeOf(await send('/claim/link/verify', { email: 'ada@example.com', code: second.code }, { proof: false }))).toBe('PUBLIC_CODE_EXPIRED');

    expect((await ask('ada@example.com')).statusCode).toBe(202);
    await drain();
    const third = linkOf((await links('ada@example.com')).at(-1)!);
    tick(19 * 60_000);
    const opened = await send('/claim/link/verify', { token: third.token }, { proof: false });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string } }).data.session;
    // Used every twenty minutes, it lives on past its first half hour.
    tick(20 * 60_000);
    expect((await deliverables(session)).statusCode).toBe(200);
    tick(20 * 60_000);
    expect((await deliverables(session)).statusCode).toBe(200);
    // Idle for more than half an hour, it is gone.
    tick(31 * 60_000);
    expect((await deliverables(session)).statusCode).toBe(404);

    // And a sign-out ends one at once.
    expect((await ask('ada@example.com')).statusCode).toBe(202);
    await drain();
    const fourth = linkOf((await links('ada@example.com')).at(-1)!);
    const next = (await send('/claim/link/verify', { token: fourth.token }, { proof: false })).json() as { data: { session: string } };
    expect((await deliverables(next.data.session)).statusCode).toBe(200);
    await served.composed.app.inject({ method: 'DELETE', url: '/api/v1/public/session', headers: served.headers(next.data.session) });
    expect((await deliverables(next.data.session)).statusCode).toBe(404);
  });

  it.skipIf(!available)('keeps three links live, caps the sends, and locks only the code path after ten wrong codes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick(2 * 24 * 60 * 60_000);
    for (const email of ['ben@example.org', 'bex@example.org']) {
      for (let i = 0; i < 4; i += 1) expect((await ask(email)).statusCode).toBe(202);
    }
    await drain();
    // Three to Ben — the fourth held by the cap, as a stranger's fourth is — each of them live.
    const sent = await links('Ben@Example.org');
    expect(sent).toHaveLength(3);
    for (const message of sent) expect((await send('/claim/link/peek', { token: linkOf(message).token }, { proof: false })).json()).toEqual({ data: { firstName: 'Ben' } });
    const subjects = await h.meta.db.selectFrom('adminium_public_challenges').select(['subject']).where('purpose', '=', LINK_PURPOSE).where('createdAt', '>=', now() - 60_000).execute();
    expect(subjects).toHaveLength(6);

    // Wrong codes, for Ben and for a stranger: the same answers, turn by turn, to the lock.
    const codes = sent.map((message) => linkOf(message).code);
    const right = codes[0]!;
    let wrong = 0;
    while (codes.includes(String(wrong).padStart(6, '0'))) wrong += 1;
    for (let i = 0; i < 10; i += 1) {
      const ben = await send('/claim/link/verify', { email: 'ben@example.org', code: String(wrong).padStart(6, '0') }, { proof: false });
      const stranger = await send('/claim/link/verify', { email: 'bex@example.org', code: String(wrong).padStart(6, '0') }, { proof: false });
      expect(ben.statusCode, ben.body).toBe(403);
      expect(stranger.body).toBe(ben.body);
    }
    const locked = await send('/claim/link/verify', { email: 'ben@example.org', code: right }, { proof: false });
    expect(served.codeOf(locked)).toBe('PUBLIC_CLAIM_LOCKED');
    expect((await send('/claim/link/verify', { email: 'bex@example.org', code: right }, { proof: false })).body).toBe(locked.body);
    // Every link in his mailbox still works: guessing at the code voids none of them.
    for (const message of sent) expect((await send('/claim/link/peek', { token: linkOf(message).token }, { proof: false })).statusCode).toBe(200);
    const opened = await send('/claim/link/verify', { token: linkOf(sent[0]!).token }, { proof: false });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string } }).data.session;
    expect(((await deliverables(session)).json() as { data: { title: string }[] }).data.map((d) => d.title)).toEqual(['Ben logo']);
  });

  it.skipIf(!available)('signs in with the code on another device, and resends only to the link’s own address', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick(3 * 24 * 60 * 60_000);
    expect((await ask(' ADA@example.com ')).statusCode).toBe(202);
    await drain();
    const link = linkOf((await links('ada@example.com')).at(-1)!);
    const byCode = await send('/claim/link/verify', { email: 'Ada@Example.com', code: link.code }, { proof: false });
    expect(byCode.statusCode, byCode.body).toBe(200);
    // The code used the link it came with.
    expect(served.codeOf(await send('/claim/link/verify', { token: link.token }, { proof: false }))).toBe('LINK_EXPIRED');

    // "Email me a new link" from the used one: to Ada's address, and counted.
    const mailed = (await links('ada@example.com')).length;
    const resent = await send('/claim/link/resend', { token: link.token });
    expect(resent.statusCode, resent.body).toBe(202);
    const nonsense = await send('/claim/link/resend', { token: 'B'.repeat(43) });
    expect(nonsense.body).toBe(resent.body);
    await drain();
    expect(await links('ada@example.com')).toHaveLength(mailed + 1);
  });

  it.skipIf(!available)('ends the sessions, takes the links back and tells the old address when the desk changes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick(4 * 24 * 60 * 60_000);
    expect((await ask('ada@example.com')).statusCode).toBe(202);
    expect((await ask('ada@example.com')).statusCode).toBe(202);
    await drain();
    const [older, newer] = (await links('ada@example.com')).slice(-2).map(linkOf);
    const session = ((await send('/claim/link/verify', { token: older!.token }, { proof: false })).json() as { data: { session: string } }).data.session;
    expect((await deliverables(session)).statusCode).toBe(200);

    // The desk, signed in, changes Ada's address through the ordinary record route.
    const desk = await usersRepo(h.meta).create({ email: 'desk@studio.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@studio.dev', password: ADMIN_PASSWORD } });
    const cookie = sessionCookie(login.headers['set-cookie']);
    const clients = (await createPublicViews(h.meta).viewFor(h.connectionId))!.model.tables.find((t) => t.name === h.real('clients'))!.id;
    const patched = await served.composed.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(clients)}/1`,
      headers: { cookie },
      payload: { values: { email: 'ada@new.example.net' } },
    });
    expect(patched.statusCode, patched.body).toBe(200);

    expect((await deliverables(session)).statusCode).toBe(404);
    expect(served.codeOf(await send('/claim/link/peek', { token: newer!.token }, { proof: false }))).toBe('LINK_EXPIRED');
    expect(served.codeOf(await send('/claim/link/verify', { token: newer!.token }, { proof: false }))).toBe('LINK_EXPIRED');
    const told = (await mail(h.meta)).at(-1)!;
    expect(told).toMatchObject({ template: 'email-changed', to: 'ada@example.com' });
    expect(told.text).toContain('a•••@n•••.net');
    // A resend from an old link now goes nowhere: that address is no longer hers.
    const count = (await mail(h.meta)).length;
    expect((await send('/claim/link/resend', { token: newer!.token })).statusCode).toBe(202);
    await drain();
    expect(await mail(h.meta)).toHaveLength(count);
    expect(await publicSessionsRepo(h.meta).purgeExpired(now())).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!available)('holds a fourth live link, opens nothing through another key, and dies with an address changed unheard', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick(6 * 24 * 60 * 60_000);
    await h.rows(`insert into ${h.real('clients')} (contact_name, email) values ('Dee Dunn', 'dee@example.com')`);
    for (let i = 0; i < 3; i += 1) expect((await ask('dee@example.com')).statusCode).toBe(202);
    await drain();
    expect(await links('dee@example.com')).toHaveLength(3);
    // Sixteen minutes on the fifteen-minute count is clear, but three are still live: none sent.
    tick(16 * 60_000);
    expect((await ask('dee@example.com')).statusCode).toBe(202);
    await drain();
    expect(await links('dee@example.com')).toHaveLength(3);
    const [first, second] = (await links('dee@example.com')).map(linkOf);

    // A link is its key's: another key of the same app opens nothing with it.
    const views = createPublicViews(h.meta);
    const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
    const secret = generatePublishableKey('browser');
    const { key } = await service.createKey({
      connectionId: h.connectionId,
      name: 'another page',
      access: [
        { ref: `${h.real('clients')}_claimed`, methods: ['GET'] },
        { ref: `${h.real('deliverables')}_verified`, methods: ['GET'] },
      ],
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    });
    await served.useKey(key.id);
    try {
      expect(served.codeOf(await send('/claim/link/peek', { token: first!.token }, { proof: false }))).toBe('LINK_EXPIRED');
      expect(served.codeOf(await send('/claim/link/verify', { token: first!.token }, { proof: false }))).toBe('LINK_EXPIRED');
      expect(served.codeOf(await send('/claim/link/verify', { email: 'dee@example.com', code: first!.code }, { proof: false }))).toBe('PUBLIC_CODE_EXPIRED');
    } finally {
      await served.useKey((h.reply['publicAccess'] as { keyId: string }).keyId);
    }
    expect((await send('/claim/link/peek', { token: first!.token }, { proof: false })).statusCode).toBe(200);

    // The address changed where no record event is heard (a direct write, an import): the link still dies.
    await h.rows(`update ${h.real('clients')} set email = 'dee@elsewhere.example.com' where email = 'dee@example.com'`);
    expect(served.codeOf(await send('/claim/link/peek', { token: second!.token }, { proof: false }))).toBe('LINK_EXPIRED');
    expect(served.codeOf(await send('/claim/link/verify', { token: second!.token }, { proof: false }))).toBe('LINK_EXPIRED');
  });

  it.skipIf(!available)('caps an address at three sends in fifteen minutes and ten a day, used or not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick(7 * 24 * 60 * 60_000);
    await h.rows(`insert into ${h.real('clients')} (contact_name, email) values ('Eve Eng', 'eve@example.com')`);
    const round = async (asks: number) => {
      for (let i = 0; i < asks; i += 1) {
        expect((await ask('eve@example.com')).statusCode).toBe(202);
        await drain();
        // Each link used at once: none stays live, so only the send counts can hold the next.
        for (const message of await links('eve@example.com')) await send('/claim/link/verify', { token: linkOf(message).token }, { proof: false });
      }
      return (await links('eve@example.com')).length;
    };
    expect(await round(4)).toBe(3);
    for (let hour = 1; hour <= 3; hour += 1) {
      tick(16 * 60_000);
      await round(3);
    }
    // Three rounds of three and one more: ten today, and not an eleventh.
    expect(await links('eve@example.com')).toHaveLength(10);
    tick(16 * 60_000);
    expect(await round(1)).toBe(10);
  });

  it.skipIf(!available)('gives one session for one link, however many ask at once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick(8 * 24 * 60 * 60_000);
    expect((await ask('ada@new.example.net')).statusCode).toBe(202);
    await drain();
    const { token } = linkOf((await links('ada@new.example.net')).at(-1)!);
    const answers = await Promise.all(Array.from({ length: 6 }, () => send('/claim/link/verify', { token }, { proof: false })));
    expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 410, 410, 410, 410, 410]);
  });

  it.skipIf(!available)('names the app’s own address whatever host asked, and sends nothing when there is none', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    tick(5 * 24 * 60 * 60_000);
    await h.rows(`insert into ${h.real('clients')} (contact_name, email) values ('Cy Cole', 'cy@example.com')`);
    expect((await ask('cy@example.com', 'evil.example')).statusCode).toBe(202);
    await drain();
    expect(linkOf((await links('cy@example.com')).at(-1)!).url.startsWith(`${PUBLIC_ORIGIN}/apps/studio/customer/c#`)).toBe(true);

    await settingsRepo(h.meta).set('system.publicOrigin', null as never);
    const sent = (await mail(h.meta)).length;
    const res = await ask('cy@example.com', 'evil.example');
    expect(res.statusCode).toBe(202);
    expect(await drain()).toBe(0);
    expect(await mail(h.meta)).toHaveLength(sent);
    const flagged = await h.meta.db.selectFrom('adminium_audit_log').select('action').where('action', '=', 'public.claim.link.no-address').execute();
    expect(flagged.length).toBeGreaterThan(0);
    await settingsRepo(h.meta).set('system.publicOrigin', PUBLIC_ORIGIN);
  });

  it.skipIf(!available)('sweeps decoys with every other challenge once they are two days old', async () => {
    const repo = publicChallengesRepo(h.meta);
    const all = async () => (await h.meta.db.selectFrom('adminium_public_challenges').select('id').where('purpose', '=', LINK_PURPOSE).execute()).length;
    expect(await all()).toBeGreaterThan(0);
    await repo.purgeBefore(Date.now() + 30 * 24 * 60 * 60_000);
    expect(await all()).toBe(0);
  });
});

describe('the sign-in link’s own rate rungs', () => {
  it('count per address whatever session is held, and apart from the claim rung', () => {
    const id = { keyId: 'k1', ip: '198.51.100.7', sessionId: 'pss_1' };
    expect(rateKeyFor('public-link', id)).toBe('public-link|pub:k1:ip:198.51.100.7');
    expect(rateKeyFor('public-link-verify', id)).toBe('public-link-verify|pub:k1:ip:198.51.100.7');
    const limiter = createPublicRateLimiter(() => 0);
    for (let i = 0; i < 60; i += 1) expect(limiter.hitKey('k1', 'claim').allowed).toBe(true);
    // The claim rung spent to the last request: links are still asked for, and opened.
    expect(limiter.hitKey('k1', 'claim').allowed).toBe(false);
    expect(limiter.hitKey('k1', 'link').allowed).toBe(true);
    expect(limiter.hitKey('k1', 'linkVerify').allowed).toBe(true);
  });
});
