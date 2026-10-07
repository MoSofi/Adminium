// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A source row + a profile's mapping → the `DocumentSubject` a provider draws
 * from.
 *
 * ─── THE SUBJECT IS THE ONLY DOOR ──────────────────────────────────────────
 *
 * A provider gets VALUES and nothing else: no database handle, no connection,
 * no clock. Everything it will ever know about this document is assembled
 * here, once, and then frozen into the register row so the document stays
 * what it was after the source row is edited or deleted.
 *
 * That is also why this file, and not the provider, does the coercion. The
 * wire law is integer minor units and basis points; a database column holds
 * `12.34` as a decimal, a string, or a driver-specific numeric object
 * depending on the dialect and the driver. Leaving that to seven providers
 * would mean seven roundings.
 *
 * ─── MONEY IS COERCED THROUGH STRINGS, NEVER THROUGH A FLOAT ───────────────
 *
 * `12.34 * 100` is `1233.9999999999998`. Every money value therefore goes
 * through its decimal TEXT — which is what `pg` hands back for `numeric`
 * anyway — and is split on the decimal mark rather than multiplied. A value
 * that arrives as a JavaScript number is stringified first, which is exact
 * for every amount a currency can express.
 */

import { qrCarries, qrPngDataUrl, qrRows } from '../qr/index.js';
import { currencyScale, groupedCode } from '@adminium/manifest';
import type { RecordRef } from '@adminium/meta';

/**
 * One slot's source, as the profile records it.
 *
 * `{ref, column}` reads a column of the row a foreign key points at: `ref` is
 * the foreign key column of the document's own row. `table` is that row's
 * table when the profile was made knowing it (an app's install does), so the
 * grants a reader needs can be named without the schema at hand; the read
 * itself always follows the foreign key the snapshot declares.
 */
export type SlotMapping =
  /** `form: 'grouped'`: a code printed in groups of four (`K7QX-M2PD`). */
  | { column: string; form?: 'grouped' | undefined }
  | { ref: string; column: string; table?: string | undefined; form?: 'grouped' | undefined }
  | { collection: CollectionSource }
  /** One list read from several sources, in order: child rows, or the nights of a price by the night. */
  | { sources: readonly ({ collection: CollectionSource } | { nightly: NightlySource })[] };

/** The child rows of the document's row a list reads. */
export interface CollectionSource {
  table: string;
  fkColumn: string;
  columns: Record<string, string>;
  /** The column the lines are listed by (a line's position); then by key. */
  orderBy?: string | undefined;
  /** Only the child rows whose column holds one of these. */
  where?: { column: string; in: readonly (string | number | boolean)[] } | undefined;
  /** A child row whose column is true (or set) is left out: a voided line. */
  unless?: string | undefined;
  /** Slot columns that list names one level below the line: `table`'s `column`, by its link to the line. */
  lists?: Record<string, { table: string; fkColumn: string; column: string; orderBy?: string | undefined }> | undefined;
  /**
   * The rows are an ADD-ON's, found by the pair each one stores — the stored
   * name of the document's table and the row's key — in place of a foreign
   * key: `table` and `fkColumn` are then empty. Kept by the add-on's own short
   * names and resolved at each read, so a rename or a reinstall never leaves
   * a stale table in a profile; with the add-on absent the list is empty.
   */
  pair?: { addOn: string; table: string; matchTable: string; matchRow: string } | undefined;
}

/**
 * The nights a price-by-the-night column of the document's row is made of,
 * worked out when the document is drawn; `columns` maps each slot column to a
 * night's own (`date`, `rate`, `base`, `qty`, `tags`) or `<rate via>.<column>`.
 */
export interface NightlySource {
  column: string;
  columns: Record<string, string>;
}

/** Where a line carries the names a list reads one level below it, under the slot column that prints them. */
export const LIST_KEY = (slotColumn: string): string => `\u0000list:${slotColumn}`;

export interface ProfileMapping {
  [slotId: string]: SlotMapping;
}

