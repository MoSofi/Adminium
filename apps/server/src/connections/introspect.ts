// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Introspection pipeline (M3-T05): adapter `introspect()` → column/table
 * classification (`@adminium/engine`) → canonical checksum → snapshot row →
 * auto-proposed PII mask overrides ("Mask PII columns · On by default",
 * 05-introspection-engine.md §7.2).
 *
 * 08 §2.4 runs this as an `introspect` job (202 + jobId, progress on
 * `jobs:<id>`); `registerIntrospectJob` wires that. The route falls back to
 * a synchronous run (with the 05 §10 duration budget) when the jobs worker
 * is not registered — dev/test topologies.
 */

import {
  applyClassification,
  applyInference,
  hashModel,
  type DatabaseModel,
} from '@adminium/engine';
import { AdapterError } from '@adminium/engine/adapter';
import { overridesRepo, snapshotsRepo, type MetaDb, type SchemaSnapshot } from '@adminium/meta';
import { z } from 'zod';

import { adapterErrorToAppError, type ConnectionManager } from './manager.js';

export interface IntrospectionResult {
  snapshot: SchemaSnapshot;
  /** True when the checksum matched the latest snapshot — nothing written. */
  noop: boolean;
  /** Count of PII mask overrides proposed by this run. */
  proposedMasks: number;
}

export interface RunIntrospectionOptions {
  manager: ConnectionManager;
  meta: MetaDb;
  connectionId: string;
  createdBy?: string | null | undefined;
  /** 05 §10 total budget; default 30s. */
  timeoutMs?: number | undefined;
}

/**
 * Auto-propose `column.pii { masked: true }` overrides for columns the
 * classifier flagged `maskedByDefault`, skipping any (table, column) that
 * already has a `column.pii` row (user decisions are never overwritten).
 *
 * These rows carry `origin: 'auto'`, NOT the repo default of `'user'`. They are
 * the engine's guess, and the guess is sometimes wrong — writing them as `user`
 * made `userLockedSuggestionId` (llm/apply-service.ts) treat every one of them
 * as a deliberate human decision, so an LLM enrichment could never correct a
 * misclassification. Every `pii` suggestion in a response was silently dropped
 * as `user-locked` while the bad mask stayed. `auto` keeps the mask applied
 * (the read path in effective-schema.ts ignores origin) but leaves it open to
 * being superseded by an accepted LLM row, which sorts later and wins.
 */
async function proposePiiMasks(meta: MetaDb, connectionId: string, model: DatabaseModel): Promise<number> {
  const overrides = overridesRepo(meta);
  const existing = await overrides.listForConnection(connectionId);
  const covered = new Set(
    existing.filter((o) => o.op === 'column.pii').map((o) => `${o.tableName}\x00${o.columnName ?? ''}`),
  );
  let proposed = 0;
  for (const table of model.tables) {
    for (const column of table.columns) {
      if (column.semantics?.flags.maskedByDefault !== true) continue;
      const key = `${table.id}\x00${column.name}`;
      if (covered.has(key)) continue;
      await overrides.create({
        connectionId,
        op: 'column.pii',
        origin: 'auto',
        tableName: table.id,
        columnName: column.name,
        value: {
          masked: true,
          ...(column.semantics.flags.pii === null ? {} : { kind: column.semantics.flags.pii }),
        },
      });
      proposed += 1;
    }
  }
  return proposed;
}

export async function runIntrospection(opts: RunIntrospectionOptions): Promise<IntrospectionResult> {
  const { manager, meta, connectionId } = opts;
  const snapshots = snapshotsRepo(meta);
  const adapter = await manager.introspectAdapter(connectionId);
  let model: DatabaseModel;
  let engineVersion: string | null = null;
  try {
    const probe = await adapter.probeCapabilities().catch(() => null);
    engineVersion = probe?.serverVersion ?? null;
    model = await adapter.introspect({ timeoutMs: opts.timeoutMs ?? 30_000 });
  } catch (error) {
    if (error instanceof AdapterError) throw adapterErrorToAppError(error);
    throw error;
  } finally {
    await adapter.close().catch(() => undefined);
  }

  // 05 §6 rules 1–2 BEFORE §§7–8. Both classifiers read `model.relations`,
  // and on a schema that declares no foreign keys (MyISAM, legacy SQLite,
  // most ORM-generated MySQL) that array arrives empty: every `*_id` column
  // falls through to `external-id`, every join table classifies as an
  // `entity`, and `detectDomains` shatters into singletons. Inferring first
  // is what lets the classifier see the graph it is supposed to describe.
  //
  // Deliberately NOT folded into `applyClassification`: that function spreads
  // `...model` and rebuilds only `tables`, so relations added inside it would
  // be discarded by the next call. Two functions, in this order.
  //
  // This is also the ONLY place inference runs. The snapshot persists its
  // output, so `generate/run.ts` reads the relations back rather than
  // re-deriving them — which is what lets a `relation.remove` override stay
  // removed instead of being re-inferred on every regeneration.
  const classified = applyClassification(applyInference(model));
  const checksum = hashModel(classified);
  const stats: Record<string, { rowCount: number }> = {};
  for (const table of classified.tables) {
    if (table.rowCountEstimate !== null) stats[table.id] = { rowCount: table.rowCountEstimate };
  }

  const { snapshot, noop } = await snapshots.create({
    connectionId,
    source: 'introspection',
    engineVersion,
    schema: classified,
    stats: Object.keys(stats).length > 0 ? stats : null,
    checksum,
    createdBy: opts.createdBy ?? null,
  });

  const proposedMasks = noop ? 0 : await proposePiiMasks(meta, connectionId, classified);
  await manager.connections.update(connectionId, { status: 'connected' });
  return { snapshot, noop, proposedMasks };
}

export const INTROSPECT_JOB_KIND = 'introspect';

export const introspectJobPayloadSchema = z.object({
  connectionId: z.string(),
  createdBy: z.string().nullish(),
  /** Jobs owner convention (routes/jobs `jobOwnerId`) — lets the enqueuing user poll their job. */
  userId: z.string().nullish(),
});

/** Minimal structural view of the jobs registry (jobs/registry.ts). */
export interface IntrospectJobRegistry {
  registerJobHandler<T>(
    kind: string,
    schema: z.ZodType<T>,
    handler: (
      payload: T,
      ctx: { progress(pct: number, info?: { step?: string; message?: string }): void },
    ) => Promise<unknown>,
    opts?: { internal?: boolean },
  ): void;
  has(kind: string): boolean;
}

/** Wire the async path of `POST /connections/:id/introspect` (08 §2.4). */
export function registerIntrospectJob(
  registry: IntrospectJobRegistry,
  deps: { manager: ConnectionManager; meta: MetaDb },
): void {
  if (registry.has(INTROSPECT_JOB_KIND)) return;
  registry.registerJobHandler(INTROSPECT_JOB_KIND, introspectJobPayloadSchema, async (payload, ctx) => {
    ctx.progress(5, { step: 'connecting', message: 'Connecting…' });
    const result = await runIntrospection({
      manager: deps.manager,
      meta: deps.meta,
      connectionId: payload.connectionId,
      createdBy: payload.createdBy ?? null,
    });
    ctx.progress(100, { step: 'done', message: 'Ready' });
    return { snapshotId: result.snapshot.id, noop: result.noop, proposedMasks: result.proposedMasks };
  }, { internal: true });
}
