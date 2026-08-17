// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-dashboard` envelope generation — one per FK-cluster domain, cap 3
 * for v1 (research/widget-registry.md §14 trigger, §15 decision summary).
 *
 * The §15 widget set (4 KPIs, hero `chart-line-area`, `chart-donut`) is
 * assembled by `@adminium/widgets/generate`'s `emitDomainDashboardCandidates`
 * and laid out by `composeTemplate` against the `page-dashboard` manifest —
 * geometry comes from the manifest's v2 slot areas, not hand-stamped x/y/w/h.
 * This module keeps only what the leaf cannot know: the §6.1 envelope wrap,
 * nav placement, and the stored `config.domain` block (`ComposedPage` carries
 * none of them). Domain detection itself stays in `./domains.js`.
 */

import {
  composeTemplate,
  domainHasDashboardSignal,
  emitDomainDashboardCandidates,
  type CandidateRelation,
  type CandidateTableInput,
  type ComposeWarning,
} from '@adminium/widgets/generate';

import { classifyModel } from '../classify/index.js';
import type { DatabaseModel, TableModel } from '../schema-model.js';
import { toCandidateModel } from './archetype.js';
import type { Domain } from './domains.js';
import { pageIdFor } from './util.js';

export interface DashboardBuildContext {
  connectionId: string;
  slug: string;
  title: string;
  navOrder: number;
  /** Live registry membership test, threaded to H4 (04 §10). */
  isRegistered?: ((widgetId: string) => boolean) | undefined;
}

export interface DashboardBuildResult {
  /**
   * Unhashed, unvalidated envelope — `generatePages` stamps + validates it.
   * `null` ⇔ the domain has no time axis at all (05 §8 trigger requires ≥ 1
   * timestamp) or composition failed — the caller records a warning.
   */
  envelope: Record<string, unknown> | null;
  warnings: readonly ComposeWarning[];
}

/**
 * §8 trigger in the pre-migration signature (`DatabaseModel` + `TableModel[]`):
 * a domain can host a dashboard only with ≥ 1 time axis. Kept as public API of
 * the self-host package (the root re-exports this module); `generatePages`
 * itself asks the leaf's `domainHasDashboardSignal` over the shared candidate
 * mirror instead of re-adapting per domain.
 */
export function hasDashboardSignal(
  model: DatabaseModel,
  domain: Domain,
  tables: readonly TableModel[],
): boolean {
  const classified = new Map(classifyModel(model).tables.map((t) => [t.tableId, t]));
  return domainHasDashboardSignal(
    domain,
    toCandidateModel(model, tables, classified),
    model.relations,
  );
}

/** Build the `page-dashboard` envelope for a domain and wrap it per §6.1. */
export function buildDashboardEnvelope(
  domain: Domain,
  model: readonly CandidateTableInput[],
  relations: readonly CandidateRelation[],
  ctx: DashboardBuildContext,
): DashboardBuildResult {
  const candidates = emitDomainDashboardCandidates(domain, model, relations, {
    connectionId: ctx.connectionId,
  });
  if (candidates === null) return { envelope: null, warnings: [] };

  const composed = composeTemplate(
    'page-dashboard',
    candidates,
    ctx.isRegistered === undefined ? {} : { isRegistered: ctx.isRegistered },
  );
  if (composed.page === null) return { envelope: null, warnings: composed.warnings };

  return {
    warnings: composed.warnings,
    envelope: {
      v: 1,
      kind: composed.page.type,
      id: pageIdFor(ctx.connectionId, ctx.slug),
      template: composed.page.template,
      title: { key: `nav.${ctx.slug}`, fallback: ctx.title },
      source: { connectionId: ctx.connectionId, table: null },
      nav: { group: 'workspace', icon: 'layout-dashboard', order: ctx.navOrder, slug: ctx.slug },
      access: { minRole: 'viewer', permissions: [] },
      config: {
        templateVersion: composed.page.templateVersion,
        toolbar: composed.page.toolbar,
        overlays: composed.page.overlays,
        // What the page aggregates — kept on the stored document so the domain
        // membership survives without re-running detection.
        domain: { key: domain.key, label: domain.label, tables: domain.tableIds },
        layout: composed.page.layout,
      },
    },
  };
}
