/**
 * The §14 page-archetype step — hooks **H1/H2/H4** of the auto-instantiation
 * pipeline as the Engine drives them (04-widget-registry.md §8):
 *
 *   H1/H2  `emitCandidates` + `selectArchetype`  (`@adminium/widgets/generate`)
 *   H4     `composeTemplate(templateId, candidates, ctx)` → the in-memory
 *          intermediate, which THIS module wraps into the 01-architecture.md
 *          §6.1 page envelope that `generatePages()` persists.
 *
 * research/widget-registry.md §15 step 3 in full: "Per table emit: `page-crud`
 * always; **plus the highest-scoring archetype from §14 triggers**; plus KPI
 * candidates and 2–4 chart candidates". `./crud.ts` + `./dashboard.ts` deliver
 * the first and last clauses via the bespoke M4 path that the v0.1 gate proved;
 * this module adds the middle clause and touches neither. Archetype pages are
 * **purely additive** — a table that earns one keeps its `page-crud` unchanged,
 * and a table that earns none loses nothing.
 *
 * WHERE THE RULES LIVE: in `@adminium/widgets`, not here — 04 §8 assigns the
 * catalog and its triggers to the Registry ("so the catalog and its trigger
 * logic never drift apart") and only the pipeline to the Engine. That package
 * cannot see `TableModel`/`ClassifiedTable` (01 §2.3 forbids widgets → engine
 * beyond the config leaf), so it declares the fields its rules read as its own
 * structural contract and this module is the **adapter**: `toCandidateModel`
 * below is the single place the two vocabularies meet, and it is compile-time
 * checked against both.
 */

import {
  composeTemplate,
  type ArchetypeSelection,
  type CandidateTable,
  type CandidateTableInput,
  type ClassifiedTableInput,
  type ComposeWarning,
  type TemplateCandidate,
  type WidgetCandidate,
} from '@adminium/widgets/generate';

import type { ClassifiedTable } from '../classify/index.js';
import type { DatabaseModel, TableModel } from '../schema-model.js';
import { ID_SLUG_BUDGET, humanize, pageIdFor } from './util.js';

/**
 * Nav placement per §14 archetype (09-generated-app.md §2.2: the five groups are
 * fixed; `icon` is a lucide name). `slugSuffix` keeps the archetype page's slug
 * distinct from its table's `page-crud` slug — the two are siblings in the nav.
 */
interface ArchetypeNav {
  group: 'workspace' | 'library' | 'planning' | 'people' | 'account';
  icon: string;
  slugSuffix: string;
}

const ARCHETYPE_NAV: Readonly<Record<string, ArchetypeNav>> = {
  'page-board': { group: 'planning', icon: 'kanban-square', slugSuffix: 'board' },
  'page-calendar': { group: 'planning', icon: 'calendar', slugSuffix: 'calendar' },
  'page-scheduler': { group: 'planning', icon: 'calendar-clock', slugSuffix: 'schedule' },
  'page-directory': { group: 'people', icon: 'users', slugSuffix: 'directory' },
  'page-chat': { group: 'people', icon: 'message-square', slugSuffix: 'chat' },
  'page-queue-inbox': { group: 'workspace', icon: 'inbox', slugSuffix: 'queue' },
  'page-log-viewer': { group: 'library', icon: 'scroll-text', slugSuffix: 'log' },
  'page-files': { group: 'library', icon: 'folder', slugSuffix: 'files' },
  'page-master-detail': { group: 'library', icon: 'layout-list', slugSuffix: 'detail' },
};

/** Human-readable page-title suffix per archetype. */
const ARCHETYPE_TITLE: Readonly<Record<string, string>> = {
  'page-board': 'Board',
  'page-calendar': 'Calendar',
  'page-scheduler': 'Schedule',
  'page-directory': 'Directory',
  'page-chat': 'Chat',
  'page-queue-inbox': 'Queue',
  'page-log-viewer': 'Log',
  'page-files': 'Files',
  'page-master-detail': 'Detail',
};

/**
 * Archetype slugs are built inside `pageIdFor`'s slug budget (`./util.ts`) so the
 * page id stays a readable 1:1 image of the (unique) slug rather than the
 * digest-suffixed form an over-budget slug earns. Either way the id is unique —
 * `pageIdFor` is injective — but a nav-visible archetype page reads better as
 * `page_<scope>_orders-board` than `page_<scope>_orders-bo-1f4c9ab2`.
 */

/* ---------------------------------------------------------------- adapter */

/** Resolve a column's enum values (the rules match on the value vocabulary). */
function enumValuesFor(model: DatabaseModel, column: { enumRef: string | null }): string[] | undefined {
  if (column.enumRef === null) return undefined;
  return model.enums.find((e) => e.id === column.enumRef)?.values;
}

/** `TableModel` → the rules' structural table contract. */
function toCandidateTable(model: DatabaseModel, table: TableModel): CandidateTable {
  const activity = table.activity;
  return {
    id: table.id,
    schema: table.schema,
    name: table.name,
    kind: table.kind,
    rowCountEstimate: table.rowCountEstimate,
    writeVelocity:
      activity === null ? null : activity.inserts + activity.updates + activity.deletes,
    columns: table.columns.map((column) => ({
      name: column.name,
      logicalType: column.logicalType,
      nullable: column.nullable,
      isPrimaryKey: column.isPrimaryKey,
      isUnique: column.isUnique,
      enumValues: enumValuesFor(model, column),
      references: column.references,
    })),
  };
}

