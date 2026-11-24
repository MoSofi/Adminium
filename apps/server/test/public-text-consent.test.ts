// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S OWN BOXES FOR TEXTS, over the public API of a shop installed by
 * the real installer, on SQLite, Postgres and MySQL:
 *
 *  - The customer's own page (a change, through an entry that cannot change
 *    their number) carries two boxes, one per class, each its own column,
 *    wording and version: a tick of each records its own yes, for the number
 *    on their row.
 *  - Signed in by the link mailed to them, their fresh yes replaces their own
 *    earlier no for the app. It never lifts a STOP: their Prefs read
 *    "stopped", lifted by their START.
 *  - A first booking nobody is linked to yet keeps its yes on the booking:
 *    the app's texts to that number count it.
 *  - Whether texts can come at all, as a plain flag any key may read; the
 *    standing only for a verified session.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseDatabaseModel } from '@adminium/engine';
import { SMS_WORDS_FLOOR } from '@adminium/manifest';
import { snapshotsRepo } from '@adminium/meta';

import { publicEntryRefs, servedPublicEntries } from '../src/apps/manifest-public.js';
import { appOfRow } from '../src/sms/app-of-row.js';
import { createTextConsentService, type TextConsentService } from '../src/sms/consent/index.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));

type Doc = Record<string, unknown>;

const SERVICE = { version: 2, text: { 'en-US': 'Text me when my order is ready.' } };
const OFFERS = { version: 1, text: { 'en-US': 'Text me offers now and then.' } };
const INES = '+4915123456781';
const NORA = '+4915123456782';
const PIA = '+4915123456783';
const BEA = '+4915123456784';

function textShop(): Doc {
  const manifest = shopManifest({
    entries: (entries) =>
      entries
        .map((entry) =>
          entry['table'] === 'customers' && entry['key'] === undefined
            ? {
                ...entry,
                // Their own page: the boxes, never the number.
                writable: ['name', 'may_text', 'offers'],
                textConsent: [
                  { column: 'may_text', phone: 'phone', class: 'service', wording: SERVICE },
                  { column: 'offers', phone: 'phone', class: 'marketing', wording: OFFERS },
                ],
              }
            : entry,
        )
        // A first booking: anybody, linked to a customer only once the desk knows them.
        .concat([
          {
            table: 'bookings',
            methods: ['POST'],
            humanCheck: true,
            level: 'verified',
            select: ['id'],
            writable: ['mobile', 'texts_ok'],
            claimedBy: { table: 'customers', column: 'customer_id', optional: true },
            anonymous: { perValue: { columns: ['mobile'], n: 5 } },
            textConsent: { column: 'texts_ok', phone: 'mobile', class: 'service', wording: SERVICE },
          },
        ]),
  });
  const tables = (manifest['requiredSchema'] as { tables: Doc[] }).tables;
  const customers = tables.find((table) => table['ref'] === 'customers')!;
  (customers['columns'] as Doc[]).push({ ref: 'may_text', type: 'bool', default: false }, { ref: 'offers', type: 'bool', default: false });
  tables.push({
    ref: 'bookings',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
      { ref: 'mobile', type: 'text', maxLength: 32, nullable: true },
      { ref: 'texts_ok', type: 'bool', default: false },
    ],
  });
  manifest['people'] = [{ table: 'customers', kind: 'people', email: 'email', name: 'name', phone: 'phone' }];
  (manifest['outbox'] as Doc)['classes'] = { 'order-placed': 'service' };
  manifest['compatibility'] = { minAdminiumVersion: SMS_WORDS_FLOOR };
  return manifest;
}

