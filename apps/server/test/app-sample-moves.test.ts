// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S SAMPLE ASKS AN ADD-ON FOR ITS STOCK.
 *
 * An app that keeps its goods in an add-on wants its own goods in its sample:
 * a furniture firm's desks, not the add-on's own sample of clinic supplies.
 * The things themselves are rows the file brings. What the add-on's ledger
 * keeps of them is never typed: the file asks for it with `moves`, each made
 * as a save of its own once the rows are in, so the add-on's own code plans
 * the rows and its totals are its own.
 *
 * Here, with the test ledger: a request brought as a draft is sent and then
 * done by two moves; the hold, the entry and the receipts the ledger wrote
 * are listed as the app's sample and leave with it, and the total they fed is
 * worked out again. A move the ledger refuses leaves nothing of the file.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { snapshotsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { loadDecider } from '../src/add-ons/decide.js';
import { createSampleDataService, findSampleApp, findSampleOwner, type SampleApp } from '../src/apps/sample-data.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { createWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { createLedgerRuntime } from '../src/ledgers/registry.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEDGER_KIT_SERVER, ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;
const KIT = 'ledger-kit';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

/** The kit, whose clerk may write a request by hand, with a sample of its own: one account that opened with ten. */
function kit() {
  const manifest = ledgerKitManifest() as Doc & { requiredSchema: { tables: (Doc & { ref: string; states?: Doc & { moves: Record<string, unknown[]> } })[] } };
  manifest['roles'] = [{ key: 'manager', name: 'Ledger manager', permissions: ['table:@requests:read', 'table:@requests:create', 'table:@requests:update'] }];
  // Marking a request done is anybody's here: what a move is judged by is its own subject, not a role's.
  const requests = manifest.requiredSchema.tables.find((table) => table.ref === 'requests')!;
  requests.states = { ...requests.states!, moves: { ...requests.states!.moves, sent: ['done', 'cancelled'] } };
  manifest['sampleData'] = { file: 'seeds/kit.sample.json' };
  const sample = { format: 'adminium.sample/1', app: KIT, tables: [{ ref: 'accounts', rows: [{ '@label': 'flour', name: 'Flour', opening: '10.000' }] }] };
  return { manifest, files: { ...ledgerKitFiles(manifest), 'seeds/kit.sample.json': JSON.stringify(sample) } };
}

const pk = { ref: 'id', type: 'int', role: 'pk' };

function shop(section: Doc) {
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
    requiredSchema: { tables: [{ ref: 'orders', columns: [pk, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] }] },
    sampleData: { file: 'seeds/shop.sample.json', addOns: { [KIT]: { file: 'seeds/shop.kit.sample.json' } } },
  };
  const files = {
    'seeds/shop.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', tables: [{ ref: 'orders', rows: [{ note: 'First order' }] }] }),
    'seeds/shop.kit.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', addOn: KIT, ...section }),
  };
  return { manifest, files };
}

/** Four units asked of the kit's own flour, brought as a draft and moved twice. */
const asks = (quantity: string, moves: Doc[] = [{ ref: 'first', to: 'sent' }, { table: 'requests', to: 'done' }]): Doc => ({
  tables: [{ ref: 'requests', rows: [{ '@label': 'first', account_id: { '@ref': 'flour' }, quantity }] }],
  moves,
});

