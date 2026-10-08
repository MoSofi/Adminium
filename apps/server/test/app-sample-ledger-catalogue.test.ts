// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S SAMPLE ROWS THAT LINK ITS ROWS TO AN ADD-ON'S — "this visit type
 * offers the flu kit". The add-on's ledger may write such a row itself (its
 * `adopt` makes one), but it is catalogue, not history: no total adds it up.
 * So an app's file may hold it, beside rows of the app's own that link in.
 *
 * The two kinds load together and once, name no receipt, are listed as the
 * app's, leave whole with the app's sample — and leave before the add-on's
 * own sample does, when they name a row of it. What a ledger counts stays the
 * ledger's: a file that holds any of it is refused whole.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp, findSampleOwner, type SampleApp } from '../src/apps/sample-data.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const KIT = 'ledger-kit';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

/** The kit with every action saying what it writes — so its `things`, written by `adopt` alone, are catalogue — and a sample of its own. */
function kit() {
  const manifest = ledgerKitManifest() as Doc & { addOn: { ledgers: { actions: Record<string, Doc> }[] } };
  for (const action of Object.values(manifest.addOn.ledgers[0]!.actions)) action['writes'] ??= ['entries', 'holds'];
  manifest['sampleData'] = { file: 'seeds/kit.sample.json' };
  const sample = { format: 'adminium.sample/1', app: KIT, tables: [{ ref: 'accounts', rows: [{ '@label': 'flour', name: 'Flour', opening: '10.000' }] }] };
  return { manifest, files: { ...ledgerKitFiles(manifest), 'seeds/kit.sample.json': JSON.stringify(sample) } };
}

const link = (table: string) => ({ addOnLink: { addOn: KIT, table } });
const pk = { ref: 'id', type: 'int', role: 'pk' };

/** A shop whose picks say which of the kit's things a visit offers, and which account it is taken from. */
function shop(section: { tables: unknown[] }) {
  const manifest = {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.3.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.18' },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    addOns: { suggests: [{ key: KIT, range: '>=1.0.0', reason: { 'en-US': 'Keeps units.' } }] },
    requiredSchema: {
      tables: [
        { ref: 'orders', columns: [pk, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] },
        {
          ref: 'picks',
          columns: [pk, { ref: 'note', type: 'text', maxLength: 80, nullable: true }, { ref: 'thing_id', type: 'int', nullable: true, rules: link('things') }, { ref: 'account_id', type: 'int', nullable: true, rules: link('accounts') }],
        },
      ],
    },
    sampleData: { file: 'seeds/shop.sample.json', addOns: { [KIT]: { file: 'seeds/shop.kit.sample.json' } } },
  };
  const files = {
    'seeds/shop.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', tables: [{ ref: 'orders', rows: [{ note: 'First order' }] }] }),
    'seeds/shop.kit.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', addOn: KIT, ...section }),
  };
  return { manifest, files };
}

/** A thing of the kit's that the shop offers, and the shop's own pick of it, from the kit's own sample account. */
const BOTH = {
  tables: [
    { ref: 'things', rows: [{ '@label': 'shop-flu-kit', name: 'Flu kit' }] },
    { ref: 'picks', own: true, rows: [{ note: 'The nurse offers it', thing_id: { '@ref': 'shop-flu-kit' }, account_id: { '@ref': 'flour' } }] },
  ],
};