/** What the outline says a slot is, so this file knows how to coerce it. */
export type SlotType =
  | 'text'
  | 'text[]'
  | 'date'
  | 'email'
  | 'money'
  | 'percent'
  | 'currency'
  | 'number'
  | 'collection'
  /** A QR code of a short text (a ticket's code): `{text, modules, png}`, drawn here, so a provider needs no encoder. */
  | 'qr';

export interface SubjectSlot {
  id: string;
  type: SlotType;
  required: boolean;
  /** Where the slot's value comes from when nothing fills it (`slotDefault`). */
  default?: 'sequence' | 'connection' | 'setting' | 'now';
  columns?: readonly { id: string; type: SlotType }[];
}

/**
 * The value an empty slot takes from its outline's `default`, or undefined.
 *
 * The outline promises these to the add-on, so such a slot need not be
 * mapped: `now` is the day (or instant) the document is made, on the venue's
 * clock — kept from the first draw when the same document is drawn again;
 * `connection` the connection's currency; `sequence` the number this document
 * prints. `setting` is one of the add-on's own settings, which only the add-on
 * reads, so it is left to the add-on — and a required slot the engine cannot
 * fill still counts as missing.
 */
function slotDefault(slot: SubjectSlot, input: SubjectInput, scale: number): unknown {
  let raw: unknown;
  if (slot.default === 'now') raw = input.drawnBefore?.[slot.id] ?? input.now.iso;
  else if (slot.default === 'connection') raw = input.currency;
  else if (slot.default === 'sequence') raw = input.number;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = coerceSlot(slot.type, raw, scale, input.now.timezone);
  return value === null || value === '' ? undefined : value;
}

const DECIMAL = /^([+−-]?)(\d*)(?:[.,](\d*))?$/;

/**
 * Decimal text → integer minor units, by string arithmetic.
 *
 * `scale` is how many decimals the currency's minor unit has: 2 for euros,
 * 0 for yen, 3 for Kuwaiti dinars. A decimal past it rounds half away from
 * zero, which is the same rule `money.ts` uses in all three trees that
 * compute a total — so a value the pipeline coerces and a value a person
 * typed reach the provider identically.
 */