const OPTS = { locale: 'en-US', userId: null, userLabel: 'test' };
const KEEP = { keepChanged: true, userId: null, userLabel: 'test' };
const count = async (harness: Harness, table: string, where = '1 = 1') => Number((await harness.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!['n']);

describe.each(LEGS)('an app\'s sample asks an add-on for its stock — %s', (dialect, available) => {
  async function world(section: Doc, opts: { noWrites?: boolean } = {}) {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    const made = shop(section);
    const theKit = kit();
    await harness.stageAddOn(theKit.manifest, { files: theKit.files, bundled: true });
    await harness.stageApp(made.manifest, made.files);
    const installed = await harness.install('shop', '0.3.0', { addOns: [{ key: KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    // The write service as the server wires it: the kept installs, the kit's real deciding file.
    const installs = keepAddOnInstalls(harness.meta, async () => parseDatabaseModel((await snapshotsRepo(harness.meta).latest(harness.connectionId))!.schema));
    const decider = loadDecider({ key: KIT, version: '1.0.0', path: 'dist/server.js', bytes: LEDGER_KIT_SERVER });
    const ledgers = createLedgerRuntime({
      installs: () => installs.current(),
      refresh: () => installs.fresh(),
      decider: (key) => (key === KIT ? decider : null),
      versionNow: async (key) => {
        const row = await harness.meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).executeTakeFirst();
        return row === undefined ? null : { version: row.version, status: row.status };
      },
    });
    await installs.fresh();
    const writes = createWriteService({ ...writeStores(harness.meta), ledgers });
    const service = createSampleDataService({ ...harness.sampleData, ...(opts.noWrites === true ? {} : { writes: () => writes }) });
    return { harness, service, app: (await findSampleApp(harness.meta, 'shop'))! as SampleApp, addOn: (await findSampleOwner(harness.meta, KIT, 'add-on'))! };
  }
  const there = async (harness: Harness) => ({
    requests: await count(harness, 'ledger_kit_requests'),
    done: await count(harness, 'ledger_kit_requests', "status = 'done'"),
    holds: await count(harness, 'ledger_kit_holds'),
    entries: await count(harness, 'ledger_kit_entries'),
    receipts: await count(harness, 'ledger_kit_postings'),
  });
  const flour = async (harness: Harness) => {
    const row = (await harness.rows('SELECT opening, taken, balance FROM ledger_kit_accounts'))[0]!;
    return [Number(row['opening']), Number(row['taken']), Number(row['balance'])];
  };

  it.runIf(available)('the moves are saves of their own: the add-on writes the hold, the entry and the receipts, and its total is its own', async () => {
    const w = await world(asks('4.000'));
    h = w.harness;
    await w.service.add(w.addOn, OPTS);
    const added = await w.service.add(w.app, OPTS);
    expect(added.counts).toEqual({ orders: 1, [`${KIT}:requests`]: 1, [`${KIT}:postings`]: 2, [`${KIT}:holds`]: 1, [`${KIT}:entries`]: 1 });
    const now = await there(h);
    expect(now).toEqual({ requests: 1, done: 1, holds: 1, entries: 1, receipts: 2 });
    expect(await count(h, 'ledger_kit_entries', 'receipt_id IS NOT NULL')).toBe(1);
    expect(Number((await h.rows('SELECT amount FROM ledger_kit_entries'))[0]!['amount'])).toBe(4);
    // Nobody typed the total: ten opened, four taken, six left.
    expect(await flour(h)).toEqual([10, 4, 6]);
    // Listed as the app's: the request it brought, and what the ledger wrote for it.
    const listed = (await w.service.status(w.app)).tables.map((table) => table.ref).sort();
    expect(listed).toEqual([`${KIT}:entries`, `${KIT}:holds`, `${KIT}:postings`, `${KIT}:requests`, 'orders']);
    // Asked again, nothing is loaded or moved twice.
    await w.service.add(w.app, OPTS).catch(() => undefined);
    expect(await there(h)).toEqual(now);
    expect(await flour(h)).toEqual([10, 4, 6]);
  });

  it.runIf(available)('what the ledger wrote leaves with the app\'s sample, the total it fed is worked out again, and the add-on\'s own sample still leaves whole', async () => {
    const w = await world(asks('4.000'));
    h = w.harness;
    await w.service.add(w.addOn, OPTS);
    await w.service.add(w.app, OPTS).catch(() => undefined);
    expect(await flour(h)).toEqual([10, 4, 6]);
    const removed = await w.service.remove(w.app, KEEP);
    expect(removed.kept).toBe(0);
    expect(await there(h)).toEqual({ requests: 0, done: 0, holds: 0, entries: 0, receipts: 0 });
    expect(await count(h, 'orders')).toBe(0);
    // The flour is the kit's own sample row: it stays, with nothing taken from it,
    expect(await flour(h)).toEqual([10, 0, 10]);
    // and still reads as the row the kit's sample wrote: it goes with that sample, kept by nothing.
    expect((await w.service.remove(w.addOn, KEEP)).kept).toBe(0);
    expect(await count(h, 'ledger_kit_accounts')).toBe(0);
  });

  it.runIf(available)('a move the ledger refuses leaves nothing of the file, and says why', async () => {
    // More than the flour holds: the kit refuses the hold.
    const w = await world(asks('400.000'));
    h = w.harness;
    await w.service.add(w.addOn, OPTS);
    const failed = await w.service.add(w.app, OPTS).then(
      () => null,
      (error: unknown) => error as Error & { details?: { reason?: string } },
    );
    // The app's own file is in whether its rows for the add-on went in with it or were refused after it.
    expect(await count(h, 'orders')).toBe(1);
    expect(await there(h)).toEqual({ requests: 0, done: 0, holds: 0, entries: 0, receipts: 0 });
    expect(await flour(h)).toEqual([10, 0, 10]);
    expect(failed).not.toBeNull();
    expect(failed!.message).toMatch(/a move they ask for was refused\. There is not enough left\./);
    expect(failed!.details?.reason).toBe('SAMPLE_MOVE_REFUSED');
    expect((await w.service.status(w.app)).tables.map((table) => table.ref)).toEqual(['orders']);
  });

  it.runIf(available)('a move the table does not allow is refused the same way: nothing of the file stays', async () => {
    // Draft straight to done: no such move.
    const w = await world(asks('4.000', [{ ref: 'first', to: 'done' }]));
    h = w.harness;
    await w.service.add(w.addOn, OPTS);
    await w.service.add(w.app, OPTS).catch(() => undefined);
    expect(await there(h)).toEqual({ requests: 0, done: 0, holds: 0, entries: 0, receipts: 0 });
    expect(await flour(h)).toEqual([10, 0, 10]);
  });

  it.runIf(available)('a server that cannot make moves writes none of the file', async () => {
    const w = await world(asks('4.000'), { noWrites: true });
    h = w.harness;
    await w.service.add(w.addOn, OPTS);
    await w.service.add(w.app, OPTS).catch(() => undefined);
    expect(await there(h)).toEqual({ requests: 0, done: 0, holds: 0, entries: 0, receipts: 0 });
    expect(await count(h, 'orders')).toBe(1);
  });
});