const service = (harness: Harness) => createSampleDataService(harness.sampleData);
const OPTS = { locale: 'en-US', userId: null, userLabel: 'test' };
const KEEP = { keepChanged: true, userId: null, userLabel: 'test' };
const count = async (harness: Harness, table: string, where = '1 = 1') => Number((await harness.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!['n']);

describe.each(LEGS)('an app\'s sample rows of a table a ledger writes beside its books — %s', (dialect, available) => {
  async function world(section: { tables: unknown[] }): Promise<{ harness: Harness; app: SampleApp; addOn: SampleApp }> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    const made = shop(section);
    const theKit = kit();
    await harness.stageAddOn(theKit.manifest, { files: theKit.files, bundled: true });
    await harness.stageApp(made.manifest, made.files);
    const installed = await harness.install('shop', '0.3.0', { addOns: [{ key: KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    return { harness, app: (await findSampleApp(harness.meta, 'shop'))!, addOn: (await findSampleOwner(harness.meta, KIT, 'add-on'))! };
  }
  /** What is there of the two kinds, and of the ledger's books. */
  const there = async (harness: Harness) => ({
    things: await count(harness, 'ledger_kit_things'),
    picks: await count(harness, 'picks'),
    linked: await count(harness, 'picks', 'thing_id IS NOT NULL AND account_id IS NOT NULL'),
    receipts: await count(harness, 'ledger_kit_postings'),
    entries: await count(harness, 'ledger_kit_entries'),
    named: await count(harness, 'ledger_kit_things', 'receipt_id IS NOT NULL'),
  });

  it.runIf(available)('both kinds wait for the add-on\'s sample they name, load together, once, and name no receipt', async () => {
    const w = await world(BOTH);
    h = w.harness;
    // The pick names the kit's own "flour": the whole file waits for the kit's sample.
    expect((await service(h).add(w.app, OPTS)).counts).toEqual({ orders: 1 });
    expect(await there(h)).toMatchObject({ things: 0, picks: 0 });
    await service(h).add(w.addOn, OPTS);
    expect(await there(h)).toEqual({ things: 1, picks: 1, linked: 1, receipts: 0, entries: 0, named: 0 });
    // The pick points at the thing and the account that were written.
    const pick = (await h.rows('SELECT thing_id, account_id FROM picks'))[0]!;
    expect(Number(pick['thing_id'])).toBe(Number((await h.rows('SELECT id FROM ledger_kit_things'))[0]!['id']));
    expect(Number(pick['account_id'])).toBe(Number((await h.rows('SELECT id FROM ledger_kit_accounts'))[0]!['id']));
    // Listed as the app's: the thing under the add-on's name, the pick under its own.
    const status = await service(h).status(w.app);
    expect(status.tables.map((table) => table.ref).sort()).toEqual([`${KIT}:things`, 'orders', 'picks']);
    expect((await service(h).status(w.addOn)).tables.map((table) => table.ref)).toEqual(['accounts']);

    // Asked again, by either door, nothing is loaded twice.
    await service(h).add(w.app, OPTS).catch(() => undefined);
    await service(h).add(w.addOn, OPTS).catch(() => undefined);
    expect(await there(h)).toEqual({ things: 1, picks: 1, linked: 1, receipts: 0, entries: 0, named: 0 });
  });

  it.runIf(available)('they leave whole with the app\'s sample, and the add-on\'s own sample stays', async () => {
    const w = await world(BOTH);
    h = w.harness;
    await service(h).add(w.addOn, OPTS);
    await service(h).add(w.app, OPTS);
    expect(await there(h)).toMatchObject({ things: 1, picks: 1, linked: 1 });
    const removed = await service(h).remove(w.app, KEEP);
    expect(removed).toMatchObject({ removed: 3, kept: 0 });
    expect(await there(h)).toMatchObject({ things: 0, picks: 0 });
    expect(await count(h, 'orders')).toBe(0);
    expect(await count(h, 'ledger_kit_accounts')).toBe(1);
    // And they come back with it.
    await service(h).add(w.app, OPTS);
    expect(await there(h)).toMatchObject({ things: 1, picks: 1, linked: 1 });
  });

  it.runIf(available)('they leave before the add-on\'s own sample, whose row they name: both kinds, and nothing is left pointing at a row that is gone', async () => {
    const w = await world(BOTH);
    h = w.harness;
    await service(h).add(w.addOn, OPTS);
    await service(h).add(w.app, OPTS);
    const removed = await service(h).remove(w.addOn, KEEP);
    expect(removed.kept).toBe(0);
    expect(await count(h, 'ledger_kit_accounts')).toBe(0);
    expect(await there(h)).toMatchObject({ things: 0, picks: 0 });
    // The shop's own sample is still in, and its file loads again when the kit's sample is back.
    expect(await count(h, 'orders')).toBe(1);
    await service(h).add(w.addOn, OPTS);
    expect(await there(h)).toMatchObject({ things: 1, picks: 1, linked: 1 });
  });

  it.runIf(available)('a file with rows of the app\'s own only is a section all the same: loaded once, and gone before the add-on\'s sample it names', async () => {
    const w = await world({ tables: [BOTH.tables[1]!].map((table) => ({ ...table, rows: [{ note: 'From the flour', account_id: { '@ref': 'flour' } }] })) });
    h = w.harness;
    await service(h).add(w.addOn, OPTS);
    await service(h).add(w.app, OPTS);
    expect(await there(h)).toMatchObject({ things: 0, picks: 1 });
    // The add-on's sample asked for again, and the app's: the file is in, and is not read in a second time.
    await service(h).add(w.addOn, OPTS).catch(() => undefined);
    await service(h).add(w.app, OPTS).catch(() => undefined);
    expect(await there(h)).toMatchObject({ picks: 1 });
    expect((await service(h).remove(w.addOn, KEEP)).kept).toBe(0);
    expect(await there(h)).toMatchObject({ picks: 0 });
    expect(await count(h, 'ledger_kit_accounts')).toBe(0);
    expect(await count(h, 'orders')).toBe(1);
  });

  it.runIf(available)('a file that holds what the ledger counts is refused whole: nothing of it is written', async () => {
    const w = await world({ tables: [...BOTH.tables, { ref: 'entries', rows: [{ account_id: { '@ref': 'flour' }, amount: '2.000', kind: 'use' }] }] });
    h = w.harness;
    await service(h).add(w.addOn, OPTS).catch(() => undefined);
    await service(h).add(w.app, OPTS).catch(() => undefined);
    expect(await there(h)).toMatchObject({ things: 0, picks: 0, entries: 0, receipts: 0 });
  });
});
