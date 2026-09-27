// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PERSON A PUBLIC WRITE IS FOR, FOUND BY ADDRESS OR MADE.
 *
 * A guest's order names an address. The person with that address is linked
 * to the order; nobody has it yet, a person row is made with it (and the
 * few columns the entry fills a new person with) — inside the order's own
 * transaction, so a refused order leaves no person behind. The guest is never
 * told which happened: the reply, the refusals and the caps are the same
 * either way, and the work differs by one INSERT.
 *
 * ─── The same answer for a known and an unknown address ───────────────────
 * Everything that could refuse is asked of BOTH branches, before the address
 * is looked up: the would-be person row goes through the write service's
 * checks (a fill too long is refused the same whether or not the person
 * exists) and the role's column grants. A person table that behaves
 * differently for a new row — a running number, a limit, a hook — is refused
 * for everybody, never only for strangers.
 *
 * ─── Found, never changed ──────────────────────────────────────────────────
 * A found person is linked and left as it is: a stranger typing someone's
 * address never renames them. An address that only looks like one on file (a
 * MySQL collation reads `adà@` as `ada@`) links nobody: the row stays
 * unlinked, and the desk can link it.
 *
 * ─── Two writers, one new address ──────────────────────────────────────────
 * On Postgres a transaction-scoped advisory lock named by the address
 * serialises every find-or-create of it, taken right after the write's named
 * locks (the one lock order). MySQL cannot take a named lock inside an open
 * transaction, so the address's lock joins the write's named locks, taken
 * before its transaction opens ({@link personLocks}): a second writer of the
 * same address waits there — for a known address as for a new one — and never
 * on the first one's uncommitted row. Should a writer still meet the unique
 * index (one that took no lock), the caller runs its whole write again once,
 * and the fresh transaction finds the row. SQLite has one writer.
 *
 * ─── Found by the address as sign-in finds it ──────────────────────────────
 * The person is looked for as signing in looks for them, by the address
 * trimmed and in lower case, so a person kept as `Ada@Example.com` is never
 * made again as `ada@example.com` (sign-in would then find two, and let
 * neither in). Only a row that keeps the address exactly as typed (trimmed,
 * lower case) is linked; one that keeps it any other way is a look-alike and
 * links nobody, as a collation's look-alike does.
 */
import { createHash } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { refuseUngrantedColumns } from '../connections/privileges.js';
import { normaliseAddress } from '../public-api/claim-code.js';
import type { NamedLock } from './capacity/locks.js';
import { isUniqueViolation } from './decided-columns.js';
import type { Row } from './mask.js';
import { tableRulesFor } from './column-rules.js';
import type { RecordWriteService } from './write-service.js';
import type { WriteContext, WriteTarget } from './write-context.js';

type Db = Kysely<SourceDatabase>;

/** A value the would-be person row was refused for: the person table's column, and why. */
export class PersonRefused extends Error {
  constructor(
    readonly column: string,
    readonly reason: string,
  ) {
    super('The person this write is for was refused.');
  }
}

/**
 * A person table that cannot be found-or-made the same way for a known and
 * an unknown address (a hook, a running number, a limit): the app's make-up,
 * refused for everybody and never named to a guest.
 */
export class PersonTableUnusable extends Error {
  constructor(readonly why: string) {
    super(`The person table cannot be used to find a person by address: ${why}.`);
  }
}

/** Another writer made the same new person first: the caller runs its whole write again, once. */
export class PersonRaced extends Error {
  constructor(readonly original: unknown) {
    super('Another write made the same person first.');
  }
}

export interface ResolvePersonInput {
  writes: RecordWriteService;
  /** The person table, on the write's transaction handle, with the role's grants on it. */
  identity: WriteTarget & { db: Db };
  /** The person table's address column. */
  email: string;
  /** The address typed, as sent (plausible already). */
  address: string;
  /** The person table's columns a NEW person is filled with (never a found one). */
  fill: Readonly<Row>;
  context: WriteContext;
}

export interface ResolvedPerson {
  /** The person's key, or null when the address only looks like one on file. */
  link: unknown;
  /** The person row made by this write (announced once the write commits), or null when one was found. */
  made: Row | null;
}

/** Why a person table would behave differently for a new person, or null. */
export async function personTableUnusable(writes: RecordWriteService, identity: WriteTarget, context: WriteContext): Promise<string | null> {
  const rules = tableRulesFor(identity);
  if ((rules?.sequences?.length ?? 0) > 0 || (rules?.gapless?.length ?? 0) > 0) return 'it numbers its rows';
  if ((identity.table.table?.capacityRules?.length ?? 0) > 0 || rules?.booking !== undefined) return 'it keeps a limit';
  if ((await writes.wants('before', 'create', identity, context)) || (await writes.wants('after', 'create', identity, context))) return 'a hook runs when a row is made';
  return null;
}

