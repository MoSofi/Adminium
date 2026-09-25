// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sign-in link an app's own email carries, minted by the outbox sender
 * at send time — on every engine this run can reach.
 *
 * It opens once, for the person the message is addressed to and only while
 * that is still their address; a place to land rides in the fragment only when
 * the app's customer side declares it; and it counts toward nobody's caps.
 */
import { settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encryptSecret } from '../src/config/secrets.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { emailSecretKey } from '../src/email/config.js';
import { addressKey } from '../src/public-api/claim-code.js';
import { solveProof } from '../src/public-api/proof.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import type { SignInLinkMinter } from '../src/outbox/sign-in-link.js';
import { createSignInLinkMinter, declaredRoute } from '../src/public-api/sign-in-link-minter.js';
import { SIGN_IN_LINK_JOB_KIND } from '../src/public-api/sign-in-link.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const BASE = 'https://portal.example.com';

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'clients',
        columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'contact_name', type: 'text', maxLength: 120 }, { ref: 'email', type: 'text', maxLength: 254, unique: true }],
      },
    ]),
    publicAccess: [{ table: 'clients', methods: ['GET'], select: ['contact_name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true }],
  };
}

describe('declared routes', () => {
  const routes = ['invoices/:number', '/home', 'proposals/:id/sign'];
  it('lets a link land only on a path the app declares', () => {
    expect(declaredRoute(routes, 'invoices/INV-2042')).toBe(true);
    expect(declaredRoute(routes, 'home')).toBe(true);
    expect(declaredRoute(routes, 'proposals/7/sign')).toBe(true);
    for (const to of ['admin', 'invoices', 'invoices/INV-1/extra', '//evil.example', 'https://evil.example', 'invoices/../admin', 'invoices/%2e%2e', 'invoices/a b', '']) {
      expect(declaredRoute(routes, to), to).toBe(false);
    }
  });
});

describe.each(LEGS)('the link an app’s email carries — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let minter: SignInLinkMinter;
  let ip = 0;
  let clients: string;
  const from = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const send = async (url: string, payload: Record<string, unknown>, proof = false) => {
    let extra: Record<string, string> = {};
    if (proof) {
      const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=claim', remoteAddress: from(), headers: served.headers() });
      const challenge = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
      extra = { 'x-adminium-proof': `${challenge.id}.${solveProof(challenge.salt, challenge.difficulty)}` };
    }
    return served.composed.app.inject({ method: 'POST', url: `/api/v1/public${url}`, remoteAddress: from(), headers: served.headers(undefined, extra), payload });
  };
  const tokenOf = (url: string) => /#([A-Za-z0-9_-]{43})/.exec(url)![1]!;
  const mint = (over: Partial<Parameters<SignInLinkMinter['mint']>[0]> = {}) =>
    minter.mint({ appKey: 'studio', connectionId: h.connectionId, table: clients, pk: { id: 1 }, email: 'ada@example.com', base: BASE, now: Date.now(), ...over });

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    await h.rows(`insert into ${h.real('clients')} (contact_name, email) values ('Ada Lovelace', 'Ada@Example.com')`);
    // The customer side's routes, as an app's manifest declares them.
    const row = await h.meta.db.selectFrom('adminium_manifests').selectAll().where('manifestKey', '=', 'studio').executeTakeFirstOrThrow();
    const document = (typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest) as { frontends: unknown[] };
    document.frontends = [...document.frontends, { side: 'customer', kind: 'spa', routes: { invoice: 'invoices/:number', home: 'home' } }];
    await h.meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify(document) as never }).where('id', '=', row.id).execute();
    await settingsRepo(h.meta).set('system.publicOrigin', 'https://studio.example.com');
    await settingsRepo(h.meta).set('email.smtp', {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
      from: 'Studio <no-reply@studio.test>',
      secure: false,
    } as never);
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
    const views = createPublicViews(h.meta);
    clients = (await views.viewFor(h.connectionId))!.table(h.real('clients')).id;
    minter = createSignInLinkMinter({ meta: h.meta, manager: h.manager, views, crypto: dsnCryptoFromSecret(TEST_SECRET), addressSecret: addressKey(TEST_SECRET) });
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('opens once, for that person, landing where the app declares', async () => {
    const url = await mint({ to: 'invoices/INV-2042' });
    expect(url).toMatch(new RegExp(`^${BASE}/c#[A-Za-z0-9_-]{43}&to=invoices/INV-2042$`));
    const token = tokenOf(url!);
    expect((await send('/claim/link/peek', { token })).json()).toEqual({ data: { firstName: 'Ada' } });
    const opened = await send('/claim/link/verify', { token });
    expect(opened.statusCode, opened.body).toBe(200);
    // A replay finds it used.
    const again = await send('/claim/link/verify', { token });
    expect(again.statusCode).toBe(410);
    expect(served.codeOf(again)).toBe('LINK_EXPIRED');
    // As the sender spells a place: with its leading slash.
    expect(await mint({ to: '/invoices/INV-7' })).toMatch(/#[A-Za-z0-9_-]{43}&to=invoices\/INV-7$/);
  });

  it.skipIf(!available)('lands nowhere undeclared, and is never a way off the app', async () => {
    for (const to of ['admin/secrets', '//evil.example', 'https://evil.example/x', 'invoices']) {
      const url = await mint({ to });
      expect(url, to).toMatch(new RegExp(`^${BASE}/c#[A-Za-z0-9_-]{43}$`));
    }
  });

  it.skipIf(!available)('mints nothing for another address, another row, or an app with no link identity', async () => {
    expect(await mint({ email: 'someone@example.com' })).toBeNull();
    expect(await mint({ pk: { id: 99 } })).toBeNull();
    expect(await mint({ pk: { other: 1 } })).toBeNull();
    expect(await mint({ appKey: 'nope' })).toBeNull();
    expect(await mint({ table: 'no_such_table' })).toBeNull();
  });

  it.skipIf(!available)('counts toward no caps, and still sends "a new link" to that link’s own address', async () => {
    for (let i = 0; i < 4; i += 1) expect(await mint()).not.toBeNull();
    // Four studio links later, Ada may still ask for her own.
    expect((await send('/claim/link', { email: 'ada@example.com' }, true)).statusCode).toBe(202);
    const expired = await mint();
    expect((await send('/claim/link/resend', { token: tokenOf(expired!) }, true)).statusCode).toBe(202);
    const jobs = await h.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', SIGN_IN_LINK_JOB_KIND).execute();
    const entry = served.composed.jobs.registry.get(SIGN_IN_LINK_JOB_KIND)!;
    for (const job of jobs) await entry.run(entry.schema.parse(typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload), {} as never);
    const mailed = await h.meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'email.send').execute();
    expect(mailed).toHaveLength(2);
  });

  it.skipIf(!available)('dies with the address it was minted for', async () => {
    const url = await mint();
    await h.rows(`update ${h.real('clients')} set email = 'ada@new.example.com' where id = 1`);
    expect(served.codeOf(await send('/claim/link/verify', { token: tokenOf(url!) }))).toBe('LINK_EXPIRED');
    expect(await mint()).toBeNull();
    expect(await mint({ email: 'ada@new.example.com' })).not.toBeNull();
  });
});
