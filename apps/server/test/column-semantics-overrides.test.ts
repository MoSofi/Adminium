// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `column.semanticType` → page composition.
 *
 * The override shipped end to end — Studio's Column Inspector stages it, the
 * write route stores it, `applyOverrides` folds it into the schema reply — and
 * it reached everything EXCEPT the one thing an operator tags a column for.
 * `composeForTable` and `generate/run.ts` both re-parsed the raw snapshot, so
 * tagging `date` as the event date changed what CRUD showed and nothing about
 * which pages the table could back: the calendar still refused to compose.
 *
 * These tests pin both halves of the unlock — the tag now decides composition,
 * and the absence of the tag still refuses — because a test that only asserts
 * the success half would pass just as well against a calendar that composes
 * for every table.
 */
import { describe, expect, it } from 'vitest';
import { applyClassification, composeRequestedPage, parseDatabaseModel } from '@adminium/engine';
import type { SchemaOverride } from '@adminium/meta';

import {
  activeColumnSemantics,
  applyColumnOptionValues,
  applyColumnSemanticOverrides,
  applyCompositionOverrides,
  applyOverrides,
} from '../src/connections/effective-schema.js';

/**
 * A table whose date column is the right TYPE and the wrong NAME.
 *
 * `r12-event-timestamp` tags a timestamp only when its name ends `_at`/`_date`/
 * `_on`/`_time`/`_ts`, so a column simply called `date` is classified `plain`
 * and the calendar's `calendar.date-title` rule never fires. That is the exact
 * shape the override exists to correct, and the most common one in the wild.
 */
const RAW = parseDatabaseModel({
  dialect: 'sqlite',
  name: 'clinic',
  defaultSchema: 'main',
  schemas: ['main'],
  tables: [
    {
      schema: 'main',
      name: 'appointments',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'title', logicalType: 'text' },
        { name: 'date', logicalType: 'timestamp' },
      ],
      primaryKey: ['id'],
    },
  ],
});

const MODEL = applyClassification(RAW);
const TABLE = MODEL.tables[0]!.id;

const CTX = {
  connectionId: 'conn_01HZX',
  id: 'page_01HZXTEST',
  slug: 'appointments-calendar',
  navGroup: 'planning' as const,
  navIcon: 'calendar',
  navOrder: 1,
};

let seq = 0;
function row(value: Record<string, unknown>, opts: { column?: string | null; status?: 'active' | 'disabled' } = {}): SchemaOverride {
  seq += 1;
  return {
    id: `ovr_${String(seq).padStart(22, '0')}`,
    connectionId: CTX.connectionId,
    op: 'column.semanticType' as SchemaOverride['op'],
    tableName: TABLE,
    columnName: opts.column === undefined ? 'date' : opts.column,
    value,
    origin: 'user',
    llmRunId: null,
    status: opts.status ?? 'active',
    createdBy: null,
    createdAt: 1_000 + seq,
    updatedAt: 1_000 + seq,
  };
}

const TAGGED = row({ semanticType: 'event-timestamp' });

describe('applyColumnSemanticOverrides → composition', () => {
  it('refuses the calendar while the date column is only named "date"', () => {
    const result = composeRequestedPage(MODEL, TABLE, 'page-calendar', CTX);
    expect(result.bindable).toBe(true);
    // The control half. Without it a calendar that composes unconditionally
    // would pass the test below and this suite would assert nothing.
    expect(result.envelope).toBeNull();
    expect(result.reason).not.toBe('');
  });

  it('composes the calendar once the operator has tagged that column', () => {
    const overlaid = applyColumnSemanticOverrides(MODEL, [TAGGED]);
    const result = composeRequestedPage(overlaid, TABLE, 'page-calendar', CTX);
    expect(result.envelope).not.toBeNull();

    // The layout must actually bind the tagged column, not merely exist.
    const config = (result.envelope as Record<string, unknown>)['config'] as Record<string, unknown>;
    const items = (config['layout'] as { items: { widget: string; config: Record<string, unknown> }[] }).items;
    const calendar = items.find((item) => item.widget === 'calendar-month');
    expect(calendar?.config['startColumn']).toBe('date');
  });

  it('stamps the assertion so the engine prefers it over the recomputed tag', () => {
    const overlaid = applyColumnSemanticOverrides(MODEL, [TAGGED]);
    const column = overlaid.tables[0]!.columns.find((c) => c.name === 'date');
    // `toClassifiedInput` only honours a stamp whose source is not 'heuristic'.
    expect(column?.semantics).toMatchObject({
      primary: 'event-timestamp',
      confidence: 1,
      source: 'override',
    });
    // …and it keeps what the classifier decided about everything else.
    expect(column?.semantics?.flags).toEqual(MODEL.tables[0]!.columns.find((c) => c.name === 'date')?.semantics?.flags);
  });

  it('leaves the model untouched — the same object — when no row applies', () => {
    expect(applyColumnSemanticOverrides(MODEL, [])).toBe(MODEL);
    expect(applyColumnSemanticOverrides(MODEL, [row({ semanticType: 'event-timestamp' }, { status: 'disabled' })])).toBe(MODEL);
  });

  it('skips a row naming a column the schema has since dropped', () => {
    const drifted = applyColumnSemanticOverrides(MODEL, [
      row({ semanticType: 'event-timestamp' }, { column: 'gone' }),
    ]);
    // Drift must not fail a generation run, and must not invent a column.
    expect(drifted.tables[0]!.columns.map((c) => c.name)).toEqual(['id', 'title', 'date']);
  });

  it('drops a tag the engine does not know rather than stamping it', () => {
    // `json-payloads.ts` types the stored value as a free string, so this is
    // the only gate between an operator's typo and a candidate rule.
    const junk = [row({ semanticType: 'evnt-timestamp' })];
    expect(activeColumnSemantics(junk).size).toBe(0);
    expect(applyColumnSemanticOverrides(MODEL, junk)).toBe(MODEL);
    // The read path agrees — the two must never disagree about one row.
    expect(applyOverrides(MODEL, junk).tables[0]!.columns.find((c) => c.name === 'date')?.semantics?.primary).not.toBe('evnt-timestamp');
  });

  it('lets a later row win, as every other op here does', () => {
    const tags = activeColumnSemantics([
      row({ semanticType: 'event-timestamp' }),
      row({ semanticType: 'created-at' }),
    ]);
    expect([...tags.values()]).toEqual(['created-at']);
  });
});

