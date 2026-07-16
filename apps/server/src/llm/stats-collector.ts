/**
 * The §4.2 statistics collector, backed by a live {@link ConnectionManager}.
 *
 * `createPromptService` takes `collectStats` as an INJECTED dependency and falls
 * back to `NO_STATS` (an empty array) when nobody supplies one — which is the
 * correct default for a service that must stay testable without a source
 * database, and the wrong behavior for a front door that advertises
 * `--sampling` in its `--help`. Both doors (the CLI's `generate-prompt` and the
 * Studio's `POST /llm/runs`) inject THIS, so `--sampling` and the Studio toggle
 * mean the same thing: the same aggregates, from the same query, through the
 * same privacy rules.
 *
 * PRIVACY (06 §4.2, and why this file passes the classified model down rather
 * than a bare column list): the adapter decides what is safe to look at, and it
 * can only do that if it knows which columns the classifier flagged
 * `secret`/`pii`. Sample-free is the default — with `sampling` null NO cell
 * value leaves the database, only row counts, null fractions and distinct
 * counts. Under sampling opt-in the adapter still refuses sampled values and
 * min/max for PII-suspected or secret columns; that refusal is the adapter's,
 * and this module's job is simply to hand it the flags it needs to make it.
 *
 * DEGRADATION. A table that cannot be profiled (dropped since introspection, a
 * permission gap, a timeout) is SKIPPED, not fatal: the prompt is an
 * enrichment aid, and losing aggregates for one table must not fail the run
 * that would have enriched the other forty.
 */

import type { CollectStatsOptions, StatsColumnInput, StatsResult } from '@adminium/engine/adapter';
import type { DatabaseModel, TableModel } from '@adminium/engine';

import type { ConnectionManager } from '../connections/manager.js';
import type { CollectRunStats } from './prompt-service.js';

/** Tables Adminium owns are never profiled — they are not the user's schema. */
function isProfilable(table: TableModel): boolean {
  return !table.system;
}

/** The classified column set, in the shape the adapter's privacy rules read. */
function statsColumns(table: TableModel): StatsColumnInput[] {
  return table.columns.map((column) => ({
    name: column.name,
    logicalType: column.logicalType,
    piiSuspected: column.semantics?.flags.pii != null,
    secret: column.semantics?.flags.secret === true,
  }));
}

export interface ConnectionStatsCollectorDeps {
  manager: ConnectionManager;
  /** Cap on tables profiled per run — a 500-table schema must not stall a boot. */
  maxTables?: number | undefined;
}

/**
 * §4.2 aggregates for every non-system table in the run's model, collected over
 * the connection's DATA role (the introspect role may not read rows at all).
 */
export const DEFAULT_MAX_STATS_TABLES = 200;

export function createConnectionStatsCollector(
  deps: ConnectionStatsCollectorDeps,
): CollectRunStats {
  const maxTables = deps.maxTables ?? DEFAULT_MAX_STATS_TABLES;

  return async ({ connectionId, model, sampling }): Promise<readonly StatsResult[]> => {
    const tables = (model as DatabaseModel).tables.filter(isProfilable).slice(0, maxTables);
    if (tables.length === 0) return [];

    const adapter = await deps.manager.dataAdapter(connectionId);
    try {
      const results: StatsResult[] = [];
      for (const table of tables) {
        const opts: CollectStatsOptions = {
          columns: statsColumns(table),
          sampling: sampling ?? null,
        };
        try {
          results.push(
            await adapter.collectTableStats({ schema: table.schema, name: table.name }, opts),
          );
        } catch {
          // See the module header: one unprofilable table is not a failed run.
          continue;
        }
      }
      return results;
    } finally {
      await adapter.close().catch(() => undefined);
    }
  };
}
