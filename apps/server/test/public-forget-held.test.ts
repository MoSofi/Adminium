// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "DELETE MY DETAILS" ON WHAT A PERSON STILL HOLDS, on every engine, as the
 * person themselves and as the staff erasure.
 *
 *  - a pack or card with no value left loses their name, address, key and the
 *    address on its mail; its amounts stay;
 *  - one with value left keeps them and is marked, and the reply counts it;
 *  - the daily sweep empties a kept row once its value ends;
 *  - a gift they bought for somebody else, somebody else's row, and a row that
 *    only holds their typed address stay as they are on the public door.
 */
import { validateManifest } from '@adminium/manifest';
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { sweepKeptHolders } from '../src/privacy/held-values.js';
import { installedCustomerKey } from '../src/public-api/customer-key.js';
import { addOnHarness, addOnManifest, type Harness } from './app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const WALLET = 'wallet';
const LEA = 'lea@fieldmail.io';
const MAX = 'max@fieldmail.io';
const DAY = 86_400_000;
const dayFrom = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Doc = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });

function wallet(over: { passes?: Doc } = {}): Doc {
  return addOnManifest(WALLET, {
    compatibility: { minAdminiumVersion: '0.3.71', requires: [] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'passes',
          holders: { live: { status: 'status', open: ['issued'], left: 'uses_left', until: 'expires_on' }, people: [{ email: 'holder_email', name: 'holder_name', key: 'holder_key', forgotten: 'holder_forgotten' }] },
          ...over.passes,
          columns: [
            pk,
            { ref: 'status', type: 'enum', enum: ['issued', 'used', 'expired', 'voided'], default: 'issued' },
            { ref: 'uses_left', type: 'int', nullable: true },
            { ref: 'expires_on', type: 'date', nullable: true },
            text('holder_email', 254),
            text('holder_key', 64, { rules: { customerKey: { of: 'holder_email' } } }),
            text('holder_name', 80),
            { ref: 'holder_forgotten', type: 'bool', default: false },
          ],
        },
        {
          ref: 'cards',
          holders: {
            live: { status: 'status', open: ['inactive', 'active'], waiting: ['inactive'], left: 'balance', until: 'expires_on' },
            people: [{ email: 'recipient_email', name: 'recipient_name', sale: { table: 'source_table', row: 'source_row' }, forgotten: 'recipient_forgotten' }],
          },
          columns: [
            pk,
            { ref: 'status', type: 'enum', enum: ['inactive', 'active', 'void', 'expired'], default: 'inactive' },
            { ref: 'balance', type: 'money', scale: 2, nullable: true },
            { ref: 'expires_on', type: 'date', nullable: true },
            text('recipient_email', 254),
            text('recipient_name', 80),
            { ref: 'source_table', type: 'text', maxLength: 96, default: '', rules: { tableRef: true } },
            { ref: 'source_row', type: 'text', maxLength: 64, default: '' },
            { ref: 'recipient_forgotten', type: 'bool', default: false },
          ],
        },
        {
          ref: 'mail',
          columns: [
            pk,
            { ref: 'kind', type: 'enum', enum: ['note'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            text('error', 500),
            { ref: 'pass_id', type: 'fk', references: 'passes', nullable: true },
            { ref: 'card_id', type: 'fk', references: 'cards', nullable: true },
          ],
        },
      ],
    },
    outbox: {
      table: 'mail',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error' },
      links: { pass: 'pass_id', card: 'card_id' },
      recipient: { via: 'pass_id', table: 'passes', email: 'holder_email', name: 'holder_name' },
      kinds: { note: 'wallet-note' },
      classes: { note: 'service' },
      producers: [{ kind: 'note', link: 'pass_id', onCreate: { table: 'passes' } }],
    },
    emailTemplates: [{ key: 'wallet-note', name: 'Note', locales: { 'en-US': { subject: 'Your pass', blocks: [{ block: 'email.text', data: { text: 'Your pass.' } }] } } }],
  });
}

