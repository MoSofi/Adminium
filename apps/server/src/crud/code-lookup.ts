// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CODE A PERSON TYPES, FOUND AMONG THE CODES A VENUE MADE (`column.lookup`).
 *
 * A discount box, a presale code: the guest types `student10`, and the row
 * they write links to the one codes row that spelling means. The link is
 * Adminium's to fill — a browser never names the codes row itself — and it is
 * filled in RESOLVE, before the copies, so what a copy reads through it (the
 * code's kind, its amount, the type it unlocks) is the row just found, in the
 * same pass and on the same handle.
 *
 * What a typed code matches:
 *
 *  - spelled as the codes are kept: upper case, spaces and `-` gone. A code
 *    column Adminium makes (`column.code`) reads the typed text the way a
 *    claim does — its prefix put back, O as 0, I and L as 1; any other code
 *    column is compared folded the same way on both sides, so `BL00MEARLY`
 *    finds `BLOOMEARLY`. Two stored codes that fold alike (`BOOKO`, `BOOK0`)
 *    are told apart by the exact spelling; a third spelling finds neither;
 *  - only a row the rule's conditions allow (active, not expired) and within
 *    its scope (this show's codes, or a venue-wide one where the rule says an
 *    empty scope is any).
 *
 * Every miss — no such code, one switched off, expired, another show's, two
 * alike — is ONE answer, `unknown`, on the typed column: a guesser learns no
 * more from one miss than from another. Text that could be no code at all is
 * refused before any query is made. Emptying the typed column empties the
 * link, and every copy made through it: a code taken off takes its discount
 * with it.
 *
 * A code whose uses are all taken is the limit's to refuse (a parent limit
 * through this link), on the typed column, as `used-up`.
 */
import { refuseUngrantedColumns } from '../connections/privileges.js';
import type { CodeLookupWhere, ColumnLookupRule, EffectiveColumn, EffectiveTable } from '../connections/effective-schema.js';
import type { SnapshotView } from './identifiers.js';
import { readDay, readInstant } from './moments.js';
import { venueClock } from './venue-time.js';
import { booleanOf, sameValue } from './write-values.js';
import { ValidationFailedError } from '../errors.js';
import { sql, type Expression, type Kysely, type SqlBool } from 'kysely';
import type { TablePrivileges } from '@adminium/engine/adapter';
import type { SourceDatabase } from '../connections/manager.js';
import type { Row } from './mask.js';
import type { WriteAction, WriteOrigin } from './write-context.js';

type Db = Kysely<SourceDatabase>;

/** How a codes column keeps its codes: made by Adminium (with a prefix), or typed in and kept as a code. */
export type CodeSpelling = { made: { prefix: string; length: number } } | { kept: true };

/** A lookup rule, compiled against the model: the link it fills, and how to find its row. */
export interface CodeLookup {
  /** This table's foreign key the lookup fills. */
  column: string;
  /** This table's text column the person types into. */
  from: string;
  /** The codes table, and the key the foreign key points at. */
  table: string;
  key: string;
  /** The codes column the typed code is compared with, and how it keeps codes. */
  code: string;
  spelling: CodeSpelling;
  where: readonly CodeLookupWhere[];
  scope: readonly { column: string; equals: string; orEmpty?: true | undefined }[];
}

/** The rows a code unlocks for reading: `link` of each codes row the code finds (`unlockBy`). */
export interface CodeUnlock {
  table: string;
  column: string;
  link: string;
  /** The code is the row's own: `table` is the read table and `link` its key. */
  self?: true | undefined;
  /** With `self`: the code's length without its prefix; any other length is refused before the lookup. */
  length?: number | undefined;
  where?: readonly (CodeLookupWhere | { column: string; not_before?: 'now' | 'today'; not_after?: 'now' | 'today'; or_empty?: true; eq?: unknown })[] | undefined;
}

