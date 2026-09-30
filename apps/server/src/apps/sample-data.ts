// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's sample data: added in one go, remembered row by row, and taken out
 * again without touching anything the operator made or changed.
 *
 * ── THE LEDGER ─────────────────────────────────────────────────────────────
 * `<prefix>sample_data` in the operator's own database, one row per sample
 * record: its order, its table, its key (canonical JSON, as TEXT — a json
 * column reorders keys on Postgres and MySQL), its label, and hashes of the row
 * as it was read back. It is made on the first add, recorded with role
 * `sample-ledger`, excluded from CRUD and endpoints by an override, and left
 * out of page generation. Files the sample added are ledger rows too
 * (`table_ref = '@file'`), and so are the rows a removal kept
 * (`'@kept:<ref>'`): a `table_ref` starting with `@` is bookkeeping, never a
 * sample row — the outbox's exact match on the ref already passes it by.
 *
 * ── ADD ────────────────────────────────────────────────────────────────────
 * The bundle is checked first; its images go to the Files library (and to the
 * bin if anything later fails); then every row is written in ONE transaction,
 * parents first, through the same column rules a person's write goes through
 * but with no hooks and no automations — a demo booking must not send email.
 * A failure anywhere rolls the whole add back.
 *
 * A row the last removal kept is not written twice: a bundle row with the
 * same identity (its `@label`, or the key it names itself) takes the kept row
 * back instead — its entry returns to the ledger and the other sample rows
 * point at it. Only while it reads exactly as the sample wrote it, over every
 * column the ledger hashed: a row the operator changed since, or a key the
 * database handed to another row, is theirs, and the sample writes its own
 * copy beside it. The row itself is never written to (bar the totals a table
 * keeps, settled as for every sample row). Kept entries nothing took back
 * leave the ledger when the add is done.
 *
 * ── REMOVE ─────────────────────────────────────────────────────────────────
 * A preview first: how many per table; which sample rows the operator's own
 * records still point at (kept, with the rows they point at in turn and the
 * rows their lock ties to them — a document's lines stay with it); which
 * the operator changed since (kept when they ask). Then, in ONE transaction,
 * the rest are deleted in reverse order, then their ledger entries: a row
 * that stays is the operator's from then on — their records use it, or they
 * changed it — so the app reads "not loaded". Its entry stays as `@kept:`, the
 * one thing that lets the next add take it back rather than copy it. A
 * reference the scan missed makes the database refuse, and nothing is removed.
 */
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import {
  byClockSchema,
  byStaySchema,
  isoDurationMs,
  prefixFor,
  ROW_DIRECTIVES,
  sampleBundleIssues,
  sampleBundleSchema,
  sampleDirective,
  shareCodeColumns,
  type Manifest,
  type SampleBundle,
} from '@adminium/manifest';
import {
  appTablesRepo,
  auditRepo,
  connectionTenantConfig,
  filesRepo,
  isId,
  jobsRepo,
  newId,
  readJson,
  type Job,
  overridesRepo,
  snapshotsRepo,
  type MetaDb,
} from '@adminium/meta';

import type { AppStore } from './store.js';
import { applyOverrides, type EffectiveModel } from '../connections/effective-schema.js';
import { runIntrospection } from '../connections/introspect.js';
import type { ConnectionManager, DataHandle, SourceDatabase } from '../connections/manager.js';
import { SnapshotView, type ResolvedTable } from '../crud/identifiers.js';
import { literalDefault, tableRulesFor } from '../crud/column-rules.js';
import { isUniqueViolation } from '../crud/decided-columns.js';
import { labelColumnFor } from '../crud/labels.js';
import { renderNow } from '../crud/instants.js';
import { createWriteService, deleteRows, insertRow, type WriteContext, type WriteTarget } from '../crud/write-service.js';
import { fetchByPk } from '../crud/records.js';
import { writeStores } from '../crud/write-stores.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';
import type { FileStore } from '../files/store.js';
import type { JobHandlerContext, JobRegistry } from '../jobs/registry.js';
import type { Row } from '../crud/mask.js';
import { Reads } from '../crud/capacity/count.js';
import { slotDays } from '../crud/capacity/placement.js';
import { slotKey as countKey } from '../crud/capacity/count.js';
import { tallyFor } from '../crud/capacity/judge.js';
import { rulesFor } from '../crud/capacity/rules.js';

export interface SampleDataDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  store: AppStore;
  files: FileStore;
  /** Tell open dashboards their data moved; absent in a bare composition. */
  publish?: ((connectionId: string) => Promise<void>) | undefined;
}

/** The installed app a sample-data call is about. */
export interface SampleApp {
  key: string;
  version: string;
  manifestId: string;
  connectionId: string | null;
  manifest: Manifest;
}

const FILE_REF = '@file';
/** A row a removal kept, as its ledger entry remembers it: `@kept:<ref>`. */
const KEPT_PREFIX = '@kept:';
/** The ledger's `table_ref` width. */
const REF_WIDTH = 64;

// ── pure helpers ──────────────────────────────────────────────────────────

/** JSON with every object's keys sorted: one spelling for one value. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  return JSON.stringify(value ?? null);
}

/**
 * One value, spelled the same whatever the engine handed back: a decimal
 * without trailing zeros, a boolean as true/false, a timestamp as a UTC
 * instant, a JSON document with sorted keys.
 */
