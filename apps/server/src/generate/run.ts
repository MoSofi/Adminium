/**
 * Generation pipeline glue (M4-T08): latest classified snapshot (introspect
 * first when none) → `generatePages()` (@adminium/engine) → validate every
 * envelope against the frozen config contract (the server is the single
 * write-time validator, 01-architecture.md §6.1) → persist idempotently via
 * `pagesRepo.upsertGenerated`.
 *
 * Pure orchestration — no Fastify types here so the demo script and tests
 * can drive it directly.
 */

import {
  generatePages,
  hashEnvelope,
  parseDatabaseModel,
  type DatabaseModel,
  type GenerateIntent,
} from '@adminium/engine';
import { pageEnvelopeSchema, type PageEnvelope } from '@adminium/engine/config';
import {
  overridesRepo,
  pagesRepo,
  snapshotsRepo,
  type GeneratedPageInput,
  type MetaDb,
  type UpsertGeneratedResult,
} from '@adminium/meta';

import { activeTableLabels } from '../connections/effective-schema.js';
import { runIntrospection } from '../connections/introspect.js';
import type { ConnectionManager } from '../connections/manager.js';
import { materializeLlmPages } from './materialize-llm.js';

export interface RunGenerationOptions {
  manager: ConnectionManager;
  meta: MetaDb;
  connectionId: string;
  createdBy?: string | null | undefined;
  /** Overrides the connection's stored intent for this run (09 §8.4). */
  intent?: GenerateIntent | undefined;
}

export interface GenerationRunResult {
  snapshotId: string;
  /** True when a fresh introspection ran because no snapshot existed. */
  introspected: boolean;
  intent: GenerateIntent;
  pages: PageEnvelope[];
  navGroups: string[];
  warnings: string[];
  persistence: UpsertGeneratedResult;
  /** `origin: 'llm'` seed rows expanded into envelopes this run (06 §8.3). */
  llmPagesMaterialized: number;
  durationMs: number;
}

/**
 * M5-T02 table inclusion: when the wizard persisted
 * `settings.includedTables` (PATCH /connections/:id), restrict the model to
 * that set before generation. Join/system tables stay in the graph (they
 * power M2M detection and are never paged anyway); relations and FK mirrors
 * that point at excluded tables are dropped so envelopes cannot reference
 * pages that will not exist.
 */
export function filterModelToIncludedTables(
  model: DatabaseModel,
  includedTables: readonly string[] | undefined,
): DatabaseModel {
  if (includedTables === undefined || includedTables.length === 0) return model;
  const keep = new Set(includedTables);
  const tables = model.tables.filter(
    (table) => keep.has(table.id) || table.system || table.semantics?.role === 'join-table',
  );
  const ids = new Set(tables.map((table) => table.id));
  return {
    ...model,
    tables: tables.map((table) => ({
      ...table,
      columns: table.columns.map((column) =>
        column.references !== null && !ids.has(column.references.tableId)
          ? { ...column, references: null }
          : column,
      ),
    })),
    relations: model.relations.filter(
      (relation) =>
        ids.has(relation.from.tableId) &&
        ids.has(relation.to.tableId) &&
        (relation.through === null || ids.has(relation.through.tableId)),
    ),
  };
}

/** The identity of a table-bound page: which template, for which table. */
function coordinateKey(table: string, template: string): string {
  return `${table}\u0000${template}`;
}

/**
 * `(table, template)` pairs already covered by an `origin: 'llm'` page of this
 * connection — the accepted §8.3 template pages (06-llm-assist.md), seeds and
 * materialized envelopes alike (both carry `config.source.table`). Dashboards
 * bind to no table and never claim a pair.
 */
async function llmCoveredTemplates(meta: MetaDb, connectionId: string): Promise<Set<string>> {
  const covered = new Set<string>();
  for (const page of await pagesRepo(meta).listForConnection(connectionId)) {
    if (page.origin !== 'llm') continue;
    const source = (page.config as { source?: { table?: unknown } } | null)?.source;
    const table = source?.table;
    if (typeof table === 'string') covered.add(coordinateKey(table, page.type));
  }
  return covered;
}

/** Envelope → the opaque row shape `pagesRepo` persists. */
export function toGeneratedPageInput(envelope: PageEnvelope): GeneratedPageInput {
  return {
    id: envelope.id,
    slug: envelope.nav.slug ?? envelope.id.replace(/^page_/, ''),
    type: envelope.template,
    title: envelope.title.fallback,
    icon: envelope.nav.icon,
    navGroup: envelope.nav.group,
    navOrder: envelope.nav.order,
    config: envelope,
  };
}

