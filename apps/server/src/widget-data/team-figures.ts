// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A WHOLE TEAM'S FIGURES (`kind: 'team-figures'`): what each person owns of a
 * table, added up, a target from a second table, and the cover of it.
 *
 * ── WHOLE OR LEFT OUT ──────────────────────────────────────────────────────
 * Every other card answers the reader's own reach: a rep sees her own sum.
 * That is right for "my pipeline" and wrong under a heading that says "the
 * team": her 95,000 drawn as the business's figure is a lie, and a colleague's
 * target beside it is a row she may not read. So this kind answers ONLY a
 * person no row limit holds, on the rows' table and on the targets' table
 * alike. Anybody else is refused with `403 TEAM_FIGURE_WHOLE_ONLY`, before a
 * single row is read: never a partial figure, never a zero, and no way to
 * tell from the refusal what the figure would have been.
 *
 * The rest is the ordinary rule of a read: the reader's roles read both
 * tables and show every column named (a column they hide is refused by
 * name), and a person is named as the people list names them.
 *
 * The sums are the summaries' own (`automations/digest.ts` `fold`): one
 * statement a figure, grouped by the owner, added up by the database.
 */
import type { Dialect } from '@adminium/engine';
import type { QueryDescriptor } from '@adminium/engine/config';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { MetaDb } from '@adminium/meta';

import { fold } from '../automations/digest.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { RecordFilter } from '../crud/filters.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { RowLimitContext } from '../crud/row-limit.js';
import { rowTestOf } from '../crud/row-limit-context.js';
import { venueClock } from '../crud/venue-time.js';
import { AppError, ForbiddenError, ValidationFailedError } from '../errors.js';
import { isStaffColumn, peopleNames } from './people-names.js';
import type { ColumnMeta } from './shapers.js';

const figureKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/);


/** What `descriptor.team` holds; the descriptor's own schema describes it (`query-descriptor.ts`). */
export const teamFiguresSchema = z
  .object({
    owner: z.string().min(1).max(128),
    figures: z
      .array(
        z
          .object({
            key: figureKeySchema,
            fn: z.enum(['count', 'sum']),
            column: z.string().min(1).max(128).optional(),
            where: z
              .array(z.object({ column: z.string().min(1).max(128), in: z.array(z.union([z.string().max(200), z.number().finite(), z.boolean()])).min(1).max(20) }).strict())
              .min(1)
              .max(3)
              .optional(),
            thisYear: z.string().min(1).max(128).optional(),
          })
          .strict()
          .refine((figure) => (figure.fn === 'sum') === (figure.column !== undefined), { message: 'a sum names its column, and a count names none' }),
      )
      .min(1)
      .max(4)
      .refine((figures) => new Set(figures.map((figure) => figure.key)).size === figures.length, { message: 'each figure has a key of its own' })
      .refine((figures) => figures.every((figure) => !['name', 'person', 'target', 'cover'].includes(figure.key)), { message: 'a figure is not keyed name, person, target or cover' }),
    target: z.object({ table: z.string().min(1).max(200), owner: z.string().min(1).max(128), column: z.string().min(1).max(128), year: z.string().min(1).max(128).optional() }).strict().optional(),
    cover: z.array(figureKeySchema).min(1).max(4).optional(),
    metric: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/).optional(),
  })
  .strict()
  .refine((team) => team.cover === undefined || team.target !== undefined, { message: 'a cover is measured against a target' })
  .refine((team) => (team.cover ?? []).every((key) => team.figures.some((figure) => figure.key === key && figure.fn === 'sum')), { message: 'a cover adds up figures that are sums' })
  .refine((team) => team.metric === undefined || team.metric === 'target' || team.metric === 'cover' || team.figures.some((figure) => figure.key === team.metric), { message: 'metric is a figure, target or cover' });
export type TeamFigures = z.infer<typeof teamFiguresSchema>;

const SUMMED: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float']);

export interface ShapedTeamMetric {
  shape: 'single-metric';
  /** Null: no figure to give (a cover with no target above zero). */
  value: number | null;
}

export interface ShapedTeamList {
  shape: 'record-list';
  rows: Record<string, unknown>[];
  columns: ColumnMeta[];
  total: number;
  key: 'person';
  /** The team's own line: each figure over everybody, the targets added up, the cover of them. */
  totals: Record<string, number | null>;
}

export type ShapedTeam = ShapedTeamMetric | ShapedTeamList;

