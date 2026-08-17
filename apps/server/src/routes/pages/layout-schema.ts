// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server-side dashboard grid layout schema (04-widget-registry.md §6.1).
 *
 * The canonical `layoutItemSchema` / `pageLayoutSchema` Zod definitions live in
 * the pure-Zod `@adminium/widgets/page-config` leaf (which `grid/layout-schema.ts`
 * re-exports for the grid track). The server must NOT import the React
 * `@adminium/widgets` package directly, so it consumes the SAME schema through
 * the browser-safe `@adminium/engine/config` surface — which re-exports the
 * page-config leaf verbatim (see engine `config-schema/index.ts`). Re-exporting
 * it here keeps a stable `routes/pages/layout-schema` import point for the pages
 * + me-views routes with ZERO second Zod definition to drift from.
 *
 * Half-unit height convention: an annex height of 1.5 rows persists as `h: 3`.
 * `layoutItemSchema` = one placed widget instance; `pageLayoutSchema` = the
 * whole `config.layout` document (max 60 items). Both the shared-default PATCH
 * and the per-user override PUT validate their body against `pageLayoutSchema`.
 */

export {
  layoutItemSchema,
  pageLayoutSchema,
  type LayoutItem,
  type PageLayout,
} from '@adminium/engine/config';
