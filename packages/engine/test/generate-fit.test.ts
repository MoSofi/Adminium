// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `templateFit` / `fittingTables`.
 *
 * The question these answer is the one `composeRequestedPage` already answers
 * badly: not "may I build this page" — that was always available — but *what
 * exactly is missing*, in a shape something other than a human can act on.
 *
 * The suite is deliberately built around CONTROLS. Every "this fits" assertion
 * is paired with a case that must not fit, because a fit report that said yes
 * to everything would satisfy the happy-path half of every test below.
 */
import { describe, expect, it } from 'vitest';

import { applyClassification } from '../src/classify/index.js';
import {
  TABLE_BOUND_TEMPLATES,
  composeRequestedPage,
  fittingTables,
  templateFit,
} from '../src/generate/index.js';
import { parseDatabaseModel, type DatabaseModel } from '../src/schema-model.js';

/**
 * Four tables, each failing or passing the calendar for a different reason:
 *
 *   appointments  a timestamp named `date` — right type, wrong name (the
 *                 common real case, and the one remedy 1 exists for)
 *   shifts        `starts_at` — the classifier tags it unaided, so it fits
 *   invoices      no date at all beyond `created_at`, which rows 9/10 claim
 *                 before the event rule sees it
 *   employees     people-shaped; the FK target the scheduler needs
 */
const MODEL: DatabaseModel = applyClassification(
  parseDatabaseModel({
    dialect: 'postgres',
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
          { name: 'date', logicalType: 'timestamptz' },
          { name: 'created_at', logicalType: 'timestamptz' },
        ],
        primaryKey: ['id'],
      },
      {
        schema: 'main',
        name: 'shifts',
        columns: [
          { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
          { name: 'name', logicalType: 'text' },
          { name: 'starts_at', logicalType: 'timestamptz' },
          {
            name: 'employee_id',
            logicalType: 'integer',
            references: { tableId: 'main.employees', column: 'id' },
          },
          { name: 'shift_type', logicalType: 'enum', enumRef: 'main.shifts.shift_type' },
        ],
        primaryKey: ['id'],
      },
      {
        schema: 'main',
        name: 'invoices',
        columns: [
          { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
          { name: 'reference', logicalType: 'text' },
          { name: 'created_at', logicalType: 'timestamptz' },
        ],
        primaryKey: ['id'],
      },
      {
        schema: 'main',
        name: 'employees',
        columns: [
          { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
          { name: 'full_name', logicalType: 'text' },
        ],
        primaryKey: ['id'],
      },
    ],
    enums: [
      {
        id: 'main.shifts.shift_type',
        name: 'shift_type',
        values: ['morning', 'evening', 'night'],
        source: 'check',
      },
    ],
  }),
);

const CTX = {
  connectionId: 'conn_fit',
  id: 'page_fit',
  slug: 'fit',
  navGroup: 'planning' as const,
  navIcon: 'calendar',
  navOrder: 1,
};

describe('templateFit — the generic half (all ten table-bound templates)', () => {
  it('agrees with composition on every table-bound template, table by table', () => {
    // The whole value of the report is that it PREDICTS the refusal. A report
    // that disagreed with the composer would send an operator down a repair
    // for a page that already worked, or refuse one that would have.
    let checked = 0;
    for (const template of TABLE_BOUND_TEMPLATES) {
      for (const table of MODEL.tables) {
        const fit = templateFit(MODEL, table.id, template);
        const composed = composeRequestedPage(MODEL, table.id, template, CTX);
        expect(fit.satisfied, `${template} on ${table.id}`).toBe(composed.envelope !== null);
        checked += 1;
      }
    }
    // Guard against the loop silently iterating nothing.
    expect(checked).toBe(TABLE_BOUND_TEMPLATES.length * MODEL.tables.length);
  });

  it('names the unfilled required slot rather than joining engine warnings', () => {
    const fit = templateFit(MODEL, 'main.appointments', 'page-calendar');
    expect(fit.satisfied).toBe(false);
    expect(fit.unfilled.map((s) => s.slot)).toEqual(['calendar']);
    // The slot carries what it WOULD have accepted, so the UI can say what is
    // missing without a second copy of the manifest.
    expect(fit.unfilled[0]?.accepts.widgets).toContain('calendar-month');
  });

  it('states a slot for a template with no repair descriptors (D4)', () => {
    // `page-directory` gets the generic half and no repair flow behind it.
    const fit = templateFit(MODEL, 'main.invoices', 'page-directory');
    expect(fit.bindable).toBe(true);
    expect(fit.satisfied).toBe(false);
    expect(fit.unfilled.map((s) => s.slot)).toEqual(['directory']);
    expect(fit.requirements).toEqual([]);
  });

  it('page-crud fits every available table — it has no required slot', () => {
    for (const table of MODEL.tables) {
      expect(templateFit(MODEL, table.id, 'page-crud').satisfied).toBe(true);
    }
  });

  it('reports a non-table-bound template as unbindable, not as unsatisfied', () => {
    for (const template of ['page-dashboard', 'page-builder', 'page-wizard', 'page-settings']) {
      const fit = templateFit(MODEL, 'main.appointments', template);
      // `bindable: false` means "there is no requirement to state", which is a
      // different answer from "this table cannot back it".
      expect(fit).toMatchObject({ bindable: false, satisfied: false, unfilled: [], requirements: [] });
    }
  });

  it('explains an unknown table instead of throwing', () => {
    const fit = templateFit(MODEL, 'main.nope', 'page-calendar');
    expect(fit.satisfied).toBe(false);
    expect(fit.reason).toMatch(/not available/i);
  });
});

