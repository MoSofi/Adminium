/** Handlers for the system resource (08-server-api.md §1.2 route-module layout). */
import { settingsRepo, type MetaDb } from '@adminium/meta';
import { sql } from 'kysely';

import type { Env } from '../../config/env.js';
import { demoSeedAvailable } from '../../desktop/demo-seed.js';
import { lanShareActive } from '../../desktop/lan-share.js';
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

export interface SystemInfoDeps {
  env: Env;
  /** `null` when the server booted without a meta store; every field stays answerable. */
  meta: MetaDb | null;
}

/**
 * Build/runtime info + the §8.2 capability flags (11-electron.md §8.1/§8.2).
 * `dialect` reports the connected meta store, or `null` when the server booted
 * without one (the wave-1 behavior the schema still allows, and what a
 * pre-bootstrap install looks like).
 *
 * NO FLAG HERE IS A CONSTANT. `runtime`, `networkFeaturesAllowed` and `lanShare`
 * come off the environment this process was booted with, `smtpConfigured` off
 * the meta store — which is why this is async, and why it is worth the one
 * indexed primary-key read per call rather than a value baked at compose time:
 * SMTP is editable from Settings, so a cached answer would leave the "Configure
 * SMTP to send email" state showing on a page whose Send button now works.
 *
 * `lanShare` is env-derived and therefore constant for a process lifetime — but
 * that is the whole truth of it, not a limitation: §8.3 applies the toggle by
 * RE-FORKING this process (`config.json` → `ADMINIUM_HOST` → a new child), so a
 * change of answer and a change of process are the same event. There is no
 * moment at which a fresh read here would say something this boot's environment
 * does not.
 *
 * The no-meta case is not a degradation to paper over: without a meta store the
 * `email.smtp` setting does not exist, so email genuinely cannot send, and
 * `false` is the correct answer rather than an "unknown" the SPA would have to
 * invent a third state for.
 */
export async function systemInfo(deps: SystemInfoDeps): Promise<SystemInfoReply> {
  const { env, meta } = deps;
  return {
    version: APP_VERSION,
    node: process.version,
    dialect: meta?.dialect ?? null,
    runtime: env.ADMINIUM_RUNTIME,
    smtpConfigured: await smtpConfigured(meta),
    networkFeaturesAllowed: env.ADMINIUM_NETWORK_FEATURES,
    lanShare: lanShareActive(env),
    // The SAME predicate compose registers the route on — see `demo-seed.ts`.
    desktopDemo: demoSeedAvailable(env),
  };
}

/**
 * Is `adminium_settings.email.smtp` set?
 *
 * THE TRY/CATCH IS THE POINT, and it is the same argument {@link readyz} makes
 * one function up. This route was a pure function until the §8.2 flags arrived;
 * adding a database read to it means a meta-store blip — or one row of stored
 * JSON that no longer parses — can now throw, and an unhandled throw here costs
 * the caller the WHOLE reply, including `runtime` and `networkFeaturesAllowed`,
 * which come off the environment and were never in doubt.
 *
 * That is not a hypothetical inconvenience: `/system/info` is unauthenticated
 * precisely so pre-auth screens can ask it, and `/forgot` disables its Send
 * button when it cannot get an answer. A 500 here would take password reset down
 * with the settings table.
 *
 * `false` on failure is the same answer the no-meta case gives, and it is the
 * conservative one: it offers an explanation instead of a Send button that drops
 * mail. The log line is what stops it from being a silent lie to the operator.
 */
async function smtpConfigured(meta: MetaDb | null): Promise<boolean> {
  if (meta === null) return false;
  try {
    return (await settingsRepo(meta).get('email.smtp')) !== null;
  } catch {
    // Deliberately not surfacing the driver's message — same reason readyz
    // does not: a connection error routinely quotes the whole DSN, and this
    // route is unauthenticated.
    return false;
  }
}
