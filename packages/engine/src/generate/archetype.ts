// SPDX-License-Identifier: AGPL-3.0-only
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
 * the first and last clauses through the same leaf (`composeCrudBody`,
 * `emitDomainDashboardCandidates`), fed by this module's adapter; this module
 * adds the middle clause. Archetype pages are **purely additive** — a table
 * that earns one keeps its `page-crud` unchanged, and a table that earns none
 * loses nothing.
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
  emitCandidates,
  isRegisteredWidgetId,
  type ArchetypeSelection,
  type CandidateContext,
  type CandidateTable,
  type CandidateTableInput,
  type ClassifiedTableInput,
  type ComposeWarning,
  type TemplateCandidate,
  type WidgetCandidate,
} from '@adminium/widgets/generate';

import { classifyModel, type ClassifiedTable } from '../classify/index.js';
import type { ColumnSemantics, DatabaseModel, TableModel } from '../schema-model.js';
import { ID_SLUG_BUDGET, humanize, pageIdFor } from './util.js';

/**
 * Nav placement per §14 archetype (09-generated-app.md §2.2: the five groups are
 * fixed; `icon` is a lucide name). `slugSuffix` keeps the archetype page's slug
 * distinct from its table's `page-crud` slug — the two are siblings in the nav.
 */
export interface ArchetypeNav {
  group: 'workspace' | 'library' | 'planning' | 'people' | 'account';
  icon: string;
  slugSuffix: string;
}

/**
 * Exported for the same reason as `generate/index.ts`'s `SHAPE_ICONS`: these
 * icons are what a freshly generated app paints before an admin has chosen
 * anything, and an `icon` lucide cannot resolve costs a wrong glyph plus a
 * catalogue fetch on that first paint (`test/generate-nav-icons.test.ts`).
 */
