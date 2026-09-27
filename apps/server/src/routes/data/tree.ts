// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A staff form's record with its child rows is held to what the app declares
 * for its guests' creates on the same table: a row's values agree with its
 * parent's (a desk cannot put three guests in a room that sleeps two), each
 * list's groups stay between their least and most, a list adds up to no more
 * than its most. The rows a guest may point at (the readable rule) are a
 * guest's alone: staff may point at anything their grants let them.
 *
 * The rules are read from the connection's public entries that create rows
 * of the table, and matched to a staff form's lists by the child table and
 * the column that links it to its parent.
 */
import { publicEndpointsRepo, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import type { TreeNode, TreeWritten } from '../../crud/write-tree.js';
import { definitionToResource, parseDefinition } from '../../public-api/endpoint.js';
import type { ScopeAgree, ScopeChild } from '../../public-api/scope.js';
import { judgeAgrees, judgeCounts, judgeSumMax } from '../../public-api/tree-checks.js';

type Db = Kysely<SourceDatabase>;

/** One declared list: its table, its link to the parent, and its rules; lists below it by the same key. */
interface DeclaredList {
  table: string;
  via: string;
  entry: Omit<ScopeChild, 'children'>;
  below: DeclaredList[];
}

export interface StaffTreeRules {
  checks: (db: Db, node: TreeNode, values: Row, parent: Row | null) => Promise<void>;
  siblings: (db: Db, parent: TreeWritten, name: string, rows: readonly TreeWritten[]) => Promise<void>;
  /**
   * The relations of the lists declared below a row of `parentTable` — at
   * the record (`depth` 0) or at one of its child rows (1): each is judged
   * once written, an empty one too (a size the desk left out).
   */
  listsOf: (parentTable: ResolvedTable, depth: 0 | 1) => string[];
  /** Whether the record itself is held to an agreement (guests no more than the room sleeps). */
  rootAgrees: boolean;
}

const tableIdOf = (view: SnapshotView, name: string): string | null => {
  try {
    return view.table(name).id;
  } catch {
    return null;
  }
};

/**
 * The checks a staff form's tree runs: every `agrees`, `counts` and `sumMax`
 * the connection's create entries on `table` declare. `listOf` answers, for a
 * row's list name (a relation id), the table and the link of its rows.
 */
export async function staffTreeRules(
  meta: MetaDb,
  connectionId: string,
  view: SnapshotView,
  table: ResolvedTable,
  listOf: (name: string, parentTable: ResolvedTable) => { table: ResolvedTable; via: string } | null,
): Promise<StaffTreeRules> {
  const agrees: ScopeAgree[] = [];
  const lists: DeclaredList[] = [];
  const declared = (children: Readonly<Record<string, ScopeChild | Omit<ScopeChild, 'children'>>> | undefined): DeclaredList[] =>
    Object.values(children ?? {}).flatMap((child): DeclaredList[] => {
      const id = tableIdOf(view, child.table);
      return id === null ? [] : [{ table: id, via: child.via, entry: child, below: declared('children' in child ? child.children : undefined) }];
    });
  for (const row of await publicEndpointsRepo(meta).listByConnection(connectionId)) {
    const parsed = parseDefinition(row.definition);
    if (!parsed.ok || !parsed.definition.methods.includes('POST') || tableIdOf(view, parsed.definition.source) !== table.id) continue;
    const resource = definitionToResource(row.ref, parsed.definition, parsed.definition.methods, table);
    agrees.push(...(resource.agrees ?? []));
    lists.push(...declared(resource.children));
  }
  /** The lists a row's list may be, by where it sits: the root's, or below one of the root's. */
  const matching = (at: readonly (string | number)[], name: string, parentTable: ResolvedTable): DeclaredList[] => {
    const list = listOf(name, parentTable);
    if (list === null) return [];
    const among = at.length === 0 ? lists : lists.flatMap((above) => above.below);
    return among.filter((declaredList) => declaredList.table === list.table.id && declaredList.via === list.via);
  };
  /** The relation of a declared list below `parentTable`: its table's link column to it. */
  const relationOf = (list: DeclaredList, parentTable: ResolvedTable): string | null =>
    view.model.relations.find(
      (relation) =>
        relation.through === null &&
        relation.from.tableId === list.table &&
        relation.from.columns.length === 1 &&
        relation.from.columns[0] === list.via &&
        relation.to.tableId === parentTable.id,
    )?.id ?? null;
  return {
    rootAgrees: agrees.length > 0,
    listsOf(parentTable, depth) {
      const among = depth === 0 ? lists : lists.flatMap((above) => above.below);
      return [...new Set(among.map((list) => relationOf(list, parentTable)).filter((id): id is string => id !== null))];
    },
    async checks(db, node, values, parent) {
      if (node.at.length === 0) {
        if (agrees.length > 0) await judgeAgrees(db, view, table, agrees, values, null);
        return;
      }
      const parentTable = node.at.length === 2 ? table : (listOf(String(node.at[0]), table)?.table ?? null);
      if (parentTable === null) return;
      for (const list of matching(node.at.slice(0, -2), node.name, parentTable)) {
        if ((list.entry.agrees ?? []).length === 0) continue;
        await judgeAgrees(db, view, node.target.table, list.entry.agrees!, values, parent === null ? null : { table: parentTable, row: parent });
      }
    },
    async siblings(db, parent, name, rows) {
      for (const list of matching(parent.node.at, name, parent.node.target.table)) {
        const childTable = view.linkTable(list.table);
        if (childTable === null) continue;
        if (list.entry.counts !== undefined) await judgeCounts(db, view, { counts: list.entry.counts, table: childTable }, rows.map((row) => row.record), parent.record);
        if (list.entry.sumMax !== undefined) await judgeSumMax(db, name, list.entry.sumMax, rows.map((row) => row.record));
      }
    },
  };
}
