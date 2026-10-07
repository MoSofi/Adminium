// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TABLES OF AN OWNER'S DATABASE THAT HAND ROWS TO AN ADD-ON.
 *
 * An add-on that keeps a ledger is posted into by rules on other tables, and
 * asked for a price by a rule on others. Its own pages read those tables (a
 * dish's stock links, the orders a card paid for), and its record tab shows on
 * them. Which tables those are is read from the rules as they stand:
 *
 *  - a table carrying a posting into one of the add-on's ledgers;
 *  - the table a posting hands in as "the row asked about" — the posting's
 *    own table when it maps the row itself, the table a link column points at
 *    when it maps that column (of the row, or of the parent its `via` names);
 *  - a table carrying a price rule the add-on answers.
 *
 * Read from the effective model: an app's rule and an owner's count alike,
 * and a rule switched off still names its table.
 */
import type { AddOnManifest } from '@adminium/manifest';

import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { outboundKey } from '../documents/compose.js';

export interface HostTable {
  /** The table's id in its database's snapshot. */
  id: string;
  via: 'posting' | 'adjust';
}

type Mapping = string | { row: true } | { parent: string } | { setting: string } | { value: unknown };

/** The declared input types of one action of one of the add-on's ledgers. */
function inputsOf(manifest: AddOnManifest, ledger: string, action: string): Record<string, string> {
  const ledgers = (manifest.addOn as { ledgers?: { id: string; actions?: Record<string, { inputs?: Record<string, string> }> }[] }).ledgers ?? [];
  return ledgers.find((candidate) => candidate.id === ledger)?.actions?.[action]?.inputs ?? {};
}

/** How a table hands rows to the add-on: it carries the rule, is the row a rule asks about, is the row a rule's link names, or carries a price rule. */
type Hands = 'carries' | 'row' | 'link' | 'adjust';

/** Every table that hands the add-on rows, each way it does. */
function handing(view: SnapshotView, addOnKey: string, manifest: AddOnManifest, add: (id: string | undefined, how: Hands) => void): void {
  const resolved = (id: string): ResolvedTable | null => {
    try {
      return view.table(id);
    } catch {
      return null;
    }
  };
  for (const model of view.model.tables) {
    const table = resolved(model.id);
    if (table === null) continue;
    for (const posting of table.table?.postings ?? []) {
      if (posting.into.addOn !== addOnKey) continue;
      add(table.id, 'carries');
      const parentAt = posting.via === undefined ? null : outboundKey(view, table, posting.via);
      const parent = parentAt === null ? null : resolved(parentAt.tableId);
      for (const [name, type] of Object.entries(inputsOf(manifest, posting.into.ledger, posting.into.action))) {
        if (type !== 'rowRef') continue;
        const mapping = (posting.map as Record<string, Mapping>)[name];
        if (mapping === undefined) continue;
        // The row itself is this table's; a link column names the table it points at.
        if (typeof mapping === 'string') add(outboundKey(view, table, mapping)?.tableId, 'link');
        else if ('row' in mapping) add(table.id, 'row');
        else if ('parent' in mapping && parent !== null) add(outboundKey(view, parent, mapping.parent)?.tableId, 'link');
      }
    }
    if ((table.table?.adjust as { by?: { addOn?: unknown } } | undefined)?.by?.addOn === addOnKey) add(table.id, 'adjust');
  }
}

export function hostTablesOf(view: SnapshotView, addOnKey: string, manifest: AddOnManifest): HostTable[] {
  const out = new Map<string, HostTable>();
  handing(view, addOnKey, manifest, (id, how) => {
    if (id !== undefined && !out.has(id)) out.set(id, { id, via: how === 'adjust' ? 'adjust' : 'posting' });
  });
  return [...out.values()];
}

/**
 * The tables whose ROWS the add-on keeps rows for: the row a rule asks about
 * (`row`), the row a rule's link column names (`link`), a table whose price
 * the add-on answers (`adjust`). A table that only carries a rule — an
 * order's lines, posting for the dish each names — is not one: the add-on's
 * rows belong to the dish.
 */
export function handedInOf(view: SnapshotView, addOnKey: string, manifest: AddOnManifest): Map<string, Set<'row' | 'link' | 'adjust'>> {
  const out = new Map<string, Set<'row' | 'link' | 'adjust'>>();
  handing(view, addOnKey, manifest, (id, how) => {
    if (id === undefined || how === 'carries') return;
    const ways = out.get(id) ?? new Set();
    ways.add(how);
    out.set(id, ways);
  });
  return out;
}
