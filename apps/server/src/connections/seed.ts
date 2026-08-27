// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-boot source-connection seed (28-public-surface.md 28-T31).
 *
 * `ADMINIUM_SOURCE_URL` names the database the back office is generated FROM.
 * On a boot that has never had a healthy seed, this creates the connection,
 * introspects it, and generates the pages — the chain `adminium init` walks
 * interactively (`cli/commands/init.ts`: `testDsn` → `connections.create` →
 * `runIntrospection` → `runGeneration`), driven from configuration instead of
 * from prompts. It calls those same four functions rather than reimplementing
 * any of them, so a container install and a wizard install cannot drift.
 *
 * WHY THIS EXISTS AT ALL, AND WHY IT IS NOT `DATABASE_URL`. The variable this
 * replaces was validated, forwarded through docker-compose.yml, and documented
 * on two self-hosting pages as exactly this feature — while nothing read it.
 * Every documented Docker quickstart set it, got no connection, and had nothing
 * to debug. It was deleted rather than retrofitted, with the note that a real
 * seed owes four answers first (`config/env.ts`). They are, in order:
 *
 *  1. VALIDATE AND PROBE BEFORE STORING. `parseDsn` decides the engine and
 *     rejects a scheme we have no adapter for; `manager.testDsn` guards the
 *     host, dials, and probes capabilities. The row records what the probe
 *     found — `readOnly` included — not what the environment claimed.
 *  2. A BAD DSN DOES NOT STOP THE BOOT. It leaves a connection in `error`
 *     carrying the adapter's message and hint, and the server comes up. The
 *     alternative — refusing to boot — takes away the Studio that is the only
 *     way to see what is wrong, to fix a typo you cannot read from a crash loop.
 *  3. IDEMPOTENT ACROSS RESTARTS. `system.sourceSeededAt` is written only after
 *     a healthy probe and is the once-only gate. A restart re-reads it and does
 *     nothing.
 *  4. A ROW DELETED LATER STAYS DELETED. The claim outlives the row it made, so
 *     an operator who removes the seeded connection does not find it rebuilt by
 *     the next `docker compose up`.
 *
 * THE RETRY IS THE POINT OF THE SECOND KEY. A single claim written on failure
 * too would stand between the commonest mistake and its fix: `PATCH
 * /connections/:id` accepts `name` and `settings` and NOT a DSN
 * (`routes/connections/schema.ts`), so a stored bad DSN cannot be corrected
 * anywhere in the product. The operator's only fix is to correct compose — so
 * until a probe succeeds, this keeps listening to compose, and updates the row
 * it already made instead of adding one more on every restart.
 *
 * IT NEVER TOUCHES AN INSTANCE SOMEBODY ELSE CONFIGURED. If connections already
 * exist and none of them is this seed's, the variable is ignored and said so in
 * the log. Someone who ran the wizard and later added the variable gets a note,
 * not a surprise second connection.
 */

import { basename } from 'node:path';

import { settingsRepo, type MetaDb } from '@adminium/meta';

import { AppError } from '../errors.js';
import { runGeneration } from '../generate/run.js';
import { runIntrospection } from './introspect.js';
import { maskDsn, parseDsn } from './dsn.js';
import type { ConnectionManager } from './manager.js';

export interface SeedSourceConnectionOptions {
  manager: ConnectionManager;
  meta: MetaDb;
  /** The raw `ADMINIUM_SOURCE_URL`. */
  sourceUrl: string;
  /** Ordinary progress — one line per step, on stdout. */
  log: (message: string) => void;
  /** Anything the operator has to act on, on stderr. */
  warn: (message: string) => void;
  now?: number | undefined;
}

export type SeedSourceConnectionResult =
  /** A healthy seed already happened, or the operator has taken this over. */
  | { kind: 'skipped'; reason: 'already-seeded' | 'row-deleted' | 'other-connections' }
  /** The DSN did not survive parsing — nothing was stored, because nothing could be. */
  | { kind: 'refused'; message: string }
  /** Stored in `error`; the boot continues and the next one retries. */
  | { kind: 'failed'; connectionId: string; message: string }
  /** Connected, introspected, generated. The claim is written. */
  | { kind: 'seeded'; connectionId: string; tables: number | null; pages: number };