/** The refusal of a figure that is the whole team's, to somebody held to some of the rows. */
export class WholeOnlyError extends AppError {
  override readonly name = 'WholeOnlyError';
  constructor() {
    super(403, 'TEAM_FIGURE_WHOLE_ONLY', 'This figure is the whole team’s. It is not shown to you, because your role reads only some of the rows it is worked out from.');
  }
}

function reject(message: string, details?: unknown): never {
  throw new ValidationFailedError(message, details);
}

/** A number column this reader's roles show, by name; refused by name otherwise. */
function summed(view: SnapshotView, table: ResolvedTable, name: string): string {
  const column = view.readableColumn(table, name, false);
  if (!SUMMED.has(column.logicalType)) reject(`"${name}" is not a number column of ${table.id}, so it cannot be added up.`, { column: name });
  return column.name;
}

function staff(table: ResolvedTable, name: string): string {
  if (!isStaffColumn(table, name)) reject(`"${name}" is not a staff column of ${table.id}: a team's figures are counted by the person a row names.`, { owner: name });
  return name;
}

export async function answerTeamFigures(input: {
  descriptor: QueryDescriptor;
  connectionId: string;
  /** The reader's view: a table or a column their roles do not show is refused by it. */
  view: SnapshotView;
  /** `descriptor.source`, resolved and read-checked by the route. */
  table: ResolvedTable;
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  meta: MetaDb;
  timezone: string | undefined;
  now: Date;
  reach: RowLimitContext | null;
  canReadTable: (tableId: string) => Promise<boolean>;
  /** Whether this reader is told people's names at all (a person is; an API key is not). */
  named: boolean;
  unnamed: string;
}): Promise<{ shaped: ShapedTeam; /** The targets' table, by its id: a write there is a new answer. */ targetTable: string | null }> {
  const { descriptor, view, table, db, dialect, reach } = input;
  if (descriptor.team === undefined) reject('A `team-figures` binding says what it adds up in `team`.', { kind: descriptor.kind });
  const parsed = teamFiguresSchema.safeParse(descriptor.team);
  if (!parsed.success) reject(`\`team\` is not readable: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`, { team: descriptor.team });
  const team: TeamFigures = parsed.data;
  if (descriptor.shape !== 'single-metric' && descriptor.shape !== 'record-list') reject('A team\'s figures are answered as a "single-metric" or a "record-list".', { shape: descriptor.shape });
  for (const key of ['select', 'lookups', 'aggregations', 'groupBy', 'groupLabel', 'bucket', 'filters', 'window', 'orderBy', 'cursor', 'capacity', 'counts', 'people', 'daysSince'] as const) {
    if (descriptor[key] !== undefined) reject(`\`${key}\` has no meaning on a \`team-figures\` binding: each figure carries its own test.`, { [key]: descriptor[key] });
  }

  // The targets' table, read-checked as the rows' table was by the route.
  const target = team.target === undefined ? null : { ...team.target, resolved: view.table(team.target.table) };
  if (target !== null && !(await input.canReadTable(target.resolved.id))) {
    throw new ForbiddenError('You do not have access to this table.', 'TABLE_FORBIDDEN', { permission: `table:${input.connectionId}:${target.resolved.id}:read` });
  }

  // WHOLE OR LEFT OUT: decided before a column is looked at or a row is read, so the refusal says nothing else.
  if (rowTestOf(reach, table.id, 'read') !== null || (target !== null && rowTestOf(reach, target.resolved.id, 'read') !== null)) throw new WholeOnlyError();

  const owner = staff(table, team.owner);
  const year = Number(venueClock(input.now, input.timezone ?? 'UTC').day.slice(0, 4));
  const figures = team.figures.map((figure) => {
    const tests: RecordFilter[] = (figure.where ?? []).map((test): RecordFilter => {
      // Refused by name where this reader's roles do not show it: a test on a hidden column would say what it holds.
      view.readableColumn(table, test.column, false);
      return test.in.length === 1 ? { column: test.column, op: 'eq', value: test.in[0] } : { column: test.column, op: 'in', value: [...test.in] };
    });
    if (figure.thisYear !== undefined) {
      const dated = view.readableColumn(table, figure.thisYear, false);
      if (dated.logicalType !== 'date') reject(`"${figure.thisYear}" is not a date column of ${table.id}: "this year" is read from a day, on the venue's calendar.`, { thisYear: figure.thisYear });
      tests.push({ column: dated.name, op: 'gte', value: `${String(year)}-01-01` }, { column: dated.name, op: 'lte', value: `${String(year)}-12-31` });
    }
    return { key: figure.key, column: figure.column === undefined ? null : summed(view, table, figure.column), filter: tests.length === 0 ? null : tests.length === 1 ? (tests[0] as RecordFilter) : { and: tests } };
  });
  const targetColumn = target === null ? null : summed(view, target.resolved, target.column);
  if (target !== null) staff(target.resolved, target.owner);
  const yearColumn = target?.year === undefined || target === null ? null : view.readableColumn(target.resolved, target.year, false).name;

  const reader = { db, dialect, view, reach: null };
  /** Each person's figures, by id; `''` is the rows nobody owns. */
  const people = new Map<string, Record<string, number>>();
  const line = (id: string): Record<string, number> => {
    let found = people.get(id);
    if (found === undefined) {
      found = Object.fromEntries(figures.map((figure) => [figure.key, 0]));
      people.set(id, found);
    }
    return found;
  };
  for (const figure of figures) {
    for (const row of await fold(reader, table, figure.filter, figure.column === null ? [] : [figure.column], owner)) {
      // Rows in two currencies are no one sum: the figure is not given for anybody, rather than a wrong one for all.
      if (figure.column !== null && row.currency === undefined) reject(`"${figure.column}" is kept in more than one currency, so it has no one sum.`, { figure: figure.key });
      line(row.owner ?? '')[figure.key] = figure.column === null ? row.count : (row.sums[figure.column] ?? 0);
    }
  }
  const targets = new Map<string, number>();
  if (target !== null && targetColumn !== null) {
    const thisYear: RecordFilter | null = yearColumn === null ? null : { column: yearColumn, op: 'eq', value: year };
    for (const row of await fold(reader, target.resolved, thisYear, [targetColumn], target.owner)) {
      const value = row.sums[targetColumn];
      if (row.owner !== null && row.owner !== '' && value !== null && value !== undefined) {
        targets.set(row.owner, value);
        line(row.owner);
      }
    }
  }

  const covered = (of: Record<string, number>): number => (team.cover ?? []).reduce((sum, key) => sum + (of[key] ?? 0), 0);
  const coverOf = (of: Record<string, number>, goal: number | undefined): number | null => (team.cover === undefined || goal === undefined || !(goal > 0) ? null : covered(of) / goal);
  const whole: Record<string, number> = Object.fromEntries(figures.map((figure) => [figure.key, [...people.values()].reduce((sum, of) => sum + (of[figure.key] ?? 0), 0)]));
  const allTargets = [...targets.values()].reduce((sum, value) => sum + value, 0);
  const totals: Record<string, number | null> = { ...whole, ...(target === null ? {} : { target: targets.size === 0 ? null : allTargets }), ...(team.cover === undefined ? {} : { cover: coverOf(whole, allTargets) }) };

  if (descriptor.shape === 'single-metric') {
    const metric = team.metric ?? (team.cover !== undefined ? 'cover' : (figures[0] as (typeof figures)[number]).key);
    if (!(metric in totals)) reject(`"${metric}" is not a figure this binding works out.`, { metric });
    return { shaped: { shape: 'single-metric', value: totals[metric] ?? null }, targetTable: target?.resolved.id ?? null };
  }

  const names = input.named ? await peopleNames(input.meta, [...people.keys()]) : new Map<string, string>();
  const rows = [...people].map(([id, of]) => {
    const goal = targets.get(id);
    return {
      person: id === '' ? null : id,
      // Nobody's rows are a line of their own, so the lines add up to the team's; a person not named is never their id.
      name: id === '' ? '—' : (names.get(id) ?? input.unnamed),
      ...of,
      ...(target === null ? {} : { target: goal ?? null }),
      ...(team.cover === undefined ? {} : { cover: coverOf(of, goal) }),
    };
  });
  rows.sort((a, b) => Number(a.person === null) - Number(b.person === null) || a.name.localeCompare(b.name) || String(a.person).localeCompare(String(b.person)));
  const limit = Math.min(descriptor.limit ?? 200, 1000);
  const number = (name: string): ColumnMeta => ({ name, logicalType: 'decimal', nullable: true, isPrimaryKey: false });
  const shaped: ShapedTeamList = {
    shape: 'record-list',
    rows: rows.slice(0, limit),
    columns: [
      { name: 'name', logicalType: 'varchar', nullable: false, isPrimaryKey: false },
      ...figures.map((figure) => number(figure.key)),
      ...(target === null ? [] : [number('target')]),
      ...(team.cover === undefined ? [] : [number('cover')]),
    ],
    total: rows.length,
    key: 'person',
    totals,
  };
  return { shaped, targetTable: target?.resolved.id ?? null };
}
