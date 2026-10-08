// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OFFERS' SAMPLE DATA, ADDED BY THE REAL LOADER — AND THE OVERVIEW OVER IT.
 *
 * The sample is a month of history written as it stands, with nothing posted
 * and no price asked. Every figure a fresh install shows is then a total
 * Adminium adds up: uses into their discount and their code, card rows into a
 * balance, vouchers into their batch, a pack's uses into what it has left.
 * This suite adds the sample on each database, reads those totals from the
 * stored columns, and then asks every card of the Overview as the dashboard
 * asks it.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { queryDescriptorSchema } from '@adminium/engine/config';
import { overridesRepo, pagesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleOwner } from '../../../src/apps/sample-data.js';
import { applyOverrides } from '../../../src/connections/effective-schema.js';
import { SnapshotView } from '../../../src/crud/identifiers.js';
import { resolveLookups } from '../../../src/crud/lookups.js';
import { compileWidgetQuery } from '../../../src/widget-data/compiler.js';
import { groupLabelSourceOf, groupLabelsFor } from '../../../src/widget-data/group-labels.js';
import { shapeRows } from '../../../src/widget-data/shapers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { installCustomerKey } from '../../../src/public-api/customer-key.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';

const offers = builtAddOn('offers');
const sampleFile = (offers?.manifest['sampleData'] as { file?: string } | undefined)?.file;
const n = (value: unknown): number => Number(value);
const money = (value: unknown): string => n(value).toFixed(2);
const yes = (value: unknown): boolean => value === true || n(value) === 1;

describe.skipIf(offers === null)('Offers, as it is built', () => {
  it('ships the sample file its manifest names', () => {
    expect(sampleFile).toBe('seeds/offers.sample.json');
    expect(Object.keys(offers?.files ?? {})).toContain(sampleFile);
  });
});