export const ARCHETYPE_NAV: Readonly<Record<string, ArchetypeNav>> = {
  'page-board': { group: 'planning', icon: 'square-kanban', slugSuffix: 'board' },
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

/**
 * `TableModel` → the rules' structural table contract. Beyond what the §14
 * triggers read, the mirror carries the crud-body facts (`ordinal`,
 * `defaultKind`, `isGenerated`, `maxLength`, `primaryKey`) — `composeCrudBody`
 * reproduces the bespoke builder byte-for-byte only when these map exactly
 * (undefined ⇔ the engine's null for `enumValues`; `default?.kind ?? null`).
 */
function toCandidateTable(model: DatabaseModel, table: TableModel): CandidateTable {
  const activity = table.activity;
  return {
    id: table.id,
    schema: table.schema,
    name: table.name,
    label: table.label,
    kind: table.kind,
    rowCountEstimate: table.rowCountEstimate,
    writeVelocity:
      activity === null ? null : activity.inserts + activity.updates + activity.deletes,
    primaryKey: table.primaryKey,
    columns: table.columns.map((column) => ({
      name: column.name,
      ordinal: column.ordinal,
      logicalType: column.logicalType,
      nullable: column.nullable,
      isPrimaryKey: column.isPrimaryKey,
      isUnique: column.isUnique,
      isGenerated: column.isGenerated,
      defaultKind: column.default?.kind ?? null,
      maxLength: column.maxLength,
      enumValues: enumValuesFor(model, column),
      references: column.references,
    })),
  };
}

/**
 * `ClassifiedTable` → the rules' structural classification contract.
 *
 * SEMANTIC SOURCE (05 §7 "overrides always win"): recomputed heuristics are
 * authoritative for the model *as generated* — post `includedTables` filtering,
 * a join table whose partner is excluded genuinely stops being a join table,
 * and its columns reclassify on the filtered model (deliberate change from the
 * bespoke dashboard builder, which read full-model stamps). But a column
 * stamped `source: 'llm' | 'override'` is an explicit enrichment, not a
 * heuristic, so it beats the recomputed tag — the same rule
 * `applyClassification` uses when stamping the model. Table semantics carry no
 * `source`, so roles stay recomputed-only.
 */
function toClassifiedInput(table: TableModel, classified: ClassifiedTable): ClassifiedTableInput {
  const stampedByName = new Map(table.columns.map((c) => [c.name, c.semantics]));
  const semanticsFor = (column: string, recomputed: ColumnSemantics): ColumnSemantics => {
    const stamped = stampedByName.get(column);
    return stamped !== null && stamped !== undefined && stamped.source !== 'heuristic'
      ? stamped
      : recomputed;
  };
  return {
    tableId: classified.tableId,
    shape: classified.shape.kind,
    role: classified.semantics.role,
    displayColumn: classified.displayColumn,
    naturalKey: classified.naturalKey,
    hierarchyColumn: classified.semantics.hierarchy?.parentColumn ?? null,
    columns: classified.columns.map((column) => {
      const semantics = semanticsFor(column.column, column.semantics);
      return {
        column: column.column,
        semantic: semantics.primary,
        format: semantics.format,
        secret: semantics.flags.secret,
        pii: semantics.flags.pii,
        maskedByDefault: semantics.flags.maskedByDefault,
        pair: semantics.pair,
      };
    }),
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
      classified: toClassifiedInput(table, info),
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
  /**
   * Explicit page id — the 06 §8.3 materialization path targets an existing
   * `page_<sha30>` row. Defaults to `pageIdFor(connectionId, slug)`.
   */
  id?: string | undefined;
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
  const title = `${table.label ?? humanize(table.name)} ${suffix}`;

  return {
    warnings: composed.warnings,
    envelope: {
      v: 1,
      kind: composed.page.type,
      id: ctx.id ?? pageIdFor(ctx.connectionId, ctx.slug),
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

/**
 * Compose one REQUESTED §14 archetype page — the 06-llm-assist.md §8.3
 * materialization path: an accepted LLM template suggestion seeds a page row
 * carrying only `{type, table, source: 'llm'}`, and the regeneration hook
 * expands it here from the active snapshot. Nothing is scored — the template
 * id was chosen upstream — but the candidates, the manifest and the
 * required-slot failure mode are exactly the §15 pass's. Returns a null
 * envelope when the table is missing/system/join or composition fails; the
 * caller records a warning and the seed row stays as it was.
 */
export function composeRequestedArchetype(
  model: DatabaseModel,
  tableId: string,
  template: string,
  ctx: ArchetypeBuildContext,
): ArchetypeBuildResult {
  const classified = new Map(classifyModel(model).tables.map((t) => [t.tableId, t]));
  // The same include rule as generatePages' splitTables: system and join
  // tables never earn a page (05 §8.2).
  const tables = [...model.tables]
    .filter((table) => {
      const role = classified.get(table.id)?.semantics.role ?? table.semantics?.role ?? 'entity';
      return !table.system && role !== 'system' && role !== 'join-table';
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const table = tables.find((t) => t.id === tableId);
  if (table === undefined) return { envelope: null, warnings: [] };

  const isRegistered = ctx.isRegistered ?? isRegisteredWidgetId;
  const candidateModel = toCandidateModel(model, tables, classified);
  const entry = candidateModel.find((e) => e.table.id === tableId);
  if (entry === undefined) return { envelope: null, warnings: [] };

  const candidateCtx: CandidateContext = { connectionId: ctx.connectionId, model: candidateModel, isRegistered };
  const candidates = emitCandidates(entry.table, entry.classified, candidateCtx);
  return buildArchetypeEnvelope(
    table,
    { template, score: 0, reasons: ['accepted LLM suggestion (06 §8.3)'] },
    candidates,
    { ...ctx, isRegistered },
  );
}

/** Slug for a table's archetype page, inside the {@link ID_SLUG_BUDGET}. */
export function archetypeSlug(tableSlug: string, template: string): string {
  const suffix = ARCHETYPE_NAV[template]?.slugSuffix ?? 'page';
  const head = tableSlug.slice(0, Math.max(1, ID_SLUG_BUDGET - suffix.length - 1));
  return `${head.replace(/-+$/, '')}-${suffix}`;
}
