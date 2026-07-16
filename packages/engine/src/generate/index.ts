/**
 * `generatePages()` — Generator v1 (M4-T08, 05-introspection-engine.md
 * generation section, research/widget-registry.md §14–§15, 09-generated-app.md
 * §2.2 nav rules, §8.4 intent variants).
 *
 * Pure and deterministic: same classified model + options in, same
 * `PageEnvelope[]` out (05 §9 — regeneration is safe to re-run). Every
 * emitted envelope is validated against `pageEnvelopeSchema` (and dashboard
 * widget instances against `widgetConfigSchema`) before return — outputs
 * cannot drift from the frozen config contract.
 */

import {
  emitCandidates,
  isRegisteredWidgetId,
  selectArchetype,
  type CandidateContext,
} from '@adminium/widgets/generate';
import { z } from 'zod';

import { classifyModel, type ClassifiedTable } from '../classify/index.js';
import {
  pageEnvelopeSchema,
  widgetConfigSchema,
  type PageEnvelope,
} from '../config-schema/envelope.js';
import type { DatabaseModel, TableModel } from '../schema-model.js';
import { archetypeSlug, buildArchetypeEnvelope, toCandidateModel } from './archetype.js';
import { buildCrudEnvelope, type CrudBuildContext } from './crud.js';
import { buildDashboardEnvelope, hasDashboardSignal } from './dashboard.js';
import { detectDomains, type Domain } from './domains.js';
import { hashEnvelope, humanize, slugify, SlugRegistry } from './util.js';

export {
  archetypeSlug,
  buildArchetypeEnvelope,
  toCandidateModel,
  type ArchetypeBuildContext,
  type ArchetypeBuildResult,
} from './archetype.js';
export { buildCrudEnvelope, enumTones } from './crud.js';
export { buildDashboardEnvelope, hasDashboardSignal } from './dashboard.js';
export { detectDomains, type Domain } from './domains.js';
export {
  ID_SLUG_BUDGET,
  MAX_SLUG_LENGTH,
  hashEnvelope,
  humanize,
  pageIdFor,
  pluralizeWord,
  slugify,
  SlugRegistry,
} from './util.js';

/** 09 §8.4 generation intent variants (adminium_connections.settings.intent). */
export const GENERATE_INTENTS = [
  'full-admin',
  'read-only-analytics',
  'crud',
  'support-console',
] as const;
export const generateIntentSchema = z.enum(GENERATE_INTENTS);
export type GenerateIntent = z.infer<typeof generateIntentSchema>;

/** One `page-dashboard` per major domain, cap 3 for v1. */
export const DASHBOARD_CAP = 3;

/**
 * The §14 archetypes each 09 §8.4 intent OMITS (empty ⇒ it admits them all).
 * `crud` is absent because it skips the archetype pass wholesale ("`page-crud`
 * per table … no dashboards beyond a minimal home").
 *
 * An archetype is omitted when the intent's §8.4 row rules out the *surface*, not
 * merely the permission: capping roles at Viewer still leaves a kanban whose
 * whole affordance is dragging a row to a new status, and a page's `toolbar` /
 * `overlays` chrome is generated per template, not per role. Dropping the page is
 * what makes the intent mean what §8.4 says it means.
 */
const INTENT_OMITTED_ARCHETYPES: Readonly<Record<string, readonly string[]>> = {
  'full-admin': [],
  // §8.4: "dashboards, analytics, data grids (read-only), search, exports; no
  // forms/boards/imports". page-board is the board; page-files is the import
  // surface (upload-dropzone); page-queue-inbox (modal-wizard approvals) and
  // page-chat (message compose) are the form surfaces.
  'read-only-analytics': ['page-board', 'page-chat', 'page-files', 'page-queue-inbox'],
  // §8.4: "queue/master-detail templates prioritized …; boards/analytics omitted".
  'support-console': ['page-board'],
};