/** How a column keeps the codes a lookup compares with. */
export function spellingOf(column: Pick<EffectiveColumn, 'code'> | undefined): CodeSpelling {
  return column?.code !== undefined ? { made: { prefix: column.code.prefix ?? '', length: column.code.length } } : { kept: true };
}

/** Every lookup a table declares, compiled against the model (a hand-built target has none). */
export function codeLookupsOf(view: Pick<SnapshotView, 'model'> | undefined, table: Pick<EffectiveTable, 'id' | 'columns'> | undefined): CodeLookup[] {
  if (view?.model === undefined || table?.columns === undefined) return [];
  const out: CodeLookup[] = [];
  for (const column of table.columns) {
    const rule: ColumnLookupRule | undefined = column.lookup;
    if (rule === undefined) continue;
    const relation = view.model.relations.find(
      (r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === column.name && r.to.columns.length === 1,
    );
    const codes = view.model.tables.find((t) => t.id === rule.table);
    // A link into an add-on's table has no foreign key: the key is the one that link resolved to, for that same table.
    const key = relation?.to.columns[0] ?? (column.addOnLink?.tableId === rule.table ? column.addOnLink.key : null);
    if (key === null || key === undefined || codes === undefined) continue;
    out.push({
      column: column.name,
      from: rule.from,
      table: rule.table,
      key,
      code: rule.column,
      spelling: spellingOf(codes.columns?.find((c) => c.name === rule.column)),
      where: rule.where ?? [],
      scope: rule.scope ?? [],
    });
  }
  return out;
}

// ─── spelling ────────────────────────────────────────────────────────────────

/** A code as codes are kept: upper case, with spaces and `-` gone. */
export function canonicalCode(text: string): string {
  return text.toUpperCase().replace(/[\s-]+/g, '');
}

/** A kept code read as Crockford reads one: O is 0, I and L are 1. */
export function foldedCode(canonical: string): string {
  return canonical.replace(/O/g, '0').replace(/[IL]/g, '1');
}

/**
 * A kept code as somebody reading it aloud, or off a sign, may take it: the
 * Crockford fold, and the letters that look like a digit read as that digit
 * (S as 5, B as 8, Z as 2, G as 6). Two codes that fold alike here are easy
 * to mix up — a warning to whoever names one, never a refusal.
 */
export function lookAlikeFold(canonical: string): string {
  return foldedCode(canonical).replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2').replace(/G/g, '6');
}

/** The same, in SQL, over a stored column. */
function lookAlikeSql(column: string): Expression<string> {
  return sql<string>`replace(replace(replace(replace(${foldSql(column)}, 'S', '5'), 'B', '8'), 'Z', '2'), 'G', '6')`;
}

/**
 * The rows of a table whose code reads like this one — itself included, when
 * it is there, unless `but` names it. `canonical` is the code as codes are
 * kept. A few at most.
 */
export async function lookAlikes(db: Db, table: string, codeColumn: string, canonical: string, limit: number, but?: string): Promise<Row[]> {
  return (await db
    .selectFrom(table as never)
    .selectAll()
    .where((eb) => eb(lookAlikeSql(codeColumn), '=', lookAlikeFold(canonical) as never))
    // (`but`: the rows that are not this very code, however it is spaced or cased where it is stored.)
    .$if(but !== undefined, (query) => query.where(sql<string>`replace(replace(upper(${sql.ref(codeColumn)}), ' ', ''), '-', '')` as never, '<>', but as never))
    .orderBy(sql.ref(codeColumn))
    .limit(limit)
    .execute()) as Row[];
}

/**
 * The reserved word a code starts with, or null: a discount code may not
 * start as a voucher's or a card's code does (`VC`, `GC`), or a typed value
 * would be taken for one of those and never found as the word it is. Both
 * sides are read as codes are kept.
 */
export function reservedStart(canonical: string, reserved: readonly string[]): string | null {
  return reserved.find((word) => canonicalCode(word) !== '' && canonical.startsWith(canonicalCode(word))) ?? null;
}

/**
 * A discount code written with a reserved start is that column's own issue,
 * on every way of writing the row: a create, a change, an import. Null when
 * the table keeps no such codes, or the write leaves the code alone.
 */
export function reservedIssue(rules: { reservedStarts?: { column: string; words: readonly string[] } | undefined } | null, values: Row): Record<string, { code: 'reserved' }> | null {
  const reserved = rules?.reservedStarts;
  if (reserved === undefined) return null;
  const value = values[reserved.column];
  if (typeof value !== 'string' || reservedStart(canonicalCode(value), reserved.words) === null) return null;
  return { [reserved.column]: { code: 'reserved' } };
}

/** The same fold, in SQL, over a stored column: identical on the three engines for the letters a code may hold. */
function foldSql(column: string): Expression<string> {
  const ref = sql.ref(column);
  return sql<string>`replace(replace(replace(replace(replace(upper(${ref}), ' ', ''), '-', ''), 'O', '0'), 'I', '1'), 'L', '1')`;
}

/** A code Adminium made, as a claim reads one typed: its prefix put back, the rest read as Crockford. */
function madeCode(text: string, rule: { prefix: string }): string {
  const prefix = rule.prefix.toUpperCase();
  let typed = text.toUpperCase().replace(/\s+/g, '');
  const bare = prefix.replace(/[^A-Z0-9]/g, '');
  if (prefix !== '' && !typed.startsWith(prefix)) {
    const body = typed.replace(/[^A-Z0-9]/g, '');
    typed = prefix + (body.startsWith(bare) ? body.slice(bare.length) : body);
  }
  return typed.slice(0, prefix.length) + foldedCode(typed.slice(prefix.length).replace(/[^A-Z0-9]/g, ''));
}

/** Text that could be a code at all: letters and digits, after spacing and dashes, and not too long. */
const PLAUSIBLE = /^[0-9A-Z]{1,32}$/;

// ─── finding the row ────────────────────────────────────────────────────────

/** Whether a found codes row meets a rule's conditions, read on the venue's clock. */
function meets(row: Row, where: CodeUnlock['where'] | readonly CodeLookupWhere[], now: Date, zone: string): boolean {
  for (const raw of where ?? []) {
    const condition = normalised(raw as Record<string, unknown>);
    const value = row[condition.column];
    if ('eq' in condition) {
      if (!sameValue(typeof condition.eq === 'boolean' ? booleanOf(value) : value, condition.eq)) return false;
      continue;
    }
    const empty = value === null || value === undefined || value === '';
    if (empty) {
      if (condition.orEmpty !== true) return false;
      continue;
    }
    const when = condition.notBefore ?? condition.notAfter!;
    const sign = condition.notBefore !== undefined ? 1 : -1;
    if (when === 'now') {
      const at = readInstant(value);
      if (at === null || sign * (at.getTime() - now.getTime()) < 0) return false;
    } else {
      const day = readDay(value);
      const today = venueClock(now, zone).day;
      if (day === null || sign * (day < today ? -1 : day > today ? 1 : 0) < 0) return false;
    }
  }
  return true;
}

type Condition = { column: string; eq?: unknown; notBefore?: 'now' | 'today'; notAfter?: 'now' | 'today'; orEmpty?: boolean };

/** A condition as a rule or an endpoint spells it (camel or snake case), in one spelling. */
function normalised(raw: Record<string, unknown>): Condition {
  const out: Condition = { column: String(raw['column']) };
  if ('eq' in raw) out.eq = raw['eq'];
  const before = raw['notBefore'] ?? raw['not_before'];
  const after = raw['notAfter'] ?? raw['not_after'];
  if (before !== undefined) out.notBefore = before as 'now' | 'today';
  if (after !== undefined) out.notAfter = after as 'now' | 'today';
  if ((raw['orEmpty'] ?? raw['or_empty']) === true) out.orEmpty = true;
  return out;
}

/** A scope a found codes row must be within: its column equals the written row's value (or, where allowed, is empty). */
interface ScopePart {
  column: string;
  value: unknown;
  orEmpty: boolean;
}

/**
 * The codes rows a typed code finds, before conditions: those spelled as it
 * is (or folded alike), within the scope. At most a few: a code column is
 * unique (with its scope), so more are fold twins.
 */
async function candidates(db: Db, table: string, codeColumn: string, spelling: CodeSpelling, canonical: string, scope: readonly ScopePart[] = []): Promise<Row[]> {
  const match = 'made' in spelling ? madeCode(canonical, spelling.made) : foldedCode(canonical);
  const rows = await db
    .selectFrom(table as never)
    .selectAll()
    .where((eb) => {
      const parts: Expression<SqlBool>[] = ['made' in spelling ? eb(db.dynamic.ref(codeColumn), '=', match as never) : eb(foldSql(codeColumn), '=', match as never)];
      for (const part of scope) {
        const either: Expression<SqlBool>[] = [];
        if (part.value !== null && part.value !== undefined) either.push(eb(db.dynamic.ref(part.column), '=', part.value as never));
        if (part.orEmpty) either.push(eb(db.dynamic.ref(part.column), 'is', null));
        parts.push(either.length === 0 ? sql<SqlBool>`1 = 0` : eb.or(either));
      }
      return eb.and(parts);
    })
    .limit(10)
    .execute();
  return rows as Row[];
}

/** Of rows that fold alike, the one spelled exactly as typed; otherwise the one row, or none. */
function theOne(rows: readonly Row[], codeColumn: string, canonical: string): Row | null {
  if (rows.length === 1) return rows[0]!;
  const exact = rows.filter((row) => typeof row[codeColumn] === 'string' && canonicalCode(row[codeColumn] as string) === canonical);
  return exact.length === 1 ? exact[0]! : null;
}

/** Whether text, as codes are kept (`canonicalCode`), could be a code at all: nothing else is worth a query. */
export function plausibleCode(canonical: string): boolean {
  return PLAUSIBLE.test(canonical);
}

/**
 * The one row of a table a typed code finds, or none: rows spelled as it is
 * (or folded alike), and of fold twins the one typed exactly. `needle` is
 * the code as codes are kept; no condition is judged here.
 */
export async function findByCode(db: Db, table: string, codeColumn: string, spelling: CodeSpelling, needle: string): Promise<Row | null> {
  return theOne(await candidates(db, table, codeColumn, spelling, needle), codeColumn, needle);
}

/** A place a typed code may be found: an own routing word, or none, and how its column keeps codes. */
export interface CodeKind {
  /** A typed value starting so is this kind's and no other's (`GC-`). */
  prefix?: string | undefined;
  spelling: CodeSpelling;
}

/**
 * WHERE A TYPED VALUE IS LOOKED FOR, and as what — one answer for every door
 * that takes one value and several kinds of code (an add-on's look-up, the
 * price question). `canonical` is the value as codes are kept. The tries, in
 * order; the caller stops at the first that finds a row:
 *
 *  1. the kind whose routing word starts the value. The needle is the whole
 *     value when the column stores that word (a card's `GC-…`), and the value
 *     with the word cut off when it does not (a voucher's `VC-` only routes);
 *  2. no such kind: the kinds with no routing word, in the order declared;
 *  3. then each kind whose column stores no word and whose codes are as long
 *     as the value: a scanned code carries no word — also after try 1, since
 *     a scanned code may happen to start with the letters of a word.
 *
 * A kind's routing word is the one it declares, else the one its column
 * stores. A column that stores a word is found only by a value that starts
 * with its kind's: a bare value is never tried against it.
 */
export function routeTypedCode<Kind extends CodeKind>(canonical: string, kinds: readonly Kind[]): { kind: Kind; needle: string }[] {
  const word = (prefix: string): string => prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
  /** The word the column itself stores before every code, or none. */
  const kept = (kind: Kind): string => ('made' in kind.spelling ? word(kind.spelling.made.prefix) : '');
  /** What a typed value starts with to be this kind's. */
  const routing = (kind: Kind): string => (kind.prefix !== undefined ? word(kind.prefix) : kept(kind));
  const scanned = kinds
    .filter((kind) => routing(kind) !== '' && kept(kind) === '' && 'made' in kind.spelling && kind.spelling.made.length === canonical.length)
    .map((kind) => ({ kind, needle: canonical }));
  const routed = kinds.find((kind) => routing(kind) !== '' && canonical.startsWith(routing(kind)));
  if (routed !== undefined) {
    // A stored word of its own is put back by the compare, so only the kind's own routing word is ever cut.
    const whole = kept(routed) !== '' && kept(routed) === routing(routed);
    return [{ kind: routed, needle: whole ? canonical : canonical.slice(routing(routed).length) }, ...scanned];
  }
  const bare = kinds.filter((kind) => routing(kind) === '').map((kind) => ({ kind, needle: canonical }));
  return [...bare, ...scanned];
}

/**
 * A full limit counted through a link a typed code fills (a code's uses):
 * the refusal names the column the person typed into, as `used-up`.
 */
export function usedUpOf(table: { table?: Pick<EffectiveTable, 'columns'> | undefined }, column: string): { fields?: Record<string, { code: 'used-up' }> } {
  const from = table.table?.columns?.find((c) => c.name === column)?.lookup?.from;
  return from === undefined ? {} : { fields: { [from]: { code: 'used-up' } } };
}

/** A typed code that finds no code: a refusal of the write's values, told apart so a many-row write can name the row. */
export class CodeNotFoundError extends ValidationFailedError {
  constructor(readonly fields: Record<string, { code: 'unknown' }>) {
    super('Some values were refused.', { fields });
  }
}

/** The refusal every miss gets: one reason, on the column the person typed into. */
export function unknownCode(from: string): ValidationFailedError {
  return new CodeNotFoundError({ [from]: { code: 'unknown' } });
}

/** A row whose typed code found nothing: its own issue, for a write of many rows to report and go on. */
export interface LookupMiss {
  readonly issues: Record<string, { code: 'unknown' }>;
}

/** The values a write prepared, or — when a code typed in them found nothing — that row's issue. */
export async function lookupIssue(work: Promise<Row>): Promise<Row | LookupMiss> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof CodeNotFoundError) return { [MISSED]: true, issues: error.fields } as LookupMiss;
    throw error;
  }
}