/**
 * `column.options` → the board gate.
 *
 * The second half of the same bug, and the one nobody would have watched fail.
 * A board's requirement reaches into the enum's VALUES, not just the column's
 * semantic; `addColumns` cannot carry values (`AddColumn` holds a
 * `DesiredColumn`, and only `DesiredTable` has an `enumValues` map); so a
 * repair that adds a status column has exactly one channel for the values it
 * must hold, and until now that channel reached the forms and stopped.
 *
 * The operator would have watched a schema change succeed, seen the values in
 * every dropdown, and found the board still refusing — with nothing on screen
 * connecting the two.
 */
const BOARD_RAW = parseDatabaseModel({
  dialect: 'sqlite',
  name: 'shop',
  defaultSchema: 'main',
  schemas: ['main'],
  tables: [
    {
      schema: 'main',
      name: 'tickets',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'title', logicalType: 'text' },
        // The shape a repair can actually create: a bounded varchar, with the
        // values living in the override rather than in the database.
        { name: 'status', logicalType: 'varchar', maxLength: 32 },
      ],
      primaryKey: ['id'],
    },
  ],
});
const BOARD_MODEL = applyClassification(BOARD_RAW);
const BOARD_TABLE = BOARD_MODEL.tables[0]!.id;

function optionsRow(values: string[], opts: { column?: string } = {}): SchemaOverride {
  seq += 1;
  return {
    id: `ovr_${String(seq).padStart(22, '0')}`,
    connectionId: CTX.connectionId,
    op: 'column.options' as SchemaOverride['op'],
    tableName: BOARD_TABLE,
    columnName: opts.column ?? 'status',
    value: { values: values.map((value) => ({ value })) },
    origin: 'user',
    llmRunId: null,
    status: 'active',
    createdBy: null,
    createdAt: 2_000 + seq,
    updatedAt: 2_000 + seq,
  };
}

describe('applyColumnOptionValues → the board', () => {
  it('refuses the board while the status column has no values (the control)', () => {
    const result = composeRequestedPage(BOARD_MODEL, BOARD_TABLE, 'page-board', {
      ...CTX,
      navGroup: 'planning',
    });
    expect(result.envelope).toBeNull();
  });

  it('composes the board once the answer list is projected onto the column', () => {
    const overlaid = applyCompositionOverrides(BOARD_MODEL, [
      optionsRow(['todo', 'in_progress', 'blocked', 'done']),
    ]);
    const result = composeRequestedPage(overlaid, BOARD_TABLE, 'page-board', {
      ...CTX,
      navGroup: 'planning',
    });
    expect(result.envelope).not.toBeNull();
  });

  it('still refuses when the values are not kanban-shaped', () => {
    // The requirement is about the VALUES. A repair that seeds a list of
    // loyalty tiers builds a column of the right type, with the right semantic,
    // and no board — which is the whole reason the descriptor seeds values.
    const overlaid = applyCompositionOverrides(BOARD_MODEL, [
      optionsRow(['bronze', 'silver', 'gold']),
    ]);
    expect(
      composeRequestedPage(overlaid, BOARD_TABLE, 'page-board', { ...CTX, navGroup: 'planning' })
        .envelope,
    ).toBeNull();
  });

  it('leaves a column the database itself describes alone', () => {
    // A real enum or CHECK is the stronger statement; an admin's answer list is
    // a display choice layered over it, not a replacement for it.
    const declared = applyClassification(
      parseDatabaseModel({
        dialect: 'postgres',
        name: 'shop',
        defaultSchema: 'main',
        schemas: ['main'],
        tables: [
          {
            schema: 'main',
            name: 'tickets',
            columns: [
              { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
              { name: 'status', logicalType: 'enum', enumRef: 'main.ticket_state' },
            ],
            primaryKey: ['id'],
          },
        ],
        enums: [
          { id: 'main.ticket_state', name: 'ticket_state', values: ['open', 'closed'], source: 'native' },
        ],
      }),
    );
    const overlaid = applyColumnOptionValues(declared, [optionsRow(['a', 'b'])]);
    expect(overlaid.tables[0]!.columns[1]?.enumRef).toBe('main.ticket_state');
  });

  it('ignores a shared-list pointer it cannot resolve, and clones nothing', () => {
    seq += 1;
    const pointer: SchemaOverride = {
      ...optionsRow(['ignored']),
      value: { list: 'ticket-states' },
    };
    // `{ list }` names a list that lives in settings; resolving it needs a read
    // this pure function does not have, so the column keeps what the database
    // declares rather than silently losing its values.
    expect(applyColumnOptionValues(BOARD_MODEL, [pointer])).toBe(BOARD_MODEL);
  });
});