export interface GenerateOptions {
  /** 09 §8.4; default 'full-admin'. */
  intent?: GenerateIntent | undefined;
  /**
   * Connection the pages bind to. Defaults to the model's live-source
   * connection id; import models without one get CRUD pages with a null
   * source connection and no dashboards (descriptors need a connection).
   */
  connectionId?: string | null | undefined;
  /**
   * Widget-registry membership test, threaded into the §14 archetype step
   * (04 §8 H1/H4) so unregistered ids are dropped before they reach a stored
   * page.
   *
   * **Defaults to `isRegisteredWidgetId`** — the checked-in mirror of
   * `widgetRegistry` that `@adminium/widgets/generate` exports (the Engine is
   * Node-only and cannot import the registry map itself, and neither can the
   * server, 01 §2.3). Defaulting rather than requiring is deliberate: this option
   * being *optional and omitted* by the sole production caller is what made every
   * registry filter in the archetype pipeline dead code, persisting chrome ids
   * like `toast-stack`/`date-range-picker` into real page envelopes.
   *
   * Pass an explicit test only to override that catalog — a Studio preview
   * against a marketplace registry, or `() => true` in a unit test driving
   * synthetic widget ids.
   */
  isRegistered?: ((widgetId: string) => boolean) | undefined;
}

export interface GenerateResult {
  pages: PageEnvelope[];
  warnings: string[];
}

/** Nav icon per table shape (lucide names, 09 §2.2). */
const SHAPE_ICONS: Record<string, string> = {
  people: 'users',
  workflow: 'kanban-square',
  events: 'calendar',
  catalog: 'package',
  log: 'scroll-text',
  settings: 'settings',
  geo: 'map',
  join: 'link',
  generic: 'table',
};

interface TableSplit {
  /** Tables that get a page-crud (non-system, non-join). */
  included: TableModel[];
  /** Included + join tables — the domain graph nodes (join tables connect M2M sides). */
  graph: TableModel[];
}

function splitTables(
  model: DatabaseModel,
  classified: Map<string, ClassifiedTable>,
  warnings: string[],
): TableSplit {
  const included: TableModel[] = [];
  const graph: TableModel[] = [];
  for (const table of [...model.tables].sort((a, b) => a.id.localeCompare(b.id))) {
    const info = classified.get(table.id);
    const role = info?.semantics.role ?? table.semantics?.role ?? 'entity';
    if (table.system || role === 'system') {
      warnings.push(`skipped system table ${table.id} (05 §8.2)`);
      continue;
    }
    if (role === 'join-table') {
      warnings.push(`skipped join table ${table.id} — hidden from nav, relation still powers M2M (05 §8.2)`);
      graph.push(table);
      continue;
    }
    included.push(table);
    graph.push(table);
  }
  return { included, graph };
}

interface ArchetypePassOptions {
  connectionId: string | null;
  slugs: SlugRegistry;
  crudPlacement: ReadonlyMap<string, { slug: string; navOrder: number }>;
  warnings: string[];
  /** Always resolved by `generatePages` — never optional past this boundary. */
  isRegistered: (widgetId: string) => boolean;
  /** §14 templates this run's 09 §8.4 intent omits. */
  omittedArchetypes: ReadonlySet<string>;
  /** Page ids already emitted — an archetype must never clobber a crud page. */
  emittedIds: Set<string>;
}

/**
 * The §14 archetype pass: for every included table, the highest-scoring §14
 * trigger (04 §8 H2: "1 page archetype per table … `page-crud` always emitted
 * regardless") composed into a page. Tables that trigger nothing, tie, or whose
 * template has an unfillable `required` slot yield nothing.
 */
