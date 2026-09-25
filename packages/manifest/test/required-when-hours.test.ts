// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two pieces of rule vocabulary: a column required only while another column
 * of its row holds one of some values (`requiredWhen`), and the hours between
 * two moments as a formula (`hoursBetween`) — what each accepts, what each
 * refuses by name, and what the formula works out.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateFormula,
  formulaColumns,
  formulaExprSchema,
  shapeConformanceIssues,
  shapeKey,
  validateManifest,
  type ShapeDefinitionView,
} from '../src/index.js';
import { addOnManifest, columnOf, issuesText, tableOf, valid, type Doc } from './invoicing-fixture.js';

const expectIssue = (m: Doc, fragment: string) => expect(issuesText(m)).toContain(fragment);

describe('requiredWhen', () => {
  const handover = (m: Doc) => columnOf(m, 'projects', 'handover_file');

  it('keeps a column required while another holds one of the values', () => {
    const m = valid();
    handover(m)['rules'] = { requiredWhen: { column: 'status', in: ['done'] } };
    expect(issuesText(m)).toBe('');
    expect(validateManifest(m).ok).toBe(true);
  });

  it('refuses a column that is not there, a value that does not fit, itself, and no values', () => {
    let m = valid();
    handover(m)['rules'] = { requiredWhen: { column: 'nope', in: ['done'] } };
    expectIssue(m, '"projects" has no column "nope"');
    m = valid();
    handover(m)['rules'] = { requiredWhen: { column: 'status', in: ['finished'] } };
    expectIssue(m, '"finished" is not a value of "projects.status"');
    m = valid();
    handover(m)['rules'] = { requiredWhen: { column: 'handover_file', in: ['x'] } };
    expectIssue(m, 'a column is required by another column');
    m = valid();
    handover(m)['rules'] = { requiredWhen: { column: 'status', in: [] } };
    expect(validateManifest(m).ok).toBe(false);
  });

  it('refuses it on a column that is never empty, one that is always required, and one Adminium fills', () => {
    let m = valid();
    columnOf(m, 'projects', 'share_stopped')['rules'] = { requiredWhen: { column: 'status', in: ['done'] } };
    expectIssue(m, 'a column required only sometimes may be empty the rest of the time, so make it nullable');
    m = valid();
    handover(m)['rules'] = { required: true, requiredWhen: { column: 'status', in: ['done'] } };
    expectIssue(m, 'a column is required always, or only when another column says so, not both');
    m = valid();
    columnOf(m, 'projects', 'share_token')['rules'] = { code: { length: 16 }, requiredWhen: { column: 'status', in: ['done'] } };
    expectIssue(m, 'Adminium fills this column, so nobody is asked for it');
  });

  it('may be added to a column of an add-on part, as required may', () => {
    const shape = structuredClone(((addOnManifest()['addOn'] as Doc)['shapes'] as Doc[])[0]!) as unknown as ShapeDefinitionView;
    const shapes = new Map([[shapeKey('invoices', shape), shape]]);
    const m = valid();
    // A line's description is asked for once its discount is a percentage.
    columnOf(m, 'invoice_lines', 'description')['rules'] = { requiredWhen: { column: 'discount_kind', in: ['percent'] } };
    expect(issuesText(m)).toBe('');
    expect(shapeConformanceIssues(m as never, shapes)).toEqual([]);
  });
});

