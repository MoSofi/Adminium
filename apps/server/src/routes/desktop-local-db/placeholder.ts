/**
 * "Auto-generate placeholder entries" (11-electron.md §6 step 2 card 1;
 * the toggle is `Connect Database.dc.html`'s, task 11-T07).
 *
 * The comp states the whole requirement in its own helper text:
 *
 *   > You imported a schema with no rows. Seed each table with realistic sample
 *   > data so your dashboards and charts render immediately.
 *
 * "So your dashboards and charts render immediately" is the acceptance criterion,
 * and it rules out the obvious implementation. Filling every column with
 * `'text'`/`0`/`null` satisfies the constraints and produces a generated app in
 * which every chart is a flat line, every kanban column but one is empty, and
 * every date axis is a single point — i.e. it fails the one thing it was for.
 *
 * So the generator is built around three properties, in this order:
 *
 *  1. **Enum columns cycle through their values.** A status column that is
 *     `'active'` in all twelve rows renders a kanban with one occupied lane.
 *     Cycling is what makes the board look like a board.
 *  2. **Dates spread backwards from today.** One row per day, so a
 *     created-at axis has a domain and the calendar/gantt archetypes have
 *     something to lay out.
 *  3. **Numbers vary.** Seeded, not random (below), but not constant.
 *
 * ─── DETERMINISTIC, AND WHY THAT IS NOT A TEST CONVENIENCE ───────────────────
 *
 * Every value derives from a hash of (table, column, rowIndex) — no `Math.random`,
 * no `Date.now()` beyond the single `now` the caller injects. That makes the
 * suite able to assert on actual values rather than on shapes, but the reason it
 * is written this way is the user's: two people importing the same Prisma schema
 * on two machines get the same demo, so a screenshot in an issue means something
 * and "it looks wrong on mine" is a real report rather than a coin flip.
 *
 * ─── THIS IS NOT THE DEMO DATABASE ───────────────────────────────────────────
 *
 * 11-T08's `demo-seed.mjs` (§6 card 4) is a hand-authored domain: nine tables
 * written so each one's intended archetype outscores its runners-up, with the
 * margins recorded per table. It can do that because it owns its schema. This
 * generator owns nothing — the schema is whatever the user dropped on the
 * wizard — so it cannot aim at an archetype, only avoid destroying the evidence
 * of one. The two are not redundant and neither can be written in terms of the
 * other.
 */

import type { DatabaseModel, TableModel } from '@adminium/engine';

/** Rows per table. */
export const PLACEHOLDER_ROWS_PER_TABLE = 12;

export interface PlaceholderInsert {
  table: string;
  columns: string[];
  /** One array per row, positionally matching {@link PlaceholderInsert.columns}. */
  rows: (string | number | null)[][];
}

export interface PlaceholderPlan {
  inserts: PlaceholderInsert[];
  /** Tables that were skipped, and why — surfaced to the wizard. */
  skipped: { table: string; reason: 'circular-fk' | 'no-insertable-columns' }[];
}

/**
 * FNV-1a. A hash, not a PRNG: the same (table, column, row) must produce the
 * same value no matter what order the tables are visited in, which a stateful
 * generator with a running seed does not guarantee (add a table, every later
 * table's data shifts, and a review diff becomes unreadable).
 */