function archetypePages(
  model: DatabaseModel,
  tables: readonly TableModel[],
  classified: ReadonlyMap<string, ClassifiedTable>,
  opts: ArchetypePassOptions,
): Record<string, unknown>[] {
  const { connectionId, warnings } = opts;
  if (connectionId === null) {
    warnings.push(
      'no connection id — §14 archetype pages skipped (query descriptors bind to a connection)',
    );
    return [];
  }

  const candidateModel = toCandidateModel(model, tables, classified);
  const ctx: CandidateContext = {
    connectionId,
    model: candidateModel,
    isRegistered: opts.isRegistered,
  };
  const byId = new Map(tables.map((table) => [table.id, table]));
  const out: Record<string, unknown>[] = [];

  for (const entry of candidateModel) {
    const table = byId.get(entry.table.id);
    const placement = opts.crudPlacement.get(entry.table.id);
    if (table === undefined || placement === undefined) continue;

    const selection = selectArchetype(entry.table, entry.classified, ctx);
    if (selection === null) continue;
    if (opts.omittedArchetypes.has(selection.template)) {
      warnings.push(
        `${selection.template} for ${table.id} skipped — the generation intent omits this archetype (09 §8.4)`,
      );
      continue;
    }

    const candidates = emitCandidates(entry.table, entry.classified, ctx);
    const slug = opts.slugs.claim(archetypeSlug(placement.slug, selection.template));
    const built = buildArchetypeEnvelope(table, selection, candidates, {
      connectionId,
      slug,
      // Sits directly under its table's page-crud in the nav (crud orders step
      // by 10), so the archetype never shifts a crud page's position.
      navOrder: placement.navOrder + 5,
      isRegistered: opts.isRegistered,
    });

    if (built.envelope === null) {
      const detail = built.warnings
        .filter((w) => w.code === 'required-slot-unfillable' || w.code === 'invalid-layout')
        .map((w) => w.message)
        .join('; ');
      warnings.push(
        `${selection.template} for ${table.id} skipped — ${detail || 'composition produced no page'}`,
      );
      continue;
    }

    const id = built.envelope['id'] as string;
    if (opts.emittedIds.has(id)) {
      // Two slugs colliding after the char(36) id budget (util.ts `pageIdFor`).
      // Dropping the archetype is the safe branch: a crud page must never be
      // overwritten by an upsert on a duplicate id.
      warnings.push(`${selection.template} for ${table.id} skipped — page id "${id}" already taken`);
      continue;
    }
    opts.emittedIds.add(id);
    out.push(built.envelope);
  }
  return out;
}

/**
 * Generate the v1 page set for a classified model: one `page-crud` per
 * included table plus one `page-dashboard` per FK-cluster domain (cap
 * {@link DASHBOARD_CAP}), honoring the 09 §8.4 intent. The model should come
 * out of `applyClassification` (snapshots persist that form); classification
 * is recomputed here regardless — `classifyModel` is pure and cheap, and the
 * generator also needs the non-persisted shape/displayColumn outputs.
 */
