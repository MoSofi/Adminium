// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared page-template contract types (09-generated-app.md §4.1) — leaf
 * module so template bindings and the registry never import each other.
 */
import type { ComponentType } from 'react';
import type { PageEnvelope } from '@adminium/engine/config';
import type { WidgetEvent } from '@adminium/widgets';

import type { BoundCrudApi } from '../api/crud.js';
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
  /** Route the detail record (09 §2.3): id → `/p/$slug/r/$id`, null → `/p/$slug`. */
  openRecord: (recordId: string | null) => void;
  /** Undo-toast hook for template-run mutations (mutation → undoToken → toast). */
  notifyUndoable: (options: { title: string; undoToken: string | null; onUndone?: () => void }) => void;
}

export interface PageTemplateProps {
  page: PageEnvelope;
  adapters: PageTemplateAdapters;
  /** Present on the `/p/$slug/r/$recordId` child route (09 §2.3). */
  recordId?: string | undefined;
  /** Per-caller `page:<id>:edit` capability resolved by the server (04 §6.3);
   *  the dashboard builder routes edits to the shared default vs. a personal
   *  override on this, never on role slugs. */
  canEditLayout?: boolean | undefined;
  /** Per-caller write capabilities for the envelope's source table, resolved
   *  by the server from the same `table:<connectionId>:<table>:<action>`
   *  grants the data routes enforce (30-record-pages.md D4) — bindings hide
   *  the matching affordances when false so a read-only caller never sees a
   *  New row / Edit / Delete that would 403. Absent (undefined) means "not
   *  computed": keep the widget's permissive default. */
  canCreate?: boolean | undefined;
  canUpdate?: boolean | undefined;
  canDelete?: boolean | undefined;
  /** Caller holds the server's PII unmask permission — the templates render
   *  the reveal affordance on PII cells. Unlike the write capabilities this
   *  defaults CLOSED when absent: a reveal control is only honest when the
   *  server said it sent the values in clear. */
  canUnmask?: boolean | undefined;
}

export type PageTemplateComponent = ComponentType<PageTemplateProps>;
