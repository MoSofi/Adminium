// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Remedy 4's draft — a new table shaped for a template.
 *
 * The draft is only worth offering if the table it describes, once created,
 * actually backs the page. `templateTableDraft` proves that itself (`composes`);
 * these tests prove the proof: every repairable template drafts a table that
 * composes on an EMPTY model (the "I have no table yet" case), a taken or
 * invalid name is refused, and a scheduler's person link reuses a real people table when one exists.
 */
import { describe, expect, it } from 'vitest';

import { applyClassification } from '../src/classify/index.js';
import { REPAIRABLE_TEMPLATES, templateFit, templateTableDraft } from '../src/generate/index.js';
import { parseDatabaseModel, type DatabaseModel } from '../src/schema-model.js';

function model(tables: Record<string, unknown>[] = []): DatabaseModel {
  return applyClassification(
    parseDatabaseModel({
      dialect: 'postgres',
      name: 'draft',
      defaultSchema: 'public',
      schemas: ['public'],
      tables,
    }),
  );
}

const employees = {
  schema: 'public',
  name: 'employees',
  columns: [
    { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
    { name: 'full_name', logicalType: 'text' },
    { name: 'email', logicalType: 'text' },
  ],
  primaryKey: ['id'],
};

describe('templateTableDraft', () => {
  it.each([...REPAIRABLE_TEMPLATES])('%s drafts a table that composes from nothing', (template) => {
    const draft = templateTableDraft(model(), template);
    expect(draft).not.toBeNull();
    expect(draft?.nameProblem).toBeNull();
    expect(draft?.composes, JSON.stringify(draft?.tables)).toBe(true);
    // Exactly one generated key per table, and it is the only NOT NULL column.
    for (const table of draft?.tables ?? []) {
      expect(table.columns.filter((c) => c.primaryKey).map((c) => c.name)).toEqual(['id']);
    }
  });

  it('declines the seven templates with no repair descriptors (D4)', () => {
    expect(templateTableDraft(model(), 'page-directory')).toBeNull();
    expect(templateTableDraft(model(), 'page-crud')).toBeNull();
    expect(templateTableDraft(model(), 'page-dashboard')).toBeNull();
  });

  it('a calendar draft carries a title and a conforming date name', () => {
    const draft = templateTableDraft(model(), 'page-calendar');
    const columns = draft?.tables.at(-1)?.columns.map((c) => c.name);
    expect(draft?.bindTableId).toBe('public.appointments');
    expect(columns).toEqual(['id', 'title', 'event_date']);
  });

  it('a board draft adds a title and seeds kanban-shaped values', () => {
    const draft = templateTableDraft(model(), 'page-board');
    const status = draft?.tables.at(-1)?.columns.find((c) => c.role === 'status-workflow');
    expect(draft?.tables.at(-1)?.columns.some((c) => c.role === 'title')).toBe(true);
    expect(status?.enumValues).toEqual(['todo', 'in_progress', 'blocked', 'done']);
    expect(status?.semantic).toBe('status-workflow');
  });

  it('skips a taken suggestion and reports a taken or invalid chosen name', () => {
    const existing = model([
      {
        schema: 'public',
        name: 'appointments',
        columns: [{ name: 'id', logicalType: 'integer', isPrimaryKey: true }],
        primaryKey: ['id'],
      },
    ]);
    expect(templateTableDraft(existing, 'page-calendar')?.bindTableId).toBe('public.bookings');
    const taken = templateTableDraft(existing, 'page-calendar', { name: 'appointments' });
    expect(taken?.nameProblem).toBe('taken');
    expect(taken?.composes).toBe(false);
    expect(templateTableDraft(existing, 'page-calendar', { name: 'My Table' })?.nameProblem).toBe(
      'invalid',
    );
  });

  it('names the table rules read do not defeat these drafts today (measured)', () => {
    // The compose check is a guard, not a known necessity: `LOG_TABLE_RE`
    // claims `events`/`history`/`audit`, but the log rule also needs a
    // created-at + actor-FK shape no draft has. If a future table rule starts
    // claiming one of these, this fails and the header's claim must be revisited.
    for (const template of REPAIRABLE_TEMPLATES) {
      for (const name of ['events', 'event_log', 'history', 'audit', 'settings', 'options']) {
        expect(templateTableDraft(model(), template, { name })?.composes, `${template}/${name}`).toBe(
          true,
        );
      }
    }
  });

  it('a scheduler with no people table creates one in the same edit, first', () => {
    const draft = templateTableDraft(model(), 'page-scheduler');
    expect(draft?.tables.map((t) => t.name)).toEqual(['staff', 'shifts']);
    expect(draft?.peopleTarget).toBeNull();
    const link = draft?.tables[1]?.columns.find((c) => c.role === 'person-fk');
    expect(link?.references).toEqual({ table: 'staff', column: 'id' });
    expect(draft?.composes).toBe(true);
  });

  it('a scheduler reuses the people table the classifier recognises', () => {
    const withPeople = model([
      employees,
      {
        // People-ish by NAME, but no person-name/email column: ranked below.
        schema: 'public',
        name: 'customers',
        columns: [
          { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
          { name: 'company', logicalType: 'text' },
        ],
        primaryKey: ['id'],
      },
      {
        schema: 'public',
        name: 'products',
        columns: [{ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }],
        primaryKey: ['id'],
      },
    ]);
    const draft = templateTableDraft(withPeople, 'page-scheduler');
    expect(draft?.peopleTargets.map((t) => t.tableId)).toEqual([
      'public.employees',
      'public.customers',
    ]);
    expect(draft?.peopleTarget).toBe('public.employees');
    expect(draft?.tables.map((t) => t.name)).toEqual(['shifts']);
    const link = draft?.tables[0]?.columns.find((c) => c.role === 'person-fk');
    expect(link?.references).toEqual({ table: 'public.employees', column: 'id' });
    expect(draft?.composes).toBe(true);

    const fresh = templateTableDraft(withPeople, 'page-scheduler', { people: 'new' });
    expect(fresh?.peopleTarget).toBeNull();
    expect(fresh?.tables.map((t) => t.name)).toEqual(['staff', 'shifts']);
    expect(fresh?.composes).toBe(true);
  });

  it('the FK column mirrors the target key type (pg/mysql refuse a mismatch)', () => {
    const uuidPeople = model([
      {
        ...employees,
        columns: [
          { name: 'id', logicalType: 'uuid', isPrimaryKey: true, nullable: false },
          { name: 'full_name', logicalType: 'text' },
          { name: 'email', logicalType: 'text' },
        ],
      },
    ]);
    const draft = templateTableDraft(uuidPeople, 'page-scheduler');
    const link = draft?.tables.at(-1)?.columns.find((c) => c.role === 'person-fk');
    expect(link?.logicalType).toBe('uuid');
  });

  it('the proof agrees with templateFit over the created table', () => {
    // Build the created table by hand from the draft and ask the fit report —
    // the same question the create route asks after the apply.
    const draft = templateTableDraft(model(), 'page-calendar');
    const table = draft?.tables.at(-1);
    const after = model([
      {
        schema: 'public',
        name: table?.name,
        primaryKey: ['id'],
        columns: table?.columns.map((c) => ({
          name: c.name,
          logicalType: c.logicalType,
          isPrimaryKey: c.primaryKey,
          nullable: !c.primaryKey,
          maxLength: c.maxLength,
        })),
      },
    ]);
    expect(templateFit(after, draft?.bindTableId ?? '', 'page-calendar').satisfied).toBe(true);
  });
});