export function generatePages(model: DatabaseModel, opts: GenerateOptions = {}): GenerateResult {
  const intent = opts.intent ?? 'full-admin';
  const isRegistered = opts.isRegistered ?? isRegisteredWidgetId;
  const warnings: string[] = [];

  const connectionId =
    opts.connectionId !== undefined
      ? opts.connectionId
      : model.source.kind === 'live'
        ? model.source.connectionId
        : null;

  const classified = new Map(classifyModel(model).tables.map((t) => [t.tableId, t]));
  const { included: tables, graph } = splitTables(model, classified, warnings);
  const includedIdSet = new Set(tables.map((t) => t.id));
  const slugs = new SlugRegistry();
  const rawPages: Record<string, unknown>[] = [];

  // -- dashboards first: they own the WORKSPACE group and low nav orders ----
  // `crud` gets "no dashboards beyond a minimal home" and `support-console` has
  // "analytics omitted" — both per 09 §8.4.
  const wantDashboards = intent !== 'crud' && intent !== 'support-console';
  if (wantDashboards) {
    if (connectionId === null) {
      warnings.push('no connection id — dashboards skipped (query descriptors bind to a connection)');
    } else {
      // Join tables participate in the graph (they connect M2M sides) but
      // never appear as domain members downstream.
      const domains: Domain[] = detectDomains(model, graph)
        .map((domain) => ({
          ...domain,
          tableIds: domain.tableIds.filter((id) => includedIdSet.has(id)),
        }))
        .filter((domain) => domain.tableIds.length > 0);
      const eligible = domains.filter((domain) => {
        if (hasDashboardSignal(model, domain, tables)) return true;
        warnings.push(`domain ${domain.key} has no timestamp column — dashboard skipped (05 §8)`);
        return false;
      });
      if (eligible.length > DASHBOARD_CAP) {
        warnings.push(
          `${eligible.length} dashboard-eligible domains — capped at ${DASHBOARD_CAP} for v1`,
        );
      }
      const chosen = eligible.slice(0, DASHBOARD_CAP);
      const multi = chosen.length > 1;
      let navOrder = 10;
      for (const domain of chosen) {
        const slug = slugs.claim(multi ? slugify(`dashboard-${domain.key}`) : 'dashboard');
        const title = multi ? `${domain.label} Dashboard` : 'Dashboard';
        const envelope = buildDashboardEnvelope(model, domain, tables, {
          connectionId,
          slug,
          title,
          navOrder,
        });
        if (envelope === null) continue; // hub filtered away — cannot happen after eligibility
        rawPages.push(envelope);
        navOrder += 1;
      }
    }
  }

  // -- one page-crud per included table (research/widget-registry.md §14) --
  const readOnly = intent === 'read-only-analytics';
  const includedIds: ReadonlySet<string> = includedIdSet;
  const counters = { library: 0, people: 0 };
  /** Each table's page-crud slug + nav order — the archetype pass sits beside them. */
  const crudPlacement = new Map<string, { slug: string; navOrder: number }>();
  for (const table of tables) {
    const info = classified.get(table.id) as ClassifiedTable;
    const people = info.shape.kind === 'people' || info.semantics.role === 'people';
    const group = people ? 'people' : 'library';
    const order = 20 + 10 * (people ? counters.people++ : counters.library++);
    const ctx: CrudBuildContext = {
      connectionId,
      slug: slugs.claim(slugify(table.name)),
      navGroup: group,
      navIcon: SHAPE_ICONS[info.shape.kind] ?? 'table',
      navOrder: order,
      readOnly,
      includedTableIds: includedIds,
    };
    crudPlacement.set(table.id, { slug: ctx.slug, navOrder: order });
    rawPages.push(buildCrudEnvelope(model, table, info, ctx));
  }

  // -- plus the highest-scoring §14 archetype per table (§15 step 3) -------
  //
  // Strictly additive, and strictly LAST: the crud/dashboard envelopes above
  // are the v0.1-gate-proven output, so this pass may not perturb them. Running
  // after the crud loop is what guarantees it — archetype slugs are claimed from
  // the same `SlugRegistry` only once every crud slug already holds its name,
  // and nav orders slot between the crud orders (+5) without touching the
  // counters. `test/generate-baseline.test.ts` is the regression guard.
  if (intent !== 'crud') {
    for (const raw of archetypePages(model, tables, classified, {
      connectionId,
      slugs,
      crudPlacement,
      warnings,
      isRegistered,
      omittedArchetypes: new Set(INTENT_OMITTED_ARCHETYPES[intent] ?? []),
      emittedIds: new Set(rawPages.map((page) => page['id'] as string)),
    })) {
      rawPages.push(raw);
    }
  }

  // -- stamp generated hashes + validate against the frozen contract -------
  const pages: PageEnvelope[] = [];
  for (const raw of rawPages) {
    const config = raw['config'] as Record<string, unknown>;
    config['generatedHash'] = hashEnvelope(raw);
    const envelope = pageEnvelopeSchema.parse(raw);
    if (envelope.kind === 'dashboard') {
      const layout = envelope.config['layout'] as { items: unknown[] };
      for (const item of layout.items) widgetConfigSchema.parse(item);
    }
    pages.push(envelope);
  }

  return { pages, warnings };
}

/** Human-readable page label — used by server replies and the demo script. */
export function pageLabel(page: PageEnvelope): string {
  return page.title.fallback || humanize(page.id.replace(/^page_/, ''));
}
