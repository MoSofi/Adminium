// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CODES A GUEST TYPES, ON THE PUBLIC API: what each try costs, and the rows a
 * code unlocks for reading.
 *
 * A typed code is a guess at a code the venue made. Each MISS costs the
 * visitor, and the key, one of a few a minute (`limiter.ts`,
 * `PUBLIC_CODE_GUESSES`): no such code, one expired or switched off, and one
 * whose uses are all taken are the same miss, whichever door it came through —
 * a save, a quote of one (a dry run is no free oracle), a change, a read of
 * the rows a code unlocks, availability asked with a code. A code that works
 * costs nothing. Once the misses are spent, a typed code is refused before
 * anything is looked up.
 *
 * A guess is reserved BEFORE anything is looked up and handed back when the
 * request ends without a miss (`guessRung`): requests that arrive together
 * are held to the count as surely as requests one after another.
 *
 * A code never travels in a URL — logs and proxies keep URLs — so a read
 * sends it in the `x-adminium-code` header, and a write in its values.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { CompiledResource } from '../../public-api/scope.js';
import type { SnapshotView, ResolvedTable } from '../../crud/identifiers.js';
import { canonicalCode, codeBodyLength, spellingOf, unlockedByCode, unlockedTargets, type CodeUnlock } from '../../crud/code-lookup.js';
import type { GuessTicket, PublicGuessRung, PublicRateLimiter, RateDecision } from '../../public-api/limiter.js';
import type { Row } from '../../crud/mask.js';
import type { TreeNode } from '../../crud/write-tree.js';
import type { Kysely } from 'kysely';
import type { SourceDatabase } from '../../connections/manager.js';

/** The header a read carries a typed code in. */
export const CODE_HEADER = 'x-adminium-code';

/** The reasons a refusal gives a typed code that missed: a discount code not found or used up, a card or a voucher not valid. */
export const MISSES: ReadonlySet<string> = new Set(['unknown', 'used-up', 'not-valid']);

/** The code a read carries, or null: a header, never the query string. */
export function typedCodeOf(request: FastifyRequest): string | null {
  const raw = request.headers[CODE_HEADER];
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  return trimmed === '' || trimmed.length > 64 ? null : trimmed;
}

/** The codes a write's values type into the table's lookups (none: the write guesses nothing). */
export function typesCode(table: ResolvedTable, values: Row): string[] {
  const out: string[] = [];
  for (const column of table.table.columns ?? []) {
    if (column.lookup === undefined) continue;
    const typed = values[column.lookup.from];
    if (typed !== null && typed !== undefined && !(typeof typed === 'string' && typed.trim() === '')) out.push(String(typed));
  }
  return out;
}

/** The codes a create with its rows types anywhere in it. */
export function treeTypesCode(node: TreeNode): string[] {
  return [...typesCode(node.target.table, node.values), ...node.children.flatMap(treeTypesCode)];
}

/** Thrown out of a read asked with a code when the visitor's guesses are spent (answered 429). */
export class GuessesSpent extends Error {
  override readonly name = 'GuessesSpent';
}

/** One request's guess: reserved before the lookup, kept for a miss, handed back otherwise. */
interface HeldGuess {
  keyId: string;
  ip: string;
  codes: string[];
  ticket: GuessTicket;
  missed: boolean;
}

/**
 * The code rung, per request. `reserve` holds one guess before anything is
 * looked up (answering 429 when the visitor's or the key's misses are
 * spent); `missed` keeps it; `settle` — run when the reply has gone — hands
 * back every guess that was no miss, and remembers the codes of a request
 * that succeeded as codes this visitor has seen work.
 */