export function toMinorUnits(value: unknown, scale = 2): number | null {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'string' ? value : String(value);
  const match = DECIMAL.exec(text.trim().replace(/[\s_']/g, ''));
  if (match === null) return null;
  const [, sign, whole = '', frac = ''] = match;
  if (whole === '' && frac === '') return null;
  const digits = (frac + '0'.repeat(scale + 1)).slice(0, scale + 1);
  const minor =
    Number(whole === '' ? '0' : whole) * 10 ** scale +
    (scale === 0 ? 0 : Number(digits.slice(0, scale))) +
    (Number(digits[scale]) >= 5 ? 1 : 0);
  if (!Number.isFinite(minor)) return null;
  return sign === '-' || sign === '−' ? -minor : minor;
}

/**
 * A percentage → basis points. `20` → 2000, `7.5` → 750.
 *
 * THE SAME FUNCTION AS `toMinorUnits`, deliberately, and named separately so
 * a caller reads the intent rather than the arithmetic. Both are "decimal text
 * to integer hundredths": a currency's minor unit is a hundredth of a major
 * one, and a basis point is a hundredth of a percent. Writing the second one
 * out again would be a second place to get the third-decimal rounding right.
 */
export function toBasisPoints(value: unknown): number | null {
  return toMinorUnits(value);
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return '';
  return String(value);
}

function toLines(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(toText).filter((line) => line !== '');
  const text = toText(value);
  return text === '' ? [] : text.split('\n').filter((line) => line !== '');
}

/** A moment's day on a clock, as `YYYY-MM-DD`. */
function dayIn(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** An instant spelled as text: a date, a time, and its zone (`Z` or an offset). */
const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/i;

/**
 * An ISO day. A plain day is already one; a MOMENT (a timestamp's instant, as
 * a `Date` or as zoned text) is the day it fell on at the venue — `timezone`,
 * the connection's clock — never the UTC day: a payment voided at 00:30 in
 * Berlin was voided on that Berlin day. A plain `date` column reaches here as
 * its day already (the source read spells it so), because a driver's `Date`
 * for a day is the server's local midnight, not an instant at the venue.
 */
function toDate(value: unknown, timezone = 'UTC'): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : dayIn(value, timezone);
  const text = toText(value);
  if (INSTANT.test(text.trim())) {
    const at = new Date(text.trim().replace(' ', 'T'));
    if (!Number.isNaN(at.getTime())) return dayIn(at, timezone);
  }
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

/**
 * Coerce one value to what the wire law says a slot of this type carries.
 *
 * `moneyScale` is the decimals of the DOCUMENT's currency: money is integer
 * minor units of that currency, so ¥1,200 is 1200 and 1.250 KWD is 1250 —
 * never a hundredth of either.
 */
export function coerceSlot(type: SlotType, value: unknown, moneyScale = 2, timezone = 'UTC'): unknown {
  switch (type) {
    case 'money':
      return toMinorUnits(value, moneyScale);
    case 'percent':
      return toBasisPoints(value);
    case 'number': {
      // An empty column is no number, not zero (`Number('')` is 0).
      if (value === null || value === undefined || toText(value).trim() === '') return null;
      const numeric = typeof value === 'number' ? value : Number(toText(value));
      return Number.isFinite(numeric) ? numeric : null;
    }
    case 'text[]':
      return toLines(value);
    case 'date':
      return toDate(value, timezone);
    case 'collection':
      // Rows are coerced column by column by the caller; a collection slot
      // itself never holds a scalar.
      return null;
    case 'qr': {
      // The code's text alone, at most 64 bytes; anything else draws no code (and a required slot is missing).
      const text = value === null || value === undefined ? '' : toText(value).trim();
      if (!qrCarries(text)) return null;
      return { text, modules: qrRows(text), png: qrPngDataUrl(text) };
    }
    default:
      return toText(value);
  }
}

export interface SubjectInput {
  slots: readonly SubjectSlot[];
  mapping: ProfileMapping;
  /** The source row, already unmasked and read with the caller's grants. */
  row: Readonly<Record<string, unknown>>;
  /** Child rows per collection slot id, already fetched by the caller. */
  collections?: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /** Values a lookup across a foreign key resolved to, keyed `<ref>.<column>`. */
  lookups?: Readonly<Record<string, unknown>>;
  /**
   * Typed per-profile values — "entered here, not read from your data", stored
   * as `options.literals` on the profile.
   *
   * They are NOT part of `mapping`, and the difference is the point: `mapping`
   * says which columns are read, and a value typed into the editor is read
   * from nothing. Keeping them apart is what lets a screen show a bound field
   * as its column name and a typed one as its value, so an operator can see
   * which half of a document is live (O20).
   */
  values?: Readonly<Record<string, unknown>>;
  /**
   * Collection rows a caller supplies OUTRIGHT, keyed by the slot's own column
   * ids — a request-shaped intent (D15), which has no source table to read.
   *
   * Distinct from `collections`, which holds CHILD ROWS keyed by their source
   * columns and is meaningless without a mapping to translate them. Folding the
   * two together would mean guessing which naming a caller used, and guessing
   * wrong draws a line-items table full of blanks.
   */
  collectionValues?: Readonly<
    Record<string, readonly Readonly<Record<string, unknown>>[]>
  >;
  /**
   * The prefix a mapped code column keeps its codes with (`GC-`), keyed as
   * `lookups` is: `<column>`, or `<ref>.<column>` across a link. A code read
   * out in groups keeps it whole. Absent, a code is grouped from its start.
   */
  codePrefixes?: Readonly<Record<string, string>> | undefined;
  now: { iso: string; timezone: string };
  locale: string;
  currency: string;
  business: { name: string; lines: readonly string[]; logoDataUrl?: string };
  entity: RecordRef | null;
  number: string | null;
  /** The fields this document printed when it was last drawn, if it was. */
  drawnBefore?: Readonly<Record<string, unknown>>;
}

export interface BuiltSubject {
  subject: {
    now: { iso: string; timezone: string };
    locale: string;
    currency: string;
    business: { name: string; lines: readonly string[]; logoDataUrl?: string };
    entity: RecordRef | null;
    number: string | null;
    fields: Record<string, unknown>;
    collections: Record<string, readonly Readonly<Record<string, unknown>>[]>;
  };
  /** Required slots with no mapping and no value — the operator's to fix. */
  missing: readonly string[];
}

/**
 * Build the subject, and report what the mapping did not cover.
 *
 * MISSING IS REPORTED, NOT THROWN. The caller is the render job, which turns
 * it into a `failed` register row naming the slots — a document that could not
 * be made is a fact worth recording, and an exception here would leave the
 * operator with a job error and no row to look at.
 */
export function buildSubject(input: SubjectInput): BuiltSubject {
  const fields: Record<string, unknown> = {};
  const collections: Record<string, readonly Readonly<Record<string, unknown>>[]> = {};
  const missing: string[] = [];
  const scale = currencyScale(input.currency);
  const zone = input.now.timezone;

  for (const slot of input.slots) {
    const mapped = input.mapping[slot.id];

    if (slot.type === 'collection') {
      /*
       * An UNMAPPED collection contributes nothing — not a list of rows with
       * only their ids in them, which is what a version of this loop that
       * skipped the check produced. That would have drawn a line-items table
       * with the right number of blank rows: worse than an absent block,
       * because it looks like data.
       */
      if (mapped !== undefined && 'sources' in mapped) {
        // Several sources, read already in the slot's own column ids (see `compose.ts`).
        collections[slot.id] = (input.collections?.[slot.id] ?? []).map((row) => {
          const out: Record<string, unknown> = {};
          if (row.id !== undefined) out.id = toText(row.id);
          for (const column of slot.columns ?? []) {
            if (row[column.id] === undefined) continue;
            out[column.id] = coerceSlot(column.type, row[column.id], scale, zone);
          }
          return out;
        });
        continue;
      }
      if (mapped === undefined || !('collection' in mapped)) {
        // Supplied outright? Then it is already in the slot's own column ids
        // and needs only the same coercion a mapped row gets.
        const given = input.collectionValues?.[slot.id];
        if (given !== undefined && given.length > 0) {
          collections[slot.id] = given.map((row) => {
            const out: Record<string, unknown> = {};
            for (const column of slot.columns ?? []) {
              if (row[column.id] === undefined) continue;
              out[column.id] = coerceSlot(column.type, row[column.id], scale, zone);
            }
            return out;
          });
          continue;
        }
        collections[slot.id] = [];
        if (slot.required) missing.push(slot.id);
        continue;
      }
      const rows = input.collections?.[slot.id] ?? [];
      const columns = slot.columns ?? [];
      collections[slot.id] = rows.map((row) => {
        const out: Record<string, unknown> = {};
        // `id` is carried through when the child rows have one, so a renderer
        // can key its lines stably without minting anything.
        if (row.id !== undefined) out.id = toText(row.id);
        for (const column of columns) {
          const source = mapped.collection.columns[column.id];
          // A column that lists names one level below the line (a dish's options).
          if (source === undefined && mapped.collection.lists?.[column.id] !== undefined) {
            out[column.id] = coerceSlot(column.type, row[LIST_KEY(column.id)], scale, zone);
            continue;
          }
          if (source === undefined) continue;
          out[column.id] = coerceSlot(column.type, row[source], scale, zone);
        }
        return out;
      });
      continue;
    }

    if (mapped === undefined) {
      /*
       * A TYPED VALUE stands in for a column. It is consulted only where
       * nothing is mapped, which makes "authored or mapped, never both" (O20)
       * true here rather than merely promised by the editor: a profile
       * carrying both — an older mapping whose literal was left behind when a
       * column was chosen — draws the live column, not the stale constant.
       *
       * It goes through the SAME coercion as a column, so `"20"` typed into a
       * percent slot becomes 2000 basis points exactly as `20` read out of a
       * numeric column would. A literal that skipped it would be the one value
       * in the subject not written in the wire law.
       */
      const typed = input.values?.[slot.id];
      if (typed !== undefined && typed !== null && typed !== '') {
        const value = coerceSlot(slot.type, typed, scale, zone);
        if (value !== null && value !== '') {
          fields[slot.id] = value;
          continue;
        }
      }
      const fallback = slotDefault(slot, input, scale);
      if (fallback !== undefined) {
        fields[slot.id] = fallback;
        continue;
      }
      if (slot.required) missing.push(slot.id);
      continue;
    }

    const read =
      'column' in mapped && !('ref' in mapped)
        ? input.row[mapped.column]
        : 'ref' in mapped
          ? input.lookups?.[`${mapped.ref}.${mapped.column}`]
          : undefined;
    // A code read out in groups of four; an empty one stays empty.
    const raw = 'form' in mapped && mapped.form === 'grouped' && read !== null && read !== undefined && read !== '' ? groupedCode(read, input.codePrefixes?.['ref' in mapped ? `${mapped.ref}.${mapped.column}` : mapped.column] ?? '') : read;

    const value = coerceSlot(slot.type, raw, scale, zone);
    if (value === null || value === '') {
      // The column is mapped but empty on this row (a draft with no issue
      // date yet): the outline's default stands in, as it would unmapped.
      const fallback = slotDefault(slot, input, scale);
      if (fallback !== undefined) {
        fields[slot.id] = fallback;
        continue;
      }
      if (slot.required) {
        missing.push(slot.id);
        continue;
      }
    }
    fields[slot.id] = value;
  }

  return {
    subject: {
      now: input.now,
      locale: input.locale,
      currency: input.currency,
      business: input.business,
      entity: input.entity,
      number: input.number,
      fields,
      collections,
    },
    missing,
  };
}

/** Every table a profile's mapping reads — what the routes resolve grants over. */
/**
 * Every column a profile prints, by table: its own row's, a linked row's (by
 * the table the profile names, else the foreign key's in `view`), its lines'
 * and the names listed below them. A night's columns are worked out, not read
 * from a person's row, and are left out. `linked` names a foreign key's table
 * when the profile does not.
 */
export function mappedColumns(mapping: ProfileMapping, base: string, linked: (ref: string) => string | undefined): { table: string; column: string }[] {
  const out: { table: string; column: string }[] = [];
  const lists = (c: CollectionSource) => {
    // An add-on's rows found by a pair have no table to name until they are read.
    if (c.pair !== undefined) return;
    for (const column of Object.values(c.columns)) out.push({ table: c.table, column });
    for (const list of Object.values(c.lists ?? {})) out.push({ table: list.table, column: list.column });
  };
  for (const mapped of Object.values(mapping)) {
    if ('collection' in mapped) {
      lists(mapped.collection);
    } else if ('sources' in mapped) {
      for (const source of mapped.sources) if ('collection' in source) lists(source.collection);
    } else if ('ref' in mapped) {
      const table = mapped.table ?? linked(mapped.ref);
      if (table !== undefined) out.push({ table, column: mapped.column });
    } else {
      out.push({ table: base, column: mapped.column });
    }
  }
  return out;
}

export function mappedTables(mapping: ProfileMapping, base: string): readonly string[] {
  const tables = new Set<string>([base]);
  for (const mapped of Object.values(mapping)) {
    const lists = (c: CollectionSource) => {
      if (c.pair !== undefined) return;
      tables.add(c.table);
      for (const list of Object.values(c.lists ?? {})) tables.add(list.table);
    };
    if ('collection' in mapped) {
      lists(mapped.collection);
    } else if ('sources' in mapped) {
      for (const source of mapped.sources) if ('collection' in source) lists(source.collection);
    } else if ('ref' in mapped && mapped.table !== undefined) {
      // A column of a linked row is read from that row's table too.
      tables.add(mapped.table);
    }
  }
  return [...tables];
}