function hash(...parts: (string | number)[]): number {
  let value = 0x811c9dc5;
  for (const part of parts.join('\x00')) {
    value ^= part.codePointAt(0) ?? 0;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

/**
 * `seed >>> 0`, not `seed % length`, and the difference is not pedantry.
 *
 * {@link hash} returns a uint32, but the call sites derive a second seed from it
 * with a shift (`seed >>> 3`) to pick a surname independently of a forename.
 * JavaScript's `>>` coerces to INT32 first, so any hash above 2^31 came back
 * NEGATIVE, `%` preserved that sign, and `items[-4]` is `undefined` — which then
 * reached `.toLowerCase()` and threw. The bug was invisible because it depends on
 * the hash of a particular column name, so roughly half of all schemas seeded
 * fine and the other half 500'd.
 *
 * Hence both halves of the fix: `>>>` at every call site, and this normalisation
 * so a future caller cannot reintroduce it. The throw is unreachable — every
 * caller passes a non-empty literal — but it is what makes that a checked fact
 * instead of a comment, and it is the reason there is no `as T` here any more.
 * The cast is what let the original bug compile.
 */
function pick<T>(items: readonly T[], seed: number): T {
  const value = items[(seed >>> 0) % items.length];
  if (value === undefined) throw new Error('pick() requires a non-empty list');
  return value;
}

/**
 * Name vocabularies. Deliberately generic and deliberately not localized: this
 * is ROW DATA in a database the user is about to own and edit, not UI copy —
 * translating it would put `t()` output inside their `users` table, where it
 * would then be exported, backed up (§9) and read back as data forever.
 */
const FIRST_NAMES = ['Ava', 'Noah', 'Mia', 'Liam', 'Zoe', 'Kai', 'Iris', 'Omar', 'Lena', 'Theo', 'Nadia', 'Ruben'];
const LAST_NAMES = ['Reyes', 'Okafor', 'Lindqvist', 'Haddad', 'Novak', 'Tanaka', 'Silva', 'Dubois', 'Kowalski', 'Ferrari', 'Ali', 'Nguyen'];
const COMPANIES = ['Northwind', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Soylent', 'Vandelay', 'Hooli'];
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'sigma'];
const SENTENCES = [
  'Follow up after the review.',
  'Waiting on the vendor to confirm.',
  'Scoped and ready to start.',
  'Blocked on the migration.',
  'Shipped — monitoring for a week.',
  'Needs a second pair of eyes.',
];

/**
 * Column-name heuristics.
 *
 * A conscious duplication of a slice of the classifier's §7.1 vocabulary, and
 * the duplication is the honest choice rather than the lazy one: the classifier
 * runs on an INTROSPECTED model to decide how to RENDER a column, and reaching
 * into it from here would couple "what does this column mean" to "what should we
 * write into it" — two questions with different failure modes. It is also not
 * available at this point in the flow: the model here came from a schema FILE
 * and has `semantics: null` throughout (nothing has classified it; that happens
 * after this database is created and introspected). So `semantics` is read when
 * present and the name is the fallback that actually fires.
 */
type ValueKind =
  | 'person-name'
  | 'first-name'
  | 'last-name'
  | 'email'
  | 'phone'
  | 'company'
  | 'title'
  | 'description'
  | 'slug'
  | 'url'
  | 'money'
  | 'percent'
  | 'count'
  | 'color';

const NAME_RULES: readonly { pattern: RegExp; kind: ValueKind }[] = [
  { pattern: /^(first_?name|given_?name)$/i, kind: 'first-name' },
  { pattern: /^(last_?name|family_?name|surname)$/i, kind: 'last-name' },
  { pattern: /(full_?name|display_?name|^name$|contact_?name|author|owner|assignee)/i, kind: 'person-name' },
  { pattern: /e?mail/i, kind: 'email' },
  { pattern: /(phone|mobile|tel)/i, kind: 'phone' },
  { pattern: /(company|organi[sz]ation|account_?name|vendor|customer_?name)/i, kind: 'company' },
  { pattern: /(title|subject|headline|label)/i, kind: 'title' },
  { pattern: /(description|body|notes?|comment|summary|message|content)/i, kind: 'description' },
  { pattern: /slug|handle|username/i, kind: 'slug' },
  { pattern: /(url|link|href|website|avatar|image|photo)/i, kind: 'url' },
  { pattern: /(amount|price|total|cost|revenue|mrr|arr|balance|salary|fee|budget)/i, kind: 'money' },
  { pattern: /(percent|pct|rate|ratio|progress|score)/i, kind: 'percent' },
  { pattern: /(count|qty|quantity|number_?of|views|clicks)/i, kind: 'count' },
  { pattern: /colou?r/i, kind: 'color' },
];

function valueKindFor(column: TableModel['columns'][number]): ValueKind | null {
  const tag = column.semantics?.primary;
  // The classifier's answer wins when there is one — a `semantics` set by an
  // override or an LLM pass is a human decision this heuristic must not overrule.
  if (tag === 'person-name') return 'person-name';
  if (tag === 'email') return 'email';
  if (tag === 'phone') return 'phone';
  if (tag === 'money') return 'money';
  if (tag === 'percent' || tag === 'score') return 'percent';
  if (tag === 'url' || tag === 'image-url') return 'url';
  if (tag === 'slug') return 'slug';
  if (tag === 'color') return 'color';
  if (tag === 'free-text') return 'description';

  for (const rule of NAME_RULES) {
    if (rule.pattern.test(column.name)) return rule.kind;
  }
  return null;
}

/** `YYYY-MM-DD HH:MM:SS` — SQLite's canonical datetime text (no `T`, no zone). */
function sqliteDateTime(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

function textValue(kind: ValueKind | null, seed: number, row: number, maxLength: number | null): string {
  const raw = ((): string => {
    switch (kind) {
      case 'first-name':
        return pick(FIRST_NAMES, seed);
      case 'last-name':
        return pick(LAST_NAMES, seed);
      case 'person-name':
        return `${pick(FIRST_NAMES, seed)} ${pick(LAST_NAMES, seed >>> 3)}`;
      case 'email':
        return `${pick(FIRST_NAMES, seed).toLowerCase()}.${pick(LAST_NAMES, seed >>> 3).toLowerCase()}${String(row)}@example.com`;
      case 'phone':
        return `+1 555 ${String(100 + (seed % 900))} ${String(1000 + (seed % 9000))}`;
      case 'company':
        return pick(COMPANIES, seed);
      case 'title':
        return `${capitalize(pick(WORDS, seed))} ${pick(WORDS, seed >>> 5)} ${String(row + 1)}`;
      case 'description':
        return pick(SENTENCES, seed);
      case 'slug':
        return `${pick(WORDS, seed)}-${pick(WORDS, seed >>> 5)}-${String(row + 1)}`;
      case 'url':
        return `https://example.com/${pick(WORDS, seed)}/${String(row + 1)}`;
      case 'color':
        // Not a raw hex in a component — this is a VALUE in the user's database,
        // which is precisely the case `adminium/no-style-prop` does not cover and
        // a colour column expects.
        return pick(['#4F46E5', '#059669', '#DC2626', '#D97706', '#0891B2', '#7C3AED'], seed);
      case 'money':
      case 'percent':
      case 'count':
      case null:
        return `${capitalize(pick(WORDS, seed))} ${String(row + 1)}`;
    }
  })();
  return maxLength !== null && raw.length > maxLength ? raw.slice(0, maxLength) : raw;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function numberValue(kind: ValueKind | null, seed: number, row: number, scale: number): number {
  switch (kind) {
    case 'money': {
      const cents = 1_000 + (seed % 490_000);
      return scale > 0 ? Number((cents / 100).toFixed(Math.min(scale, 2))) : Math.round(cents / 100);
    }
    case 'percent':
      return scale > 0 ? Number(((seed % 1000) / 10).toFixed(Math.min(scale, 2))) : seed % 101;
    case 'count':
      return seed % 500;
    default:
      return scale > 0 ? Number(((seed % 10_000) / 100).toFixed(Math.min(scale, 2))) : row + 1 + (seed % 50);
  }
}

interface ColumnPlan {
  name: string;
  value: (row: number) => string | number | null;
}

/**
 * Which PK values a table's rows will carry, so children can reference them.
 *
 * Rowid-alias parents (`INTEGER PRIMARY KEY` — see `sqlite-ddl.ts`) are assigned
 * 1..N by SQLite itself on insert, and the inserts below go in one transaction in
 * this exact order, so `1..N` is not a guess: it is what those inserts produce.
 */
type PkValues = Map<string, (string | number)[]>;

export interface PlaceholderOptions {
  /** Injected so the suite can assert exact dates. */
  now: Date;
  rowsPerTable?: number | undefined;
}

/**
 * Plan the INSERTs for a freshly created schema.
 *
 * `ordered` must be the topological order `emitSqliteDdl` used — parents before
 * children — and is passed in rather than recomputed so the two can never
 * disagree about which table is a parent.
 */
export function planPlaceholderRows(
  model: DatabaseModel,
  ordered: readonly TableModel[],
  nameOf: (table: TableModel) => string,
  options: PlaceholderOptions,
): PlaceholderPlan {
  const rowCount = options.rowsPerTable ?? PLACEHOLDER_ROWS_PER_TABLE;
  const inserts: PlaceholderInsert[] = [];
  const skipped: PlaceholderPlan['skipped'] = [];
  const pkValues: PkValues = new Map();

  // A cycle has no parents-first order, so a child would reference rows that do
  // not exist yet. `orderTables` already reports the cycle; this is the seeding
  // half of the same fact.
  const inCycle = new Set(cyclicTableIds(model, ordered));

  for (const table of ordered) {
    const name = nameOf(table);
    if (inCycle.has(table.id)) {
      skipped.push({ table: name, reason: 'circular-fk' });
      continue;
    }

    const rowidAlias =
      table.primaryKey.length === 1 &&
      table.columns.some(
        (column) =>
          column.name === table.primaryKey[0] &&
          (column.logicalType === 'integer' || column.logicalType === 'bigint'),
      );

    const plans: ColumnPlan[] = [];
    for (const column of table.columns) {
      // SQLite assigns it; naming it in the INSERT would fight the sequence.
      if (rowidAlias && column.name === table.primaryKey[0]) continue;
      // A stored generated column rejects an explicit value. (`sqlite-ddl.ts`
      // materializes these as ordinary columns, so this is belt-and-braces for a
      // future in which it does not.)
      if (column.isGenerated) continue;

      const plan = columnPlan(table, column, model, pkValues, nameOf, options, rowCount);
      if (plan === null) {
        // Nothing sensible AND nothing required: leave it to its default/NULL.
        continue;
      }
      plans.push(plan);
    }

    if (plans.length === 0) {
      // A table whose every column is an auto-assigned PK is legal and rare;
      // twelve empty INSERTs would still be right, but "no insertable columns"
      // is the more useful thing to say than a row of nothing.
      skipped.push({ table: name, reason: 'no-insertable-columns' });
      continue;
    }

    const rows: (string | number | null)[][] = [];
    for (let row = 0; row < rowCount; row += 1) {
      rows.push(plans.map((plan) => plan.value(row)));
    }
    inserts.push({ table: name, columns: plans.map((plan) => plan.name), rows });

    // Record what the children can point at.
    if (table.primaryKey.length === 1) {
      const pk = table.primaryKey[0] as string;
      if (rowidAlias) {
        pkValues.set(table.id, Array.from({ length: rowCount }, (_, index) => index + 1));
      } else {
        const index = plans.findIndex((plan) => plan.name === pk);
        if (index !== -1) {
          pkValues.set(
            table.id,
            rows.map((row) => row[index] as string | number),
          );
        }
      }
    }
  }

  return { inserts, skipped };
}

/** Tables `orderTables` could not order — see its `circular-fk` warning. */
function cyclicTableIds(model: DatabaseModel, ordered: readonly TableModel[]): string[] {
  const byId = new Map(ordered.map((table) => [table.id, table]));
  const dependencies = new Map<string, Set<string>>(ordered.map((table) => [table.id, new Set<string>()]));
  for (const relation of model.relations) {
    if (relation.kind !== 'declared-fk' || relation.through !== null || relation.selfReferential) continue;
    if (!byId.has(relation.from.tableId) || !byId.has(relation.to.tableId)) continue;
    dependencies.get(relation.from.tableId)?.add(relation.to.tableId);
  }
  const settled = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const table of ordered) {
      if (settled.has(table.id)) continue;
      if ([...(dependencies.get(table.id) ?? [])].every((id) => settled.has(id))) {
        settled.add(table.id);
        progress = true;
      }
    }
  }
  return ordered.filter((table) => !settled.has(table.id)).map((table) => table.id);
}

function columnPlan(
  table: TableModel,
  column: TableModel['columns'][number],
  model: DatabaseModel,
  pkValues: PkValues,
  nameOf: (table: TableModel) => string,
  options: PlaceholderOptions,
  rowCount: number,
): ColumnPlan | null {
  const seedOf = (row: number): number => hash(table.id, column.name, row);

  // ── Foreign keys: point at a row that exists ──
  const fk = model.relations.find(
    (relation) =>
      relation.kind === 'declared-fk' &&
      relation.through === null &&
      relation.from.tableId === table.id &&
      relation.from.columns.length === 1 &&
      relation.from.columns[0] === column.name,
  );
  if (fk !== undefined) {
    if (fk.selfReferential) {
      // Row 0 is the root (NULL); every later row points at an EARLIER one. That
      // is what makes a self-FK an org chart rather than a cycle — and the
      // "earlier" is why it terminates. A non-nullable self-FK cannot be seeded
      // at all (row 0 would have to reference itself), so it is left out.
      if (!column.nullable) return null;
      return {
        name: column.name,
        value: (row) => (row === 0 ? null : 1 + (seedOf(row) % row)),
      };
    }
    const parents = pkValues.get(fk.to.tableId);
    if (parents === undefined || parents.length === 0) {
      // The parent was skipped or has no single-column PK. A non-nullable FK to
      // it cannot be satisfied, so the whole column is dropped and the insert
      // will fail loudly rather than write a dangling id.
      return column.nullable ? { name: column.name, value: () => null } : null;
    }
    return { name: column.name, value: (row) => parents[seedOf(row) % parents.length] as string | number };
  }

  const kind = valueKindFor(column);

  // ── Enums: cycle, so a board has more than one occupied lane ──
  if (column.logicalType === 'enum' && column.enumRef !== null) {
    const def = model.enums.find((candidate) => candidate.id === column.enumRef);
    if (def !== undefined && def.values.length > 0) {
      const values = def.values;
      // Round-robin rather than hashed: a hash over 12 rows and 4 values leaves
      // a lane empty roughly a third of the time, and an empty lane is exactly
      // the thing this function exists to prevent.
      return { name: column.name, value: (row) => values[row % values.length] as string };
    }
  }

  switch (column.logicalType) {
    case 'boolean':
      return { name: column.name, value: (row) => (seedOf(row) % 3 === 0 ? 0 : 1) };

    case 'date':
      return {
        name: column.name,
        value: (row) => dateOffset(options.now, row, rowCount).toISOString().slice(0, 10),
      };

    case 'timestamp':
    case 'timestamptz':
      return { name: column.name, value: (row) => sqliteDateTime(dateOffset(options.now, row, rowCount)) };

    case 'time':
      return { name: column.name, value: (row) => `${String(8 + (row % 10)).padStart(2, '0')}:00:00` };

    case 'uuid':
      return { name: column.name, value: (row) => uuidFrom(table.id, column.name, row) };

    case 'integer':
    case 'bigint':
      return { name: column.name, value: (row) => (column.isUnique ? row + 1 : numberValue(kind, seedOf(row), row, 0)) };

    case 'decimal':
      return {
        name: column.name,
        value: (row) => numberValue(kind, seedOf(row), row, column.numericScale ?? 2),
      };

    case 'float':
      return { name: column.name, value: (row) => numberValue(kind, seedOf(row), row, 2) };

    case 'json':
      return { name: column.name, value: (row) => JSON.stringify({ note: pick(WORDS, seedOf(row)), index: row }) };

    case 'text':
    case 'varchar':
    case 'inet':
    case 'interval':
    case 'unknown':
    case 'enum': {
      const base = (row: number): string => textValue(kind, seedOf(row), row, column.maxLength);
      // A unique text column with a vocabulary this small collides; the row index
      // is what keeps twelve inserts from becoming one insert and eleven errors.
      return { name: column.name, value: column.isUnique ? (row) => suffix(base(row), row, column.maxLength) : base };
    }

    case 'binary':
    case 'geometry':
      // No honest placeholder exists for an opaque blob, and a made-up one would
      // be a corrupt image/geometry the app then tries to render.
      return column.nullable ? null : { name: column.name, value: () => null };
  }
}

/** A distinct value that still fits the declared length. */
function suffix(value: string, row: number, maxLength: number | null): string {
  const tag = `-${String(row + 1)}`;
  if (maxLength === null) return `${value}${tag}`;
  return `${value.slice(0, Math.max(maxLength - tag.length, 0))}${tag}`;
}

/**
 * One row per day, ending today: `rowCount - 1` days ago … today.
 *
 * A spread, not a scatter, and the direction is the point — a `created_at` that
 * runs into the future makes every "last 30 days" dashboard the generator
 * produces look broken on the day it is created.
 */
function dateOffset(now: Date, row: number, rowCount: number): Date {
  const daysAgo = rowCount - 1 - row;
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
}

/** A stable v4-shaped uuid. Not cryptographic — it identifies a demo row. */
function uuidFrom(table: string, column: string, row: number): string {
  const chunks: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    chunks.push(hash(table, column, row, index).toString(16).padStart(8, '0'));
  }
  const hex = chunks.join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
