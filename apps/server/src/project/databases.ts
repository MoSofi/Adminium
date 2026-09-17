// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Making the project's databases exist on this instance.
 *
 * Every key under `databases` in `adminium.config.ts` is one connection,
 * marked with that key (`project_key`). On each start:
 *   - a key with no connection yet gets one: the URL is probed, the row stored
 *     (in `error` if the probe fails, so the boot goes on), and a healthy
 *     database is introspected and its pages generated;
 *   - a key whose URL changed has its stored URL replaced and is probed again,
 *     and so is one whose last probe failed, so fixing the database and
 *     restarting clears the error;
 *   - a connection that is healthy but was never introspected (it failed on
 *     every earlier start) gets its first snapshot and pages now.
 * Nothing is ever deleted: a key removed from the config keeps its connection,
 * and the boot log says so.
 *
 * The steps are the ones the first-boot seed and the setup wizard use
 * (`testDsn`, `connections.create`, `runIntrospection`, `runGeneration`), so a
 * project cannot drift from them.
 */

import { isAbsolute, resolve } from 'node:path';

import { snapshotsRepo, type MetaDb } from '@adminium/meta';

import { maskDsn, parseDsn } from '../connections/dsn.js';
import { runIntrospection } from '../connections/introspect.js';
import type { ConnectionManager } from '../connections/manager.js';
import { runGeneration } from '../generate/run.js';

export interface SyncProjectDatabasesOptions {
  manager: ConnectionManager;
  meta: MetaDb;
  /** The project folder; relative SQLite paths are resolved against it. */
  root: string;
  /** Configured databases with a URL, by key. */
  databases: ReadonlyMap<string, string>;
  /** Configured keys whose URL is empty. */
  missing: readonly string[];
  log: (message: string) => void;
  warn: (message: string) => void;
  /**
   * Whether the project already has page files for this database. Its pages
   * then come from those files, so a first connection only introspects it.
   */
  hasPageFiles?: ((key: string) => boolean) | undefined;
  now?: number;
}

export type DatabaseSyncOutcome =
  | { key: string; kind: 'unchanged' | 'created' | 'updated' | 'retried'; connectionId: string; ok: boolean; pages?: number }
  | { key: string; kind: 'refused'; message: string };

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The URL as it will be stored. A relative SQLite path means "relative to the
 * project", whatever folder the server was started from.
 */
export function projectDsn(root: string, url: string): string {
  const parsed = parseDsn(url);
  if (parsed.scheme !== 'sqlite' || parsed.file === null) return url;
  if (parsed.file === ':memory:' || isAbsolute(parsed.file)) return url;
  return `sqlite:${resolve(root, parsed.file)}`;
}

