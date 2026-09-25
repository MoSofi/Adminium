// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A held message's days read from an add-on's setting: the value the operator
 * saved, else the default the add-on declares. A fresh install whose ladder
 * nobody has saved yet dates its reminders by the add-on's own ladder, as the
 * write path's rules do — never "no days".
 */
import BetterSqlite3 from 'better-sqlite3';
import { addOnSettingsRepo, createSqliteMetaDb, firstRun, manifestsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { daysFor, settingReader } from '../src/outbox/timing.js';

const IDENTITY = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const LADDER = { setting: { addOn: 'invoices', setting: 'ladders' }, byColumn: 'ladder', index: 1 } as const;

let meta: MetaDb | undefined;
afterEach(async () => {
  await meta?.db.destroy();
  meta = undefined;
});

async function withInvoices(): Promise<MetaDb> {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await manifestsRepo(meta, IDENTITY).install({
    manifestKey: 'invoices',
    version: '1.1.0',
    kind: 'add-on',
    source: 'marketplace',
    document: {
      name: 'Invoices & Receipts',
      settings: [{ key: 'ladders', type: 'json', default: { gentle: [7, 21, 45], standard: [3, 14, 30] } }],
    },
  });
  return meta;
}

describe('the days of a held message, from an add-on’s setting', () => {
  it('uses the add-on’s declared default when nobody has saved one', async () => {
    const db = await withInvoices();
    const read = settingReader(db, undefined as never);
    expect(await daysFor(LADDER, { ladder: 'standard' }, read)).toBe(14);
    expect(await daysFor(LADDER, { ladder: 'gentle' }, read)).toBe(21);
  });

  it('uses the saved value over the default', async () => {
    const db = await withInvoices();
    await addOnSettingsRepo(db).patch('invoices', { ladders: { standard: [2, 9, 20] } }, [{ key: 'ladders', secret: false }], { updatedBy: null });
    expect(await daysFor(LADDER, { ladder: 'standard' }, settingReader(db, undefined as never))).toBe(9);
  });
});
