// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminium/widgets/generate` — the **pure generator leaf** subpath.
 *
 * WHAT IT IS: the registry-owned, engine-facing pieces of the
 * auto-instantiation pipeline (04-widget-registry.md §8), and nothing else:
 *
 *   - **H1/H2** `emitCandidates` + `candidateRules` + the §14 archetype triggers
 *     (`../registry/candidates.ts`, `../registry/archetypes.ts`);
 *   - **H4** `composeTemplate` + the shipped `page-*.json` manifests +
 *     `pageTemplateSchema` (`../templates/`);
 *   - the generated-page body vocabulary: `composeCrudBody` (the typed
 *     `page-crud` config body, 09 §3.3) and `emitDomainDashboardCandidates`
 *     (the §15 per-domain dashboard widget set) — `./crud-body.ts`,
 *     `./dashboard-domain.ts`.
 *
 * WHY IT EXISTS: 04 §8 puts hooks H1/H2/H4 in the Engine's hands
 * ("`composeTemplate(templateId, candidates, ctx)` … → `PageConfig` rows written
 * to `adminium_pages`") while 04 §8 also fixes the rules' home in this package
 * ("the Registry owns what can be instantiated and why … so the catalog and its
 * trigger logic never drift apart"). The Engine therefore needs *some* import of
 * this package, and 01-architecture.md §2.3 allows it exactly one: a leaf
 * subpath that pulls no component code. `@adminium/widgets/page-config` is the
 * wrong one — it is the frozen **config-body schema** leaf that the server and
 * `@adminium/engine/config` bundle, and it must not grow generator logic. So
 * this is a second leaf, under the same rules:
 *
 *   **PURITY CONTRACT** — every module reachable from here imports only `zod`,
 *   the `page-config` leaf, and each other. No React, no component code, no
 *   `node:` builtins, no `@adminium/ui|charts|i18n|tokens`. `leaf-purity.test.ts`
 *   is the gate; `.dependency-cruiser.cjs` (`engine-no-full-widgets`) carves out
 *   this path and nothing else.
 *
 * Notably absent: `../templates/crosscheck.ts` (it reads the live
 * `widgetRegistry`, i.e. component code) and `../templates/page-crud|page-
 * dashboard/` (React). Callers that need a registry-membership test pass one in
 * as `ctx.isRegistered` — that inverts the dependency and keeps this leaf pure.
 * `REGISTERED_WIDGET_IDS` below is the leaf-safe **data mirror** of that map for
 * callers with no registry of their own to pass (the Engine, and through it the
 * server, which 01 §2.3 bars from importing this package at all); a parity test
 * pins it to `widgetRegistry`.
 */

/* --------------------------------------------- H1/H2: candidates + triggers */
export {
  FAMILY_CAPS,
  buildCandidateView,
  candidateRules,
  emitCandidates,
  emitModelCandidates,
  humanize,
  type CandidateColumn,
  type CandidateContext,
  type CandidateRelation,
  type CandidateRule,
  type CandidateTable,
  type CandidateTableInput,
  type CandidateView,
  type ClassifiedColumnInput,
  type ClassifiedTableInput,
  type ViewColumn,
  type WidgetCandidate,
} from '../registry/candidates.js';

/* -------------------------- generated-page bodies: crud + domain dashboards */
export {
  composeCrudBody,
  enumTones,
  type CrudBodyContext,
  type CrudDetailTab,
  type CrudEnumTone,
  type CrudFormField,
  type CrudPageBody,
  type CrudSortSpec,
} from './crud-body.js';

export {
  domainHasDashboardSignal,
  emitDomainDashboardCandidates,
  type DashboardDomain,
  type DashboardDomainContext,
} from './dashboard-domain.js';

/* ------------------------------------- page-crud config-body column contract */
export {
  gridColumnSpecSchema,
  type GridColumnSpec,
  type GridColumnSpecInput,
  type GridTone,
} from '../page-config/grid-column-spec.js';

export {
  REGISTERED_WIDGET_IDS,
  isRegisteredWidgetId,
} from '../registry/registered-ids.js';

export {
  ARCHETYPE_TEMPLATE_IDS,
  archetypeRules,
  scoreArchetypes,
  selectArchetype,
  selectModelArchetypes,
  type ArchetypeRule,
  type ArchetypeSelection,
} from '../registry/archetypes.js';

/* ------------------------------------------------ H4: template composition */
export {
  InvalidPageTemplateError,
  pageTemplateSchema,
  parsePageTemplate,
  slotCapacity,
  type PageTemplate,
  type PageTemplateInput,
  type SlotAccepts,
  type SlotArea,
  type TemplateChrome,
  type TemplateSlot,
} from '../templates/template-schema.js';

export {
  DuplicatePageTemplateManifestError,
  PAGE_TEMPLATE_IDS,
  buildTemplateManifests,
  getPageTemplateManifest,
  pageTemplateManifests,
} from '../templates/manifests.js';

export {
  EMPTY_STATE_WIDGET_ID,
  composeTemplate,
  slotAccepts,
  slotInstanceArea,
  templateKind,
  type ComposeContext,
  type ComposeResult,
  type ComposeWarning,
  type ComposeWarningCode,
  type ComposedPage,
  type ComposedPageKind,
  type TemplateCandidate,
} from '../templates/compose.js';
