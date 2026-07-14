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

import { z } from 'zod';

import { classifyModel, type ClassifiedTable } from '../classify/index.js';
import {
  pageEnvelopeSchema,
  widgetConfigSchema,
  type PageEnvelope,
} from '../config-schema/envelope.js';
import type { DatabaseModel, TableModel } from '../schema-model.js';
import { buildCrudEnvelope, type CrudBuildContext } from './crud.js';
import { buildDashboardEnvelope, hasDashboardSignal } from './dashboard.js';
import { detectDomains, type Domain } from './domains.js';
import { hashEnvelope, humanize, slugify, SlugRegistry } from './util.js';

export { buildCrudEnvelope, enumTones } from './crud.js';
export { buildDashboardEnvelope, hasDashboardSignal } from './dashboard.js';
export { detectDomains, type Domain } from './domains.js';
export { hashEnvelope, humanize, pluralizeWord, slugify, SlugRegistry } from './util.js';

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

export interface GenerateOptions {
  /** 09 §8.4; default 'full-admin'. */
  intent?: GenerateIntent | undefined;
  /**
   * Connection the pages bind to. Defaults to the model's live-source
   * connection id; import models without one get CRUD pages with a null
   * source connection and no dashboards (descriptors need a connection).
   */
  connectionId?: string | null | undefined;
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
  const warnings: string[] = [];
  if (intent === 'support-console') {
    warnings.push("intent 'support-console' uses the full-admin page set in v1 (queue templates land M7)");
  }

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
  const wantDashboards = intent !== 'crud';
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
    rawPages.push(buildCrudEnvelope(model, table, info, ctx));
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
