// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SERVER-GENERATED DEFAULTS ON THE PUBLIC SURFACE
 * (ruled 2026-09-01 as D21).
 *
 * ── THE HOLE THIS FILLS ─────────────────────────────────────────────────────
 *
 * Nothing on the public create path generates a value. `add-ons/install-ddl.ts`
 * emits no DEFAULT on any column, `insertRow` inserts what it is handed, and a
 * scope's `defaults` are static JSON. Every add-on table row that exists today
 * was written by an add-on's SERVER HALF, which is fine for the add-ons that
 * have one and impossible for the ones that do not.
 *
 * So an anonymous visitor cannot create a row at all, and the two obvious ways
 * round it are both refusals:
 *
 *   · make the primary key `writable` — `compileScope` refuses it, and rightly:
 *     a caller who picks their own id picks somebody else's id.
 * · mint the id in the browser — add-on code may not touch `crypto`, and even
 *   where it could, a client-chosen key is the same hazard wearing a different
 *   hat.
 *
 * The primitive that closes it is one sentinel: a `defaults` VALUE may be
 * `{ "$generate": "uuid" }` or `{ "$generate": "now" }`, and the server resolves
 * it at request time. It is general — every app whose intent rows sit on an
 * `id`-typed table needs exactly this, and `created_at` needs it too — and it is
 * the smallest change that makes an anonymous create possible.
 *
 * ── WHY NOT DIALECT `DEFAULT` EXPRESSIONS IN THE DDL ────────────────────────
 *
 * `gen_random_uuid()`, `(UUID())`, `lower(hex(randomblob(16)))` were the
 * alternative and are recorded as declined (O5). Two reasons: they reach only
 * tables Adminium itself created, so an app-owned table — which is most of
 * them — is no better off; and they apply only to FUTURE installs, leaving
 * every table already in an operator's database exactly where it was.
 *
 * ── WHERE THE VALUE COMES FROM, AND WHY THE DIALECT IS AN ARGUMENT ──────────
 *
 * `uuid` is `randomUUID()` and is the same string everywhere. `now` is not:
 * `install-ddl` maps `timestamptz` to `timestamptz` on postgres, `datetime` on
 * mysql and `text` on sqlite, and those three do not accept the same literal.
 * An ISO instant with its `T` and `Z` is what postgres and sqlite want and is
 * what MySQL's `datetime` rejects outright — it takes `YYYY-MM-DD HH:MM:SS`,
 * with no zone designator, and stores the literal it is given.
 *
 * A `Date` OBJECT WOULD NOT HAVE SOLVED IT EITHER, which is worth writing down
 * because it is the first thing anybody tries: `pg` and `mysql2` both serialize
 * one, and `better-sqlite3` refuses one outright ("can only bind numbers,
 * strings, bigints, buffers, and null"). There is no single JavaScript value
 * the three drivers agree on, so this formats a string per dialect and the
 * round trip is tested on all three.
 *
 * UTC IN ALL THREE CASES. A `datetime` has no zone to carry one, so the only
 * question is which instant the literal denotes, and the answer has to be the
 * same one postgres and sqlite are holding or the same row means two times.
 */
import { randomUUID } from 'node:crypto';

import type { Dialect } from '@adminium/engine';

/**
 * The closed set. A generator is a spec change, exactly as a slot id is.
 *
 * TWO, and the second is the one a reader might think is unnecessary. `uuid`
 * alone would let a visitor create a row with no `created_at`, and the column
 * is `notNull` in every `requiredSchema` that declares it — so the insert would
 * fail, and the operator's only repair would be to make their own audit column
 * nullable. `now` is not a convenience beside `uuid`; it is the other half of
 * the same create.
 */
export const PUBLIC_GENERATORS = ['uuid', 'now'] as const;
export type PublicGenerator = (typeof PUBLIC_GENERATORS)[number];

export function isPublicGenerator(name: unknown): name is PublicGenerator {
  return typeof name === 'string' && (PUBLIC_GENERATORS as readonly string[]).includes(name);
}

/**
 * Read a `defaults` value as a generator sentinel, or `null` if it is not one.
 *
 * ── THE COLLISION, STATED RATHER THAN HOPED AWAY ────────────────────────────
 *
 * A `defaults` value is arbitrary JSON, so `{ "$generate": … }` is in principle
 * a literal an operator might want to store in a `json` column. They cannot,
 * and this is the whole cost of the sentinel approach: any object carrying a
 * `$generate` key is read as an instruction here. The `$` prefix is the usual
 * guard and the case is vanishingly rare, but "vanishingly rare" is not "does
 * not happen", so it is a documented limitation rather than an unstated one.
 *
 * ANYTHING SHAPED LIKE A SENTINEL IS ONE, INCLUDING A BROKEN ONE. An object
 * with a `$generate` key and other keys beside it, or with an unknown
 * generator, comes back from here as a sentinel with `problem` set — never as
 * an ordinary literal. Treating a malformed sentinel as data is how a typo
 * (`{"$generate":"uuid","note":"the row id"}`) would end up serialized into the
 * column it was meant to fill, at request time, with nothing red anywhere.
 */
export interface GeneratorReading {
  /** The raw value of `$generate`, whatever type it turned out to be. */
  raw: unknown;
  /** Set when the sentinel is malformed; `null` when it is usable. */
  problem: 'unknown-generator' | 'extra-keys' | null;
  /** The generator, when `problem` is null. */
  generator: PublicGenerator | null;
}

export function readGenerator(value: unknown): GeneratorReading | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!Object.prototype.hasOwnProperty.call(value, '$generate')) return null;
  const raw = (value as Record<string, unknown>)['$generate'];
  const keys = Object.keys(value);
  if (keys.length !== 1) return { raw, problem: 'extra-keys', generator: null };
  if (!isPublicGenerator(raw)) return { raw, problem: 'unknown-generator', generator: null };
  return { raw, problem: null, generator: raw };
}

