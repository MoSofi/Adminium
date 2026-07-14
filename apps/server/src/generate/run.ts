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
  parseDatabaseModel,
  type DatabaseModel,
  type GenerateIntent,
} from '@adminium/engine';
import { pageEnvelopeSchema, type PageEnvelope } from '@adminium/engine/config';
import {
  pagesRepo,
  snapshotsRepo,
  type GeneratedPageInput,
  type MetaDb,
  type UpsertGeneratedResult,
} from '@adminium/meta';

import { runIntrospection } from '../connections/introspect.js';
import type { ConnectionManager } from '../connections/manager.js';

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
  const { pages, warnings } = generatePages(model, { connectionId, intent });

  // Belt and braces: the engine validated on emit; the server re-validates
  // at the write boundary because it is the single write-time authority.
  const validated = pages.map((page) => pageEnvelopeSchema.parse(page));

  const persistence = await pagesRepo(meta).upsertGenerated(
    connectionId,
    validated.map(toGeneratedPageInput),
    { snapshotId: snapshot.id, createdBy: opts.createdBy ?? null },
  );

  const navGroups = [...new Set(validated.map((page) => page.nav.group))];
  return {
    snapshotId: snapshot.id,
    introspected,
    intent,
    pages: validated,
    navGroups,
    warnings,
    persistence,
    durationMs: Date.now() - startedAt,
  };
}
