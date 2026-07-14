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

import { generatePages, parseDatabaseModel, type GenerateIntent } from '@adminium/engine';
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
  const model = parseDatabaseModel(snapshot.schema);
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