const MISSED = Symbol('adminium.codeMissed');

/** Whether what `lookupIssue` gave back is a row's issue. */
export function isLookupIssue(value: Row | LookupMiss): value is LookupMiss {
  return (value as { [MISSED]?: true })[MISSED] === true;
}

/** A foreign key filled by a lookup, set empty by this write: the copies made through it are emptied too. */
const CLEARED = Symbol('adminium.lookupCleared');

type Clearing = Row & { [CLEARED]?: readonly string[] };

/** The lookup links this write emptied (so the copies through them are emptied too). */
export function clearedLinks(values: Row): readonly string[] {
  return (values as Clearing)[CLEARED] ?? [];
}

export interface LookupOptions {
  origin: WriteOrigin;
  /** The venue's time zone, for a code valid until a day. */
  zone?: string | undefined;
  now?: Date | undefined;
  /** The row as stored, for a scope column the change does not send (read once, when needed). */
  stored?: (() => Promise<Row | null>) | undefined;
  rights?: TablePrivileges | null | undefined;
}

/**
 * The values with each lookup's link filled from the code typed — the same
 * object when there is nothing to find. Throws `unknown` on the typed column
 * for any code that finds no single allowed row.
 */
export async function resolveLookups(
  lookups: readonly CodeLookup[],
  action: WriteAction,
  target: { db: Db; table: { id: string } },
  values: Row,
  options: LookupOptions,
): Promise<Row> {
  if (lookups.length === 0 || action === 'delete') return values;
  let out: Row | null = null;
  let stored: Promise<Row | null> | null = null;
  const storedRow = () => (stored ??= options.stored?.() ?? Promise.resolve(null));
  for (const lookup of lookups) {
    // On a change, only a code typed again is found again.
    if (!Object.prototype.hasOwnProperty.call(values, lookup.from)) continue;
    // History (an import, an undo, a sample row) brings its link: the writer's wins.
    if ((options.origin === 'import' || options.origin === 'undo') && Object.prototype.hasOwnProperty.call(values, lookup.column)) continue;
    const typed = values[lookup.from];
    out ??= { ...values };
    refuseUngrantedColumns(options.rights, target.table, action === 'create' ? 'create' : 'update', [lookup.column]);
    if (typed === null || typed === undefined || (typeof typed === 'string' && typed.trim() === '')) {
      out[lookup.column] = null;
      (out as Clearing)[CLEARED] = [...clearedLinks(out), lookup.column];
      continue;
    }
    const canonical = canonicalCode(String(typed));
    if (!PLAUSIBLE.test(canonical)) throw unknownCode(lookup.from);
    const scope: ScopePart[] = [];
    for (const part of lookup.scope) {
      const value = Object.prototype.hasOwnProperty.call(values, part.equals) ? values[part.equals] : (await storedRow())?.[part.equals];
      scope.push({ column: part.column, value: value ?? null, orEmpty: part.orEmpty === true });
    }
    const rows = await candidates(target.db, lookup.table, lookup.code, lookup.spelling, canonical, scope);
    const now = options.now ?? new Date();
    const allowed = rows.filter((row) => meets(row, lookup.where, now, options.zone ?? 'UTC'));
    const found = theOne(allowed, lookup.code, canonical);
    if (found === null) throw unknownCode(lookup.from);
    out[lookup.column] = found[lookup.key] as unknown;
  }
  return out ?? values;
}