/** An adapter/app error's operator-facing text, hint included when there is one. */
function describe(error: unknown): string {
  if (error instanceof AppError) {
    const hint = (error.details as { hint?: unknown } | undefined)?.hint;
    return typeof hint === 'string' && hint.length > 0 ? `${error.message} — ${hint}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the seed. Safe to call on every boot: it decides for itself whether there
 * is anything to do, and it never throws — a seed that cannot run is a boot-log
 * line, not a failed start (answer 2 above).
 *
 * The catch-all is that promise kept, and it is not defensive padding: this runs
 * inside `adminium start`, which is a container's PID 1. An unmigrated store
 * under `--skip-migrate`, a meta driver that will not open, an adapter that
 * throws something outside `AppError` — none of those are reasons for the
 * dashboard not to come up, and every one of them is legible in the log line
 * below.
 */
export async function seedSourceConnection(
  opts: SeedSourceConnectionOptions,
): Promise<SeedSourceConnectionResult> {
  try {
    return await runSeed(opts);
  } catch (error) {
    const message = describe(error);
    opts.warn(`Could not seed the source connection: ${message}`);
    return { kind: 'refused', message };
  }
}

async function runSeed(opts: SeedSourceConnectionOptions): Promise<SeedSourceConnectionResult> {
  const { manager, meta, sourceUrl, log, warn } = opts;
  const at = opts.now ?? Date.now();
  const settings = settingsRepo(meta);

  // Parsing decides the engine, so it has to succeed before there is a row to
  // put an error ON. This is the one failure with nothing to store — and it
  // runs FIRST, before the store is read at all, so a variable that could never
  // work is reported as such even on an instance whose meta store is the reason
  // nothing else here would run.
  let engine: string;
  let database: string | null;
  try {
    const parsed = parseDsn(sourceUrl);
    engine = parsed.scheme;
    // SQLite has no database name, only a path — its basename is the thing an
    // operator would recognise in the connections list.
    database = parsed.database ?? (parsed.file === null ? null : basename(parsed.file, '.db'));
  } catch (error) {
    const message = describe(error);
    warn(`ADMINIUM_SOURCE_URL was not usable: ${message}`);
    return { kind: 'refused', message };
  }

  if ((await settings.get('system.sourceSeededAt')) !== null) {
    return { kind: 'skipped', reason: 'already-seeded' };
  }

  const priorId = await settings.get('system.sourceConnectionId');
  const prior = priorId === null ? null : await manager.connections.findById(priorId);
  if (priorId !== null && prior === null) {
    // The row this seed made is gone and no healthy seed was ever claimed, so
    // the operator deleted a failed attempt. That is a decision, not a gap.
    return { kind: 'skipped', reason: 'row-deleted' };
  }
  if (prior === null && (await manager.connections.list()).length > 0) {
    log('ADMINIUM_SOURCE_URL ignored — this instance already has a connection.');
    return { kind: 'skipped', reason: 'other-connections' };
  }

  const masked = maskDsn(sourceUrl) ?? '(unprintable)';
  log(`Seeding the source connection from ADMINIUM_SOURCE_URL (${masked}).`);

  // `testDsn` guards the host before it dials, and `guardDsn` throws rather than
  // returning a summary — so the guard refusal arrives here, not in `summary`.
  let summary;
  try {
    summary = await manager.testDsn(engine, sourceUrl);
    if (summary.ok) manager.enforceMetaPlacement(sourceUrl, summary);
  } catch (error) {
    summary = {
      ok: false as const,
      latencyMs: 0,
      serverVersion: null,
      readOnly: false,
      capabilities: null,
      error: { code: 'REFUSED', message: describe(error), hint: null },
    };
  }

  const name = database === null || database.length === 0 ? 'Source database' : database;
  const connectionId =
    prior === null
      ? (
          await manager.connections.create({
            name,
            engine,
            sourceKind: 'dsn',
            introspectDsn: sourceUrl,
            dataDsn: null,
            readOnly: summary.readOnly,
            settings: {},
            status: summary.ok ? 'connected' : 'error',
            // No user exists yet — the super-admin wizard has not run. The
            // audit trail for this is the boot log, which is where a compose
            // operator is already looking.
            createdBy: null,
          })
        ).id
      : prior.id;

  if (prior !== null) {
    // A retry: push the CURRENT variable into the row we already made, so a
    // corrected compose file takes effect on restart.
    await manager.connections.update(prior.id, { introspectDsn: sourceUrl, dataDsn: null }, at);
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
  await settings.set('system.sourceConnectionId', connectionId, { at });

  if (!summary.ok) {
    const message = summary.error?.hint
      ? `${summary.error.message} — ${summary.error.hint}`
      : (summary.error?.message ?? 'connection test failed');
    warn(
      `Could not connect to ADMINIUM_SOURCE_URL (${masked}): ${message}\n` +
        'Adminium started anyway. Correct the variable and restart — the next boot retries.',
    );
    return { kind: 'failed', connectionId, message };
  }

  // Introspect, then generate. `runGeneration` would introspect on its own when
  // no snapshot exists, but running it explicitly is what lets the boot log say
  // how many tables were found — and the checksum dedupe means the generation
  // step then reuses this snapshot rather than taking a second one.
  let tables: number | null = null;
  let pages = 0;
  try {
    const introspection = await runIntrospection({ manager, meta, connectionId, createdBy: null });
    tables = tableCount(introspection.snapshot.schema);
    const generated = await runGeneration({ manager, meta, connectionId, createdBy: null });
    pages = generated.pages.length;
    for (const warning of generated.warnings) warn(warning);
  } catch (error) {
    // The CONNECTION is healthy, which is what the claim below is about, so it
    // is still written: re-running generation on every boot forever is a worse
    // failure than one empty dashboard. Unlike a bad DSN, this one the operator
    // can fix in the product — Studio generates from a connected connection.
    warn(
      `Connected to ${masked}, but could not generate the dashboard: ${describe(error)}\n` +
        'Generate it from Studio → Connections when you are ready.',
    );
  }

  await settings.set('system.sourceSeededAt', at, { at });
  log(
    `Connected ${name} (${String(tables ?? 0)} table(s)) and generated ${String(pages)} page(s).`,
  );
  return { kind: 'seeded', connectionId, tables, pages };
}

/** Table count off the stored model — the shape `routes/connections` reads too. */
function tableCount(schema: unknown): number | null {
  if (schema === null || typeof schema !== 'object') return null;
  const tables = (schema as { tables?: unknown }).tables;
  return Array.isArray(tables) ? tables.length : null;
}
