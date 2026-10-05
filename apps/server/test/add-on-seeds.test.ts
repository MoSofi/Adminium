// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ROWS AN ADD-ON STARTS WITH are written once, by its install, into
 * tables that are empty: in the installing person's language, with the
 * tables' own rules already holding, and never over a row that is there.
 * Its settings table ends up with exactly one row.
 */
import { optionListsRepo, userPrefsRepo } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const pk = { ref: 'id', type: 'int', role: 'pk' };
/** The stock kit with units, reasons and a one-row settings table, and the rows each starts with. */
function seededKit(over: { reasons?: unknown[]; zone?: string } = {}): { manifest: Record<string, unknown>; files: Record<string, string> } {
  const kit = stockKitManifest() as Record<string, unknown> & { addOn: Record<string, unknown>; requiredSchema: { tables: unknown[] } };
  kit.addOn = { ...kit.addOn, settingsTable: 'settings' };
  kit.requiredSchema.tables.push(
    {
      ref: 'units',
      columns: [
        pk,
        { ref: 'name', type: 'text', maxLength: 40 },
        // A code Adminium makes: there only when the table's rules were written before its first row.
        { ref: 'code', type: 'text', maxLength: 12, nullable: true, rules: { code: { prefix: 'U-', length: 6 } } },
        { ref: 'zone', type: 'text', maxLength: 32, nullable: true, rules: { options: { list: 'zones' } } },
      ],
    },
    { ref: 'reasons', columns: [pk, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'unit_id', type: 'fk', references: 'units', nullable: true }] },
    { ref: 'settings', columns: [pk, { ref: 'low_at', type: 'int', default: 5 }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] },
  );
  kit['seeds'] = [
    {
      table: 'units',
      rows: [
        { '@label': 'each', name: { '@t': { 'en-US': 'Each', 'de-DE': 'Stück' } }, zone: over.zone ?? 'shelf' },
        { name: 'Box' },
      ],
    },
    { table: 'reasons', file: 'seeds/reasons.json' },
  ];
  return { manifest: kit, files: { 'seeds/reasons.json': JSON.stringify(over.reasons ?? [{ name: 'Damaged', unit_id: { '@ref': 'each' } }, { name: 'Found' }]) } };
}
const install = (harness: Harness) => harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
const source = async (harness: Harness) => (await harness.manager.data(harness.connectionId)).db as unknown as Kysely<unknown>;

describe.each(LEGS)('the rows an add-on starts with — %s', (dialect, available) => {
  async function staged(over: Parameters<typeof seededKit>[0] = {}): Promise<Harness> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    const kit = seededKit(over);
    await harness.stageAddOn(kit.manifest, { files: kit.files });
    return harness;
  }

  it.runIf(available)('are there after the install, in the installer\'s language, with the tables\' own rules holding', async () => {
    h = await staged();
    await userPrefsRepo(h.meta).set(h.owner.id, { locale: 'de_DE' });
    const reply = await install(h);
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json().seeds).toEqual({ units: 2, reasons: 2, settings: 1 });
    expect(reply.json().seedsKept).toEqual([]);
    const units = await h.rows('SELECT id, name, code, zone FROM stock_kit_units ORDER BY id');
    expect(units.map((row) => row['name'])).toEqual(['Stück', 'Box']);
    // Written after the rules: each row has the code its table makes.
    for (const row of units) expect(String(row['code'])).toMatch(/^U-[0-9A-Z]{6}$/);
    expect(units[0]!['zone']).toBe('shelf');
    const reasons = await h.rows('SELECT name, unit_id FROM stock_kit_reasons ORDER BY id');
    expect(reasons.map((row) => [row['name'], row['unit_id'] === null ? null : Number(row['unit_id'])])).toEqual([['Damaged', Number(units[0]!['id'])], ['Found', null]]);
    // The starting rows are the owner's from the first second: no list of sample rows is made for them.
    expect((await h.tableNames()).filter((name) => name.includes('sample'))).toEqual([]);
  });

  it.runIf(available)('the settings table has exactly one row, of defaults', async () => {
    h = await staged();
    expect((await install(h)).statusCode).toBe(200);
    const rows = await h.rows('SELECT low_at, note FROM stock_kit_settings');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!['low_at'])).toBe(5);
    expect(rows[0]!['note']).toBeNull();
  });

  it.runIf(available)('a refused row stops the install at its seeds with nothing written, and the same call finishes it', async () => {
    h = await staged({ zone: 'attic' });
    const first = await install(h);
    expect(first.statusCode, first.body).toBe(409);
    expect(first.json().error).toMatchObject({ code: 'ADD_ON_INSTALL_INCOMPLETE', details: { stage: 'seeds' } });
    // One transaction: the row before the refused one is not there either, nor a settings row.
    for (const table of ['units', 'reasons', 'settings']) expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM stock_kit_${table}`))[0]!['n']), table).toBe(0);
    // The owner adds the value the row needs; nothing else changes.
    const lists = optionListsRepo(h.meta);
    const zones = (await lists.findByKey('stock-kit-zones'))!;
    await lists.update('stock-kit-zones', { items: [...zones.items, { value: 'attic', label: 'Attic' }] } as never);
    const second = await install(h);
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().seeds).toEqual({ units: 2, reasons: 2, settings: 1 });
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_units'))[0]!['n'])).toBe(2);
  });

  it.runIf(available)('a table that already holds a row is left alone, and a row that points at one of its rows is left out with it', async () => {
    h = await staged({ zone: 'attic' });
    expect((await install(h)).statusCode).toBe(409);
    // Between the two calls the owner fills the units themselves, and writes a note in the settings.
    const db = await source(h);
    await sql`insert into stock_kit_units (name) values ('Pallet')`.execute(db);
    await sql`insert into stock_kit_settings (low_at, note) values (9, 'ours')`.execute(db);
    const again = await install(h);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().seeds).toEqual({ reasons: 1 });
    expect(again.json().seedsKept).toEqual(['units', 'settings']);
    expect((await h.rows('SELECT name FROM stock_kit_units')).map((row) => row['name'])).toEqual(['Pallet']);
    // "Damaged" named the unit "each", which was never written: it is left out; "Found" names nothing and is written.
    expect((await h.rows('SELECT name FROM stock_kit_reasons')).map((row) => row['name'])).toEqual(['Found']);
    const settings = await h.rows('SELECT low_at, note FROM stock_kit_settings');
    expect(settings.map((row) => [Number(row['low_at']), row['note']])).toEqual([[9, 'ours']]);
  });

  it.runIf(available)('a file that is not a list of rows, or names a row nobody wrote, stops the install at its seeds', async () => {
    h = await staged({ reasons: [{ name: 'Damaged', unit_id: { '@ref': 'nobody' } }] });
    const reply = await install(h);
    expect(reply.statusCode, reply.body).toBe(409);
    expect(reply.json().error.details).toMatchObject({ stage: 'seeds' });
    expect(reply.body).toContain('nobody');
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_units'))[0]!['n'])).toBe(0);
  });
});