export async function syncProjectDatabases(opts: SyncProjectDatabasesOptions): Promise<DatabaseSyncOutcome[]> {
  const { manager, meta, log, warn } = opts;
  const at = opts.now ?? Date.now();
  const outcomes: DatabaseSyncOutcome[] = [];

  for (const key of opts.missing) {
    log(`Database "${key}" has no URL yet. Set it in .env (or the environment) and restart.`);
  }

  for (const [key, rawUrl] of opts.databases) {
    let url: string;
    let engine: string;
    try {
      url = projectDsn(opts.root, rawUrl);
      engine = parseDsn(url).scheme;
    } catch (error) {
      const message = describe(error);
      warn(`Database "${key}": the URL is not usable (${message}).`);
      outcomes.push({ key, kind: 'refused', message });
      continue;
    }
    const masked = maskDsn(url) ?? '(unprintable)';

    try {
      const existing = await manager.connections.findByProjectKey(key);
      let kind: 'unchanged' | 'created' | 'updated' | 'retried' = 'created';
      if (existing !== null) {
        const stored = (await manager.connections.getDsns(existing.id))?.introspectDsn ?? null;
        if (stored !== url) kind = 'updated';
        else if (existing.status !== 'connected') kind = 'retried';
        else kind = 'unchanged';
      }

      let connectionId = existing?.id ?? '';
      let ok = existing?.status === 'connected';
      if (kind !== 'unchanged') {
        const summary = await probe(manager, engine, url);
        ok = summary.ok;
        if (existing === null) {
          const created = await manager.connections.create(
            {
              name: key,
              engine,
              sourceKind: 'dsn',
              introspectDsn: url,
              dataDsn: null,
              readOnly: summary.readOnly,
              settings: {},
              status: summary.ok ? 'connected' : 'error',
              projectKey: key,
              createdBy: null,
            },
            at,
          );
          connectionId = created.id;
          log(`Database "${key}": added (${masked}).`);
        } else if (kind === 'updated') {
          await manager.connections.update(existing.id, { introspectDsn: url, dataDsn: null }, at);
          log(`Database "${key}": the URL changed, now ${masked}.`);
        }
        await manager.connections.recordTestResult(
          connectionId,
          {
            ok: summary.ok,
            latencyMs: summary.latencyMs,
            error: summary.error?.message ?? null,
            errorHint: summary.error?.hint ?? null,
            readOnly: summary.readOnly,
          },
          at,
        );
        if (!summary.ok) {
          const reason = summary.error?.hint
            ? `${summary.error.message} (${summary.error.hint})`
            : (summary.error?.message ?? 'the connection test failed');
          warn(`Database "${key}": could not connect to ${masked}: ${reason}. Adminium started anyway; the next start tries again.`);
        } else if (kind === 'retried') {
          log(`Database "${key}": connected.`);
        }
      }

      let pages: number | undefined;
      if (ok && (await snapshotsRepo(meta).latest(connectionId)) === null) {
        pages = await introspectAndGenerate(opts, connectionId, key, warn);
      }
      outcomes.push({ key, kind, connectionId, ok, ...(pages === undefined ? {} : { pages }) });
    } catch (error) {
      const message = describe(error);
      warn(`Database "${key}": ${message}`);
      outcomes.push({ key, kind: 'refused', message });
    }
  }

  const configured = new Set([...opts.databases.keys(), ...opts.missing]);
  for (const connection of await manager.connections.list()) {
    if (connection.projectKey !== null && !configured.has(connection.projectKey)) {
      log(
        `Database "${connection.projectKey}" is no longer in the project config. Its connection is kept; ` +
          'remove it in Studio if you no longer need it.',
      );
    }
  }
  return outcomes;
}

type ProbeSummary = Awaited<ReturnType<ConnectionManager['testDsn']>>;

async function probe(manager: ConnectionManager, engine: string, url: string): Promise<ProbeSummary> {
  try {
    const summary = await manager.testDsn(engine, url);
    if (summary.ok) manager.enforceMetaPlacement(url, summary);
    return summary;
  } catch (error) {
    return {
      ok: false,
      latencyMs: 0,
      serverVersion: null,
      readOnly: false,
      capabilities: null,
      error: { code: 'REFUSED', message: describe(error), hint: null },
    } as unknown as ProbeSummary;
  }
}

async function introspectAndGenerate(
  opts: SyncProjectDatabasesOptions,
  connectionId: string,
  key: string,
  warn: (message: string) => void,
): Promise<number> {
  try {
    await runIntrospection({ manager: opts.manager, meta: opts.meta, connectionId, createdBy: null });
    if (opts.hasPageFiles?.(key) === true) {
      opts.log(`Database "${key}": read its schema; its pages come from the project's files.`);
      return 0;
    }
    const generated = await runGeneration({ manager: opts.manager, meta: opts.meta, connectionId, createdBy: null });
    for (const warning of generated.warnings) warn(warning);
    opts.log(`Database "${key}": generated ${String(generated.pages.length)} page(s).`);
    return generated.pages.length;
  } catch (error) {
    warn(
      `Database "${key}": connected, but the pages could not be generated (${describe(error)}). ` +
        'Generate them from Studio → Connections.',
    );
    return 0;
  }
}
