// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tables a manifest keeps to ONE row (`oneRowTables`): its settings table,
 * an add-on's settings table, and every table standing alone that one of its
 * settings is read from. The server refuses a second row in each.
 */
import { describe, expect, it } from 'vitest';

import { oneRowTables } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' } as const;
const text = (ref: string) => ({ ref, type: 'text', maxLength: 80, nullable: true }) as const;

describe('oneRowTables', () => {
  it("names the outbox's settings table, and a lone table a setting is read from", () => {
    const m = {
      requiredSchema: {
        tables: [
          { ref: 'settings', columns: [id, text('name'), text('ref_prefix')] },
          { ref: 'venue', columns: [id, { ref: 'cancel_hours', type: 'int', nullable: true }] },
          { ref: 'customers', columns: [id, text('name')] },
          { ref: 'orders', columns: [id, { ref: 'customer_id', type: 'fk', references: 'customers' }, text('number')] },
        ],
      },
      outbox: { settings: { table: 'settings' } },
    };
    // Nothing read from the venue yet: only the settings table.
    expect(oneRowTables(m as never)).toEqual(['settings']);
    const reading = {
      ...m,
      requiredSchema: {
        tables: m.requiredSchema.tables.map((table) =>
          table.ref === 'orders'
            ? { ...table, columns: [...table.columns.slice(0, 2), { ...text('number'), rules: { format: { from: 'id', prefixSetting: { table: 'settings', column: 'ref_prefix' } } } }] }
            : table.ref === 'customers'
              ? { ...table, columns: [...table.columns, { ...text('note'), rules: { default: { from: { table: 'venue', column: 'cancel_hours' } } } }] }
              : table,
        ),
      },
    };
    expect(oneRowTables(reading as never).sort()).toEqual(['settings', 'venue']);
  });

  it("names an add-on's settings table, and never a table the manifest does not declare", () => {
    expect(oneRowTables({ requiredSchema: { tables: [{ ref: 'forms_settings', columns: [id] }] }, addOn: { settingsTable: 'forms_settings' } } as never)).toEqual(['forms_settings']);
    expect(oneRowTables({ requiredSchema: { tables: [] }, outbox: { settings: { table: 'settings' } } } as never)).toEqual([]);
  });

  it('leaves out a table that links or is linked to: a setting read from it is refused by the manifest check instead', () => {
    const m = {
      requiredSchema: {
        tables: [
          { ref: 'stays', columns: [id, { ref: 'arrival', type: 'text', maxLength: 5, nullable: true }] },
          { ref: 'guests', columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ...text('note'), rules: { default: { from: { table: 'stays', column: 'arrival' } } } }] },
        ],
      },
    };
    expect(oneRowTables(m as never)).toEqual([]);
  });
});