/**
 * The instant, in the form THIS dialect's `timestamptz` column accepts.
 *
 * Exported for the round-trip tests, which is the only way to prove the mysql
 * branch without a mysql server in the loop for every case.
 */
export function instantFor(dialect: Dialect, now: Date): string {
  const iso = now.toISOString();
  // `2026-09-06T12:34:56.789Z` → `2026-09-06 12:34:56.789`, still UTC.
  return dialect === 'mysql' ? iso.slice(0, 23).replace('T', ' ') : iso;
}

/**
 * Resolve every sentinel in a resource's `defaults`, leaving literals alone.
 *
 * ONE `now` FOR THE WHOLE ROW, not one per column: a row whose `created_at` and
 * `updated_at` differ by the microsecond it took to walk an object is a row
 * that looks edited the instant it was written.
 *
 * A malformed sentinel THROWS rather than being written through. `compileScope`
 * has already refused every one of them, so reaching this is a bug in the
 * compiler rather than an operator's mistake — and the alternative, quietly
 * inserting `{"$generate":"wibble"}` into an operator's table, is the failure
 * this whole file exists to avoid.
 */
export function resolveDefaults(
  defaults: Readonly<Record<string, unknown>>,
  dialect: Dialect,
  now: Date,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let instant: string | null = null;
  for (const [column, value] of Object.entries(defaults)) {
    const reading = readGenerator(value);
    if (reading === null) {
      out[column] = value;
      continue;
    }
    if (reading.problem !== null || reading.generator === null) {
      throw new Error(
        `public default for "${column}" is a malformed $generate sentinel (${reading.problem}) — compileScope should have refused it`,
      );
    }
    if (reading.generator === 'uuid') {
      out[column] = randomUUID();
    } else {
      instant ??= instantFor(dialect, now);
      out[column] = instant;
    }
  }
  return out;
}

/** Does this resource's `defaults` carry any sentinel at all? */
export function hasGeneratedDefault(defaults: Readonly<Record<string, unknown>>): boolean {
  return Object.values(defaults).some((v) => readGenerator(v) !== null);
}
