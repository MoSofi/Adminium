/** Handlers for the system resource (08-server-api.md §1.2 route-module layout). */
import type { MetaDb, MetaDialect } from '@adminium/meta';
import { sql } from 'kysely';

import { APP_VERSION } from '../../version.js';
import type { SystemHealthzReply, SystemInfoReply, SystemReadyzReply } from './schema.js';

/**
 * LIVENESS: the process is up and serving. No dependency checks, on purpose —
 * a liveness probe that fails on a dependency asks the orchestrator to restart a
 * process whose problem a restart cannot fix, turning a database blip into a
 * crash-loop.
 *
 * This is what the Dockerfile HEALTHCHECK runs, and it answers exactly one
 * question: "is this the API, and is it serving?" (It hits `/api/v1/healthz`
 * rather than bare `/healthz` because the latter has no route and would be
 * answered by the SPA history fallback with index.html + 200 — i.e. "healthy"
 * as long as the static files exist on disk.) It does NOT tell you the meta
 * store is reachable; {@link readyz} is the probe that does.
 */
export function healthz(): SystemHealthzReply {
  return { ok: true, version: APP_VERSION, uptime: process.uptime() };
}

/**
 * READINESS (01-architecture.md §4.1 lists `/readyz` beside `/healthz`): can
 * this instance actually serve a request? That means the meta store — without
 * it every authenticated route 500s, however alive the process is.
 *
 * Load balancers and orchestrators key traffic on THIS, not on `healthz`: an
 * instance whose Postgres has died or been partitioned away is live but
 * useless, and should stop receiving traffic without being restarted.
 *
 * One `SELECT 1` — enough to prove the pool can hand out a working connection,
 * cheap enough to run on a probe interval.
 */
export async function readyz(meta: MetaDb | null): Promise<SystemReadyzReply> {
  if (meta === null) {
    return { ok: false, version: APP_VERSION, checks: { meta: 'not-configured' } };
  }
  try {
    await sql`select 1`.execute(meta.db);
    return { ok: true, version: APP_VERSION, checks: { meta: 'ok' } };
  } catch {
    // Deliberately not surfacing the driver's message: a connection error
    // routinely quotes the whole DSN ("password authentication failed for user
    // … host=…"), and this route is unauthenticated.
    return { ok: false, version: APP_VERSION, checks: { meta: 'unreachable' } };
  }
}

/**
 * Build/runtime info. `dialect` reports the connected meta store, or `null`
 * when the server booted without one (the wave-1 behavior the schema still
 * allows, and what a pre-bootstrap install looks like).
 */
export function systemInfo(dialect: MetaDialect | null = null): SystemInfoReply {
  return { version: APP_VERSION, node: process.version, dialect };
}
