// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LINK THE SETTINGS FILL, AND WHAT IS COPIED THROUGH IT.
 *
 * A new item with no unit chosen takes the settings' default unit, and
 * carries that unit's code beside it. Both are decided in the one save: the
 * link is filled first, then what is copied through it. It used to be the
 * other way round — the copy ran while the link was still empty, so the row
 * was saved with a unit and no code.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(): Record<string, unknown> {
  return invoicingManifest([
    { ref: 'units', columns: [id, { ref: 'code', type: 'text', maxLength: 12 }, { ref: 'places', type: 'int', default: 0 }] },
    // One row, linking nowhere: what a rule may read a setting from.
    { ref: 'prefs', columns: [id, { ref: 'default_unit', type: 'int', nullable: true }, { ref: 'house_rate', type: 'int', nullable: true }] },
    {
      ref: 'things',
      columns: [
        id,
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'unit_id', type: 'fk', references: 'units', nullable: true, rules: { default: { from: { table: 'prefs', column: 'default_unit' } } } },
        { ref: 'unit', type: 'text', maxLength: 12, nullable: true, rules: { copy: { via: 'unit_id', from: 'code', mode: 'always' } } },
        { ref: 'places', type: 'int', nullable: true, rules: { copy: { via: 'unit_id', from: 'places', mode: 'always' } } },
        // A column both a copy and the settings may fill: the copy stands, the settings are the fallback.
        { ref: 'rate', type: 'int', nullable: true, rules: { copy: { via: 'unit_id', from: 'places' }, default: { from: { table: 'prefs', column: 'house_rate' } } } },
      ],
    },
  ]);
}

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a link the settings fill, on ${dialect}`, () => {
    async function harness() {
      const h = await installInvoicing(dialect, manifest());
      open = h;
      const w = await writerFor(h);
      const each = await w.create('units', { code: 'each', places: 0 });
      const kilo = await w.create('units', { code: 'kg', places: 3 });
      const row = async (key: unknown) => (await h.rows(`select * from ${h.real('things')} where id = ${String(key)}`))[0]!;
      const prefs = (unit: unknown, rate: unknown) => h.rows(`insert into ${h.real('prefs')} (default_unit, house_rate) values (${unit === null ? 'null' : String(unit)}, ${rate === null ? 'null' : String(rate)})`);
      return { h, w, each, kilo, row, prefs };
    }

    it('is filled first, so what is copied through it is copied in the same save', async () => {
      const { w, each, kilo, row, prefs } = await harness();
      await prefs(kilo['id'], 7);
      const made = await w.create('things', { name: 'Flour' });
      expect(await row(made['id'])).toMatchObject({ unit: 'kg' });
      expect(Number((await row(made['id']))['unit_id'])).toBe(Number(kilo['id']));
      expect(Number((await row(made['id']))['places'])).toBe(3);
      // A unit that is chosen is the one copied from: the settings are only what fills an empty one.
      const chosen = await w.create('things', { name: 'Pens', unit_id: each['id'] });
      expect(await row(chosen['id'])).toMatchObject({ unit: 'each' });
      expect(Number((await row(chosen['id']))['places'])).toBe(0);
    });

    it('leaves a column both may fill to the copy, with the settings as the fallback', async () => {
      const { w, kilo, row, prefs } = await harness();
      await prefs(kilo['id'], 7);
      // The link came from the settings; the rate is copied through it (3), not taken from the settings (7).
      const made = await w.create('things', { name: 'Flour' });
      expect(Number((await row(made['id']))['rate'])).toBe(3);
    });

    it('fills nothing where the settings hold no unit', async () => {
      const { w, row, prefs } = await harness();
      await prefs(null, 7);
      const made = await w.create('things', { name: 'Flour' });
      const stored = await row(made['id']);
      expect([stored['unit_id'], stored['unit'], stored['places']]).toEqual([null, null, null]);
      // And then the settings' own rate is the fallback it always was.
      expect(Number(stored['rate'])).toBe(7);
    });
  });
}