describe('templateFit — the repair descriptors', () => {
  it('offers the mis-named date column as taggable, and not created_at', () => {
    const fit = templateFit(MODEL, 'main.appointments', 'page-calendar');
    const date = fit.requirements.find((r) => r.role === 'event-date');

    expect(date?.satisfiedBy).toBeNull();
    // Exactly one offer, from four columns of which two are timestamps: the
    // list is the result of asking the rule, not of listing the types.
    expect(date?.taggable.map((c) => c.column)).toEqual(['date']);
  });

  it('keeps created_at out of the OFFER even though tagging it would work', () => {
    // The probe says yes to `created_at`: an override beats the classifier by
    // design, so tagging it really would compose a calendar. Excluding it is a
    // product judgement about what to put in front of someone repairing a page
    // — a bookkeeping stamp is not an event, and re-purposing it changes what
    // "created" means everywhere else the semantic is read.
    const fit = templateFit(MODEL, 'main.appointments', 'page-calendar');
    const date = fit.requirements.find((r) => r.role === 'event-date');
    expect(date?.taggable.map((c) => c.column)).not.toContain('created_at');

    // …and the escape hatch is real: a model where `created_at` IS the event
    // time still composes once it carries the tag, so nobody is blocked — the
    // Column Inspector is the surface for saying a column means something else.
    const tagged = applyClassification(
      parseDatabaseModel({
        dialect: 'postgres',
        name: 'clinic',
        defaultSchema: 'main',
        schemas: ['main'],
        tables: [
          {
            schema: 'main',
            name: 'visits',
            columns: [
              { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
              { name: 'title', logicalType: 'text' },
              {
                name: 'created_at',
                logicalType: 'timestamptz',
                semantics: {
                  primary: 'event-timestamp',
                  flags: { secret: false, pii: null, maskedByDefault: false },
                  format: null,
                  pair: null,
                  confidence: 1,
                  source: 'override',
                },
              },
            ],
            primaryKey: ['id'],
          },
        ],
      }),
    );
    expect(templateFit(tagged, 'main.visits', 'page-calendar').satisfied).toBe(true);
  });

  it('pre-fills a conforming name rather than asking the operator for one (D3)', () => {
    const fit = templateFit(MODEL, 'main.invoices', 'page-calendar');
    const date = fit.requirements.find((r) => r.role === 'event-date');
    expect(date?.taggable).toEqual([]); // nothing to tag — this is the DDL case
    expect(date?.wants.suggestedNames[0]).toBe('event_date');
    expect(date?.wants.semantic).toBe('event-timestamp');
  });

  it('reports the title role as already satisfied while the date is not', () => {
    // The two halves fail independently, and the title half almost never does.
    const fit = templateFit(MODEL, 'main.appointments', 'page-calendar');
    expect(fit.requirements.find((r) => r.role === 'title')?.satisfiedBy).toBe('title');
    expect(fit.requirements.find((r) => r.role === 'event-date')?.satisfiedBy).toBeNull();
  });

  it('names the column playing each role when the template already fits', () => {
    const fit = templateFit(MODEL, 'main.shifts', 'page-calendar');
    expect(fit.satisfied).toBe(true);
    expect(fit.requirements.find((r) => r.role === 'event-date')?.satisfiedBy).toBe('starts_at');
  });

  it('offers no tag for the scheduler person role — no tag could create an FK', () => {
    const fit = templateFit(MODEL, 'main.invoices', 'page-scheduler');
    const person = fit.requirements.find((r) => r.role === 'person-fk');
    // `personFk` tests `references` and the TARGET TABLE's name. Offering a tag
    // here would be offering something that cannot work.
    expect(person?.satisfiedBy).toBeNull();
    expect(person?.taggable).toEqual([]);
  });
});

describe('fittingTables — remedy 0', () => {
  it('offers the table that already fits, and excludes the one picked', () => {
    const offered = fittingTables(MODEL, 'page-calendar', { exclude: 'main.appointments' });
    expect(offered.map((t) => t.tableId)).toEqual(['main.shifts']);
    // The trigger's own words, so the offer can say why without inventing a
    // second explanation of the rule.
    expect(offered[0]?.reasons.join(' ')).toMatch(/starts_at/);
    expect(offered[0]?.roles).toContainEqual({ role: 'event-date', column: 'starts_at' });
  });

  it('offers nothing when no other table fits (the control)', () => {
    const offered = fittingTables(MODEL, 'page-scheduler', { exclude: 'main.shifts' });
    expect(offered).toEqual([]);
  });

  it('ranks by the trigger score, then table id — total and stable', () => {
    const offered = fittingTables(MODEL, 'page-crud');
    const ids = offered.map((t) => t.tableId);
    expect(ids.length).toBeGreaterThan(1);
    expect(fittingTables(MODEL, 'page-crud').map((t) => t.tableId)).toEqual(ids);
    const scores = offered.map((t) => t.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('every table it offers really does compose', () => {
    for (const template of TABLE_BOUND_TEMPLATES) {
      for (const offer of fittingTables(MODEL, template)) {
        const composed = composeRequestedPage(MODEL, offer.tableId, template, CTX);
        expect(composed.envelope, `${template} on ${offer.tableId}`).not.toBeNull();
      }
    }
  });

  it('returns nothing for a template that is not table-bound', () => {
    expect(fittingTables(MODEL, 'page-dashboard')).toEqual([]);
  });
});