/** `ClassifiedTable` → the rules' structural classification contract. */
function toClassifiedInput(classified: ClassifiedTable): ClassifiedTableInput {
  return {
    tableId: classified.tableId,
    shape: classified.shape.kind,
    role: classified.semantics.role,
    displayColumn: classified.displayColumn,
    naturalKey: classified.naturalKey,
    hierarchyColumn: classified.semantics.hierarchy?.parentColumn ?? null,
    columns: classified.columns.map((column) => ({
      column: column.column,
      semantic: column.semantics.primary,
      format: column.semantics.format,
      secret: column.semantics.flags.secret,
      pii: column.semantics.flags.pii,
      pair: column.semantics.pair,
    })),
  };
}

/**
 * Adapt a classified model into the rules' input. `tables` is the *included*
 * set (`settings.includedTables` has already been applied upstream, and system
 * / join tables have already been split out) — the cross-table §14 triggers only
 * ever pair tables that will actually get pages.
 */
export function toCandidateModel(
  model: DatabaseModel,
  tables: readonly TableModel[],
  classified: ReadonlyMap<string, ClassifiedTable>,
): CandidateTableInput[] {
  const out: CandidateTableInput[] = [];
  for (const table of tables) {
    const info = classified.get(table.id);
    if (info === undefined) continue;
    out.push({
      table: toCandidateTable(model, table),
      classified: toClassifiedInput(info),
    });
  }
  return out;
}

/**
 * A candidate as `composeTemplate` takes it: the binding moves inside `config`,
 * which is where the stored layout item carries it (01 §6.1 / 04 §5.1 — exactly
 * as `buildDashboardEnvelope` writes it today).
 */
function toTemplateCandidate(candidate: WidgetCandidate): TemplateCandidate {
  return {
    widget: candidate.widget,
    shape: candidate.shape,
    score: candidate.score,
    config: { ...candidate.config, binding: candidate.binding },
  };
}

/* -------------------------------------------------------------- envelopes */

export interface ArchetypeBuildContext {
  connectionId: string;
  /** Unique, already-claimed slug for this page. */
  slug: string;
  navOrder: number;
  /** Live registry membership test, threaded to H1 and H4 (04 §10). */
  isRegistered?: ((widgetId: string) => boolean) | undefined;
}

export interface ArchetypeBuildResult {
  /**
   * Unhashed, unvalidated envelope — `generatePages` stamps + validates it.
   * `null` ⇔ composition failed (a `required` slot had no accepted candidate),
   * the `buildDashboardEnvelope` → null + caller-records-a-warning idiom. The
   * table simply keeps just its `page-crud`.
   */
  envelope: Record<string, unknown> | null;
  warnings: readonly ComposeWarning[];
}

/** Compose one archetype page for a table and wrap it into the §6.1 envelope. */
export function buildArchetypeEnvelope(
  table: TableModel,
  selection: ArchetypeSelection,
  candidates: readonly WidgetCandidate[],
  ctx: ArchetypeBuildContext,
): ArchetypeBuildResult {
  const nav = ARCHETYPE_NAV[selection.template];
  if (nav === undefined) {
    // Unreachable via `selectArchetype` (its ids are a subset of ARCHETYPE_NAV's,
    // asserted by generate-archetypes.test.ts) — a marketplace template reaching
    // here would have no nav placement, so it gets no page rather than a bad one.
    return { envelope: null, warnings: [] };
  }

  const composed = composeTemplate(
    selection.template,
    candidates.map(toTemplateCandidate),
    ctx.isRegistered === undefined ? {} : { isRegistered: ctx.isRegistered },
  );
  if (composed.page === null) return { envelope: null, warnings: composed.warnings };

  const suffix = ARCHETYPE_TITLE[selection.template] ?? 'Page';
  const title = `${humanize(table.name)} ${suffix}`;

  return {
    warnings: composed.warnings,
    envelope: {
      v: 1,
      kind: composed.page.type,
      id: pageIdFor(ctx.connectionId, ctx.slug),
      template: composed.page.template,
      title: { key: `nav.${ctx.slug}`, fallback: title },
      source: { connectionId: ctx.connectionId, table: table.id },
      nav: { group: nav.group, icon: nav.icon, order: ctx.navOrder, slug: ctx.slug },
      access: { minRole: 'viewer', permissions: [`table:${table.id}:read`] },
      config: {
        templateVersion: composed.page.templateVersion,
        toolbar: composed.page.toolbar,
        overlays: composed.page.overlays,
        // Why this table earned this template — the Studio "why this page?"
        // panel and the H3 LLM prompt read it back off the stored document.
        archetype: { score: selection.score, reasons: selection.reasons },
        layout: composed.page.layout,
      },
    },
  };
}

/** Slug for a table's archetype page, inside the {@link ID_SLUG_BUDGET}. */
export function archetypeSlug(tableSlug: string, template: string): string {
  const suffix = ARCHETYPE_NAV[template]?.slugSuffix ?? 'page';
  const head = tableSlug.slice(0, Math.max(1, ID_SLUG_BUDGET - suffix.length - 1));
  return `${head.replace(/-+$/, '')}-${suffix}`;
}