/** The name of the lock that serialises finding-or-making one address. */
export function personLockName(connectionId: string, tableId: string, address: string): string {
  return `person|${connectionId}|${tableId}|${createHash('sha256').update(normaliseAddress(address)).digest('hex')}`;
}

/**
 * The address's lock as one of the write's named locks, taken before its
 * transaction: on MySQL only, where a named lock cannot be taken inside one.
 * (Postgres takes it inside, in {@link resolvePerson}; SQLite has one writer.)
 */
export function personLocks(target: Pick<WriteTarget, 'connectionId' | 'dialect'>, tableId: string, address: unknown): NamedLock[] {
  if (target.dialect !== 'mysql' || typeof address !== 'string' || address.trim() === '') return [];
  return [{ name: personLockName(target.connectionId, tableId, address), busy: 'CAPACITY_BUSY' }];
}

/**
 * Everything that could refuse the person a write is for, asked the same for
 * a known and an unknown address and before anything is looked up or held:
 * the person table's make-up, the would-be row's checks and widths, and the
 * role's column grants. A quote asks exactly this (it finds and makes nobody);
 * a save asks it first. Returns the would-be row.
 */
export async function checkPerson(input: Omit<ResolvePersonInput, 'identity'> & { identity: WriteTarget }): Promise<Row> {
  const { writes, identity, email, context } = input;
  const address = normaliseAddress(input.address);
  const unusable = await personTableUnusable(writes, identity, context);
  if (unusable !== null) throw new PersonTableUnusable(unusable);
  const wouldBe: Row = { ...input.fill, [email]: address };
  const checked = await writes.check('create', identity, context, [wouldBe]);
  const issues = checked.issues[0];
  if (issues !== null && issues !== undefined) {
    const [column, issue] = Object.entries(issues)[0] ?? [];
    throw new PersonRefused(column ?? email, typeof (issue as { code?: unknown } | undefined)?.code === 'string' ? (issue as { code: string }).code : 'invalid');
  }
  // The width the database holds a text to: refused here for both, not by the INSERT only a new person runs.
  for (const [column, value] of Object.entries(wouldBe)) {
    const width = identity.table.table?.columns.find((c) => c.name === column)?.maxLength ?? null;
    if (typeof value === 'string' && width !== null && [...value].length > width) throw new PersonRefused(column, 'too-long');
  }
  refuseUngrantedColumns(identity.rights, identity.table, 'create', Object.keys(checked.rows[0] ?? wouldBe));
  return wouldBe;
}

/**
 * Find the person with this address, or make one — inside the write's own
 * transaction (`identity.db`). Throws {@link PersonRefused} for a would-be
 * row the checks refuse (known and unknown alike), {@link PersonTableUnusable}
 * for a person table that cannot be used this way, and {@link PersonRaced}
 * when another writer made the same person first (the caller retries once).
 */
export async function resolvePerson(input: ResolvePersonInput): Promise<ResolvedPerson> {
  const { writes, identity, email, context } = input;
  const address = normaliseAddress(input.address);
  const db = identity.db;

  // 1. Everything that could refuse, for both branches alike, before the address is looked up.
  const wouldBe = await checkPerson(input);

  // 2. One writer per address at a time, on Postgres (released with the transaction).
  if (identity.dialect === 'postgres') {
    await sql`select pg_advisory_xact_lock(hashtextextended(${personLockName(identity.connectionId, identity.table.id, address)}, 0))`.execute(db);
  }

  // 3. Found: looked for as sign-in looks (trimmed, lower case); linked only to the one row that keeps it exactly so.
  const key = identity.table.primaryKey[0];
  if (key === undefined || identity.table.primaryKey.length !== 1) throw new PersonTableUnusable('it has no single-column key');
  const candidates = (await db
    .selectFrom(identity.table.id)
    .selectAll()
    .where(sql`lower(trim(${sql.ref(email)}))`, '=', address as never)
    .limit(20)
    .execute()) as Row[];
  const exact = candidates.filter((row) => row[email] === address);
  if (exact.length === 1) return { link: exact[0]![key], made: null };
  // Only a look-alike — another case, spaces kept, a collation's twin (or, on a table that lost its unique index, two): nobody is linked.
  if (candidates.length > 0) return { link: null, made: null };

  // 4. Made, through the one write path.
  let made: Row;
  try {
    // Announced by the caller once its whole write has committed: a row rolled back with it was never made.
    made = await writes.create({ target: identity, values: wouldBe, context, announce: async () => {} });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PersonRaced(error);
    throw error;
  }
  return { link: made[key], made };
}
