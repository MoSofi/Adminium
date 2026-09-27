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
 * A code never travels in a URL — logs and proxies keep URLs — so a read
 * sends it in the `x-adminium-code` header, and a write in its values.
 */
import type { FastifyRequest } from 'fastify';

import type { CompiledResource } from '../../public-api/scope.js';
import type { SnapshotView, ResolvedTable } from '../../crud/identifiers.js';
import { spellingOf, unlockedByCode, unlockedTargets, type CodeUnlock } from '../../crud/code-lookup.js';
import type { Row } from '../../crud/mask.js';
import type { TreeNode } from '../../crud/write-tree.js';
import type { Kysely } from 'kysely';
import type { SourceDatabase } from '../../connections/manager.js';

/** The header a read carries a typed code in. */
export const CODE_HEADER = 'x-adminium-code';

/** The reasons a refusal gives a typed code that missed. */
const MISSES: ReadonlySet<string> = new Set(['unknown', 'used-up']);

/** The code a read carries, or null: a header, never the query string. */
export function typedCodeOf(request: FastifyRequest): string | null {
  const raw = request.headers[CODE_HEADER];
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  return trimmed === '' || trimmed.length > 64 ? null : trimmed;
}

/** Whether a write's values type a code into one of the table's lookups. */
export function typesCode(table: ResolvedTable, values: Row): boolean {
  return (table.table.columns ?? []).some((column) => {
    if (column.lookup === undefined) return false;
    const typed = values[column.lookup.from];
    return typed !== null && typed !== undefined && !(typeof typed === 'string' && typed.trim() === '');
  });
}

/** Whether a create with its rows types a code anywhere in it. */
export function treeTypesCode(node: TreeNode): boolean {
  return typesCode(node.target.table, node.values) || node.children.some(treeTypesCode);
}

/** Whether a refusal answered a typed code as a miss (`unknown`, `used-up`). */
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
 * The keys of the rows a typed code unlocks on this resource (none for a
 * miss). A resource without an unlock rule is not asked.
 */
export async function unlockedKeys(db: Kysely<SourceDatabase>, view: SnapshotView, resource: CompiledResource, typed: string, now: Date, zone: string): Promise<unknown[]> {
  const found = unlockOf(view, resource);
  if (found === null) return [];
  const spelling = spellingOf(found.table.table.columns.find((column) => column.name === found.unlock.column));
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
