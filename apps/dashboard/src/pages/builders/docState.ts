// SPDX-License-Identifier: AGPL-3.0-only
/**
 * page-builder doc persistence algebra (09-generated-app.md §7.11, M7-T06) —
 * PURE module. The authored document is part of the page's stored layout: it
 * rides in the canvas slot item's `config.doc`, so saving a doc is exactly the
 * EXISTING pages layout write path (PATCH `/pages/:id/layout` for the shared
 * default, PUT `/me/views/:id/layout` for a personal draft) with no new server
 * surface — `layoutItemSchema.config` is an open record, so the doc validates
 * as ordinary instance config.
 *
 * Save-as-version rides the EXISTING saved-views API: a version is a
 * `POST /pages/:id/views` row whose config carries `{ v: 1, builderDoc }` —
 * `viewConfigSchema` is `.passthrough()`, so the marker survives round-trip
 * and `builderVersionsOf` filters grid-state views out.
 */
import type { PageLayout } from '@adminium/widgets/page-config';
import {
  canvasItemOf,
  canvasWidgetIdFor,
  pageBuilderConfigSchema,
  type BuilderDocType,
  type DocRecord,
} from '@adminium/widgets';
import type { PageEnvelope } from '@adminium/engine/config';

import type { SavedView } from '../views/viewsApi.js';

/** Manifest `canvas` slot area (packages/widgets/src/templates/page-builder.json). */
const CANVAS_AREA = { x: 3, y: 0, w: 6, h: 24 } as const;

export interface BuilderPageState {
  docType: BuilderDocType;
  /** The stored doc (canvas item `config.doc`), or null before the first save. */
  doc: DocRecord | null;
  /** The layout to mutate on save — synthesized when the page carries none. */
  layout: PageLayout;
  /** The canvas item id inside `layout`. */
  canvasItemId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Project a page-builder envelope onto the binding's working state. */
export function builderPageStateOf(page: PageEnvelope): BuilderPageState {
  const parsed = pageBuilderConfigSchema.safeParse(page.config);
  const docType: BuilderDocType = parsed.success ? parsed.data.docType : 'invoice';
  const rawLayout = parsed.success ? parsed.data.layout : undefined;
  const canvas = canvasItemOf(rawLayout, docType);
  const doc = isRecord(canvas.config['doc']) ? (canvas.config['doc'] as DocRecord) : null;

  const declaredItems = isRecord(rawLayout) && Array.isArray(rawLayout['items']) ? rawLayout['items'] : null;
  const layout: PageLayout =
    declaredItems !== null && declaredItems.some((item) => isRecord(item) && item['i'] === canvas.i)
      ? ({ version: 1, items: declaredItems } as PageLayout)
      : {
          version: 1,
          items: [
            {
              i: canvas.i,
              widget: canvasWidgetIdFor(docType),
              ...CANVAS_AREA,
              config: canvas.config,
            },
          ],
        };

  return { docType, doc, layout, canvasItemId: canvas.i };
}

/** A new layout document with the canvas item's `config.doc` replaced. */
export function layoutWithDoc(state: BuilderPageState, doc: DocRecord): PageLayout {
  return {
    version: 1,
    items: state.layout.items.map((item) =>
      item.i === state.canvasItemId ? { ...item, config: { ...item.config, doc } } : item,
    ),
  };
}

// ── save-as-version (saved-views rows with a builder marker) ─────────────────

export interface BuilderVersionConfig {
  v: 1;
  builderDoc: { docType: BuilderDocType; doc: DocRecord; savedAt: number };
}

export function builderVersionConfigOf(
  docType: BuilderDocType,
  doc: DocRecord,
  savedAt: number,
): BuilderVersionConfig {
  return { v: 1, builderDoc: { docType, doc, savedAt } };
}

export interface BuilderVersion {
  viewId: string;
  name: string;
  docType: BuilderDocType;
  doc: DocRecord;
  savedAt: number;
}

/** The builder versions among a page's saved views (grid-state views drop out). */
export function builderVersionsOf(views: readonly SavedView[]): BuilderVersion[] {
  return views.flatMap((view) => {
    const marker = (view.config as unknown as Record<string, unknown>)['builderDoc'];
    if (!isRecord(marker) || !isRecord(marker['doc'])) return [];
    const docType = marker['docType'];
    if (typeof docType !== 'string') return [];
    return [
      {
        viewId: view.id,
        name: view.name,
        docType: docType as BuilderDocType,
        doc: marker['doc'] as DocRecord,
        savedAt: typeof marker['savedAt'] === 'number' ? marker['savedAt'] : view.updatedAt,
      },
    ];
  });
}