describe('the word', () => {
  it('is taken on an add-on table that declares it fully', () => {
    const checked = validateManifest(wallet());
    expect(checked.ok, JSON.stringify(checked).slice(0, 700)).toBe(true);
  });

  it('needs the release that reads it', () => {
    const manifest = wallet();
    (manifest['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.70';
    const checked = validateManifest(manifest);
    expect(checked.ok).toBe(false);
    expect(JSON.stringify(checked)).toContain('table.holders');
  });

  it('refuses a key that is not the keyed hash of the address, and a person nothing links', () => {
    const noLink = wallet({ passes: { holders: { live: { status: 'status', open: ['issued'], left: 'uses_left' }, people: [{ email: 'holder_email', forgotten: 'holder_forgotten' }] } } });
    expect(JSON.stringify(validateManifest(noLink))).toContain('nothing links this person');
    const wrongKey = wallet({ passes: { holders: { live: { status: 'status', open: ['issued'], left: 'uses_left' }, people: [{ email: 'holder_name', key: 'holder_key', forgotten: 'holder_forgotten' }] } } });
    expect(JSON.stringify(validateManifest(wrongKey))).toContain('customerKey');
  });

  it('refuses a table the law keeps', () => {
    const kept = wallet({ passes: { keep: { law: 'tax' } } });
    expect(JSON.stringify(validateManifest(kept))).toContain('law keeps');
  });
});

describe.each(LEGS)('what a forgotten person still holds — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let g: ReturnType<typeof guest>;
  let reply: { keptBalances?: number; giftsNotLinked?: boolean };
  let cookie = '';

  const pass = async (id: number) => (await h.rows(`select * from wallet_passes where id = ${String(id)}`))[0]!;
  const card = async (id: number) => (await h.rows(`select * from wallet_cards where id = ${String(id)}`))[0]!;
  const flag = (value: unknown) => value === true || value === 1 || value === '1';
  const privacy = (url: string, payload: Doc) => served.composed.app.inject({ method: 'POST', url: `/api/v1/privacy/${url}`, headers: { cookie }, payload });

  beforeAll(async () => {
    if (!available) return;
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = WALLET;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const shop = shopManifest();
    (shop['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.71';
    (shop['outbox'] as Doc)['classes'] = { 'order-placed': 'service' };
    shop['frontends'] = [{ side: 'staff', kind: 'none' }];
    await h.stageApp(shop);
    const installed = await h.install('shop', String(shop['version']));
    expect(installed.statusCode, installed.body).toBe(200);
    const keyId = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    await h.stageAddOn(wallet());
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: WALLET, version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    await mailReady(h.meta);
    served = await servePublic(h as never, keyId, { ADMINIUM_DATA_DIR: h.dataDir });
    g = guest(served, h as never);
    await h.rows(`insert into shop_customers (id, email, name) values (1, '${LEA}', 'Lea Stone'), (2, '${MAX}', 'Max Bell')`);
    await h.rows(`insert into shop_orders (id, customer_id, email, name) values (1, 1, '${LEA}', 'Lea Stone'), (2, 2, '${MAX}', 'Max Bell')`);
    await h.rows(`insert into shop_order_items (id, order_id, dish) values (1, 1, 'Gift'), (2, 1, 'Gift'), (3, 1, 'Gift'), (4, 2, 'Gift')`);
    const leaKey = installedCustomerKey(h.connectionId, LEA);
    const maxKey = installedCustomerKey(h.connectionId, MAX);
    const passRow = (id: number, status: string, left: number, until: string, email: string, key: string | null, name: string) =>
      `(${String(id)}, '${status}', ${String(left)}, '${until}', '${email}', ${key === null ? 'NULL' : `'${key}'`}, '${name}')`;
    await h.rows(
      'insert into wallet_passes (id, status, uses_left, expires_on, holder_email, holder_key, holder_name) values ' +
        [
          passRow(1, 'issued', 3, dayFrom(60), LEA, leaKey, 'Lea Stone'),
          passRow(2, 'used', 0, dayFrom(60), LEA, leaKey, 'Lea Stone'),
          passRow(3, 'issued', 2, dayFrom(-10), LEA, leaKey, 'Lea Stone'),
          passRow(4, 'issued', 5, dayFrom(60), MAX, maxKey, 'Max Bell'),
          passRow(5, 'issued', 5, dayFrom(60), LEA, null, 'Typed By Someone'),
          passRow(6, 'issued', 1, dayFrom(60), LEA, leaKey, 'Lea Stone'),
        ].join(', '),
    );
    const cardRow = (id: number, status: string, balance: number, email: string, name: string, line: number) => `(${String(id)}, '${status}', ${String(balance)}, '${dayFrom(60)}', '${email}', '${name}', 'shop:order_items', '${String(line)}')`;
    await h.rows(
      'insert into wallet_cards (id, status, balance, expires_on, recipient_email, recipient_name, source_table, source_row) values ' +
        [
          cardRow(1, 'active', 10, LEA, 'Lea Stone', 1),
          cardRow(2, 'void', 0, LEA, 'Lea Stone', 2),
          cardRow(3, 'active', 20, MAX, 'Max Bell', 3),
          cardRow(4, 'active', 5, LEA, 'Lea From Max', 4),
        ].join(', '),
    );
    await h.rows(`insert into wallet_mail (id, kind, status, to_address, pass_id) values (1, 'note', 'sent', '${LEA}', 2), (2, 'note', 'queued', '${LEA}', 2), (3, 'note', 'sent', '${LEA}', 1)`);
    const admin = await usersRepo(h.meta).create({ email: 'admin@fieldmail.io', name: 'Admin', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(h.meta).assignToUser(admin.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin@fieldmail.io', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
    const session = await g.signIn(LEA);
    const gone = await g.request('DELETE', '/account', { session });
    expect(gone.statusCode, gone.body).toBe(200);
    reply = (gone.json() as { data: typeof reply }).data;
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('says how many it kept, as a number and nothing else', () => {
    expect(reply).toEqual({ keptBalances: 3, giftsNotLinked: true });
  });

  it.skipIf(!available)('keeps a live pack whole and marks it, so its holder can still spend it', async () => {
    const row = await pass(1);
    expect([row['holder_email'], row['holder_name'], row['holder_key']]).toEqual([LEA, 'Lea Stone', installedCustomerKey(h.connectionId, LEA)]);
    expect(flag(row['holder_forgotten'])).toBe(true);
    expect(Number(row['uses_left'])).toBe(3);
  });

  it.skipIf(!available)('empties a pack used up or past its day, and leaves its amounts', async () => {
    for (const id of [2, 3]) {
      const row = await pass(id);
      expect([row['holder_email'], row['holder_name'], row['holder_key']]).toEqual([null, null, null]);
      expect(flag(row['holder_forgotten'])).toBe(true);
    }
    expect(Number((await pass(3))['uses_left'])).toBe(2);
  });

  it.skipIf(!available)("takes the address off the mail about an emptied row, skips one still waiting, and leaves a kept row's", async () => {
    const mail = await h.rows('select id, status, to_address from wallet_mail order by id');
    expect(mail.map((row) => [row['status'], row['to_address']])).toEqual([['sent', null], ['skipped', null], ['sent', LEA]]);
  });

  it.skipIf(!available)("leaves another person's pack, and a row that only holds their typed address", async () => {
    expect((await pass(4))['holder_email']).toBe(MAX);
    expect(flag((await pass(4))['holder_forgotten'])).toBe(false);
    const typed = await pass(5);
    expect([typed['holder_email'], typed['holder_name']]).toEqual([LEA, 'Typed By Someone']);
    expect(flag(typed['holder_forgotten'])).toBe(false);
  });

  it.skipIf(!available)('reaches a card through their own purchase: kept with a balance, emptied without', async () => {
    const live = await card(1);
    expect(live['recipient_email']).toBe(LEA);
    expect(flag(live['recipient_forgotten'])).toBe(true);
    const dead = await card(2);
    expect([dead['recipient_email'], dead['recipient_name']]).toEqual([null, null]);
    expect(dead['status']).toBe('void');
  });

  it.skipIf(!available)('leaves a gift they bought for somebody else, and a card somebody else bought for them', async () => {
    const gift = await card(3);
    expect([gift['recipient_email'], gift['recipient_name']]).toEqual([MAX, 'Max Bell']);
    expect(flag(gift['recipient_forgotten'])).toBe(false);
    const theirs = await card(4);
    expect([theirs['recipient_email'], theirs['recipient_name']]).toEqual([LEA, 'Lea From Max']);
    expect(flag(theirs['recipient_forgotten'])).toBe(false);
  });

  it.skipIf(!available)('tells them, in the mail, what stays and what it could not reach', async () => {
    const sent = (await mailOf(h.meta)).filter((one) => one.template === 'details-deleted' && one.to === LEA).at(-1);
    expect(sent?.text).toContain('Number kept: 3.');
    expect(sent?.text).toContain('If someone else bought you a gift card');
  });

  it.skipIf(!available)('the daily sweep leaves a row with value and empties it once its value ends', async () => {
    const quiet = await sweepKeptHolders({ meta: h.meta, manager: h.manager });
    expect(quiet).toEqual({});
    expect((await pass(1))['holder_email']).toBe(LEA);
    await h.rows(`update wallet_passes set uses_left = 0, status = 'used' where id = 1`);
    await h.rows(`update wallet_cards set status = 'expired' where id = 1`);
    expect(await sweepKeptHolders({ meta: h.meta, manager: h.manager })).toEqual({ 'wallet:passes': 1, 'wallet:cards': 1 });
    const row = await pass(1);
    expect([row['holder_email'], row['holder_name'], row['holder_key']]).toEqual([null, null, null]);
    expect((await card(1))['recipient_email']).toBeNull();
    expect((await h.rows('select to_address from wallet_mail where id = 3'))[0]!['to_address']).toBeNull();
    // A second run has nothing to do, and an unmarked row is never swept.
    expect(await sweepKeptHolders({ meta: h.meta, manager: h.manager })).toEqual({});
    expect((await pass(4))['holder_email']).toBe(MAX);
  });

  it.skipIf(!available)('a row past its last day is emptied by the sweep even before its status moves', async () => {
    await h.rows(`update wallet_passes set expires_on = '${dayFrom(-5)}' where id = 6`);
    expect(await sweepKeptHolders({ meta: h.meta, manager: h.manager })).toEqual({ 'wallet:passes': 1 });
    expect((await pass(6))['holder_email']).toBeNull();
  });

  it.skipIf(!available)('the staff erasure keeps what has value, empties what has none, and reaches a card by its address', async () => {
    await h.rows(`insert into wallet_passes (id, status, uses_left, expires_on, holder_email, holder_key, holder_name) values (7, 'issued', 2, '${dayFrom(60)}', '${MAX}', '${installedCustomerKey(h.connectionId, MAX)}', 'Max Bell'), (8, 'voided', 2, '${dayFrom(60)}', '${MAX}', '${installedCustomerKey(h.connectionId, MAX)}', 'Max Bell')`);
    const previewed = await privacy('erase/preview', { address: MAX });
    expect(previewed.statusCode, previewed.body).toBe(200);
    const stays = (previewed.json() as { data: { stays: { kind: string; reason: string; count: number }[] } }).data.stays;
    expect(stays.filter((item) => item.kind === 'held-values').map((item) => [item.reason, item.count]).sort()).toEqual([['live-balance', 1], ['live-balance', 2]]);
    const erased = await privacy('erase', { address: MAX, confirm: MAX });
    expect(erased.statusCode, erased.body).toBe(200);
    const counts = (erased.json() as { data: { counts: Record<string, number> } }).data.counts;
    expect(counts['held-kept']).toBe(3);
    expect(counts['held-emptied']).toBe(1);
    expect((await pass(7))['holder_email']).toBe(MAX);
    expect(flag((await pass(7))['holder_forgotten'])).toBe(true);
    expect((await pass(8))['holder_email']).toBeNull();
    const gift = await card(3);
    expect(gift['recipient_email']).toBe(MAX);
    expect(flag(gift['recipient_forgotten'])).toBe(true);
  });

  describe('when the holder changes address', () => {
    const holder = async (id: number, email: string) => {
      await h.rows(`insert into shop_customers (id, email, name) values (${String(id)}, '${email}', 'Nora Vale')`);
      await h.rows(
        `insert into wallet_passes (id, status, uses_left, expires_on, holder_email, holder_key, holder_name) values (${String(id)}, 'issued', 4, '${dayFrom(60)}', '${email}', '${installedCustomerKey(h.connectionId, email)}', 'Nora Vale')`,
      );
    };
    const moved = async (id: number, to: string) => {
      const row = await pass(id);
      expect([row['holder_email'], row['holder_key']]).toEqual([to, installedCustomerKey(h.connectionId, to)]);
      expect(Number(row['uses_left'])).toBe(4);
    };

    it.skipIf(!available)('a pack goes with them when the desk corrects it, and the old mailbox holds nothing', async () => {
      await holder(31, 'nora.old@fieldmail.io');
      const customers = (await loadSnapshotView(h.meta, h.connectionId)).model.tables.find((table) => table.name === 'shop_customers')!.id;
      const patched = await served.composed.app.inject({ method: 'PATCH', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(customers)}/31`, headers: { cookie }, payload: { values: { email: 'nora.new@fieldmail.io' } } });
      expect(patched.statusCode, patched.body).toBe(200);
      await moved(31, 'nora.new@fieldmail.io');
    });
  });
});
