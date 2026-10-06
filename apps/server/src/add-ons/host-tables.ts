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

export function hostTablesOf(view: SnapshotView, addOnKey: string, manifest: AddOnManifest): HostTable[] {
  const out = new Map<string, HostTable>();
  const add = (id: string | undefined, via: HostTable['via']): void => {
    if (id !== undefined && !out.has(id)) out.set(id, { id, via });
  };
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
      add(table.id, 'posting');
      const parentAt = posting.via === undefined ? null : outboundKey(view, table, posting.via);
      const parent = parentAt === null ? null : resolved(parentAt.tableId);
      for (const [name, type] of Object.entries(inputsOf(manifest, posting.into.ledger, posting.into.action))) {
        if (type !== 'rowRef') continue;
        const mapping = (posting.map as Record<string, Mapping>)[name];
        if (mapping === undefined) continue;
        // The row itself is this table's; a link column names the table it points at.
        if (typeof mapping === 'string') add(outboundKey(view, table, mapping)?.tableId, 'posting');
        else if ('parent' in mapping && parent !== null) add(outboundKey(view, parent, mapping.parent)?.tableId, 'posting');
      }
    }
    if ((table.table?.adjust as { by?: { addOn?: unknown } } | undefined)?.by?.addOn === addOnKey) add(table.id, 'adjust');
  }
  return [...out.values()];
}
