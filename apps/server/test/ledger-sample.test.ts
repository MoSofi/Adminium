// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAMPLE ROWS AND A LEDGER'S RECEIPTS.
 *
 * A receipt names the row it was written for by text, which no foreign key
 * shows. "Remove sample data" must still see it: a sample row that a real
 * receipt names is kept, as one a real row points at is kept — taken out,
 * what was posted for it could never be given back. A receipt that is
 * itself one of the sample's rows goes with the sample, and keeps nothing.
 * Sample rows are brought in as history: adding them writes no receipt.
 */
import { snapshotsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleOwner } from '../src/apps/sample-data.js';
import { loadAddOnInstalls } from '../src/apps/table-ref.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

// The server refuses a table with a ledger's rules until every door knows them; this file is about the sample rows.
let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

/** The kit with sample rows: two accounts, two requests on them — and, when asked, a receipt of its own for one of the requests. */
function kit(withReceipt: boolean): { manifest: Record<string, unknown>; files: Record<string, string> } {
  const manifest = ledgerKitManifest();
  manifest['sampleData'] = { file: 'seeds/kit.sample.json' };
  const bundle = {
    format: 'adminium.sample/1',
    app: 'ledger-kit',
    tables: [
      { ref: 'accounts', rows: [{ '@label': 'flour', name: 'Flour', opening: '10.000' }, { '@label': 'salt', name: 'Salt', opening: '4.000' }] },
      // (A bundle lists a ledger's receipt table before the tables that ledger writes.)
      ...(withReceipt
        ? [{ ref: 'postings', rows: [{ source_table: { '@table': 'requests' }, source_row: '1', source_line: '', line_table: '', ledger: 'units', action: 'use', posting: 'request', phase: 'reserve', round: 1, state: 'planned', rows: 0, add_on_version: '1.0.0', origin: 'system', by: 'sample', at: '2026-01-01T00:00:00.000Z' }] }]
        : []),
      { ref: 'requests', rows: [{ '@label': 'first', account_id: { '@ref': 'flour' }, quantity: '1.000' }, { '@label': 'second', account_id: { '@ref': 'salt' }, quantity: '2.000' }] },
    ],
  };
  return { manifest, files: { ...ledgerKitFiles(manifest), 'seeds/kit.sample.json': JSON.stringify(bundle) } };
}

describe.each(LEGS)('sample rows and a ledger\'s receipts — %s', (dialect, available) => {
  const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
  async function installed(withReceipt = false): Promise<{ harness: Harness; service: ReturnType<typeof createSampleDataService>; owner: NonNullable<Awaited<ReturnType<typeof findSampleOwner>>> }> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    h = harness;
    const { manifest, files } = kit(withReceipt);
    await harness.stageAddOn(manifest, { files });
    const reply = await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.0.0', attachTo: [] } });
    expect(reply.statusCode, reply.body).toBe(200);
    // How a receipt names a table, as the server reads it from what is installed.
    const service = createSampleDataService({
      ...harness.sampleData,
      storedRefs: async (connectionId) => {
        const installs = await loadAddOnInstalls(harness.meta, async (id) => ((await snapshotsRepo(harness.meta).latest(id))?.schema as { tables: { id: string; name: string }[] } | undefined) ?? null);
        return (tableId) => installs.refOf(connectionId, tableId);
      },
    });
    const owner = (await findSampleOwner(harness.meta, 'ledger-kit', 'add-on'))!;
    await service.add(owner, { locale: 'en-US', userId: harness.owner.id, userLabel: 'owner@test' }).catch((error: unknown) => {
      throw new Error(`${(error as Error).message} ${JSON.stringify((error as { details?: unknown }).details)}`);
    });
    return { harness, service, owner };
  }
  const count = async (table: string) => Number((await h!.rows(`SELECT COUNT(*) AS n FROM ledger_kit_${table}`))[0]!['n']);
  const remove = (service: ReturnType<typeof createSampleDataService>, owner: NonNullable<Awaited<ReturnType<typeof findSampleOwner>>>) => service.remove(owner, { keepChanged: false, userId: h!.owner.id, userLabel: 'owner@test' });

  it.runIf(available)('adding sample rows writes no receipt, and with none naming them they all go', async () => {
    const { service, owner } = await installed();
    expect([await count('accounts'), await count('requests'), await count('postings')]).toEqual([2, 2, 0]);
    const removed = await remove(service, owner);
    expect(removed).toMatchObject({ removed: 4, kept: 0 });
    expect([await count('accounts'), await count('requests')]).toEqual([0, 0]);
  });

  it.runIf(available)('a sample row a real receipt names is kept — and so is the row it points at', async () => {
    const { service, owner } = await installed();
    const request = (await h!.rows('SELECT id, account_id FROM ledger_kit_requests ORDER BY id'))[0]!;
    // A hold somebody really made for the first sample request: its receipt names the request by text.
    await h!.rows(
      `INSERT INTO ledger_kit_postings (source_table, source_row, source_line, line_table, ledger, action, posting, phase, round, state, ${q('rows')}, add_on_version, origin, ${q('by')}, at) VALUES ('ledger-kit:requests', '${String(request['id'])}', '', '', 'units', 'use', 'request', 'reserve', 1, 'planned', 0, '1.0.0', 'staff', 'usr_1', '2026-02-02 10:00:00')`,
    );
    const removed = await remove(service, owner);
    // The request stays, and the account it is for; the other request and its account go.
    expect(removed).toMatchObject({ removed: 2, kept: 2 });
    expect((await h!.rows('SELECT id FROM ledger_kit_requests')).map((row) => String(row['id']))).toEqual([String(request['id'])]);
    expect((await h!.rows('SELECT id FROM ledger_kit_accounts')).map((row) => String(row['id']))).toEqual([String(request['account_id'])]);
    expect(await count('postings')).toBe(1);
  });

  it.runIf(available)('a line a real receipt names is kept the same way', async () => {
    const { service, owner } = await installed();
    const request = (await h!.rows('SELECT id FROM ledger_kit_requests ORDER BY id DESC'))[0]!;
    await h!.rows(
      `INSERT INTO ledger_kit_postings (source_table, source_row, source_line, line_table, ledger, action, posting, phase, round, state, ${q('rows')}, add_on_version, origin, ${q('by')}, at) VALUES ('somewhere:orders', '77', '${String(request['id'])}', 'ledger-kit:requests', 'units', 'use', 'line', 'reserve', 1, 'planned', 0, '1.0.0', 'staff', 'usr_1', '2026-02-02 10:00:00')`,
    );
    expect(await remove(service, owner)).toMatchObject({ kept: 2 });
    expect(await count('requests')).toBe(1);
  });

  it.runIf(available)('a bundle\'s own receipts go with it: a receipt that is a sample row keeps nothing', async () => {
    const { service, owner } = await installed(true);
    expect(await count('postings')).toBe(1);
    const removed = await remove(service, owner);
    expect(removed).toMatchObject({ removed: 5, kept: 0 });
    expect([await count('accounts'), await count('requests'), await count('postings')]).toEqual([0, 0, 0]);
  });
});