export function normaliseValue(value: unknown, logicalType: string): string | null {
  if (value === null || value === undefined) return null;
  switch (logicalType) {
    case 'integer':
    case 'bigint':
      return typeof value === 'number' ? String(Math.trunc(value)) : String(value).trim();
    case 'decimal':
    case 'float': {
      const text = typeof value === 'number' ? String(value) : String(value).trim();
      if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
      const [whole, fraction = ''] = text.split('.');
      const trimmed = fraction.replace(/0+$/, '');
      return trimmed === '' ? String(BigInt(whole!)) : `${String(BigInt(whole!))}.${trimmed}`.replace(/^0\./, '0.');
    }
    case 'boolean':
      return value === true || value === 1 || value === '1' || value === 't' || value === 'true' ? 'true' : 'false';
    case 'date': {
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      return String(value).slice(0, 10);
    }
    case 'timestamp':
    case 'timestamptz': {
      if (value instanceof Date) return value.toISOString();
      // A zone-less spelling is the server's own wall clock, which is how the
      // write path stores a naive timestamp (`crud/write-values.ts`).
      const time = Date.parse(String(value).trim().replace(' ', 'T'));
      return Number.isNaN(time) ? String(value) : new Date(time).toISOString();
    }
    case 'json':
      return canonicalJson(typeof value === 'string' ? safeJson(value) : value);
    default:
      if (Buffer.isBuffer(value)) return value.toString('hex');
      return String(value);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * A key in a ledger row's column hashes, beside the columns: the row was
 * recorded since a date reads as its `YYYY-MM-DD` day on every engine. A row
 * without it, on Postgres or MySQL, was recorded when the driver handed a
 * date back as a JavaScript date at this server's local midnight, and its
 * date columns were hashed as that instant's UTC day — the day before, east
 * of UTC. It is measured the same way, or every such row would read as
 * changed and stay when the sample is removed.
 */
export const LEDGER_DATES_AS_DAYS = '@dates-as-days';

/** The day a Postgres or MySQL date was hashed as before it read as text: the UTC day of its local midnight. */
function localMidnightDay(day: string | null): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (parts === null) return day;
  const at = new Date(0);
  at.setFullYear(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  at.setHours(0, 0, 0, 0);
  return Number.isNaN(at.getTime()) ? day : at.toISOString().slice(0, 10);
}

/**
 * The row's hash and each column's, as read back — what a later change is
 * measured against. `datesAtLocalMidnight` measures a ledger row recorded
 * before dates read as days ({@link LEDGER_DATES_AS_DAYS}).
 */
export function hashRow(
  row: Row,
  table: ResolvedTable,
  datesAtLocalMidnight = false,
): { rowHash: string; colHashes: Record<string, string> } {
  const normal: Record<string, string | null> = {};
  for (const column of table.table.columns) {
    if (!(column.name in row)) continue;
    const value = normaliseValue(row[column.name], column.logicalType);
    normal[column.name] = datesAtLocalMidnight && column.logicalType === 'date' ? localMidnightDay(value) : value;
  }
  const colHashes: Record<string, string> = {};
  for (const [name, value] of Object.entries(normal)) colHashes[name] = sha256(JSON.stringify(value)).slice(0, 16);
  return { rowHash: sha256(canonicalJson(normal)), colHashes };
}

/** The UTC instant of a wall-clock time in `timeZone`. */
export function zonedWallTime(date: { y: number; m: number; d: number }, time: string, timeZone: string): Date {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(date.y, date.m - 1, date.d, hh, mm);
  const offset = zoneOffsetMs(timeZone, guess);
  let utc = guess - offset;
  // Across a clock change the first guess can land an hour out; one more pass settles it.
  const again = zoneOffsetMs(timeZone, utc);
  if (again !== offset) utc = guess - again;
  return new Date(utc);
}

/**
 * The first time at or after `instant` that falls on a `grid`-minute step of
 * the venue's own clock, counted from its midnight: 12:07 on a 15-minute grid
 * is 12:15, and 12:15 stays 12:15.
 */
export function onVenueGrid(instant: number, grid: number, timeZone: string): Date {
  const local = instant + zoneOffsetMs(timeZone, instant);
  const midnight = Math.floor(local / 86_400_000) * 86_400_000;
  const step = grid * 60_000;
  // Never past the next midnight, which starts the next day's grid.
  const rounded = new Date(midnight + Math.min(Math.ceil((local - midnight) / step) * step, 86_400_000));
  const time = `${pad2(rounded.getUTCHours())}:${pad2(rounded.getUTCMinutes())}`;
  return zonedWallTime({ y: rounded.getUTCFullYear(), m: rounded.getUTCMonth() + 1, d: rounded.getUTCDate() }, time, timeZone);
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function zoneOffsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((local - instant) / 60_000) * 60_000;
}

/** Today's date in `timeZone`, moved by `days`. */
function zonedDay(now: number, timeZone: string, days: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(now),
  );
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const shifted = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** The text for the adding person's language: theirs, their language, US English, any. */
export function pickText(texts: Readonly<Record<string, string>>, locale: string): string {
  const tag = locale.replace('_', '-');
  if (texts[tag] !== undefined) return texts[tag]!;
  const language = tag.split('-')[0];
  const near = Object.entries(texts).find(([key]) => key.split('-')[0] === language);
  if (near !== undefined) return near[1];
  return texts['en-US'] ?? Object.values(texts)[0] ?? '';
}

export interface ResolveContext {
  now: number;
  timeZone: string;
  locale: string;
  /** Label → the row's key value. */
  labels: ReadonlyMap<string, unknown>;
  /** Asset label → Files library id. */
  assets: ReadonlyMap<string, string>;
  /** The weekday the bundle's `@week` days count from. */
  weekAnchor?: string | undefined;
  /**
   * The open times of a table's slot limits the sample's rows take, placed
   * before the rows are resolved, in row order, per table and earliest instant
   * asked (`slotKey`): each row takes the next one.
   */
  slotTimes?: ReadonlyMap<string, (Date | null)[]> | undefined;
}

/** What `ResolveContext.slotTimes` is keyed by: the table and the earliest instant asked. */
export const slotKey = (table: string, earliest: number) => `${table}\u0000${String(earliest)}`;

const WEEKDAY_INDEX: Readonly<Record<string, number>> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

/**
 * The day with the bundle's anchor weekday nearest today in `timeZone` (at
 * most three days either side), moved by `days`: a sample's dates keep the
 * weekdays they were written for.
 */
export function zonedWeekDay(now: number, timeZone: string, anchor: string, days: number): { y: number; m: number; d: number } {
  const today = zonedDay(now, timeZone, 0);
  const at = new Date(Date.UTC(today.y, today.m - 1, today.d));
  const weekday = (at.getUTCDay() + 6) % 7;
  let shift = (WEEKDAY_INDEX[anchor] ?? weekday) - weekday;
  if (shift > 3) shift -= 7;
  if (shift < -3) shift += 7;
  at.setUTCDate(at.getUTCDate() + shift + days);
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
}

/**
 * The day `n` working days (Monday to Friday) from today in `timeZone`; day 0
 * on a weekend is the Monday after, so a sample's "today" is a working day.
 */
function zonedWorkday(now: number, timeZone: string, n: number): { y: number; m: number; d: number } {
  const today = zonedDay(now, timeZone, 0);
  const at = new Date(Date.UTC(today.y, today.m - 1, today.d));
  const weekend = (date: Date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;
  while (weekend(at)) at.setUTCDate(at.getUTCDate() + 1);
  for (let left = Math.abs(n); left > 0; ) {
    at.setUTCDate(at.getUTCDate() + Math.sign(n));
    if (!weekend(at)) left -= 1;
  }
  return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
}

/**
 * Day `dom` of the month `months` from this one in `timeZone`: the month's
 * last day when it has fewer, and today when that day has not come yet.
 */
export function zonedMonthDay(now: number, timeZone: string, months: number, dom: number): { y: number; m: number; d: number; today: boolean } {
  const today = zonedDay(now, timeZone, 0);
  const first = new Date(Date.UTC(today.y, today.m - 1 + months, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = { y, m, d: Math.min(dom, last) };
  const later = day.y * 10_000 + day.m * 100 + day.d >= today.y * 10_000 + today.m * 100 + today.d;
  return later ? { ...today, today: true } : { ...day, today: false };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Half an hour either side of the adding moment is "around" it. */
const AROUND_MS = 30 * 60_000;

/**
 * One sample row, with every directive replaced by its value — or null when
 * its `@byClock` set says to leave it out.
 */
export function resolveSampleRow(row: Readonly<Record<string, unknown>>, ctx: ResolveContext): Row | null {
  const chosen = chooseSampleRow(row, ctx);
  return chosen === null ? null : resolveValues(chosen, ctx);
}

/**
 * A row's columns with its `@byClock` / `@byStay` branch for the adding
 * moment in, still unresolved; null when that branch leaves the row out.
 */
export function chooseSampleRow(row: Readonly<Record<string, unknown>>, ctx: ResolveContext): Readonly<Record<string, unknown>> | null {
  const clock = row['@byClock'] === undefined ? null : byClockSchema.parse(row['@byClock']);
  const stay = row['@byStay'] === undefined ? null : byStaySchema.parse(row['@byStay']);
  let values: Readonly<Record<string, unknown>> = row;
  if (stay !== null) {
    // The row's arrival and departure, against the adding moment: before its stay, during it, or after it.
    const edge = (end: 'from' | 'to'): number => {
      const when = resolveValues({ at: typeof stay[end] === 'string' ? row[stay[end]] : stay[end] }, ctx)['at'];
      if (when instanceof Date) return when.getTime();
      const day = typeof when === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(when.trim()) : null;
      if (day === null) return Number.NaN;
      return zonedWallTime({ y: Number(day[1]), m: Number(day[2]), d: Number(day[3]) }, stay.times?.[end] ?? '00:00', ctx.timeZone).getTime();
    };
    const from = edge('from');
    const to = edge('to');
    const branch = Number.isNaN(from) || Number.isNaN(to) ? undefined : ctx.now < from ? stay.before : ctx.now < to ? stay.during : stay.after;
    if (branch?.['@skip'] === true) return null;
    const { ['@skip']: _skip, ...columns } = branch ?? {};
    values = { ...row, ...columns };
  } else if (clock !== null) {
    // The row's own time, against the adding moment.
    const when = resolveValues({ at: typeof clock.at === 'string' ? row[clock.at] : clock.at }, ctx)['at'];
    const instant = when instanceof Date ? when.getTime() : Number.NaN;
    const branch = Number.isNaN(instant)
      ? undefined
      : instant < ctx.now - AROUND_MS
        ? clock.before
        : instant <= ctx.now + AROUND_MS
          ? clock.around
          : clock.after;
    if (branch?.['@skip'] === true) return null;
    const { ['@skip']: _skip, ...columns } = branch ?? {};
    values = { ...row, ...columns };
  }
  return values;
}

/**
 * A row left out still takes its place in the slot-time queues its `@in`
 * times would have used, so the rows after it get the times meant for them.
 */
export function releaseSlots(values: Readonly<Record<string, unknown>>, ctx: ResolveContext): void {
  for (const [column, value] of Object.entries(values)) {
    if (ROW_DIRECTIVES.has(column)) continue;
    const found = sampleDirective(value);
    if (found?.kind === 'in' && found.slot !== null) ctx.slotTimes?.get(slotKey(found.slot, ctx.now + isoDurationMs(found.duration)))?.shift();
  }
}

function resolveValues(row: Readonly<Record<string, unknown>>, ctx: ResolveContext): Row {
  const out: Row = {};
  for (const [column, value] of Object.entries(row)) {
    if (ROW_DIRECTIVES.has(column)) continue;
    const found = sampleDirective(value);
    if (found === null) {
      out[column] = value;
      continue;
    }
    switch (found.kind) {
      case 'ref': {
        if (!ctx.labels.has(found.label)) throw new ValidationFailedError(`The sample row "${found.label}" was not written.`);
        out[column] = ctx.labels.get(found.label);
        break;
      }
      // An instant: spelled for its column and engine by the caller.
      case 'ago':
        out[column] = new Date(ctx.now - isoDurationMs(found.duration));
        break;
      case 'in': {
        const at = ctx.now + isoDurationMs(found.duration);
        // On a slot limit: its first open time from then on (found beforehand); a limit with none in reach keeps the plain time.
        const slot = found.slot === null ? undefined : ctx.slotTimes?.get(slotKey(found.slot, at))?.shift();
        out[column] = slot instanceof Date ? slot : found.grid === null ? new Date(at) : onVenueGrid(at, found.grid, ctx.timeZone);
        break;
      }
      case 'wall': {
        const day = dayOf(found, ctx);
        out[column] = zonedWallTime(day, found.time, ctx.timeZone);
        break;
      }
      // A date is the venue's day, spelled as the day — never the server's.
      case 'date': {
        const day = dayOf(found, ctx);
        out[column] = `${String(day.y).padStart(4, '0')}-${pad2(day.m)}-${pad2(day.d)}`;
        break;
      }
      // History in calendar months: never later than the adding moment.
      case 'month': {
        const day = zonedMonthDay(ctx.now, ctx.timeZone, found.months, found.dom);
        if (found.time === null) {
          out[column] = `${String(day.y).padStart(4, '0')}-${pad2(day.m)}-${pad2(day.d)}`;
        } else {
          const at = zonedWallTime(day, found.time, ctx.timeZone);
          out[column] = day.today && at.getTime() > ctx.now ? new Date(ctx.now) : at;
        }
        break;
      }
      case 't':
        out[column] = pickText(found.texts, ctx.locale);
        break;
      case 'asset': {
        const id = ctx.assets.get(found.label);
        if (id === undefined) throw new ValidationFailedError(`The sample asset "${found.label}" was not added.`);
        out[column] = id;
        break;
      }
    }
  }
  return out;
}

/** The venue day a `@day` names: from today, in working days, or from the bundle's week anchor. */
function dayOf(found: { day: number; workdays: boolean; week: boolean }, ctx: ResolveContext): { y: number; m: number; d: number } {
  if (found.week && ctx.weekAnchor !== undefined) return zonedWeekDay(ctx.now, ctx.timeZone, ctx.weekAnchor, found.day);
  return found.workdays ? zonedWorkday(ctx.now, ctx.timeZone, found.day) : zonedDay(ctx.now, ctx.timeZone, found.day);
}

/** Every `@in` on a slot limit in a bundle (a column's, or one a row directive sets), in row order: its table, duration and row. */
export function slotAsks(bundle: SampleBundle): { table: string; duration: string; row: Readonly<Record<string, unknown>> }[] {
  const out: { table: string; duration: string; row: Readonly<Record<string, unknown>> }[] = [];
  let row: Readonly<Record<string, unknown>> = {};
  const look = (value: unknown, depth: number) => {
    const found = sampleDirective(value);
    if (found?.kind === 'in' && found.slot !== null) out.push({ table: found.slot, duration: found.duration, row });
    else if (found === null && depth < 2 && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const inner of Object.values(value as Record<string, unknown>)) look(inner, depth + 1);
    }
  };
  for (const table of bundle.tables) {
    for (const one of table.rows) {
      row = one;
      for (const [key, value] of Object.entries(one)) look(value, key === '@byClock' || key === '@byStay' ? 0 : 1);
    }
  }
  return out;
}

/** Places a sample's rows on a table's slot limit, each on the first open time with room for it. */
export interface SlotPlacer {
  /** The first open time at or after `earliest` with room for `row` beside the rows already there and those placed before it; null for none. */
  place(earliest: number, row: Readonly<Record<string, unknown>>): Promise<Date | null>;
}

/**
 * A placer over a table's slot limit, or null when it keeps none. A time is
 * open on the limit's grid on each day it opens (its hours, or its opening and
 * closing), never on a closed day nor a paused time — today, or the next day
 * it opens, up to two weeks on — and has room while what its counted rows
 * take, with the sample's rows placed on it so far, leaves room for the row:
 * a sample never fills a time past its limit, so a guest never finds it full
 * by the sample's doing alone.
 */
export async function slotPlacer(
  target: { connectionId: string; view: SnapshotView; table: ResolvedTable; db: Kysely<SourceDatabase>; dialect: DataHandle['dialect'] },
  timeZone: string,
  now: number,
): Promise<SlotPlacer | null> {
  const rule = rulesFor(target.view, target.table).find((candidate) => candidate.kind === 'slot');
  if (rule === undefined || rule.kind !== 'slot') return null;
  const reads = new Reads(target.db);
  const size = await reads.number(rule.rule.perSlot);
  const placed = new Map<number, number>();
  const stored = new Map<number, number>();
  const judged = { ...target, timezone: timeZone } as unknown as WriteTarget;
  return {
    async place(earliest, row) {
      const raw = 'value' in rule.amount ? rule.amount.value : Number(row[rule.amount.column] ?? 1);
      const amount = Number.isFinite(raw) && raw > 0 ? raw : 1;
      const first = zonedDay(earliest, timeZone, -1);
      const days = Array.from({ length: 16 }, (_, i) => new Date(Date.UTC(first.y, first.m - 1, first.d + i)).toISOString().slice(0, 10));
      const grid = await slotDays(rule, reads, timeZone, days);
      const open = grid.flatMap((day) => (day.closed ? [] : day.slots.filter((slot) => slot.instant.getTime() >= earliest && !day.paused.has(slot.instant.getTime())).map((slot) => ({ day: day.day, slot }))));
      // What the rows already there take of each time, counted once.
      const unread = open.filter(({ slot }) => !stored.has(slot.instant.getTime()));
      if (size !== null && unread.length > 0) {
        const states = await tallyFor(target.db, judged, rule, unread.map(({ day, slot }) => ({ part: 's', key: countKey(slot.instant, null), at: day })), new Date(now), [], 'staff', reads);
        const byKey = new Map(states.map((state) => [state.key, state.taken]));
        for (const { slot } of unread) stored.set(slot.instant.getTime(), byKey.get(slot.instant.toISOString()) ?? 0);
      }
      for (const { slot } of open) {
        const at = slot.instant.getTime();
        const taken = (stored.get(at) ?? 0) + (placed.get(at) ?? 0);
        if (size !== null && taken + amount > size) continue;
        placed.set(at, (placed.get(at) ?? 0) + amount);
        return slot.instant;
      }
      return null;
    },
  };
}

/**
 * A resolved instant, spelled the way the ordinary write path spells "now"
 * for that column and engine — a zoned instant, a naive local timestamp, a
 * date — so a sample row stores exactly what a person's would.
 */
function spellInstants(values: Row, table: ResolvedTable): Row {
  const out: Row = {};
  for (const [column, value] of Object.entries(values)) {
    if (!(value instanceof Date)) {
      out[column] = value;
      continue;
    }
    const shape = table.table.columns.find((candidate) => candidate.name === column);
    // A venue-local column reads a zone-less time as the VENUE's wall clock;
    // the server's would be off by the difference. The instant goes as it is.
    if (shape?.venueLocal === true) {
      out[column] = value.toISOString();
      continue;
    }
    out[column] = (shape === undefined ? null : renderNow(shape, value)) ?? value.toISOString();
  }
  return out;
}

/** Key types an identity sequence counts in. */
const INTEGER_TYPES = new Set(['integer', 'bigint', 'smallint']);

const MIME_BY_EXTENSION: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// ── the service ───────────────────────────────────────────────────────────

/** The bundle file the app's manifest names, if it ships one. */
export function sampleFileOf(manifest: Manifest): string | undefined {
  return 'sampleData' in manifest ? manifest.sampleData?.file : undefined;
}

/** The ledger table's name for an app: in its prefix, or its key when it has none. */
export function ledgerNameFor(manifest: Manifest): string {
  const prefix = manifest.requiredSchema?.prefixed === true ? prefixFor(manifest.key) : `${manifest.key.replace(/-/g, '_')}_`;
  return `${prefix}sample_data`;
}

interface LedgerRow {
  seq: number;
  table_ref: string;
  pk: string;
  label: string | null;
  row_hash: string;
  col_hashes: string;
  created_at: number | string;
}

/** An entry for a sample row now: not a file, not a row a removal kept. */
const isSampleRow = (row: LedgerRow): boolean => !row.table_ref.startsWith('@');

/**
 * A sample row's identity across adds: its `@label`, or else the key it names
 * itself, spelled one way whatever the engine hands back; null when it has
 * neither, and so cannot be recognised.
 */
function identityOf(ref: string, label: string | null, key: Row | null, table: ResolvedTable): string | null {
  if (label !== null) return `${ref}\u0000label\u0000${label}`;
  if (key === null || table.primaryKey.length === 0) return null;
  const normal: Record<string, string | null> = {};
  for (const column of table.primaryKey) {
    if (key[column] === undefined || key[column] === null) return null;
    const logicalType = table.columns.get(column)?.logicalType ?? 'text';
    const value = normaliseValue(key[column], logicalType);
    // Postgres hands a uuid back in lower case, whatever the bundle wrote.
    normal[column] = logicalType === 'uuid' ? (value?.toLowerCase() ?? null) : value;
  }
  return `${ref}\u0000key\u0000${canonicalJson(normal)}`;
}

/**
 * How a row of `table` is part of a row of another: a document's lines are
 * part of it (its lock ties them to it), and the rows a part's own totals add
 * up are part of that part (an order line's chosen options, which make its
 * price). `ofParts` links count only under a row that is itself a part, so a
 * customer never takes in the orders its totals count.
 */
function partLinks(view: SnapshotView, table: ResolvedTable): { parent: string; via: string; ofParts: boolean }[] {
  return [
    ...(table.table.stateParents ?? []).filter((parent) => parent.lock === true).map((parent) => ({ parent: parent.table, via: parent.via, ofParts: false })),
    ...(tableRulesFor({ view, table })?.rollupsInto ?? []).map((rollup) => ({ parent: rollup.parent, via: rollup.via, ofParts: true })),
  ];
}

/** Whether a row is a document's line: its lock ties it to a parent it names. */
function lockTied(table: ResolvedTable, row: Row): boolean {
  return (table.table.stateParents ?? []).some((parent) => parent.lock === true && row[parent.via] !== null && row[parent.via] !== undefined);
}

/**
 * Whether a row is a part of a record (`partLinks`): a document's line, or
 * what a line adds up (a rollup into a table whose rows are lines). A part
 * comes back only with its record: taken back on its own, it would name the
 * record the operator kept and leave the sample's fresh copy of it empty.
 */
function isPart(view: SnapshotView, table: ResolvedTable, row: Row): boolean {
  return partLinks(view, table).some((link) => {
    if (row[link.via] === null || row[link.via] === undefined) return false;
    if (!link.ofParts) return true;
    return (safeTable(view, link.parent)?.table.stateParents ?? []).some((parent) => parent.lock === true);
  });
}

/** Every label a bundle value points at (`{"@ref": label}`), in a column or a `@byClock` / `@byStay` branch. */
function refsIn(value: unknown): string[] {
  const found = sampleDirective(value);
  if (found !== null) return found.kind === 'ref' ? [found.label] : [];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(refsIn);
}

/**
 * Whether a kept row still reads as the sample wrote it, over every column its
 * entry hashed (a column an app update added since does not count). Anything
 * else — changed, gone, or a reused key now holding another row — is not the
 * sample's to take back. Measured as the removal measured it: the
 * {@link LEDGER_DATES_AS_DAYS} mark is not a column, and an entry recorded
 * without it hashed a Postgres or MySQL date as its local midnight's UTC day.
 */
function unchangedSince(entry: LedgerRow, now: Row, table: ResolvedTable, dialect: string): boolean {
  let before: Record<string, string>;
  try {
    before = JSON.parse(entry.col_hashes) as Record<string, string>;
  } catch {
    return false;
  }
  const recordedAsDays = Object.prototype.hasOwnProperty.call(before, LEDGER_DATES_AS_DAYS);
  delete before[LEDGER_DATES_AS_DAYS];
  const recorded = Object.keys(before);
  if (recorded.length === 0) return false;
  const { colHashes } = hashRow(now, table, dialect !== 'sqlite' && !recordedAsDays);
  return recorded.every((column) => colHashes[column] === before[column]);
}

function asDb(db: unknown): Kysely<SourceDatabase> {
  return db as Kysely<SourceDatabase>;
}

/**
 * A sample row a write of Adminium's own moved (a timed move: a held sample
 * order expired) recorded again as it now stands, so "Remove sample data"
 * still takes it for the app's own rather than a row somebody changed. A row
 * no sample brought in is left alone.
 */
export async function rehashSampleRow(
  meta: MetaDb,
  target: { connectionId: string; db: Kysely<SourceDatabase>; dialect: string; table: ResolvedTable },
  pk: Row,
): Promise<void> {
  const records = await appTablesRepo(meta).forConnection(target.connectionId);
  const own = records.find((record) => record.role === 'app' && record.tableName === target.table.name);
  if (own === undefined) return;
  const ledger = records.find((record) => record.role === 'sample-ledger' && record.appKey === own.appKey && record.state === 'created');
  if (ledger === undefined) return;
  const db = asDb(target.db);
  const found = (await sql<LedgerRow>`SELECT * FROM ${sql.table(ledger.tableName)} WHERE table_ref = ${own.ref} AND pk = ${canonicalJson(pk)}`.execute(db)).rows[0];
  if (found === undefined) return;
  const now = await fetchByPk(db, target.table, pk);
  if (now === undefined) return;
  const recordedAsDays = Object.prototype.hasOwnProperty.call(JSON.parse(found.col_hashes) as object, LEDGER_DATES_AS_DAYS);
  const { rowHash, colHashes } = hashRow(now, target.table, target.dialect !== 'sqlite' && !recordedAsDays);
  await db
    .updateTable(ledger.tableName as never)
    .set({ row_hash: rowHash, col_hashes: JSON.stringify(recordedAsDays ? { ...colHashes, [LEDGER_DATES_AS_DAYS]: '1' } : colHashes) } as never)
    .where('seq' as never, '=', found.seq as never)
    .execute();
}

export function createSampleDataService(deps: SampleDataDeps) {
  const records = appTablesRepo(deps.meta);

  async function connectionOf(app: SampleApp): Promise<string> {
    if (app.connectionId === null) {
      throw new ValidationFailedError(`"${app.key}" is installed without a database, so it has no sample data.`);
    }
    return app.connectionId;
  }

  async function ledgerRecord(app: SampleApp, connectionId: string) {
    return (await records.forInstall(connectionId, app.key)).find(
      (record) => record.role === 'sample-ledger' && record.state === 'created',
    );
  }

  async function loadBundle(app: SampleApp): Promise<SampleBundle> {
    const file = sampleFileOf(app.manifest);
    if (file === undefined) {
      throw new NotFoundError(`"${app.key}" ships no sample data.`, { reason: 'NO_SAMPLE_DATA' });
    }
    const { bytes } = await deps.store.readVerifiedFile(app.key, app.version, file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new ValidationFailedError(`"${file}" is not JSON.`, { reason: 'SAMPLE_INVALID' });
    }
    const bundle = sampleBundleSchema.safeParse(parsed);
    if (!bundle.success) {
      throw new ValidationFailedError(`"${file}" is not an adminium.sample/1 bundle.`, {
        reason: 'SAMPLE_INVALID',
        issues: bundle.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    const issues = sampleBundleIssues(bundle.data, app.manifest);
    if (issues.length > 0) {
      throw new ValidationFailedError(`"${file}" does not fit this app.`, { reason: 'SAMPLE_INVALID', issues });
    }
    return bundle.data;
  }

  async function viewFor(connectionId: string): Promise<SnapshotView> {
    const snapshot = await snapshotsRepo(deps.meta).latest(connectionId);
    if (snapshot === null) throw new NotFoundError('No schema snapshot yet — run introspection first.');
    const active = await overridesRepo(deps.meta).listForConnection(connectionId, { status: 'active' });
    return new SnapshotView(connectionId, applyOverrides(snapshot.schema as never, active));
  }

  async function modelFor(connectionId: string): Promise<EffectiveModel> {
    return (await viewFor(connectionId)).model;
  }

  /** Make the ledger on the first add, record it, and keep it out of CRUD and endpoints. */
  async function ensureLedger(app: SampleApp, connectionId: string, handle: DataHandle): Promise<string> {
    const existing = await ledgerRecord(app, connectionId);
    if (existing !== undefined) return existing.tableName;
    const name = ledgerNameFor(app.manifest);
    await asDb(handle.db)
      .schema.createTable(name)
      .ifNotExists()
      .addColumn('seq', 'integer', (col) => col.primaryKey())
      .addColumn('table_ref', 'varchar(64)', (col) => col.notNull())
      .addColumn('pk', 'text', (col) => col.notNull())
      .addColumn('label', 'varchar(96)')
      .addColumn('row_hash', 'varchar(64)', (col) => col.notNull())
      .addColumn('col_hashes', 'text', (col) => col.notNull())
      .addColumn('created_at', 'bigint', (col) => col.notNull())
      .execute();
    await records.record({
      appKey: app.key,
      manifestId: app.manifestId,
      connectionId,
      ref: 'sample_data',
      tableName: name,
      owned: true,
      state: 'created',
      role: 'sample-ledger',
    });
    await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
    const model = await modelFor(connectionId);
    const table = model.tables.find((candidate) => candidate.name === name);
    if (table !== undefined) {
      await overridesRepo(deps.meta).create({
        connectionId,
        op: 'table.exclude',
        tableName: table.id,
        value: { excluded: true },
        origin: 'app',
      });
    }
    return name;
  }

  async function ledgerRows(handle: DataHandle, ledger: string): Promise<LedgerRow[]> {
    const rows = await sql<LedgerRow>`SELECT * FROM ${sql.table(ledger)} ORDER BY seq`.execute(asDb(handle.db));
    return rows.rows.map((row) => ({ ...row, seq: Number(row.seq) }));
  }

  /**
   * The tables whose sample rows an add leaves out: the app's
   * `sampleData.skipWhenShared.skip`, when the table it watches is one
   * another installed app uses too (a shared menu) and already holds a real
   * row — one no installed app's sample data added. A venue's real menu then
   * never gains the sample dishes, nor sample orders of them.
   */
  async function skippedWhenShared(app: SampleApp, connectionId: string, handle: DataHandle, names: Readonly<Record<string, string>>): Promise<ReadonlySet<string>> {
    const rule = app.manifest.kind === 'app' ? app.manifest.sampleData?.skipWhenShared : undefined;
    const real = rule === undefined ? undefined : names[rule.table];
    if (rule === undefined || real === undefined) return new Set();
    const live = (state: string) => state === 'created' || state === 'adopted' || state === 'shared';
    const everyRecord = await records.forConnection(connectionId);
    const sharedWith = everyRecord.filter((r) => r.appKey !== app.key && r.role === 'app' && r.tableName === real && live(r.state));
    if (sharedWith.length === 0) return new Set();
    const view = await viewFor(connectionId);
    const table = view.table(real);
    const keyOf = (row: Readonly<Record<string, unknown>>) => table.primaryKey.map((column) => String(row[column])).join('\u0000');
    // Every row an installed app's sample data put in the table, by key.
    const sample = new Set<string>();
    for (const ledger of everyRecord.filter((r) => r.role === 'sample-ledger' && r.state === 'created')) {
      const refs = new Set(Object.entries(await records.realNames(connectionId, ledger.appKey)).filter(([, name]) => name === real).map(([ref]) => ref));
      if (refs.size === 0) continue;
      for (const row of await ledgerRows(handle, ledger.tableName)) {
        const key = safeJson(row.pk);
        if (refs.has(row.table_ref) && typeof key === 'object' && key !== null) sample.add(keyOf(key as Record<string, unknown>));
      }
    }
    const keys = (await asDb(handle.db)
      .selectFrom(table.id as never)
      .select(table.primaryKey.map((column) => sql.ref(column).as(column)))
      .execute()) as Record<string, unknown>[];
    return keys.some((key) => !sample.has(keyOf(key))) ? new Set(rule.skip) : new Set();
  }

  return {
    /** What is loaded now: counts per table and when it was added. */
    async status(app: SampleApp) {
      const offered = sampleFileOf(app.manifest) !== undefined;
      if (app.connectionId === null) return { offered, loaded: false, total: 0, addedAt: null, tables: [] };
      const ledger = await ledgerRecord(app, app.connectionId);
      if (ledger === undefined) return { offered, loaded: false, total: 0, addedAt: null, tables: [] };
      const handle = await deps.manager.data(app.connectionId);
      const rows = (await ledgerRows(handle, ledger.tableName)).filter(isSampleRow);
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.table_ref, (counts.get(row.table_ref) ?? 0) + 1);
      const first = rows.reduce<number | null>((min, row) => {
        const at = Number(row.created_at);
        return min === null || at < min ? at : min;
      }, null);
      return {
        offered,
        loaded: rows.length > 0,
        total: rows.length,
        addedAt: first,
        tables: [...counts.entries()].map(([ref, count]) => ({ ref, count })),
      };
    },

    /** What an add would write, per table, without writing it. */
    async addPreview(app: SampleApp) {
      const bundle = await loadBundle(app);
      // The tables a shared table's real rows keep the sample out of are not written: not listed.
      const skipped =
        app.connectionId === null || app.manifest.kind !== 'app' || app.manifest.sampleData?.skipWhenShared === undefined
          ? new Set<string>()
          : await skippedWhenShared(app, app.connectionId, await deps.manager.data(app.connectionId), await records.realNames(app.connectionId, app.key));
      const tables = bundle.tables.filter((table) => !skipped.has(table.ref));
      return {
        tables: tables.map((table) => ({ ref: table.ref, count: table.rows.length })),
        total: tables.reduce((sum, table) => sum + table.rows.length, 0),
        assets: Object.keys(bundle.assets).length,
      };
    },

    async add(
      app: SampleApp,
      opts: {
        locale: string;
        userId: string | null;
        userLabel: string;
        progress?: (pct: number, message: string) => void;
        now?: number;
      },
    ): Promise<{ counts: Record<string, number>; files: number }> {
      const connectionId = await connectionOf(app);
      const bundle = await loadBundle(app);
      const status = await this.status(app);
      if (status.loaded) {
        throw new ConflictError(`"${app.key}" already has its sample data. Remove it first to add it again.`, 'CONFLICT');
      }
      const now = opts.now ?? Date.now();
      const handle = await deps.manager.data(connectionId);
      const names = await records.realNames(connectionId, app.key);
      const timeZone = (await connectionTenantConfig(deps.meta, connectionId))?.timezone ?? 'UTC';
      const skipped = await skippedWhenShared(app, connectionId, handle, names);
      opts.progress?.(5, 'Checked the sample data');

      // Images first, into the Files library; to the bin if anything later fails.
      const fileIds = new Map<string, string>();
      const files = filesRepo(deps.meta);
      try {
        for (const [label, asset] of Object.entries(bundle.assets)) {
          const { bytes, sha256: actual } = await deps.store.readVerifiedFile(app.key, app.version, asset.file);
          if (actual !== asset.sha256) {
            throw new ValidationFailedError(`The sample image "${asset.file}" is not the file the bundle names.`, {
              reason: 'SAMPLE_INVALID',
            });
          }
          const id = newId('file');
          const filename = basename(asset.file);
          const mime = MIME_BY_EXTENSION[extname(filename).toLowerCase()] ?? 'application/octet-stream';
          const stored = await deps.files.write({ id, kind: 'upload', filename, mime, bytes });
          await files.create({
            id,
            filename,
            mime,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            storageKey: stored.storageKey,
            storage: stored.storage,
            destinationId: stored.destinationId,
            kind: 'upload',
            entityConnectionId: connectionId,
            uploadedBy: opts.userId,
            attachedAt: now,
          });
          fileIds.set(label, id);
        }
        opts.progress?.(20, 'Added the images');

        const ledger = await ensureLedger(app, connectionId, handle);
        const view = await viewFor(connectionId);
        const writes = createWriteService(writeStores(deps.meta));
        const context: WriteContext = {
          origin: 'import',
          hops: 0,
          actor: { kind: 'user', id: opts.userId, label: opts.userLabel },
          request: null,
        };
        const total = bundle.tables.reduce((sum, table) => sum + (skipped.has(table.ref) ? 0 : table.rows.length), 0);
        const counts: Record<string, number> = {};
        const explicitKeys = new Set<string>();
        let reused = 0;

        await handle.db.transaction().execute(async (trx) => {
          const db = asDb(trx);
          const labels = new Map<string, unknown>();
          /** The open times the sample's rows are placed on, per slot limit, found as each table comes (its hours may be the sample's own). */
          const slotTimes = new Map<string, (Date | null)[]>();
          const placers = new Map<string, SlotPlacer | null>();
          /** The rows of tables that keep totals, settled once every row is in. */
          const totals = new Map<string, { target: WriteTarget; rows: { seq: number; key: Row; record: Row }[] }>();
          const entries = (await sql<LedgerRow>`SELECT * FROM ${sql.table(ledger)} ORDER BY seq`.execute(db)).rows.map((row) => ({
            ...row,
            seq: Number(row.seq),
          }));
          /** The rows the last removal kept, by identity; each is taken back once at most. */
          const keptBy = new Map<string, LedgerRow>();
          /** Every kept row, by table: a parent taken back takes the rows its lock ties to it from here. */
          const keptByTable = new Map<string, LedgerRow[]>();
          for (const entry of entries) {
            if (!entry.table_ref.startsWith(KEPT_PREFIX)) continue;
            const ref = entry.table_ref.slice(KEPT_PREFIX.length);
            const table = safeTable(view, names[ref] ?? ref);
            if (table === null) continue;
            let key: Row | null = null;
            try {
              key = JSON.parse(entry.pk) as Row;
            } catch {
              continue;
            }
            const identity = identityOf(ref, entry.label, key, table);
            if (identity !== null && !keptBy.has(identity)) keptBy.set(identity, entry);
            keptByTable.set(ref, [...(keptByTable.get(ref) ?? []), entry]);
          }
          const adopted = new Set<number>();
          /** Files a row taken back still names: the sample's again, binned with it on the next removal. */
          const adoptedFiles = new Set<string>();
          /** The rows this add took back (`<table id>\u0000<key>`), each marked when it came back as a part: none of their parts is written. */
          const takenBack = new Map<string, boolean>();
          /** The labels of rows left out under a parent taken back that were not taken back themselves (changed, or gone). */
          const leftOut = new Set<string>();
          /** The kept rows that are part of a row (`partLinks`), by `<parent table id>\u0000<key>`: read once, on the first take-back. */
          const tied = new Map<string, { entry: LedgerRow; ref: string; table: ResolvedTable; row: Row; ofParts: boolean }[]>();
          let tiedRead = false;
          const tiedTo = async (parent: string, key: unknown) => {
            if (!tiedRead) {
              tiedRead = true;
              for (const [ref, kept] of keptByTable) {
                const table = safeTable(view, names[ref] ?? ref);
                const links = table === null ? [] : partLinks(view, table);
                if (table === null || links.length === 0) continue;
                for (const entry of kept) {
                  const row = await fetchByPk(db, table, JSON.parse(entry.pk) as Row);
                  if (row === undefined) continue;
                  for (const link of links) {
                    const via = row[link.via];
                    if (via === null || via === undefined) continue;
                    const at = `${link.parent}\u0000${String(via)}`;
                    tied.set(at, [...(tied.get(at) ?? []), { entry, ref, table, row, ofParts: link.ofParts }]);
                  }
                }
              }
            }
            return tied.get(`${parent}\u0000${String(key)}`) ?? [];
          };
          /*
           * A kept row, taken back as it reads now: its entry is re-hashed
           * (the same over the columns it had) and the rows after it point at
           * it by its label. Its parts (a document's lines, a terms version's
           * clauses, a line's chosen options) come back with it, each while it
           * reads as the sample wrote it: a document keeps the lines it has,
           * and the sample writes none under it (below), whatever its own lines
           * read as today — in another locale, on another day.
           */
          const takeBack = async (entry: LedgerRow, current: Row, ref: string, resolved: ResolvedTable, label: string | null, asPart = false): Promise<void> => {
            adopted.add(entry.seq);
            const key = Object.fromEntries(resolved.primaryKey.map((column) => [column, current[column]]));
            const single = resolved.primaryKey.length === 1 ? current[resolved.primaryKey[0]!] : undefined;
            if (label !== null) labels.set(label, single ?? key);
            // Hashed as it reads now, so recorded as every entry this add writes: dates as days.
            const { rowHash, colHashes } = hashRow(current, resolved);
            await db
              .updateTable(ledger as never)
              .set({
                table_ref: ref,
                row_hash: rowHash,
                col_hashes: JSON.stringify({ ...colHashes, [LEDGER_DATES_AS_DAYS]: '1' }),
                created_at: now,
              } as never)
              .where('seq' as never, '=', entry.seq as never)
              .execute();
            if ((tableRulesFor({ view, table: resolved })?.ownRollups?.length ?? 0) > 0) {
              const bucket = totals.get(ref) ?? { target: { connectionId, view, table: resolved, db, dialect: handle.dialect }, rows: [] as { seq: number; key: Row; record: Row }[] };
              bucket.rows.push({ seq: entry.seq, key, record: current });
              totals.set(ref, bucket);
            }
            for (const value of Object.values(current)) if (isId(value, 'file')) adoptedFiles.add(value as string);
            counts[ref] = (counts[ref] ?? 0) + 1;
            if (single === undefined || single === null) return;
            const part = asPart || lockTied(resolved, current);
            takenBack.set(`${resolved.id}\u0000${String(single)}`, part);
            for (const child of await tiedTo(resolved.id, single)) {
              if (child.ofParts && !part) continue;
              if (!adopted.has(child.entry.seq) && unchangedSince(child.entry, child.row, child.table, handle.dialect)) {
                await takeBack(child.entry, child.row, child.ref, child.table, child.entry.label, true);
              }
            }
          };
          // Kept entries hold their seq; new ones count on from the last.
          let seq = entries.reduce((max, entry) => Math.max(max, entry.seq), 0);
          let done = 0;
          for (const table of bundle.tables) {
            // A shared table already holding real rows keeps these tables' sample rows out.
            if (skipped.has(table.ref)) continue;
            /*
             * The totals so far, before the next table: its rows may copy one
             * (a stage of a quote copies the quote's subtotal), and a copy
             * reads the row as it stands. Settled again at the end, once
             * every child row is in.
             */
            for (const { target: parent, rows } of totals.values()) {
              await writes.settle('create', parent, rows.map((row) => ({ record: row.record, before: null })));
            }
            // The first open times this table's rows are timed on, read with the rows written so far (hours, closures) in.
            const own = safeTable(view, names[table.ref] ?? table.ref);
            for (const ask of slotAsks({ ...bundle, tables: [table] })) {
              const earliest = now + isoDurationMs(ask.duration);
              /*
               * A row the last removal kept, and that is taken back as it is:
               * it already holds its time, and the placer counts it there. It
               * takes no second time (its place kept in the queue, empty).
               */
              const label = typeof ask.row['@label'] === 'string' ? ask.row['@label'] : null;
              const identity = own === null ? null : identityOf(table.ref, label, ask.row as Row, own);
              const kept = identity === null ? undefined : keptBy.get(identity);
              if (kept !== undefined && own !== null) {
                const current = await fetchByPk(db, own, JSON.parse(kept.pk) as Row);
                if (current !== undefined && unchangedSince(kept, current, own, handle.dialect) && !isPart(view, own, current)) {
                  const key = slotKey(ask.table, earliest);
                  slotTimes.set(key, [...(slotTimes.get(key) ?? []), null]);
                  continue;
                }
              }
              let placer = placers.get(ask.table);
              if (placer === undefined) {
                const on = safeTable(view, names[ask.table] ?? ask.table);
                placer = on === null ? null : await slotPlacer({ connectionId, view, table: on, db, dialect: handle.dialect }, timeZone, now);
                placers.set(ask.table, placer);
              }
              const key = slotKey(ask.table, earliest);
              slotTimes.set(key, [...(slotTimes.get(key) ?? []), placer === null ? null : await placer.place(earliest, ask.row)]);
            }
            const resolved = view.table(names[table.ref] ?? table.ref);
            const target = { connectionId, view, table: resolved, db, dialect: handle.dialect };
            const keepsTotals = (tableRulesFor({ view, table: resolved })?.ownRollups?.length ?? 0) > 0;
            for (const row of table.rows) {
              const ctx: ResolveContext = { now, timeZone, locale: opts.locale, labels, assets: fileIds, weekAnchor: bundle.weekAnchor, slotTimes };
              const chosen = chooseSampleRow(row, ctx);
              // Its `@byClock` set left it out: a payment for a visit that has not happened yet.
              if (chosen === null) {
                done += 1;
                continue;
              }
              /*
               * A row that points at one left out goes too: it hung off a line
               * the record no longer has as the sample wrote it. Read from the
               * columns it would be written with (a branch not chosen does not
               * count), and it still takes its place in the slot-time queues.
               */
              const pointsAtLeftOut = Object.entries(chosen).some(([column, value]) => !ROW_DIRECTIVES.has(column) && refsIn(value).some((named) => leftOut.has(named)));
              if (leftOut.size > 0 && pointsAtLeftOut) {
                releaseSlots(chosen, ctx);
                if (typeof row['@label'] === 'string') leftOut.add(row['@label']);
                done += 1;
                continue;
              }
              const resolvedRow = resolveValues(chosen, ctx);
              const values = spellInstants(resolvedRow, resolved);
              const label = typeof row['@label'] === 'string' ? row['@label'] : null;
              // A part of a row this add took back: that row came back with the parts it has.
              const underTakenBack = partLinks(view, resolved).some((link) => {
                const key = values[link.via];
                const parentIsPart = key === null || key === undefined ? undefined : takenBack.get(`${link.parent}\u0000${String(key)}`);
                return parentIsPart !== undefined && (!link.ofParts || parentIsPart);
              });
              if (underTakenBack) {
                if (label !== null && !labels.has(label)) leftOut.add(label);
                done += 1;
                continue;
              }
              /*
               * The row the last removal kept, taken back rather than written
               * again — only while it reads as the sample wrote it. It keeps
               * its own links: one to a kept parent the operator changed still
               * names that parent, not the fresh copy. What the hash cannot
               * tell apart is a row of the operator's that is identical in
               * every column AND took the kept row's key after it was deleted
               * (SQLite reuses the highest rowid). A part (a line, its options)
               * is not taken back on its own: its record did not come back (it
               * would have brought the part with it), so the part stays with
               * the record the operator kept, and the sample writes its own
               * under the fresh copy.
               */
              const identity = identityOf(table.ref, label, values, resolved);
              const keptEntry = identity === null ? undefined : keptBy.get(identity);
              if (keptEntry !== undefined && !adopted.has(keptEntry.seq)) {
                keptBy.delete(identity!);
                const current = await fetchByPk(db, resolved, JSON.parse(keptEntry.pk) as Row);
                if (current !== undefined && unchangedSince(keptEntry, current, resolved, handle.dialect) && !isPart(view, resolved, current)) {
                  await takeBack(keptEntry, current, table.ref, resolved, label);
                  done += 1;
                  continue;
                }
              }
              /*
               * A row only for an empty table — the app's one settings row — is
               * left out when the operator already has one; the rows after it
               * point at theirs, which the sample never takes as its own.
               */
              if (row['@onlyIfEmpty'] === true) {
                const existing = (await db.selectFrom(resolved.id as never).selectAll().limit(1).executeTakeFirst()) as Row | undefined;
                if (existing !== undefined) {
                  const key = Object.fromEntries(resolved.primaryKey.map((column) => [column, existing[column]]));
                  const named = row['@label'];
                  if (typeof named === 'string') labels.set(named, resolved.primaryKey.length === 1 ? existing[resolved.primaryKey[0]!] : key);
                  done += 1;
                  continue;
                }
              }
              if (resolved.primaryKey.some((column) => values[column] !== undefined)) explicitKeys.add(resolved.name);
              // A shared link's code the sample gives is printed in the app's package for anyone to
              // read: every sample row's link is made here, like a person's create (`empty-code`).
              for (const column of shareCodeColumns(app.manifest.kind === 'app' ? (app.manifest.publicAccess ?? []) : [], table.ref)) delete values[column];
              /*
               * A code or a running number the table already holds — a row
               * kept from an earlier add, or one of the operator's own — is
               * left for Adminium to decide, as it would be on a person's
               * create: the sample's own spelling is a nicety, a clash a refusal.
               */
              const rules = tableRulesFor({ view, table: resolved });
              for (const decided of [...(rules?.codes ?? []), ...(rules?.sequences ?? [])]) {
                const value = values[decided.column];
                if (value === undefined || value === null) continue;
                const taken = await db
                  .selectFrom(resolved.id as never)
                  .select(sql`1`.as('taken'))
                  .where(sql.ref(decided.column), '=', value as never)
                  .executeTakeFirst();
                if (taken !== undefined) delete values[decided.column];
              }
              /*
               * Any other one-of-a-kind value the table already holds is one of
               * the operator's own records (their Monday opening hours, a day
               * they already closed): the sample never overwrites it and never
               * guesses around it, it stops — with the table, the column and
               * the value named, not the database's own words. Nothing of the
               * add is kept (it is one transaction).
               */
              for (const column of resolved.table.columns) {
                const value = values[column.name];
                if (!column.isUnique || column.isPrimaryKey || value === undefined || value === null) continue;
                const taken = await db
                  .selectFrom(resolved.id as never)
                  .select(sql`1`.as('taken'))
                  .where(sql.ref(column.name), '=', value as never)
                  .executeTakeFirst();
                if (taken !== undefined) throw sampleClash(table.ref, column.name, value);
              }
              // Sample data is history the operator asked for, not bookings to judge.
              const checked = await writes.check('create', target, context, [values], { capacity: 'unchecked' });
              const good = checked.rows[0];
              if (good === null || good === undefined) {
                throw new ValidationFailedError(`A sample row for "${table.ref}" was refused.`, {
                  reason: 'SAMPLE_ROW_REFUSED',
                  table: table.ref,
                  issues: checked.issues[0],
                });
              }
              let stored: Row;
              try {
                stored = await insertRow(db, handle.dialect, resolved, good);
              } catch (error) {
                // A unique rule over several columns, which the check above cannot see.
                if (isUniqueViolation(error)) throw sampleClash(table.ref, null, null);
                throw error;
              }
              const key = Object.fromEntries(resolved.primaryKey.map((column) => [column, stored[column]]));
              if (label !== null) {
                labels.set(label, resolved.primaryKey.length === 1 ? stored[resolved.primaryKey[0]!] : key);
              }
              const { rowHash, colHashes } = hashRow(stored, resolved);
              seq += 1;
              if (keepsTotals) {
                const bucket = totals.get(table.ref) ?? { target, rows: [] as { seq: number; key: Row; record: Row }[] };
                bucket.rows.push({ seq, key, record: stored });
                totals.set(table.ref, bucket);
              }
              await db
                .insertInto(ledger as never)
                .values({
                  seq,
                  table_ref: table.ref,
                  pk: canonicalJson(key),
                  label,
                  row_hash: rowHash,
                  col_hashes: JSON.stringify({ ...colHashes, [LEDGER_DATES_AS_DAYS]: '1' }),
                  created_at: now,
                } as never)
                .execute();
              counts[table.ref] = (counts[table.ref] ?? 0) + 1;
              done += 1;
              if (done % 25 === 0) opts.progress?.(20 + Math.round((done / total) * 70), `Wrote ${String(done)} of ${String(total)}`);
            }
          }
          /*
           * Totals last, from every child row: the rows went in one at a time
           * and nothing settled them (a payment's visit, a visit's balance).
           * Each settled row is hashed again as it now stands, or its removal
           * would take the new total for an edit and keep the row.
           */
          for (const { target, rows } of totals.values()) {
            await writes.settle('create', target, rows.map((row) => ({ record: row.record, before: null })));
          }
          // Hashed only once every total is settled: a line's settle climbs into its order, after the order's own.
          for (const [ref, { target, rows }] of totals) {
            for (const row of rows) {
              const now = (await fetchByPk(db, target.table, row.key)) ?? row.record;
              const { rowHash, colHashes } = hashRow(now, target.table);
              await db
                .updateTable(ledger as never)
                .set({ row_hash: rowHash, col_hashes: JSON.stringify({ ...colHashes, [LEDGER_DATES_AS_DAYS]: '1' }) } as never)
                .where('seq' as never, '=', row.seq as never)
                .where('table_ref' as never, '=', ref as never)
                .execute();
            }
          }
          // A kept row not taken back stays the operator's, and leaves the ledger.
          const forgotten = entries
            .filter((entry) => entry.table_ref.startsWith(KEPT_PREFIX) && !adopted.has(entry.seq))
            .map((entry) => entry.seq);
          for (let i = 0; i < forgotten.length; i += 500) {
            await db
              .deleteFrom(ledger as never)
              .where('seq' as never, 'in', forgotten.slice(i, i + 500) as never)
              .execute();
          }
          reused = adopted.size;
          for (const id of adoptedFiles) {
            const file = await files.findById(id);
            if (file === null || file.deletedAt !== null || file.entityConnectionId !== connectionId) continue;
            seq += 1;
            await db
              .insertInto(ledger as never)
              .values({
                seq,
                table_ref: FILE_REF,
                pk: canonicalJson({ id }),
                label: null,
                row_hash: '',
                col_hashes: '{}',
                created_at: now,
              } as never)
              .execute();
          }
          for (const [label, id] of fileIds) {
            seq += 1;
            await db
              .insertInto(ledger as never)
              .values({
                seq,
                table_ref: FILE_REF,
                pk: canonicalJson({ id }),
                label,
                row_hash: '',
                col_hashes: '{}',
                created_at: now,
              } as never)
              .execute();
          }
        });

        // A row that named its own key leaves an identity sequence behind it.
        if (handle.dialect === 'postgres') {
          for (const tableName of explicitKeys) {
            const resolved = view.table(tableName);
            // Only a counting key has a sequence; a uuid key has none (and no MAX).
            for (const column of resolved.primaryKey.filter((name) => INTEGER_TYPES.has(resolved.columns.get(name)?.logicalType ?? ''))) {
              await sql`SELECT setval(pg_get_serial_sequence(${`${resolved.schema}.${resolved.name}`}, ${column}), COALESCE((SELECT MAX(${sql.ref(column)}) FROM ${sql.table(`${resolved.schema}.${resolved.name}`)}), 0) + 1, false) WHERE pg_get_serial_sequence(${`${resolved.schema}.${resolved.name}`}, ${column}) IS NOT NULL`.execute(
                asDb(handle.db),
              );
            }
          }
        }
        opts.progress?.(95, 'Written');

        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: opts.userId,
          actorLabel: opts.userLabel,
          category: 'app',
          action: 'app.sample-data.add',
          connectionId,
          changes: { after: { key: app.key, counts, reused, files: fileIds.size } },
        });
        await deps.publish?.(connectionId);
        return { counts, files: fileIds.size };
      } catch (error) {
        for (const id of fileIds.values()) await files.markDeleted(id).catch(() => undefined);
        throw error;
      }
    },

    /**
     * What a removal would take and keep. Re-reads the database first: a
     * record made since the add may now point at a sample row.
     */
    async removePreview(app: SampleApp) {
      const connectionId = await connectionOf(app);
      const ledger = await ledgerRecord(app, connectionId);
      if (ledger === undefined) return { tables: [], kept: [], changed: [], total: 0 };
      await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
      const handle = await deps.manager.data(connectionId);
      const view = await viewFor(connectionId);
      const names = await records.realNames(connectionId, app.key);
      const rows = (await ledgerRows(handle, ledger.tableName)).filter(isSampleRow);
      const analysis = await analyse(handle, view, names, rows);
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.table_ref, (counts.get(row.table_ref) ?? 0) + 1);
      // What the record is called now, as the rest of the console names it:
      // the dialog says "Flat white", not the bundle's own label.
      const titleOf = (row: LedgerRow): string | null => {
        const table = view.table(names[row.table_ref] ?? row.table_ref);
        const column = labelColumnFor(view, table);
        const value = column === null ? undefined : analysis.current.get(row.seq)?.[column];
        return value === undefined || value === null || value === '' ? null : String(value);
      };
      return {
        tables: [...counts.entries()].map(([ref, count]) => ({ ref, count })),
        kept: rows
          .filter((row) => analysis.used.has(row.seq))
          .map((row) => ({ ref: row.table_ref, label: row.label, title: titleOf(row), usedBy: analysis.used.get(row.seq)! })),
        changed: rows
          .filter((row) => analysis.changed.has(row.seq))
          .map((row) => ({
            ref: row.table_ref,
            label: row.label,
            title: titleOf(row),
            columns: analysis.changed.get(row.seq)!,
          })),
        total: rows.length,
      };
    },

    async remove(
      app: SampleApp,
      opts: { keepChanged: boolean; userId: string | null; userLabel: string },
    ): Promise<{ removed: number; kept: number; byTable: Record<string, number> }> {
      const connectionId = await connectionOf(app);
      const ledger = await ledgerRecord(app, connectionId);
      if (ledger === undefined) return { removed: 0, kept: 0, byTable: {} };
      await runIntrospection({ manager: deps.manager, meta: deps.meta, connectionId });
      const handle = await deps.manager.data(connectionId);
      const view = await viewFor(connectionId);
      const names = await records.realNames(connectionId, app.key);
      const all = await ledgerRows(handle, ledger.tableName);
      const rows = all.filter(isSampleRow);
      const analysis = await analyse(handle, view, names, rows, opts.keepChanged);
      const byTable: Record<string, number> = {};
      const removedSeqs: number[] = [];
      const kept: LedgerRow[] = [];

      await handle.db.transaction().execute(async (trx) => {
        const db = asDb(trx);
        for (const row of [...rows].reverse()) {
          // Kept: the operator's now, remembered below so the next add takes it back.
          if (analysis.keep.has(row.seq)) {
            kept.push(row);
            continue;
          }
          removedSeqs.push(row.seq);
          if (!analysis.gone.has(row.seq)) {
            const table = view.table(names[row.table_ref] ?? row.table_ref);
            const pk = JSON.parse(row.pk) as Row;
            /*
             * The sample's own rows go as they came: they were never real, a
             * numbered or sent sample document included. A row the operator
             * has changed since is theirs, and its delete is judged like any
             * other — a sent invoice they moved on stays.
             */
            const judged = analysis.changed.has(row.seq)
              ? await (async () => {
                  const target = { connectionId, view, table, db, dialect: handle.dialect };
                  const person: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: opts.userId, label: opts.userLabel }, request: null };
                  const [prepared] = await createWriteService(writeStores(deps.meta)).beforeEach('delete', target, person, [{ match: pk, values: {} }]);
                  return prepared === undefined ? undefined : { dialect: handle.dialect, prepared: prepared.values };
                })()
              : undefined;
            try {
              await deleteRows(db, table, pk, undefined, judged);
            } catch (error) {
              const code = (error as { code?: unknown }).code;
              if (code === 'DELETE_REFUSED' || code === 'RECORD_LOCKED') throw error;
              throw new ConflictError(
                `A record of yours still uses a sample row in "${row.table_ref}", so nothing was removed.`,
                'CONFLICT',
                { table: row.table_ref, cause: error instanceof Error ? error.message : String(error) },
              );
            }
            byTable[row.table_ref] = (byTable[row.table_ref] ?? 0) + 1;
          }
        }
        // The files' entries go too; a file a kept row still names stays in the library.
        for (const row of all.filter((entry) => entry.table_ref === FILE_REF)) removedSeqs.push(row.seq);
        /*
         * A kept row's entry stays, marked, so it no longer counts as sample
         * data anywhere. A ref too long to mark is forgotten, as every kept
         * row used to be: the next add then writes a copy, never worse.
         */
        for (const row of kept) {
          const marked = `${KEPT_PREFIX}${row.table_ref}`;
          if (marked.length > REF_WIDTH) {
            removedSeqs.push(row.seq);
            continue;
          }
          await db
            .updateTable(ledger.tableName as never)
            .set({ table_ref: marked } as never)
            .where('seq' as never, '=', row.seq as never)
            .execute();
        }
        for (let i = 0; i < removedSeqs.length; i += 500) {
          await db
            .deleteFrom(ledger.tableName as never)
            .where('seq' as never, 'in', removedSeqs.slice(i, i + 500) as never)
            .execute();
        }
      });

      const files = filesRepo(deps.meta);
      const keptValues = new Set(analysis.keptValues);
      for (const row of all.filter((entry) => entry.table_ref === FILE_REF)) {
        const id = (JSON.parse(row.pk) as { id: string }).id;
        if (!keptValues.has(id)) await files.markDeleted(id).catch(() => undefined);
      }
      const removed = Object.values(byTable).reduce((sum, n) => sum + n, 0);
      await auditRepo(deps.meta).append({
        actorKind: 'user',
        actorId: opts.userId,
        actorLabel: opts.userLabel,
        category: 'app',
        action: 'app.sample-data.remove',
        connectionId,
        changes: { after: { key: app.key, removed: byTable, kept: analysis.keep.size, keepChanged: opts.keepChanged } },
      });
      await deps.publish?.(connectionId);
      return { removed, kept: analysis.keep.size, byTable };
    },
  };
}

/**
 * Which sample rows the operator's own records use, which they changed, and
 * which are already gone — and so which must stay: the used ones, the changed
 * ones when asked, every sample row those point at in turn, and the rows a
 * kept row's lock ties to it.
 */
async function analyse(
  handle: DataHandle,
  view: SnapshotView,
  names: Readonly<Record<string, string>>,
  rows: readonly LedgerRow[],
  keepChanged = true,
): Promise<{
  used: Map<number, number>;
  changed: Map<number, string[]>;
  gone: Set<number>;
  keep: Set<number>;
  keptValues: string[];
  /** Each sample row as it reads now; null once it is gone. */
  current: Map<number, Row | null>;
}> {
  const db = asDb(handle.db);
  // Sample rows by table and by key value (single-column keys, which is what a
  // reference can point at).
  const byTable = new Map<string, Map<string, LedgerRow>>();
  const tableOf = (row: LedgerRow): ResolvedTable => view.table(names[row.table_ref] ?? row.table_ref);
  const current = new Map<number, Row | null>();
  for (const row of rows) {
    const table = tableOf(row);
    const match = JSON.parse(row.pk) as Row;
    let query = db.selectFrom(`${table.schema}.${table.name}` as never).selectAll();
    for (const [column, value] of Object.entries(match)) query = query.where(column as never, '=', value as never);
    const found = (await query.executeTakeFirst()) as Row | undefined;
    current.set(row.seq, found ?? null);
    const keyValue = table.primaryKey.length === 1 ? String(match[table.primaryKey[0]!]) : null;
    if (keyValue !== null) {
      const map = byTable.get(table.id) ?? new Map<string, LedgerRow>();
      map.set(keyValue, row);
      byTable.set(table.id, map);
    }
  }

  const gone = new Set(rows.filter((row) => current.get(row.seq) === null).map((row) => row.seq));
  const changed = new Map<number, string[]>();
  for (const row of rows) {
    const now = current.get(row.seq);
    if (now === null || now === undefined) continue;
    const table = tableOf(row);
    const before = JSON.parse(row.col_hashes) as Record<string, string>;
    const recordedAsDays = Object.prototype.hasOwnProperty.call(before, LEDGER_DATES_AS_DAYS);
    delete before[LEDGER_DATES_AS_DAYS];
    const { rowHash, colHashes } = hashRow(now, table, handle.dialect !== 'sqlite' && !recordedAsDays);
    if (rowHash === row.row_hash) continue;
    /*
     * A column the ledger never recorded came later (an update added it), and
     * every row the sample wrote got it empty, or with the column's default.
     * Only a value somebody put there since is a change; hashed against
     * nothing, it would read as one in every sample row of the table.
     */
    const columns = Object.keys(colHashes).filter((column) =>
      Object.prototype.hasOwnProperty.call(before, column)
        ? before[column] !== colHashes[column]
        : !asAdded(now[column], table, column),
    );
    if (columns.length > 0) changed.set(row.seq, columns);
  }

  // Referrers that are not sample rows keep what they point at.
  const sampleSeqs = new Set(rows.map((row) => row.seq));
  const isSample = (tableId: string, pkRow: Row, table: ResolvedTable): boolean => {
    if (table.primaryKey.length !== 1) return false;
    const found = byTable.get(tableId)?.get(String(pkRow[table.primaryKey[0]!]));
    return found !== undefined && sampleSeqs.has(found.seq);
  };
  const used = new Map<number, number>();
  for (const table of view.model.tables) {
    if (table.system || table.excluded === true) continue;
    for (const column of table.columns) {
      const ref = column.references;
      if (ref === null) continue;
      const targets = byTable.get(ref.tableId);
      if (targets === undefined || targets.size === 0) continue;
      const resolved = safeTable(view, table.id);
      if (resolved === null) continue;
      const values = [...targets.keys()];
      for (let i = 0; i < values.length; i += 500) {
        const found = (await db
          .selectFrom(`${table.schema}.${table.name}` as never)
          .select([...resolved.primaryKey, column.name] as never)
          .where(column.name as never, 'in', values.slice(i, i + 500) as never)
          .execute()) as Row[];
        for (const referrer of found) {
          if (isSample(table.id, referrer, resolved)) continue;
          const target = targets.get(String(referrer[column.name]));
          if (target !== undefined) used.set(target.seq, (used.get(target.seq) ?? 0) + 1);
        }
      }
    }
  }

  /*
   * The sample rows that are part of another (`partLinks`): a document's lines,
   * a terms version's clauses, a line's chosen options. A kept row keeps its
   * parts. Deleted, they went from a record the operator uses (the terms their
   * sent proposal prints lost their clauses; a kept order's lines lost the
   * options their price counts), and the next add wrote them again under it.
   */
  const partsOf = new Map<string, { seq: number; ofParts: boolean }[]>();
  for (const row of rows) {
    const values = current.get(row.seq);
    if (values === null || values === undefined) continue;
    for (const link of partLinks(view, tableOf(row))) {
      const key = values[link.via];
      if (key === null || key === undefined) continue;
      const at = `${link.parent}\u0000${String(key)}`;
      partsOf.set(at, [...(partsOf.get(at) ?? []), { seq: row.seq, ofParts: link.ofParts }]);
    }
  }

  // Kept: used ones, changed ones when asked, then what those point at and their parts.
  const keep = new Set<number>(used.keys());
  if (keepChanged) for (const seq of changed.keys()) keep.add(seq);
  const queue = [...keep];
  const bySeq = new Map(rows.map((row) => [row.seq, row]));
  const keepToo = (seq: number) => {
    if (keep.has(seq)) return;
    keep.add(seq);
    queue.push(seq);
  };
  /** The kept rows that are a part: their own totals' rows are parts too. Seen again when a row first becomes one. */
  const parts = new Set<number>();
  const keepAsPart = (seq: number) => {
    if (parts.has(seq)) return;
    parts.add(seq);
    keep.add(seq);
    queue.push(seq);
  };
  while (queue.length > 0) {
    const seq = queue.pop()!;
    const row = bySeq.get(seq);
    const values = current.get(seq);
    if (row === undefined || values === null || values === undefined) continue;
    const table = tableOf(row);
    for (const column of table.table.columns) {
      const ref = column.references;
      if (ref === null) continue;
      const parent = byTable.get(ref.tableId)?.get(String(values[column.name]));
      if (parent !== undefined) keepToo(parent.seq);
    }
    if (table.primaryKey.length !== 1) continue;
    for (const part of partsOf.get(`${table.id}\u0000${String(values[table.primaryKey[0]!])}`) ?? []) {
      if (!part.ofParts || parts.has(seq) || lockTied(table, values)) keepAsPart(part.seq);
    }
  }
  const keptValues: string[] = [];
  for (const seq of keep) {
    for (const value of Object.values(current.get(seq) ?? {})) if (typeof value === 'string') keptValues.push(value);
  }
  return { used, changed, gone, keep, keptValues, current };
}

/** Whether a column added after the row was written still holds what it was added with: nothing, or its default. */
function asAdded(value: unknown, table: ResolvedTable, column: string): boolean {
  if (value === null || value === undefined) return true;
  const declared = table.table.columns.find((candidate) => candidate.name === column);
  if (declared === undefined) return false;
  const given = literalDefault(declared.default, declared.logicalType);
  return given !== undefined && given !== null && normaliseValue(value, declared.logicalType) === normaliseValue(given, declared.logicalType);
}

function safeTable(view: SnapshotView, id: string): ResolvedTable | null {
  try {
    return view.table(id);
  } catch {
    return null;
  }
}

// ── the job ─────────────────────────────────────────────────────────────────

/** A sample row that would repeat a value one of the operator's own records already holds. */
function sampleClash(ref: string, column: string | null, value: unknown): ValidationFailedError {
  const what = column === null ? 'a record already there' : `a record already there with ${column} "${String(value)}"`;
  return new ValidationFailedError(
    `The sample data was not added: a sample row for "${ref}" clashes with ${what}. Sample data is for tables that hold none of your own records of that kind yet.`,
    { reason: 'SAMPLE_ROW_CLASH', table: ref, column },
  );
}

export const SAMPLE_ADD_KIND = 'app-sample-add';

const sampleAddPayloadSchema = z.object({
  key: z.string().min(1),
  locale: z.string().min(2),
  userId: z.string().nullable(),
  userLabel: z.string(),
});
export type SampleAddPayload = z.infer<typeof sampleAddPayloadSchema>;

/** The installed app a key names, read straight off its row; null when not installed. */
export async function findSampleApp(meta: MetaDb, key: string): Promise<SampleApp | null> {
  const row = await meta.db
    .selectFrom('adminium_manifests')
    .select(['id', 'manifestKey', 'version', 'connectionId', 'manifest'])
    .where('manifestKey', '=', key)
    .where('kind', '=', 'app')
    .executeTakeFirst();
  if (row === undefined) return null;
  return {
    key: row.manifestKey,
    version: row.version,
    manifestId: row.id,
    connectionId: row.connectionId,
    manifest: readJson<Manifest>(row.manifest),
  };
}

/**
 * Add runs as a job, with progress on `jobs:<id>`: a café's worth of rows and
 * images is more than a request should hold open. Internal — only the app
 * route enqueues it, after its own permission check.
 */
export function registerSampleDataHandler(registry: JobRegistry, deps: SampleDataDeps): void {
  const service = createSampleDataService(deps);
  registry.registerJobHandler(
    SAMPLE_ADD_KIND,
    sampleAddPayloadSchema,
    async (payload: SampleAddPayload, ctx: JobHandlerContext) => {
      const app = await findSampleApp(deps.meta, payload.key);
      if (app === null) throw new NotFoundError(`"${payload.key}" is not installed.`);
      return service.add(app, {
        locale: payload.locale,
        userId: payload.userId,
        userLabel: payload.userLabel,
        progress: (pct, message) => ctx.progress(pct, { step: 'sample', message }),
      });
    },
    { internal: true },
  );
}

export async function enqueueSampleAdd(meta: MetaDb, payload: SampleAddPayload): Promise<Job> {
  return jobsRepo(meta).enqueue({
    kind: SAMPLE_ADD_KIND,
    payload,
    // One add per app at a time: a double click must not write the café twice.
    dedupeKey: `${SAMPLE_ADD_KIND}:${payload.key}`,
    maxAttempts: 1,
  });
}