describe.each(LEGS)('a person\'s own boxes for texts — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let texts: TextConsentService;
  let customersId = '';
  let bookingsId = '';
  const refs: Record<string, string> = {};

  beforeAll(async () => {
    if (!available) return;
    const manifest = textShop();
    h = await installInvoicing(dialect, manifest);
    await mailReady(h.meta);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    g = guest(shop, h);
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    customersId = model.tables.find((table) => table.name === h.real('customers'))!.id;
    bookingsId = model.tables.find((table) => table.name === h.real('bookings'))!.id;
    const served = servedPublicEntries(manifest as never);
    const names = Object.fromEntries(['customers', 'orders', 'bookings', 'settings', 'order_items'].map((ref) => [ref, h.real(ref)]));
    publicEntryRefs(served, names).forEach((ref, at) => {
      const entry = served[at]!;
      if (entry.key === undefined && !(entry.table in refs)) refs[entry.table] = ref;
    });
    texts = createTextConsentService({ meta: h.meta, secret: TEST_SECRET, appOf: appOfRow(h.meta) });
    for (const [name, email, phone] of [['Ines', 'ines@fieldmail.io', INES], ['Nora', 'nora@fieldmail.io', NORA], ['Pia', 'pia@fieldmail.io', PIA]] as const) {
      await h.rows(`insert into ${h.real('customers')} (email, name, phone) values ('${email}', '${name}', '${phone}')`);
    }
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await shop.close();
    await h.close();
  });

  const customer = async (email: string) => (await h.rows(`select * from ${h.real('customers')} where email = '${email}'`))[0]!;
  const asked = (phone: string, purpose: 'service' | 'marketing' = 'service', record?: { table: string; key: string }) =>
    texts.decide({ phone, country: 'DE', class: purpose, sender: { kind: 'number' }, repliesReachUs: true, scope: { app: 'shop', ...(record === undefined ? {} : { record: { connectionId: h.connectionId, ...record } }) } });
  const tick = async (email: string, values: Doc) => {
    const session = await g.signIn(email);
    const row = await customer(email);
    const res = await g.request('PATCH', `/records/${refs['customers']!}/${String(row['id'])}`, { session, payload: { values } });
    return { res, session, row };
  };

  it.skipIf(!available)('two boxes on their own page: each its own yes, words and version, for the number on their row they may not change', async () => {
    const { res, session, row } = await tick('ines@fieldmail.io', { may_text: true, offers: true });
    expect(res.statusCode, res.body).toBe(200);
    const person = { connectionId: h.connectionId, table: customersId, key: String(row['id']) };
    expect((await texts.standing({ phone: INES, country: 'DE', person }, 'text-service')).event).toMatchObject({ state: 'yes', source: 'form', wording: SERVICE.text['en-US'], wordingVersion: 'v2 en-US' });
    expect((await texts.standing({ phone: INES, country: 'DE', person }, 'text-marketing')).event).toMatchObject({ state: 'yes', source: 'form', wording: OFFERS.text['en-US'], wordingVersion: 'v1 en-US' });
    expect(await asked(INES)).toMatchObject({ send: true });
    // Their own Prefs read it, for the number their row holds.
    const standing = await g.request('GET', '/texts/standing', { session });
    expect(standing.statusCode, standing.body).toBe(200);
    expect((standing.json() as { data: Doc }).data).toMatchObject({ ready: false, masked: '+49 ••• 781', service: { state: 'yes' }, marketing: { state: 'yes' }, stopped: null });
    expect(standing.body).not.toContain(INES);
    // Their number is still not theirs to change here.
    const moved = await g.request('PATCH', `/records/${refs['customers']!}/${String(row['id'])}`, { session, payload: { values: { phone: NORA } } });
    expect(moved.statusCode).toBeGreaterThanOrEqual(400);
  });

  it.skipIf(!available)('signed in, their fresh yes replaces their own earlier no for the app', async () => {
    const row = await customer('nora@fieldmail.io');
    const person = { connectionId: h.connectionId, table: customersId, key: String(row['id']) };
    await texts.record({ phone: NORA, person, purpose: 'text-service', state: 'no', source: 'person', detail: 'prefs' });
    expect(await asked(NORA)).toMatchObject({ send: false, reason: 'no-consent' });
    const { res, session } = await tick('nora@fieldmail.io', { may_text: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(await asked(NORA)).toMatchObject({ send: true });
    expect(((await g.request('GET', '/texts/standing', { session })).json() as { data: Doc }).data).toMatchObject({ service: { state: 'yes' } });
  });

  it.skipIf(!available)('a STOP stands: their yes records nothing, and their Prefs say stopped, lifted by their START', async () => {
    await texts.stop.add({ phone: PIA, reason: 'text-stop' });
    const before = (await texts.history({ phone: PIA, country: 'DE' })).length;
    const { res, session } = await tick('pia@fieldmail.io', { may_text: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(await texts.history({ phone: PIA, country: 'DE' })).toHaveLength(before);
    expect(await asked(PIA)).toMatchObject({ send: false, reason: 'stopped' });
    const standing = (await g.request('GET', '/texts/standing', { session })).json() as { data: Doc };
    expect(standing.data).toMatchObject({ service: { state: 'stopped' }, stopped: { reason: 'text-stop', liftBy: 'start' } });
  });

  it.skipIf(!available)('a first booking nobody is linked to yet keeps its yes on the booking, and the app\'s texts to that number count it', async () => {
    const made = await g.request('POST', `/records/${refs['bookings']!}`, { payload: { values: { mobile: BEA, texts_ok: true } }, proof: 'write' });
    expect(made.statusCode, made.body).toBe(201);
    const booking = (await h.rows(`select id, customer_id from ${h.real('bookings')} where mobile = '${BEA}'`))[0]!;
    expect(booking['customer_id']).toBeNull();
    expect((await texts.standing({ phone: BEA, country: 'DE' }, 'text-service')).event).toMatchObject({ state: 'yes', person: { table: bookingsId, key: String(booking['id']) } });
    // The desk links her later: the customer the booking becomes has that number, and the app's texts count her yes.
    await h.rows(`insert into ${h.real('customers')} (email, name, phone) values ('bea@fieldmail.io', 'Bea', '${BEA}')`);
    const bea = await customer('bea@fieldmail.io');
    expect(await asked(BEA, 'service', { table: customersId, key: String(bea['id']) })).toMatchObject({ send: true });
  });

  it.skipIf(!available)('a verified person\'s yes for a number their row does not hold never replaces that number\'s no', async () => {
    const OTHER = '+4915123456785';
    await texts.record({ phone: OTHER, purpose: 'text-service', state: 'no', source: 'person', detail: 'prefs' });
    const session = await g.signIn('nora@fieldmail.io');
    const made = await g.request('POST', `/records/${refs['bookings']!}`, { session, payload: { values: { mobile: OTHER, texts_ok: true } }, proof: 'write' });
    expect(made.statusCode, made.body).toBe(201);
    expect((await texts.standing({ phone: OTHER, country: 'DE' }, 'text-service')).state).toBe('no');
  });

  it.skipIf(!available)('whether texts can come is a plain flag for any key; the standing only for a verified session', async () => {
    const ready = await g.request('GET', '/texts');
    expect(ready.statusCode, ready.body).toBe(200);
    expect(ready.json()).toEqual({ data: { ready: false } });
    expect((await g.request('GET', '/texts/standing')).statusCode).toBeGreaterThanOrEqual(400);
  });
});
