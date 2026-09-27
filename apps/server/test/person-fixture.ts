// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A shop that finds its guests by the address they type — an order's own
 * link, a guest's sign-in by an emailed link, "delete my details", bank
 * details for signed-in guests only — installed through the real installer,
 * and the requests a test makes of it over the public API.
 */
import { publicChallengesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { expect } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { solveProof } from '../src/public-api/proof.js';
import { SIGN_IN_LINK_JOB_KIND } from '../src/public-api/sign-in-link.js';
import { invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import type { Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, ...more });

export const PUBLIC_ORIGIN = 'https://shop.example.com';

/** The shop's tables and public entries; `more` changes or adds entries. */
export function shopManifest(opts: { orders?: Record<string, unknown>; entries?: (entries: Record<string, unknown>[]) => Record<string, unknown>[] } = {}): Record<string, unknown> {
  const manifest = invoicingManifest([
    // The venue's bank details: the app's own, not a person's.
    { ref: 'settings', columns: [id, text('bank_name', 80, { nullable: true, rules: { personal: false } }), text('account_number', 34, { nullable: true, rules: { personal: false } })] },
    {
      ref: 'customers',
      columns: [
        id,
        text('email', 254, { nullable: true, unique: true, rules: { normalize: 'email', validation: { format: 'email' } } }),
        text('name', 60, { nullable: true }),
        text('phone', 32, { nullable: true }),
        { ref: 'forgotten_at', type: 'timestamptz', nullable: true },
      ],
    },
    {
      ref: 'orders',
      columns: [
        id,
        { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
        text('email', 254, { rules: { validation: { format: 'email' } } }),
        text('name', 120),
        text('note', 200, { nullable: true }),
        { ref: 'status', type: 'enum', enum: ['placed', 'ready', 'collected'], default: 'placed' },
        text('link_token', 16, { nullable: true, rules: { code: { length: 16 } } }),
        { ref: 'link_stopped', type: 'bool', default: false },
        text('client_key', 64, { nullable: true, unique: true }),
        { ref: 'item_count', type: 'int', nullable: true, rules: { rollup: { from: 'order_items', via: 'order_id', count: true } } },
        ...((opts.orders?.['columns'] as Record<string, unknown>[] | undefined) ?? []),
      ],
    },
    { ref: 'order_items', columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, text('dish', 60), { ref: 'qty', type: 'int', default: 1, rules: { validation: { min: 1, max: 20 } } }] },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: ['order-placed'] },
        { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        text('to', 254, { nullable: true }),
        text('error', 500, { nullable: true }),
        { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
        { ref: 'order_id', type: 'fk', references: 'orders', nullable: true },
      ],
    },
  ]);
  manifest['key'] = 'shop';
  (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicKeys'] = { link: {} };
  const entries: Record<string, unknown>[] = [
    {
      table: 'customers',
      methods: ['GET', 'PATCH'],
      select: ['name', 'email'],
      writable: ['name'],
      claim: { verify: 'email-link', email: 'email' },
      humanCheck: true,
      forget: { columns: ['email', 'name', 'phone'], stamp: 'forgotten_at' },
    },
    { table: 'orders', methods: ['GET'], level: 'verified', claimedBy: { table: 'customers', column: 'customer_id' }, select: ['id', 'email', 'name', 'note', 'status'] },
    {
      table: 'orders',
      methods: ['POST'],
      humanCheck: true,
      level: 'verified',
      select: ['id', 'status', 'item_count'],
      writable: ['email', 'name', 'note', 'client_key'],
      requires: ['email', 'name'],
      claimedBy: { table: 'customers', column: 'customer_id', optional: true },
      identity: { table: 'customers', email: 'email', link: 'customer_id', fill: { name: 'name' } },
      shareLink: 'link_token',
      anonymous: { perValue: { columns: ['email'], n: 10 } },
      children: { order_items: { via: 'order_id', writable: ['dish', 'qty'], select: ['id', 'dish', 'qty'], max: 10 } },
      dryRun: true,
      clientKey: 'client_key',
    },
    { table: 'settings', methods: ['GET'], level: 'verified', select: ['bank_name', 'account_number'] },
    {
      table: 'orders',
      key: 'link',
      methods: ['GET', 'PATCH'],
      select: ['id', 'status', 'email', 'name', 'note'],
      writable: ['note'],
      claim: { by: 'token', column: 'link_token', stopped: 'link_stopped', own: true, address: 'email' },
    },
    { table: 'order_items', key: 'link', methods: ['GET'], level: 'verified', visibleWith: { table: 'orders', via: 'order_id' }, select: ['id', 'dish', 'qty'] },
    { table: 'settings', key: 'link', methods: ['GET'], level: 'verified', select: ['bank_name', 'account_number'] },
  ];
  manifest['publicAccess'] = opts.entries === undefined ? entries : opts.entries(entries);
  manifest['outbox'] = {
    table: 'messages',
    columns: { kind: 'kind', status: 'status', to: 'to', error: 'error' },
    links: { customer: 'customer_id', order: 'order_id' },
    recipient: { via: 'customer_id', table: 'customers', email: 'email', name: 'name', fallback: { via: 'order_id', email: 'email', name: 'name' } },
    kinds: { 'order-placed': 'shop-order-placed' },
    producers: [{ kind: 'order-placed', link: 'order_id', onCreate: { table: 'orders' } }],
  };
  manifest['emailTemplates'] = [
    {
      key: 'shop-order-placed',
      name: 'Order placed',
      locales: { 'en-US': { subject: 'Your order', blocks: [{ block: 'email.text', data: { text: 'Your order: {{manage_url}}#{{order.link_token}}' } }] } },
    },
  ];
  return manifest;
}

/** Mail set up, and the app's own public address: sign-in links and the app's emails can go. */
export async function mailReady(meta: MetaDb): Promise<void> {
  await settingsRepo(meta).set('system.publicOrigin', PUBLIC_ORIGIN);
  await settingsRepo(meta).set('email.smtp', {
    host: 'localhost',
    port: 587,
    user: 'postmaster',
    passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
    from: 'Shop <no-reply@shop.test>',
    secure: false,
  } as never);
}

/** Mail queued so far: who it went to, its template and text. */
export async function mailOf(meta: MetaDb): Promise<{ template: string; to: string; subject: string; text: string; html: string }[]> {
  const jobs = await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute();
  return jobs.map((job) => {
    const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { templateKey: string; envelope: string };
    const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string; html?: string };
    return { template: payload.templateKey, to: envelope.to, subject: envelope.subject, text: envelope.text, html: envelope.html ?? '' };
  });
}