describe.each(LEGS)("Offers' sample data — %s", (dialect, available) => {
  const run = available && offers !== null && sampleFile !== undefined;
  let w: Writing;
  let counts: Record<string, number>;
  const t = (ref: string) => w.real(ref);
  const rows = (sql: string): Promise<Record<string, unknown>[]> => w.h.rows(sql);

  beforeAll(async () => {
    // The server says its secret as it starts; a key that stands for an address is made under it.
    installCustomerKey('a secret only this test server knows, long enough');
    if (!run) return;
    w = await writing(await installBuilt(dialect, offers));
    counts = (await createSampleDataService(w.h.sampleData).add((await findSampleOwner(w.h.meta, 'offers', 'add-on'))!, { locale: 'en-US', userId: w.h.owner.id, userLabel: 'owner@test' })).counts;
  }, 600_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('writes every row but the settings row, which the install already made', async () => {
    expect(counts).toEqual({ groups: 3, group_members: 6, reasons: 4, ceilings: 2, offers: 6, offer_targets: 2, codes: 3, voucher_batches: 1, vouchers: 206, voucher_actions: 9, gift_cards: 12, card_ledger: 21, redemptions: 171, applied: 260 });
    expect(await rows(`select id from ${t('settings')}`)).toHaveLength(1);
    // Nothing was posted and nothing was sent: no receipt, no hand action on a card, no message.
    for (const ref of ['postings', 'card_actions', 'messages']) expect(await rows(`select id from ${t(ref)}`), ref).toHaveLength(0);
  });

  it.skipIf(!run)('each discount holds its uses and what it gave, added up from the uses; Launch week is used up and still active', async () => {
    const stored = await rows(`select name, status, uses, given, used_up, max_uses from ${t('offers')} order by id`);
    expect(stored.map((row) => `${String(row['name'])} ${String(n(row['uses'] ?? 0))} / ${money(row['given'] ?? 0)}`)).toEqual(['Welcome 10 41 / 117.48', 'Monday mugs 9 / 22.50', 'Tote pair 6 / 90.00', 'Autumn 5 20 / 100.00', 'Launch week 50 / 280.20', 'Summer close-out 0 / 0.00']);
    const launch = stored.find((row) => row['name'] === 'Launch week')!;
    expect(launch['status']).toBe('active');
    expect(yes(launch['used_up'])).toBe(true);
    expect((await rows(`select code, uses from ${t('codes')} order by id`)).map((row) => `${String(row['code'])} ${String(n(row['uses'] ?? 0))}`)).toEqual(['WELCOME10 41', 'AUTUMN5 20', 'LAUNCH20 50']);
    // A name kept by language is still a name in each.
    const named = (await rows(`select public_name from ${t('offers')} where name = 'Welcome 10'`))[0]!['public_name'];
    const names = (typeof named === 'string' ? JSON.parse(named) : named) as Record<string, string>;
    expect(names['en-US']).toBe('10 % off your first order');
    expect(Object.keys(names)).toHaveLength(8);
  });

  it.skipIf(!run)('each of the twelve cards and credits holds the sum of its ledger rows: $455.25 owed', async () => {
    const cards = await rows(`select id, kind, label, status, balance from ${t('gift_cards')} order by id`);
    expect(cards).toHaveLength(12);
    for (const card of cards) {
      const [sum] = await rows(`select coalesce(sum(taken), 0) as taken, count(*) as c from ${t('card_ledger')} where card_id = ${String(card['id'])}`);
      // A card nothing was ever written to has no balance worked out; it holds nothing.
      expect(money(card['balance'] ?? 0), String(card['label'])).toBe(money(-n(sum!['taken'])));
    }
    // (Adminium makes a code for every row of a column that keeps one, a credit's too: nobody is shown it, and a credit is named by what it is.)
    expect(cards.map((card) => `${card['kind'] === 'credit' ? 'Credit' : String(card['label'])} ${money(card['balance'] ?? 0)}`)).toEqual(['Q4XP 19.00', '2HVT 35.75', 'WN6C 0.00', '8KJD 50.00', 'R2MC 50.00', 'T7QF 62.00', 'NP3H 100.00', '6VXQ 0.00', 'K4WD 100.00', '9MXR 0.00', 'Credit 22.00', 'Credit 16.50']);
    expect(money(cards.filter((card) => card['status'] === 'active').reduce((total, card) => total + n(card['balance'] ?? 0), 0))).toBe('455.25');
  });

  it.skipIf(!run)('the batch counts its 200 vouchers and the 23 used; the packs have six of ten and none of five left', async () => {
    const [batch] = await rows(`select name, count, made, used, to_make from ${t('voucher_batches')}`);
    expect(`${String(batch!['name'])} ${String(n(batch!['made']))} ${String(n(batch!['used']))}`).toBe('Leaflet drop, October 200 23');
    const packs = await rows(`select public_name, uses_total, uses_left, status from ${t('vouchers')} where worth = 'pack' order by id`);
    expect(packs.map((row) => `${String(row['public_name'])} ${String(n(row['uses_left']))} of ${String(n(row['uses_total']))} ${String(row['status'])}`)).toEqual(['10 classes 6 of 10 issued', '5 car washes 0 of 5 used']);
    expect((await rows(`select name, members from ${t('groups')} order by id`)).map((row) => `${String(row['name'])} ${String(n(row['members'] ?? 0))}`)).toEqual(['Newsletter 3', 'Regulars 2', 'Wholesale 1']);
  });

  it.skipIf(!run)('the Overview shows the sample to the cent: every card, asked as the dashboard asks', async () => {
    const page = (await pagesRepo(w.h.meta).findBySlug(w.h.connectionId, 'offers-overview'))!;
    const findLayout = (value: unknown): { items: { i: string; config: { binding?: unknown } }[] } | null => {
      if (typeof value !== 'object' || value === null) return null;
      const node = value as Record<string, unknown>;
      if (Array.isArray(node['items']) && node['version'] === 1) return node as never;
      for (const child of Object.values(node)) {
        const found = findLayout(child);
        if (found !== null) return found;
      }
      return null;
    };
    const layout = findLayout(page.config)!;
    expect(layout.items.map((item) => item.i)).toEqual(['owed', 'given', 'uses', 'issued', 'spent', 'discounts', 'staff', 'cards', 'batches', 'packs', 'activity']);
    const model = parseDatabaseModel((await snapshotsRepo(w.h.meta).latest(w.h.connectionId))!.schema);
    const view = new SnapshotView(w.h.connectionId, applyOverrides(model, await overridesRepo(w.h.meta).listForConnection(w.h.connectionId, { status: 'active' })), new Map());
    const { db, dialect: engine } = await w.h.manager.data(w.h.connectionId);
    const now = new Date();
    const cards: Record<string, Record<string, unknown>> = {};
    for (const item of layout.items) {
      const descriptor = queryDescriptorSchema.parse(item.config.binding);
      const table = view.table(view.model.tables.find((candidate) => candidate.name === descriptor.source.name)!.id);
      const lookups = await resolveLookups({ view, table, raw: descriptor.lookups ?? [], canReadPii: true, canReadTable: async () => true });
      const groupLabel = await groupLabelSourceOf({ path: descriptor.groupLabel, groupColumn: descriptor.groupBy?.[0], table, view, canReadPii: true, canReadTable: async () => true });
      const compiled = compileWidgetQuery({ db: db as never, view, descriptor, params: {}, canReadPii: true, dialect: engine, now: () => now, timezone: 'UTC', lookups, groupLabel });
      const found = (await compiled.query.execute()) as Record<string, unknown>[];
      const priorRows = compiled.prior === null ? undefined : ((await compiled.prior.execute()) as Record<string, unknown>[]);
      const groupLabels = await groupLabelsFor({ path: descriptor.groupLabel, compiled, rows: found, view, db: db as never, canReadPii: true, canReadTable: async () => true });
      cards[item.i] = shapeRows({ compiled, rows: found, priorRows, canReadPii: true, groupLabels }) as unknown as Record<string, unknown>;
    }
    const figure = (card: string) => n(cards[card]!['value']);
    // The five tiles: owed now; given, used, issued and spent last month.
    expect([money(figure('owed')), money(figure('given')), String(figure('uses')), money(figure('issued')), money(figure('spent'))]).toEqual(['455.25', '667.66', '126', '505.00', '238.05']);
    // Discounts last month, most given first; and what staff gave, by the reason they picked.
    const ranked = (card: string) => (cards[card] as unknown as { items: { label: string; value: number }[] }).items.map((item) => `${item.label} ${money(item.value)}`);
    expect(ranked('discounts')).toEqual(['Launch week 280.20', 'Welcome 10 117.48', 'Autumn 5 100.00', 'Tote pair 90.00', 'Monday mugs 22.50']);
    expect(ranked('staff')).toEqual(['Damaged 24.10', 'Staff purchase 21.98', 'Goodwill 11.40']);
    // The six largest balances, in the sample's order.
    const listed = (card: string) => (cards[card] as unknown as { rows: Record<string, unknown>[] }).rows;
    expect(listed('cards').map((row) => `${String(row['label'])} ${money(row['balance'])}`)).toEqual(['NP3H 100.00', 'K4WD 100.00', 'T7QF 62.00', '8KJD 50.00', 'R2MC 50.00', '2HVT 35.75']);
    expect(listed('batches').map((row) => `${String(row['name'])} ${String(n(row['used']))} of ${String(n(row['count']))}`)).toEqual(['Leaflet drop, October 23 of 200']);
    expect(listed('packs').map((row) => `${String(row['public_name'])} ${String(n(row['uses_left']))} of ${String(n(row['uses_total']))}`)).toEqual(['10 classes 6 of 10']);
    // The last six card rows, newest first: a card by its last four, a credit by what it is.
    expect(listed('activity').map((row) => `${row['what'] === 'credit' ? 'credit' : String(row['card'])} ${String(row['kind'])} ${money(row['amount'])}`)).toEqual(['6VXQ void -30.00', 'T7QF spend -88.00', 'R2MC refund 9.80', 'R2MC spend -9.80', 'K4WD issue 100.00', 'credit spend -20.00']);
  });

  it.skipIf(!run)('a sample card works like any card: it pays what it holds, and a sample code is found when it is looked up', async () => {
    // Twenty-five put on the card ending 8KJD by a manager's hand: it holds seventy-five.
    const [card] = await rows(`select id from ${t('gift_cards')} where label = '8KJD'`);
    await w.create('card_actions', { card_id: card!['id'], action: 'top_up', amount: '25.00', reason: 'A top-up at the desk', paid_by: 'cash' });
    expect(money((await w.one('gift_cards', card!['id']))['balance'])).toBe('75.00');
    // A pack of the sample, used once more by hand: five left.
    const [pack] = await rows(`select id from ${t('vouchers')} where public_name = '10 classes'`);
    await w.create('voucher_actions', { voucher_id: pack!['id'], action: 'use' });
    expect(n((await w.one('vouchers', pack!['id']))['uses_left'])).toBe(5);
  });
});
