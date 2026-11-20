// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The user's own database in an operator project: `yours`, from
 * `ADMINIUM_YOUR_DATABASE` (`config/your-database.ts`), beside the operator's
 * `main`.
 *
 * OFF THE BOOT PATH. The operator does not run this database, so nothing about
 * it may hold up a boot or a wake: before the server listens only the
 * connection row is made or brought in line with the environment (no dial);
 * the probe (5 s), introspection and generation run as a job after it listens
 * ({@link startYourDatabase}). Readiness never waits for it. While it cannot be
 * reached, `/system/info` and the banner say so with a coarse reason
 * (`project/your-database-state.ts`), and the job tries again with a growing
 * pause.
 *
 * THE ENVIRONMENT IS THE TRUTH. On every boot the stored choice (intent,
 * tables, read-only, the URL's host and database) is compared with the
 * variable's. A difference updates the row, introspects again and generates
 * again; a page someone edited is kept (`runGeneration` keeps edited pages).
 *
 *  - Table ids that match nothing are warned about; when none match, every
 *    table is used.
 *  - Read-only (chosen, or forced by read-only analytics) is STICKY: the row's
 *    `readOnly` stays true whatever a probe finds (`settings.readOnlyForced`,
 *    which `recordTestResult` honours), and a Postgres session opens with
 *    `default_transaction_read_only`.
 *  - Creation goes through `withRoomForSource`, as every trial source does.
 */
import { createHash } from 'node:crypto';

import { operatorTalliesRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';

import type { YourDatabase } from '../config/your-database.js';
import { maskDsn } from '../connections/dsn.js';
import { runIntrospection } from '../connections/introspect.js';
import { testOutcome, type ConnectionManager, type ConnectionTestSummary } from '../connections/manager.js';
import { AppError } from '../errors.js';
import { runGeneration } from '../generate/run.js';
import type { YourDatabaseReason, YourDatabaseStatus } from './your-database-state.js';

/** The project key the user's database is stored under (one constant, with the guard that keeps tables off it). */
export { YOURS_KEY } from '../connections/no-app-tables.js';
import { YOURS_KEY } from '../connections/no-app-tables.js';

/** The tally holding a fingerprint of the choice last applied (an operator tally holds a whole number). */
export const YOURS_CHOICE_TALLY = 'yours-choice';

/** How long the probe may take before the database counts as unreachable. */
export const YOURS_PROBE_MS = 5_000;

/** The pauses between tries while it cannot be reached: 1, 2, 5, then every 15 minutes. */
export const YOURS_RETRY_MS: readonly number[] = [60_000, 120_000, 300_000, 900_000];

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The choice as compared from boot to boot. */
function choiceOf(yours: YourDatabase): string {
  return JSON.stringify({ intent: yours.intent, tables: [...yours.tables].sort(), readOnly: yours.readOnly, host: yours.host, port: yours.port, database: yours.database, engine: yours.engine });
}

/** A whole number for the tally: the first 48 bits of the choice's sha256. */
export function choiceFingerprint(yours: YourDatabase): number {
  return Number.parseInt(createHash('sha256').update(choiceOf(yours)).digest('hex').slice(0, 12), 16);
}

/**
 * The data URL: the variable's, and on Postgres a read-only session when the
 * database is read-only (`options=-c default_transaction_read_only=on`, which the
 * parameter allow-list takes). MySQL has no such URL setting; the read-only flag
 * gates every write there.
 */
export function yoursDataDsn(yours: YourDatabase): string | null {
  if (!yours.readOnly || yours.engine !== 'postgres') return null;
  const url = new URL(yours.url);
  const options = url.searchParams.get('options');
  const readOnly = '-c default_transaction_read_only=on';
  url.searchParams.set('options', options === null || options.trim() === '' ? readOnly : `${options} ${readOnly}`);
  return url.toString();
}

/** A failed probe or a refusal as one of `check-source`'s classes: never the server's own words. */
export function reasonOf(error: { code?: string | undefined; message?: string | undefined } | null | undefined): YourDatabaseReason {
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  // The lockout after repeated refused logins (`SOURCE_LOGIN_LOCKED`) is ours, as every refusal before a dial is.
  if (code === 'OFF_BY_OPERATOR' || code === 'VALIDATION_FAILED' || code === 'REFUSED' || code === 'SOURCE_LOGIN_LOCKED') return 'refused-by-us';
  if (code === 'HOST_LOOKUP_FAILED' || code === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo|could not be looked up/i.test(message)) return 'dns';
  // Before `auth`: the adapters report a missing database as an AUTH failure (Postgres 3D000, MySQL ER_BAD_DB_ERROR).
  if (/database .* does not exist|unknown database|3D000|ER_BAD_DB_ERROR|ER_DBACCESS_DENIED_ERROR/i.test(message)) return 'no-database';
  if (code === 'AUTH') return 'auth';
  if (code === 'TLS') return 'tls';
  if (code === 'PERMISSION') return 'no-permission';
  if (/ENETUNREACH|EHOSTUNREACH/.test(message) && /[0-9a-f]*:[0-9a-f:]+/i.test(message)) return 'ipv6-only';
  return 'unreachable';
}

export interface YourDatabaseOptions {
  manager: ConnectionManager;
  meta: MetaDb;
  yours: YourDatabase;
  status: YourDatabaseStatus;
  log: (message: string) => void;
  warn: (message: string) => void;
  now?: () => number;
}

/**
 * Before the server listens: the `yours` row made, or brought in line with the
 * environment. No dial. Returns the connection id and whether the choice
 * changed since the last boot (which means introspect and generate again).
 */
export async function registerYourDatabase(opts: YourDatabaseOptions): Promise<{ connectionId: string; changed: boolean } | null> {
  const { manager, meta, yours } = opts;
  const at = (opts.now ?? Date.now)();
  const fingerprint = choiceFingerprint(yours);
  const tallies = operatorTalliesRepo(meta);
  opts.status.set({ state: 'connecting', reason: null, host: yours.host, label: yours.label, readOnly: yours.readOnly }, at);
  try {
    const existing = await manager.connections.findByProjectKey(YOURS_KEY);
    const settings = { intent: yours.intent, readOnlyForced: yours.readOnly };
    const dataDsn = yoursDataDsn(yours);
    let connectionId: string;
    let changed: boolean;
    if (existing === null) {
      const created = await manager.withRoomForSource(() =>
        manager.connections.create(
          {
            name: yours.label,
            engine: yours.engine,
            sourceKind: 'dsn',
            introspectDsn: yours.url,
            dataDsn,
            readOnly: yours.readOnly,
            settings,
            status: 'error',
            projectKey: YOURS_KEY,
            createdBy: null,
          },
          at,
        ),
      );
      connectionId = created.id;
      changed = true;
      opts.log(`Your database: added (${maskDsn(yours.url) ?? 'a database'}); it is connected once the server is up.`);
    } else {
      connectionId = existing.id;
      const stored = await manager.connections.getDsns(existing.id);
      const urlChanged = stored?.introspectDsn !== yours.url || (stored?.dataDsn ?? null) !== dataDsn;
      const tally = await tallies.get(YOURS_CHOICE_TALLY);
      changed = tally?.amount !== fingerprint;
      if (urlChanged || changed || existing.readOnly !== yours.readOnly || existing.settings.intent !== yours.intent || existing.settings.readOnlyForced !== yours.readOnly || existing.name !== yours.label) {
        // Merge: what the operator set replaces what is stored; the rest of the settings stay.
        await manager.connections.update(
          existing.id,
          {
            name: yours.label,
            introspectDsn: yours.url,
            dataDsn,
            readOnly: yours.readOnly,
            settings: { ...existing.settings, ...settings },
          },
          at,
        );
        // A pool opened under the old URL or rule must not serve another request.
        await manager.dispose(existing.id).catch(() => undefined);
      }
    }
    return { connectionId, changed };
  } catch (error) {
    const reason = error instanceof AppError ? reasonOf({ code: error.code, message: error.message }) : 'refused-by-us';
    opts.status.set({ state: 'down', reason, host: yours.host, label: yours.label, readOnly: yours.readOnly }, at);
    opts.warn(`Your database could not be set up: ${describe(error)}`);
    return null;
  }
}

async function probeWithin(manager: ConnectionManager, yours: YourDatabase, ms: number): Promise<ConnectionTestSummary> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ConnectionTestSummary>((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, latencyMs: ms, serverVersion: null, readOnly: false, capabilities: null, error: { code: 'TIMEOUT', message: 'The database did not answer in time.', hint: null } });
    }, ms);
  });
  try {
    return await Promise.race([
      manager.testDsn(yours.engine, yours.url).catch((error: unknown) => ({
        ok: false as const,
        latencyMs: 0,
        serverVersion: null,
        readOnly: false,
        capabilities: null,
        error: { code: error instanceof AppError ? error.code : 'REFUSED', message: describe(error), hint: null },
      })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The table ids that exist, warning about the rest; empty (all tables) when none match. */
async function matchTables(meta: MetaDb, connectionId: string, wanted: readonly string[], warn: (message: string) => void): Promise<string[]> {
  if (wanted.length === 0) return [];
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  const model = snapshot?.schema as { tables?: { id: string }[] } | undefined;
  const ids = new Set((model?.tables ?? []).map((table) => table.id));
  const found = wanted.filter((id) => ids.has(id));
  const missing = wanted.filter((id) => !ids.has(id));
  if (missing.length > 0) warn(`Your database: ${String(missing.length)} chosen table(s) were not found (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}).`);
  if (found.length === 0) {
    warn('Your database: none of the chosen tables were found, so pages are made for every table.');
    return [];
  }
  return found;
}

/**
 * One try: probe, and when it answers, introspect and generate (the first time,
 * or when the choice changed). True when the database is ready.
 */
export async function connectYourDatabase(opts: YourDatabaseOptions, registered: { connectionId: string; changed: boolean }): Promise<boolean> {
  const { manager, meta, yours, status } = opts;
  const now = opts.now ?? Date.now;
  const base = { host: yours.host, label: yours.label, readOnly: yours.readOnly };
  const summary = await probeWithin(manager, yours, YOURS_PROBE_MS);
  await manager.connections.recordTestResult(registered.connectionId, testOutcome(summary), now()).catch(() => undefined);
  if (!summary.ok) {
    status.set({ ...base, state: 'down', reason: reasonOf(summary.error) }, now());
    opts.warn(`Your database is not reachable (${reasonOf(summary.error)}). Adminium keeps trying.`);
    return false;
  }
  const fresh = (await snapshotsRepo(meta).latest(registered.connectionId)) === null;
  if (fresh || registered.changed) {
    try {
      await runIntrospection({ manager, meta, connectionId: registered.connectionId, createdBy: null });
      const includedTables = await matchTables(meta, registered.connectionId, yours.tables, opts.warn);
      const row = await manager.connections.findById(registered.connectionId);
      if (row !== null) {
        const settings = { ...row.settings, intent: yours.intent, readOnlyForced: yours.readOnly };
        if (includedTables.length > 0) settings.includedTables = includedTables;
        else delete settings.includedTables;
        await manager.connections.update(row.id, { settings }, now());
      }
      const generated = await runGeneration({ manager, meta, connectionId: registered.connectionId, createdBy: null, intent: yours.intent });
      for (const warning of generated.warnings) opts.warn(warning);
      opts.log(`Your database: generated ${String(generated.pages.length)} page(s).`);
      // Applied: the next boot compares against this choice.
      const tallies = operatorTalliesRepo(meta);
      await tallies.release(YOURS_CHOICE_TALLY);
      await tallies.raise(YOURS_CHOICE_TALLY, choiceFingerprint(yours), now());
    } catch (error) {
      const empty = /no tables|nothing to generate/i.test(describe(error));
      status.set({ ...base, state: 'down', reason: empty ? 'empty' : 'unreachable' }, now());
      opts.warn(`Your database is connected, but its pages could not be made: ${describe(error)}`);
      return false;
    }
  }
  status.set({ ...base, state: 'ready', reason: null }, now());
  return true;
}

export interface YourDatabaseJob {
  /** Resolves when the first try is over (tests). */
  readonly firstTry: Promise<boolean>;
  close(): void;
}

/**
 * After the server listens: try now, then again with a growing pause until the
 * database is ready. Never throws; a failure is a state and a log line.
 */
export function startYourDatabase(
  opts: YourDatabaseOptions,
  registered: { connectionId: string; changed: boolean },
  schedule: (run: () => void, ms: number) => { cancel(): void } = (run, ms) => {
    const timer = setTimeout(run, ms);
    timer.unref();
    return { cancel: () => clearTimeout(timer) };
  },
): YourDatabaseJob {
  let closed = false;
  let pending: { cancel(): void } | null = null;
  let attempt = 0;
  let current = registered;
  const tryOnce = async (): Promise<boolean> => {
    try {
      return await connectYourDatabase(opts, current);
    } catch (error) {
      opts.warn(`Your database: ${describe(error)}`);
      return false;
    }
  };
  const loop = async (): Promise<boolean> => {
    const ok = await tryOnce();
    // A later try after a success generates only what is missing.
    if (!ok && !closed) {
      const ms = YOURS_RETRY_MS[Math.min(attempt, YOURS_RETRY_MS.length - 1)] ?? 900_000;
      attempt += 1;
      pending = schedule(() => {
        pending = null;
        if (!closed) void loop();
      }, ms);
    } else {
      current = { ...current, changed: false };
    }
    return ok;
  };
  const firstTry = loop();
  return {
    firstTry,
    close() {
      closed = true;
      pending?.cancel();
    },
  };
}