export async function runGeneration(opts: RunGenerationOptions): Promise<GenerationRunResult> {
  const { manager, meta, connectionId } = opts;
  const startedAt = Date.now();
  const snapshots = snapshotsRepo(meta);
  const connection = await manager.mustFind(connectionId);
  const intent = opts.intent ?? connection.settings.intent ?? 'full-admin';

  let snapshot = await snapshots.latest(connectionId);
  let introspected = false;
  if (snapshot === null) {
    const result = await runIntrospection({
      manager,
      meta,
      connectionId,
      createdBy: opts.createdBy ?? null,
    });
    snapshot = result.snapshot;
    introspected = true;
  }

  // Snapshots store the classified model (connections/introspect.ts).
  const model = filterModelToIncludedTables(
    parseDatabaseModel(snapshot.schema),
    connection.settings.includedTables,
  );

  // Overlay effective table labels (user `table.label` > accepted `llm.label`,
  // provenance 06 §8.3) onto the parsed model BEFORE generation, so every
  // renamed table's page titles — and through `adminium_pages`, the sidebar
  // nav — carry the rename. The stored snapshot stays label-free; this is a
  // per-run, in-memory attachment. L10n bundles resolve to the connection's
  // default locale (en_US in v1).
  const overrides = await overridesRepo(meta).listForConnection(connectionId, { status: 'active' });
  const labels = activeTableLabels(overrides);
  if (labels.size > 0) {
    for (const table of model.tables) {
      const label = labels.get(table.id);
      if (label !== undefined) table.label = label;
    }
  }

  // NOTE (06 §8.3 nav groups): an accepted `group` suggestion is NOT fed in
  // here, so a generated page keeps its heuristic 09 §2.2 group and the apply's
  // `nav_group` stamping is rewritten on the next run. That is deliberate until
  // the rail can render domain groups: `buildNavTree` (routes/bootstrap) drops
  // any row whose group is not one of the five fixed keys, so making the
  // accepted placement authoritative removes every page of a member table from
  // the sidebar. Making it stick and teaching the rail to show it are one
  // change, not two.
  const { pages, warnings } = generatePages(model, { connectionId, intent });

  // Belt and braces: the engine validated on emit; the server re-validates
  // at the write boundary because it is the single write-time authority.
  const validated = pages.map((page) => pageEnvelopeSchema.parse(page));

  // One page per (table, template): an accepted LLM template page and the
  // generator's own archetype for that table are the SAME page under two slug
  // schemes (`orders-board` vs `public-orders-page-board`). The apply executor
  // holds the common order — it declines to insert an llm page a generated one
  // already covers — and this is the other order: when the apply landed first
  // (or a schema change only now makes the table earn that archetype), the
  // generated twin is dropped from the run instead of appearing beside it. Any
  // twin persisted by an earlier run is then pruned below as an orphan, unless
  // it was hand-edited, which keeps it under "user delta wins" (04 §6.3).
  const covered = await llmCoveredTemplates(meta, connectionId);
  const emitted = validated.filter((page) => {
    const table = page.source.table;
    if (table === null || !covered.has(coordinateKey(table, page.template))) return true;
    warnings.push(
      `${page.template} for ${table} skipped — an accepted LLM page already covers this table+template (06 §8.3)`,
    );
    return false;
  });

  const persistence = await pagesRepo(meta).upsertGenerated(
    connectionId,
    emitted.map(toGeneratedPageInput),
    // `hashEnvelope` arms the H5 edited-page guard (04 §6.3 "user delta wins"):
    // stored documents whose embedded generatedHash went stale were edited by a
    // human and are skipped, not overwritten.
    { snapshotId: snapshot.id, createdBy: opts.createdBy ?? null, hashEnvelope },
  );
  for (const id of persistence.skippedEdited) {
    warnings.push(`page ${id} was edited after generation — kept as-is (user delta wins, 04 §6.3)`);
  }
  for (const id of persistence.keptEdited) {
    warnings.push(
      `page ${id} is no longer generated but was edited by hand — kept instead of pruned (user delta wins, 04 §6.3)`,
    );
  }
  for (const blocked of persistence.blockedSlugs) {
    // Surfacing this is the whole point of not throwing: the run succeeded, but
    // one generated page silently does not exist because a hand-authored page
    // (Studio → Pages) holds its URL. Naming the slug is what lets an admin
    // rename either side and re-run.
    warnings.push(
      `page ${blocked.id} could not be written — another page already uses the slug "${blocked.slug}". Rename it in Studio → Pages, then regenerate.`,
    );
  }

  // §8.3 step 3 tail: expand `origin: 'llm'` seed rows into real envelopes.
  const llm = await materializeLlmPages({ meta, model, connectionId });
  warnings.push(...llm.warnings);

  const navGroups = [...new Set(emitted.map((page) => page.nav.group))];
  return {
    snapshotId: snapshot.id,
    introspected,
    intent,
    pages: emitted,
    navGroups,
    warnings,
    persistence,
    llmPagesMaterialized: llm.materialized.length,
    durationMs: Date.now() - startedAt,
  };
}
