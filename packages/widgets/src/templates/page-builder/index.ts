// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-builder` template barrel (04 §10, 09 §7.11, M7-T06) — the renderer plus
 * the pure config/doc algebra the host bindings and the engine's generator
 * consume. Mirrors `templates/page-crud/index.ts`.
 */
export {
  PAGE_BUILDER_TEMPLATE_ID,
  PageBuilder,
  type PageBuilderLabels,
  type PageBuilderProps,
} from './PageBuilder.js';
export {
  BLOCK_KIND_META,
  BUILDER_CANVAS_WIDGETS,
  BUILDER_DOC_TYPES,
  BUILDER_DRAFT_BINDING,
  BUILDER_DRAFT_CONNECTION_ID,
  BUILDER_STARTERS,
  DOC_TYPE_PALETTE,
  addBlockToDoc,
  builderDemoData,
  builderDemoDoc,
  canvasDocTypeOf,
  canvasItemOf,
  canvasWidgetIdFor,
  docBlockInstancesOf,
  ensureTriggerFirst,
  flowNodesFromValues,
  isDraftMutation,
  pageBuilderConfigSchema,
  reorderDocByBlockIds,
  starterDocOf,
  surveySummaryOf,
  type BlockKindMeta,
  type BuilderCanvasItem,
  type BuilderCanvasWidgetId,
  type BuilderDocType,
  type BuilderStarterDef,
  type DocBlockInstance,
  type DocRecord,
  type DocType,
  type FlowNodeLike,
  type PageBuilderConfig,
  type SurveySummary,
} from './builder-config.js';