export function guessRung(limiter: PublicRateLimiter, admit: (reply: FastifyReply, decision: RateDecision) => boolean) {
  const held = new WeakMap<FastifyRequest, HeldGuess>();
  const reserveFor = (request: FastifyRequest, keyId: string, typed: readonly string[], rung: PublicGuessRung = 'code'): RateDecision | null => {
    if (held.has(request)) return null;
    const codes = [...new Set(typed.map(canonicalCode))];
    const reserved = limiter.reserveGuess(keyId, request.ip, codes, rung);
    if ('refused' in reserved) return reserved.refused;
    held.set(request, { keyId, ip: request.ip, codes, ticket: reserved.ticket, missed: false });
    return null;
  };
  return {
    /** Reserve a guess, or answer 429 and say no. */
    admit(request: FastifyRequest, reply: FastifyReply, keyId: string, typed: readonly string[], rung: PublicGuessRung = 'code'): boolean {
      const refused = reserveFor(request, keyId, typed, rung);
      return refused === null || admit(reply, refused);
    },
    /** Reserve a guess with no reply to write: the refusal, or null once it is held. */
    reserve: reserveFor,
    /** The code this request typed missed: its guess is spent. */
    missed(request: FastifyRequest): void {
      const guess = held.get(request);
      if (guess !== undefined) guess.missed = true;
    },
    /** A refusal that answered a typed code as a miss spends the guess; any other leaves it to be handed back. */
    spendMiss(request: FastifyRequest, error: unknown): void {
      if (missedCode(error)) this.missed(request);
    },
    /** When the reply has gone: a guess that was no miss is handed back; a success's codes are remembered. */
    settle(request: FastifyRequest, reply: FastifyReply): void {
      const guess = held.get(request);
      if (guess === undefined) return;
      held.delete(request);
      if (guess.missed) {
        guess.ticket.keep();
        return;
      }
      guess.ticket.giveBack();
      if (reply.statusCode < 400) limiter.knownCodes(guess.keyId, guess.ip, guess.codes);
    },
  };
}

/** Whether a refusal answered a typed code as a miss (one of `MISSES`). */
export function missedCode(error: unknown): boolean {
  const params = (error as { params?: { reason?: unknown } } | null)?.params;
  return typeof params?.reason === 'string' && MISSES.has(params.reason);
}

/** A resource's unlock rule, with how its codes column keeps codes. */
function unlockOf(view: SnapshotView, resource: CompiledResource): { unlock: CodeUnlock; table: ResolvedTable } | null {
  const unlock = resource.unlockBy;
  if (unlock === undefined || unlock === null) return null;
  try {
    return { unlock, table: view.table(unlock.table) };
  } catch {
    return null;
  }
}

/**
 * The count a wrong code on this resource is held against: a row opened by
 * its own code is money (a gift card, a voucher) and has the cards' count; a
 * code that opens other rows has the discount codes'.
 */
export function rungOf(resource: Pick<CompiledResource, 'unlockBy'>): PublicGuessRung {
  return resource.unlockBy?.self === true ? 'card' : 'code';
}

/**
 * The keys of the rows a typed code unlocks on this resource (none for a
 * miss). A resource without an unlock rule is not asked. A row opened by its
 * own code may say how long that code is: one of any other length is a miss
 * before anything is looked up.
 */
export async function unlockedKeys(db: Kysely<SourceDatabase>, view: SnapshotView, resource: CompiledResource, typed: string, now: Date, zone: string): Promise<unknown[]> {
  const found = unlockOf(view, resource);
  if (found === null) return [];
  const spelling = spellingOf(found.table.table.columns.find((column) => column.name === found.unlock.column));
  if (found.unlock.self === true && found.unlock.length !== undefined && codeBodyLength(spelling, typed) !== found.unlock.length) return [];
  return unlockedTargets(db, found.unlock, spelling, typed, now, zone);
}

/**
 * The keys of the rows the code a written row already links to unlocks (an
 * order's code, for its tickets): the row's links to the unlock rule's codes
 * table, each read as the codes row stands.
 */
export async function unlockedByRow(db: Kysely<SourceDatabase>, view: SnapshotView, resource: CompiledResource, table: ResolvedTable, row: Row | null, now: Date, zone: string): Promise<unknown[]> {
  const found = unlockOf(view, resource);
  if (found === null || row === null) return [];
  const out: unknown[] = [];
  for (const relation of view.model.relations) {
    if (relation.through !== null || relation.from.tableId !== table.id || relation.to.tableId !== found.table.id || relation.from.columns.length !== 1) continue;
    out.push(...(await unlockedByCode(db, found.unlock, { column: relation.to.columns[0]!, value: row[relation.from.columns[0]!] }, now, zone)));
  }
  return out;
}
