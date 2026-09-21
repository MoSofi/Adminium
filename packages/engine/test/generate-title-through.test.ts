// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Remedy 2 — a calendar on the related table, titled through the FK.
 *
 * The fixture is the case the remedy exists for: `patients` has no date, and
 * `appointments` has a date and NO text column of its own — so neither table
 * can back a calendar alone, remedy 0 has nothing to offer, and the only way to
 * a calendar without writing to the database is the FK between them.
 */
import { describe, expect, it } from 'vitest';

import { applyClassification } from '../src/classify/index.js';
import { pageEnvelopeSchema, queryDescriptorSchema, widgetConfigSchema } from '../src/config-schema/index.js';
import {
  composeRequestedPage,
  fittingTables,
  relatedDateTables,
  templateFit,
} from '../src/generate/index.js';
import { parseDatabaseModel, type DatabaseModel } from '../src/schema-model.js';

function clinic(): DatabaseModel {
  return applyClassification(
    parseDatabaseModel({
      dialect: 'postgres',
      name: 'clinic',
      defaultSchema: 'public',
      schemas: ['public'],
      tables: [
        {
          schema: 'public',
          name: 'patients',
          columns: [
            { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
            { name: 'full_name', logicalType: 'text' },
            { name: 'email', logicalType: 'text' },
          ],
          primaryKey: ['id'],
        },
        {
          schema: 'public',
          name: 'appointments',
          columns: [
            { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
            {
              name: 'patient_id',
              logicalType: 'integer',
              references: { tableId: 'public.patients', column: 'id' },
            },
            { name: 'starts_at', logicalType: 'timestamptz' },
          ],
          primaryKey: ['id'],
        },
      ],
    }),
  );
}

const CTX = {
  connectionId: 'conn_1',
  slug: 'visits',
  id: 'page_visits',
  navGroup: 'planning' as const,
  navIcon: 'calendar',
  navOrder: 0,
};

interface Item {
  i: string;
  widget: string;
  config: Record<string, unknown>;
}

function itemsOf(envelope: Record<string, unknown>): Item[] {
  return ((envelope['config'] as Record<string, unknown>)['layout'] as { items: Item[] }).items;
}

describe('title through the FK (remedy 2)', () => {
  it('the fixture is the case: neither table backs a calendar alone, and remedy 0 is empty', () => {
    const model = clinic();
    expect(templateFit(model, 'public.patients', 'page-calendar').satisfied).toBe(false);
    expect(templateFit(model, 'public.appointments', 'page-calendar').satisfied).toBe(false);
    expect(fittingTables(model, 'page-calendar')).toEqual([]);
  });

  it('offers the related table, naming the key, the title and the date', () => {
    expect(relatedDateTables(clinic(), 'public.patients', 'page-calendar')).toEqual([
      {
        tableId: 'public.appointments',
        label: null,
        via: 'patient_id',
        titleColumn: 'full_name',
        dateColumn: 'starts_at',
      },
    ]);
  });

  it('only an INBOUND key qualifies — one appointment has no single title for its patient', () => {
    expect(relatedDateTables(clinic(), 'public.appointments', 'page-calendar')).toEqual([]);
  });

  it('is calendar-only', () => {
    expect(relatedDateTables(clinic(), 'public.patients', 'page-board')).toEqual([]);
    const board = composeRequestedPage(clinic(), 'public.appointments', 'page-board', {
      ...CTX,
      titleThrough: 'patient_id',
    });
    expect(board.envelope).toBeNull();
    expect(board.reason).toMatch(/foreign key/);
  });

  it('composes a calendar whose title arrives as a lookup, not a column', () => {
    const built = composeRequestedPage(clinic(), 'public.appointments', 'page-calendar', {
      ...CTX,
      titleThrough: 'patient_id',
    });
    expect(built.reason).toBe('');
    const envelope = built.envelope as Record<string, unknown>;
    expect(pageEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope['source']).toEqual({ connectionId: 'conn_1', table: 'public.appointments' });

    const items = itemsOf(envelope);
    const calendar = items.find((item) => item.widget === 'calendar-month');
    expect(calendar?.config['titleColumn']).toBe('patient_id__display');
    expect(calendar?.config['startColumn']).toBe('starts_at');
    expect(calendar?.config['titleLookup']).toEqual({
      column: 'patient_id',
      table: 'public.patients',
      keyColumn: 'id',
      labelColumn: 'full_name',
    });
    const binding = calendar?.config['binding'] as { select: string[]; lookups: string[] };
    expect(binding.lookups).toEqual(['patient_id__display:patient_id.full_name']);

    const choices = queryDescriptorSchema.parse(calendar?.config['choicesBinding']);
    expect(choices).toMatchObject({
      connectionId: 'conn_1',
      source: { name: 'patients' },
      shape: 'record-list',
      select: ['id', 'full_name'],
    });

    // The virtual column must not survive into ANY binding as a real column:
    // the server would refuse it as unknown and the widget would fail.
    for (const item of items) {
      expect(widgetConfigSchema.safeParse(item).success, item.i).toBe(true);
      const b = item.config['binding'] as Record<string, unknown> | undefined;
      if (b === undefined) continue;
      const { lookups: _lookups, ...rest } = b;
      expect(JSON.stringify(rest), item.i).not.toContain('patient_id__display');
    }
  });

  it('refuses a column that is not a foreign key', () => {
    const built = composeRequestedPage(clinic(), 'public.appointments', 'page-calendar', {
      ...CTX,
      titleThrough: 'starts_at',
    });
    expect(built.envelope).toBeNull();
    expect(built.reason).toMatch(/not a foreign key/);
  });

  it('leaves composition untouched when no titleThrough is asked for', () => {
    const plain = composeRequestedPage(clinic(), 'public.appointments', 'page-calendar', CTX);
    expect(plain.envelope).toBeNull();
  });
});
