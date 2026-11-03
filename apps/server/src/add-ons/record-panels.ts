// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH OF AN ADD-ON'S PANELS A RECORD PAGE SHOWS, AND TO WHOM.
 *
 * An add-on declares panels (`addOn.panels`): its own code, drawn in a tab
 * of the record page of every table that links into one of its tables
 * (`on`) through a `rules.addOnLink` column — the way an app binds an add-on.
 * This says which panels the record page of one table shows one reader, and
 * the route that serves a panel's code asks the same question for one panel:
 *
 *  - the add-on installed, and — on a table an app made — attached to that
 *    app and switched on for it;
 *  - the table linking into the panel's `on` table;
 *  - a reader who reads the table (the row itself is the route's to judge,
 *    with the reader's row limits), holds a grant on the `on` table, and
 *    holds the panel's own permission (`page:<id>:view`).
 *
 * A table handed rows by a posting or a price rule names no row of `on`, so
 * a panel is reached only through a link; such tables show record tabs.
 * Read from what is installed and from the rules as they stand.
 */
import type { RecordPanel } from '@adminium/add-on-contracts';

import { readerWords } from '../i18n/bcp47.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { addOnPagePermission } from './page-gate.js';
import type { TabInstalls } from './record-tabs.js';

export interface RecordPanelFact {
  addOn: string;
  id: string;
  /** The panel's name: the add-on's key for it, and its words in the reader's language (English for a reader without them). */
  title: string;
  titleKey: string;
  /** The table's link column into the panel's table: what the linked row's key is read from. */
  column: string;
  order: number;
}

/** One panel as it stands on one table: what it is, the table it is on, and the link that reaches it. */
export interface PanelOn {
  addOn: string;
  version: string;
  panel: RecordPanel;
  /** The add-on's `on` table, by its id here. */
  onTable: string;
  column: string;
}

/**
 * The panels of installed, switched-on add-ons whose `on` table this table
 * links into, each with the link — before anybody's grants are asked.
 */
export function panelsOn(installs: TabInstalls, view: SnapshotView, tableId: string): PanelOn[] {
  const connectionId = view.connectionId;
  const table = view.table(tableId);
  const tableRef = installs.refOf(connectionId, table.id);
  const cut = tableRef.indexOf(':');
  // The app (or add-on) that made the table; null for one the owner keeps.
  const madeBy = tableRef === table.id || cut <= 0 ? null : tableRef.slice(0, cut);
  const out: PanelOn[] = [];
  for (const key of installs.keys?.(connectionId) ?? []) {
    const addOn = installs.installed(connectionId, key);
    if (addOn === null || addOn.status !== 'installed') continue;
    const panels = (addOn.manifest.addOn as { panels?: RecordPanel[] } | undefined)?.panels;
    if (panels === undefined || panels.length === 0) continue;
    // An app's table: only while the add-on is attached to that app, and on for it.
    if (madeBy !== null && madeBy !== key && addOn.hosts.get(madeBy) !== true) continue;
    for (const panel of panels) {
      const onTable = installs.tableOf(connectionId, key, panel.on);
      if (onTable === null) continue;
      const link = (table.table?.columns ?? []).find((column) => column.addOnLink?.addOn === key && column.addOnLink.table === panel.on);
      if (link === undefined) continue;
      out.push({ addOn: key, version: addOn.version, panel, onTable, column: link.name });
    }
  }
  return out;
}

/** Whether a reader passes a panel's two grants: a grant on its `on` table, and its own permission. The host row is the caller's to judge. */
export async function panelOpen(can: (permission: string) => Promise<boolean>, connectionId: string, on: Pick<PanelOn, 'onTable' | 'panel'>): Promise<boolean> {
  return (await can(`table:${connectionId}:${on.onTable}:read`)) && (await can(addOnPagePermission(on.panel.id)));
}

/**
 * The panels the record page of `tableId` shows this reader, or undefined
 * when there is none — and when anything here throws: a facts bug leaves a
 * record without the panel, never a page that does not load.
 */
export async function recordPanelsFor(
  installs: TabInstalls,
  asker: { can(permission: string): Promise<boolean>; locale?: string | undefined; log?: { warn(details: object, message: string): void } | undefined },
  view: SnapshotView,
  tableId: string,
): Promise<RecordPanelFact[] | undefined> {
  try {
    if (!(await asker.can(`table:${view.connectionId}:${tableId}:read`))) return undefined;
    const out: RecordPanelFact[] = [];
    for (const on of panelsOn(installs, view, tableId)) {
      if (!(await panelOpen((permission) => asker.can(permission), view.connectionId, on))) continue;
      out.push({
        addOn: on.addOn,
        id: on.panel.id,
        // In the reader's language where the add-on wrote it: the tab is named before any of its code runs.
        title: readerWords(on.panel.titles, asker.locale ?? 'en-US') ?? on.panel.title.fallback,
        titleKey: on.panel.title.key,
        column: on.column,
        order: on.panel.order ?? 0,
      });
    }
    out.sort((a, b) => a.order - b.order || (a.addOn === b.addOn ? (a.id < b.id ? -1 : 1) : a.addOn < b.addOn ? -1 : 1));
    return out.length === 0 ? undefined : out;
  } catch (error) {
    asker.log?.warn({ table: tableId, reason: error instanceof Error ? error.message : String(error) }, 'the record panels of a table could not be worked out: the page shows none');
    return undefined;
  }
}
