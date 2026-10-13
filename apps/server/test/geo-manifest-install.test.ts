// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A place and an area written in an app's manifest, on a real database of
 * each engine: the install makes the json columns and keeps the two rules,
 * the app's sample rows are read as any save is (a town by its id is filled
 * in from the place list), and every later write is held to the rules.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteContext } from '../src/crud/write-context.js';
import { readGeoValue } from '../src/geo/values.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const IMPORT: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
const CAIRO = { lat: 30.06263, lng: 31.24967, by: 'town', placeId: 360630, name: 'Cairo', country: 'EG' };
const TAHRIR = { lat: 30.0444, lng: 31.2357, by: 'exact' };
const SQUARE = { type: 'Polygon', coordinates: [[[31.2, 30.0], [31.3, 30.0], [31.3, 30.1], [31.2, 30.1], [31.2, 30.0]]] };

const SITES = {
  ref: 'sites',
  columns: [
    { ref: 'id', type: 'int', role: 'pk' },
    { ref: 'name', type: 'text', maxLength: 80 },
    { ref: 'spot', type: 'json', nullable: true, rules: { place: true } },
    { ref: 'zone', type: 'json', nullable: true, rules: { area: true } },
    // No rule: whatever JSON is given.
    { ref: 'notes', type: 'json', nullable: true },
  ],
};

const manifest = (): Record<string, unknown> => ({
  ...invoicingManifest([SITES]),
  compatibility: { minAdminiumVersion: '0.3.28' },
  maps: true,
  pages: [{ ref: 'studio-sites', template: 'page-crud', title: { key: 't', fallback: 'Sites' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'sites' } }],
  seeds: [{ table: 'sites', rows: [{ name: 'Cairo depot', spot: { placeId: 360630 }, zone: SQUARE }, { name: 'Tahrir kiosk', spot: { lat: 30.0444, lng: 31.2357 } }, { name: 'Nowhere yet' }] }],
});

const refusal = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return error as { code?: string; statusCode?: number; details?: { fields?: Record<string, { code: string }> } };
  }
  throw new Error('the save went through');
};

describe.each(LEGS)('a place and an area an app declares — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  const stored = async (where: string): Promise<Record<string, unknown>[]> =>
    (await h!.rows(`SELECT name, spot, zone FROM ${h!.real('sites')} WHERE ${where} ORDER BY id`)).map((row) => ({ name: row['name'], spot: readGeoValue(row['spot']), zone: readGeoValue(row['zone']) }));

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    w = await writerFor(h);
  }, 240_000);
  afterAll(async () => h?.close());

  it.skipIf(!available)('the install keeps both rules on json columns', () => {
    const table = w.view.model.tables.find((one) => one.name === h!.real('sites'))!;
    // SQLite has no JSON type: the install makes the column TEXT there, and the rule is what says it holds a place.
    const json = dialect === 'sqlite' ? 'text' : 'json';
    expect(table.columns.find((column) => column.name === 'spot')).toMatchObject({ logicalType: json, place: true });
    expect(table.columns.find((column) => column.name === 'zone')).toMatchObject({ logicalType: json, area: true });
    expect(table.columns.find((column) => column.name === 'notes')?.place).toBeUndefined();
    expect(w.targetOf('sites').table.columns.get('spot')?.geo).toBe('place');
    expect(w.targetOf('sites').table.columns.get('zone')?.geo).toBe('area');
  });

  it.skipIf(!available)('its sample rows are read as a save is: a town by its id is filled in from the list', async () => {
    expect(await stored('1 = 1')).toEqual([
      { name: 'Cairo depot', spot: CAIRO, zone: SQUARE },
      { name: 'Tahrir kiosk', spot: TAHRIR, zone: null },
      { name: 'Nowhere yet', spot: null, zone: null },
    ]);
  });

  it.skipIf(!available)('a save, a change and an import’s row are each held to the rules; a json column with no rule holds anything', async () => {
    const made = await w.create('sites', { name: 'By link', spot: 'https://www.openstreetmap.org/?mlat=30.0444&mlon=31.2357#map=12/30.1/31.3', zone: { type: 'Feature', geometry: SQUARE }, notes: { lat: 500, anything: ['goes'] } });
    expect(readGeoValue(made['spot'])).toEqual(TAHRIR);
    expect(readGeoValue(made['zone'])).toEqual(SQUARE);
    expect(readGeoValue(made['notes'])).toEqual({ lat: 500, anything: ['goes'] });

    expect(await refusal(w.create('sites', { name: 'Bad', spot: 'somewhere nice' }))).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 422, details: { fields: { spot: { code: 'place-unreadable' } } } });
    expect(await refusal(w.create('sites', { name: 'Bad', spot: { lat: 95, lng: 0 } }))).toMatchObject({ details: { fields: { spot: { code: 'place-out-of-range' } } } });
    expect(await refusal(w.create('sites', { name: 'Bad', zone: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] } }))).toMatchObject({ details: { fields: { zone: { code: 'area-unreadable' } } } });
    expect(await refusal(w.update('sites', made['id'], { spot: { placeId: 1 } }))).toMatchObject({ details: { fields: { spot: { code: 'place-unknown' } } } });
    await w.update('sites', made['id'], { spot: { placeId: 360630 } });
    expect((await stored(`id = ${String(made['id'])}`))[0]).toMatchObject({ spot: CAIRO, zone: SQUARE });

    const checked = await w.writes.check('create', w.targetOf('sites'), IMPORT, [{ name: 'A', spot: '30.0444,31.2357' }, { name: 'B', spot: 'https://maps.app.goo.gl/AbCdEf' }, { name: 'C', spot: '{"placeId": 360630}' }, { name: 'D', zone: 'not a shape' }], { capacity: 'unchecked' });
    expect(checked.issues).toEqual([null, { spot: { code: 'place-short-link' } }, null, { zone: { code: 'area-unreadable' } }]);
    expect(checked.rows[0]?.['spot']).toEqual(TAHRIR);
    expect(checked.rows[2]?.['spot']).toEqual(CAIRO);
  });
});
