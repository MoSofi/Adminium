// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Restarting the server against a meta store that has just moved
 * (`meta/relocate.ts`; 01-architecture.md §3.1).
 *
 * ── WHY A RESTART AT ALL ────────────────────────────────────────────────────
 * `compose.ts` captures the meta handle ONCE (`const meta = opts.metaStore.meta`)
 * and threads it into every repo, service, guard and job. There is no seam
 * through which a live `Kysely` instance could be swapped for another, and
 * inventing one — an indirection on every meta call, for an operation that
 * happens at most once in an instance's life — would be a permanent tax paid
 * for a moment. Rebuilding the graph is the cheap, boring option.
 *
 * ── THE BOOTSTRAP FILE IS THE HANDOFF ───────────────────────────────────────
 * Nothing here passes the new DSN to the new runtime, and it does not need to.
 * `relocateMetaStore` has already written `<dataDir>/adminium.json`, and
 * `resolveMetaUrl`'s second rung reads exactly that — so `openRuntime(env)`
 * with the SAME env resolves to the new store on its own. The env object is
 * never mutated, which keeps "where does this instance's store live" a question
 * with one answer rather than two that can drift.
 *
 * ── FAILURE ─────────────────────────────────────────────────────────────────
 * Once the bootstrap file is written the relocation has committed, so there is
 * nothing to roll back TO: the old store is stale the moment the new one is
 * live. If the rebuild fails, this says so in terms an operator can act on and
 * exits non-zero rather than leaving a process that is up but serving nothing.
 * The data is safe in the new store and a plain `adminium start` will pick it up.
 */

import { retireSqliteStore, type MetaRelocation, type OnMetaRelocated } from '../meta/relocate.js';
import type { Env } from '../config/env.js';
import { setShutdownTarget, type CliDeps, type CliRuntime, type StartedServer } from './runtime.js';

export type { MetaRelocation, OnMetaRelocated };

export interface RelocationHost {
  /**
   * Boot, and keep booting into whatever store the bootstrap file names.
   *
   * `existing` adopts a runtime the caller has already opened — both CLI front
   * doors open one before this point, to run `firstRun` and to emit the §3.1
   * OD-1 embedded-store warning. Opening a second one here would leave two live
   * handles on the same store, only one of which anything would ever close.
   */
  start(existing?: CliRuntime): Promise<StartedServer>;
  /** Pass to `startServer`; the routes call it. */
  onMetaRelocated: OnMetaRelocated;
  /** The live server, for callers that print its URL. */
  current(): StartedServer | null;
}

export interface CreateRelocationHostOptions {
  env: Env;
  deps: CliDeps;
  /** Lifecycle narration — the wizard's `io.note`, or `console.error`. */
  log: (message: string) => void;
  /** Test seam: defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Test seam: defaults to running the task on the next tick. */
  schedule?: (task: () => void) => void;
}

export function createRelocationHost(opts: CreateRelocationHostOptions): RelocationHost {
  const { env, deps, log } = opts;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const schedule = opts.schedule ?? ((task: () => void) => void setImmediate(task));

  let runtime: CliRuntime | null = null;
  let server: StartedServer | null = null;
  /**
   * Serializes restarts. Two relocations cannot legitimately overlap — the
   * second would find `ADMINIUM_META_URL` unpinned but the store already moved
   * — but a duplicate request must not be able to interleave two teardowns of
   * the same server.
   */
  let chain: Promise<void> = Promise.resolve();

  const boot = async (existing?: CliRuntime): Promise<StartedServer> => {
    // The rebuild path passes nothing, so it re-resolves through the bootstrap
    // file the relocation just wrote — which is what makes it land on the new
    // store without anyone threading the DSN through.
    runtime = existing ?? (await deps.openRuntime(env));
    server = await deps.startServer(runtime, { onMetaRelocated });
    setShutdownTarget(server.app);
    return server;
  };

  const rebuild = async (relocation: MetaRelocation): Promise<void> => {
    log(`Meta store moved to ${relocation.engine}. Restarting…`);

    // Order matters: the server first (it stops accepting requests and fires
    // the onClose hooks that stop the job worker), then the runtime (which is
    // what actually releases the SQLite file handle), and only then the rename.
    await server?.close().catch(() => undefined);
    await runtime?.close().catch(() => undefined);
    server = null;
    runtime = null;

    if (relocation.retiredSqlitePath !== null) {
      const retired = await retireSqliteStore(relocation.retiredSqlitePath);
      if ('error' in retired) {
        // Not fatal: the bootstrap file already points at the new store, so the
        // stale file is never opened. Worth saying out loud all the same —
        // it is the operator's fallback copy and they should know where it is.
        log(
          `Could not rename the old meta store at ${relocation.retiredSqlitePath} ` +
            `(${retired.error.message}). It is no longer in use; move it yourself when convenient.`,
        );
      } else {
        log(`Previous meta store kept at ${retired.renamedTo}`);
      }
    }

    try {
      const restarted = await boot();
      log(`Adminium is running at ${restarted.url}`);
    } catch (error) {
      log(
        'Adminium moved its tables successfully but could not restart against the new store:\n' +
          `  ${error instanceof Error ? error.message : String(error)}\n` +
          '\nYour data is in the new database and the setup file already points at it. ' +
          'Run `adminium start` to try again.',
      );
      exit(1);
    }
  };

  const onMetaRelocated: OnMetaRelocated = (relocation) => {
    chain = chain
      // The wait is INSIDE the chain, not a bare `schedule(…)` beside it: a
      // `chain.then(rebuild)` runs the moment the previous link settles, so
      // scheduling next to it defers nothing at all. This yields first, so the
      // response that triggered the relocation is fully off the socket before
      // `app.close()` starts draining the connection that carried it.
      .then(() => new Promise<void>((resolve) => schedule(resolve)))
      .then(() => rebuild(relocation));
  };

  return {
    start: boot,
    onMetaRelocated,
    current: () => server,
  };
}