/** Requests of one served key, each from its own address, with a fresh human check where one is asked. */
export function guest(served: Served, h: InvoicingHarness, first = 1) {
  let ip = first;
  const from = () => {
    ip += 1;
    return `10.${String((ip >> 16) & 255)}.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const proof = async (purpose: 'write' | 'claim') => {
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/challenge?purpose=${purpose}`, remoteAddress: from(), headers: served.headers() });
    const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return `${c.id}.${solveProof(c.salt, c.difficulty)}`;
  };
  const request = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    opts: { payload?: Record<string, unknown>; session?: string; proof?: 'write' | 'claim'; address?: string } = {},
  ) =>
    served.composed.app.inject({
      method,
      url: `/api/v1/public${url}`,
      remoteAddress: opts.address ?? from(),
      headers: served.headers(opts.session, opts.proof === undefined ? {} : { 'x-adminium-proof': await proof(opts.proof) }),
      ...(opts.payload === undefined ? {} : { payload: opts.payload }),
    });
  /** Run the sign-in link jobs the requests queued, as the worker would. */
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
  /** A verified session for the person with this address: a link asked for, emailed, and pressed. */
  const signIn = async (email: string): Promise<string> => {
    const asked = await request('POST', '/claim/link', { payload: { email }, proof: 'claim' });
    expect(asked.statusCode, asked.body).toBe(202);
    await drain();
    const sent = (await mailOf(h.meta)).filter((m) => m.template === 'sign-in-link' && m.to === email).at(-1);
    expect(sent, `no sign-in link went to ${email}`).toBeDefined();
    const token = /\/c#([A-Za-z0-9_-]{43})/.exec(sent!.text + sent!.html)![1]!;
    const opened = await request('POST', '/claim/link/verify', { payload: { token } });
    expect(opened.statusCode, opened.body).toBe(200);
    return (opened.json() as { data: { session: string } }).data.session;
  };
  return { request, from, proof, drain, signIn };
}

/** Every open sign-in link of an address, on any key. */
export async function openLinksOf(meta: MetaDb, subject: string, keyId: string): Promise<number> {
  return (await publicChallengesRepo(meta).openLinks(subject, keyId, Date.now())).length;
}