/**
 * How long a typed code is, as its column keeps codes and with the column's
 * own prefix apart: `GC-7K2M 9QXA 41TR` and `gc7k2m9qxa41tr` are both twelve.
 */
export function codeBodyLength(spelling: CodeSpelling, typed: string): number {
  if (!('made' in spelling)) return canonicalCode(typed).length;
  return madeCode(typed, spelling.made).length - spelling.made.prefix.length;
}

/**
 * The rows a typed code unlocks for reading (`unlockBy`): the `link` of the
 * one codes row it finds, under the rule's conditions — none for a miss,
 * whatever the miss was. `spelling` is how the codes column keeps its codes.
 */
export async function unlockedTargets(db: Db, unlock: CodeUnlock, spelling: CodeSpelling, typed: string, now: Date, zone: string): Promise<unknown[]> {
  const canonical = canonicalCode(typed);
  if (!PLAUSIBLE.test(canonical)) return [];
  const rows = (await candidates(db, unlock.table, unlock.column, spelling, canonical)).filter((row) => meets(row, unlock.where, now, zone));
  const found = theOne(rows, unlock.column, canonical);
  const link = found?.[unlock.link];
  return link === null || link === undefined ? [] : [link];
}

/**
 * The rows a code already found unlocks (a tree's order carries its code's
 * link): the `link` of that codes row, when it still meets the conditions.
 */
export async function unlockedByCode(db: Db, unlock: CodeUnlock, key: { column: string; value: unknown }, now: Date, zone: string): Promise<unknown[]> {
  if (key.value === null || key.value === undefined) return [];
  const row = (await db.selectFrom(unlock.table).selectAll().where(sql.ref(key.column), '=', key.value as never).limit(1).executeTakeFirst()) as Row | undefined;
  if (row === undefined || !meets(row, unlock.where, now, zone)) return [];
  const link = row[unlock.link];
  return link === null || link === undefined ? [] : [link];
}
