// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared page-template contract types — leaf module so template
 * bindings and the registry never import each other.
 */
import type { ComponentType } from 'react';
import type { PageEnvelope } from '@adminium/engine/config';
import type { ColumnFacts, WidgetEvent } from '@adminium/widgets';

import type { BoundCrudApi } from '../api/crud.js';
import type { FormChildFactReply, FormColumnFactReply, FormRelationFactReply } from '../api/pages.js';
import type { DashboardData } from '../api/widgetData.js';

/** Everything a template needs from the app — data adapters + event sinks. */
export interface PageTemplateAdapters {
  /** Bound to `source.connectionId` + `source.table`; null for source-less pages. */
  crud: BoundCrudApi | null;
  /** Widget-data batch adapter; null when the page has no dashboard layout. */
  dashboard: DashboardData | null;
  /** WidgetEvent sink — record-open navigation, drill-through, mutate+undo.
   *  `mutate` events return the CRUD promise so optimistic widgets can roll
   *  back on rejection; other events return void. */
  onEvent: (event: WidgetEvent) => void | Promise<unknown>;
  /** Route the detail record: id → `/p/$slug/r/$id`, null → `/p/$slug`. */
  openRecord: (recordId: string | null) => void;
  /** Undo-toast hook for template-run mutations (mutation → undoToken → toast). */
  notifyUndoable: (options: { title: string; undoToken: string | null; onUndone?: () => void }) => void;
}

export interface PageTemplateProps {
  page: PageEnvelope;
  adapters: PageTemplateAdapters;
  /** Present on the `/p/$slug/r/$recordId` child route. */
  recordId?: string | undefined;
  /** Per-caller `page:<id>:edit` capability resolved by the server; the
   * dashboard builder routes edits to the shared default vs. a personal
   * override on this, never on role slugs. */
  canEditLayout?: boolean | undefined;
  /** Per-caller write capabilities for the envelope's source table, resolved
   *  by the server from the same `table:<connectionId>:<table>:<action>`
   * grants the data routes enforce — bindings hide the matching affordances
   *  when false so a read-only caller never sees a New row / Edit / Delete
   *  that would 403. Absent (undefined) means "not computed": keep the
   *  widget's permissive default. */
  canCreate?: boolean | undefined;
  canUpdate?: boolean | undefined;
  canDelete?: boolean | undefined;
  /** May attach a sidecar file. Diverges from `canUpdate` on a read-only
   * source, where the record cannot be edited and a file still can be
   * attached — which is what the sidecar mode is for. */
  canAttach?: boolean | undefined;
  /** Caller holds the server's PII unmask permission — the templates render
   *  the reveal affordance on PII cells. Unlike the write capabilities this
   *  defaults CLOSED when absent: a reveal control is only honest when the
   *  server said it sent the values in clear. */
  canUnmask?: boolean | undefined;
  /**
   * The source table as the server sees it right now (`columnFacts` on the
   * page reply): who fills each column and which ones the create form has to
   * ask for. The stored `config.columns[]` froze the day the page was
   * generated and regeneration will not touch a page anybody has edited, so
   * the form reads these instead. Absent ⇒ the stored spec decides.
   */
  columnFacts?: ColumnFacts | undefined;
  /**
   * The same block unkeyed and whole, in table order: what the create dialog's
   * FORM DOCUMENT is derived from. `columnFacts` answers what the
   * server says about a column the page already lists; this carries the columns
   * themselves, including the ones the grid's eight-column cap never listed.
   */
  formColumns?: readonly FormColumnFactReply[] | undefined;
  /** The link relations the table can write through (a field of chips each). */
  formRelations?: readonly FormRelationFactReply[] | undefined;
  /**
   * The tables this one can hold a LIST of rows from — an invoice's lines,
   * with the child's own columns. What a `child-rows` field is rendered from.
   */
  formChildren?: readonly FormChildFactReply[] | undefined;
  /** The table's own singular label, which the dialog's words are built on. */
  tableLabelSingular?: string | null | undefined;
  /**
   * The owning connection's ISO-4217 currency, resolved once by
   * `PageRenderer` from the bootstrap nav item.
   *
   * Every money cell in the product has rendered `USD` since the feature
   * shipped: `formatMoney` falls back to it, the column spec's own `currency`
   * is populated by nothing, and the `currency` prop `PageCrud`/`PageRecord`
   * already accept had no caller. This is that caller. Undefined keeps the
   * fallback, so a connection with no currency set is unchanged.
   */
  currency?: string | undefined;
}

export type PageTemplateComponent = ComponentType<PageTemplateProps>;
