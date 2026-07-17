/**
 * Is the §6 demo database available in this build (11-electron.md §6 step 2
 * card 4)?
 *
 * ─── ONE PREDICATE, TWO CALLERS, AND THAT IS THE ENTIRE POINT ────────────────
 *
 * `compose.ts` decides whether to REGISTER `POST /desktop/demo-database`;
 * `routes/system/handlers.ts` reports `desktopDemo` on `GET /system/info`, which
 * is what the first-run wizard gates its fourth source card on. Those two must
 * answer identically or the product lies in one of two directions: a card that
 * 404s when clicked, or a card that explains it is unavailable while the route
 * sits there working.
 *
 * Both conditions are load-bearing, and `compose.ts` already says why: the
 * runtime, because self-host and Docker have no demo; the script path, because a
 * desktop boot without `ADMINIUM_DEMO_SEED_SCRIPT` has nothing to run. This
 * module exists so neither caller can restate them and get one wrong.
 */

import type { Env } from '../config/env.js';

export function demoSeedScriptPath(env: Env): string | null {
  if (env.ADMINIUM_RUNTIME !== 'desktop') return null;
  return env.ADMINIUM_DEMO_SEED_SCRIPT ?? null;
}

/** True ⇔ `POST /api/v1/desktop/demo-database` is mounted on this process. */
export function demoSeedAvailable(env: Env): boolean {
  return demoSeedScriptPath(env) !== null;
}