describe('hoursBetween', () => {
  const withShifts = (hours: unknown, types: { start?: string; stop?: string; hours?: string } = {}): Doc => {
    const m = valid();
    const columns = tableOf(m, 'projects')['columns'] as Doc[];
    columns.push(
      { ref: 'started_at', type: types.start ?? 'timestamptz', nullable: true },
      { ref: 'stopped_at', type: types.stop ?? 'timestamptz', nullable: true },
      { ref: 'hours', type: types.hours ?? 'decimal', scale: 2, nullable: true, rules: { formula: hours } },
    );
    return m;
  };

  it('reads two moments of the row, alone or inside other arithmetic', () => {
    expect(issuesText(withShifts({ hoursBetween: ['started_at', 'stopped_at'] }))).toBe('');
    expect(issuesText(withShifts({ round: [{ hoursBetween: ['started_at', 'stopped_at'] }, 1] }))).toBe('');
    expect(formulaColumns({ mul: [{ hoursBetween: ['started_at', 'stopped_at'] }, 'rate'] })).toEqual(['started_at', 'stopped_at', 'rate']);
  });

  it('refuses a column that is not a moment, one that is not there, and two of the same', () => {
    expectIssue(withShifts({ hoursBetween: ['started_at', 'status'] }), '"status" is not a moment (a timestamptz column)');
    expectIssue(withShifts({ hoursBetween: ['started_at', 'stopped_at'] }, { start: 'date' }), '"started_at" is not a moment (a timestamptz column)');
    expectIssue(withShifts({ hoursBetween: ['started_at', 'nope'] }), 'the table has no column "nope"');
    expect(formulaExprSchema.safeParse({ hoursBetween: ['started_at'] }).success).toBe(false);
    expectIssue(withShifts({ hoursBetween: ['started_at', 'started_at'] }), 'hours are counted between two different columns');
    // A moment is no number: it cannot be added up on its own.
    expectIssue(withShifts({ add: ['started_at', 1] }), '"started_at" is not a number');
  });

  const hours = { hoursBetween: ['started_at', 'stopped_at'] } as const;

  it('works the hours out exactly, at the scale asked', () => {
    expect(evaluateFormula(hours, { started_at: '2026-09-25T09:15:00Z', stopped_at: '2026-09-25T11:45:00Z' }, 2)).toBe('2.50');
    // Across midnight.
    expect(evaluateFormula(hours, { started_at: '2026-09-25T22:30:00Z', stopped_at: '2026-09-26T01:15:00Z' }, 2)).toBe('2.75');
    // 20 minutes is a third of an hour, exactly, rounded once.
    expect(evaluateFormula(hours, { started_at: '2026-09-25T09:00:00Z', stopped_at: '2026-09-25T09:20:00Z' }, 2)).toBe('0.33');
    expect(evaluateFormula(hours, { started_at: '2026-09-25T09:00:00Z', stopped_at: '2026-09-25T09:20:00Z' }, 4)).toBe('0.3333');
    // A Date, as Postgres and MySQL hand one back, and an offset.
    expect(evaluateFormula(hours, { started_at: new Date('2026-09-25T09:15:00Z'), stopped_at: '2026-09-25T13:45:00+02:00' }, 2)).toBe('2.50');
    // Inside other arithmetic: hours times a rate.
    expect(evaluateFormula({ mul: [hours, 'rate'] }, { started_at: '2026-09-25T09:15:00Z', stopped_at: '2026-09-25T11:45:00Z', rate: '40.00' }, 2)).toBe('100.00');
  });

  it('is empty with either moment empty, and for a stop before its start', () => {
    expect(evaluateFormula(hours, { started_at: '2026-09-25T09:15:00Z', stopped_at: null }, 2)).toBeNull();
    expect(evaluateFormula(hours, { stopped_at: '2026-09-25T09:15:00Z' }, 2)).toBeNull();
    expect(evaluateFormula(hours, { started_at: 'soon', stopped_at: '2026-09-25T09:15:00Z' }, 2)).toBeNull();
    expect(evaluateFormula(hours, { started_at: '2026-09-25T11:45:00Z', stopped_at: '2026-09-25T09:15:00Z' }, 2)).toBeNull();
    expect(evaluateFormula(hours, { started_at: '2026-09-25T09:15:00Z', stopped_at: '2026-09-25T09:15:00Z' }, 2)).toBe('0.00');
    // An empty span is still empty inside coalesce's first place.
    expect(evaluateFormula({ coalesce: [hours, 0] }, { started_at: '2026-09-25T09:15:00Z' }, 2)).toBe('0.00');
  });

  it('reads a time with no zone on this clock, the one Adminium keeps such times on', () => {
    // The same wall times read as local and as the instants they are here: the same span.
    const local = (text: string) => {
      const [day, time] = text.split(' ') as [string, string];
      const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
      const [h, mi] = time.split(':').map(Number) as [number, number];
      return new Date(y, mo - 1, d, h, mi).toISOString();
    };
    const wall = { started_at: '2026-03-29 00:30:00', stopped_at: '2026-03-29 03:30:00' };
    expect(evaluateFormula(hours, wall, 2)).toBe(evaluateFormula(hours, { started_at: local(wall.started_at), stopped_at: local(wall.stopped_at) }, 2));
    expect(evaluateFormula(hours, { started_at: '2026-09-25T09:15', stopped_at: '2026-09-25 11:45:00.000' }, 2)).toBe('2.50');
  });
});
