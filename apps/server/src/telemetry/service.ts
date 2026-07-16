/**
 * Telemetry client (M10-T04). OPT-IN: `telemetry.enabled` defaults to `false`
 * in the settings registry, so a fresh install reports nothing until someone
 * answers "yes" on the first-run consent screen (v0.5 exit criterion:
 * "Telemetry is opt-in (off by default)"). `ADMINIUM_TELEMETRY`, when set,
 * overrides that answer in both directions — see {@link TelemetryServiceDeps.envOverride}.
 *
 * It is CONSTRUCTED in `../compose.ts`, the composition root, and reported on
 * the croner scheduler that every other periodic job uses. (For a while it was
 * constructed nowhere but tests: the consent screen wrote a setting no code
 * read, so "Share anonymous usage data → yes" promised a behavior the build did
 * not implement. That failed safe, but a consent screen that does nothing is
 * still a lie.)
 *
 * The load-bearing property, asserted by `telemetry-network-isolation.test.ts`
 * with all outbound network disabled: when telemetry is off, `report()` makes
 * ZERO network calls. That is why the enabled check comes first and returns
 * before the payload is even built — there is no code path from a disabled
 * instance to `fetch`. See ./payload.ts for exactly what a consenting instance
 * sends (and what it never sends).
 */
import { settingsRepo, type MetaDb } from '@adminium/meta';

import { buildTelemetryPayload, type TelemetryEngine, type TelemetryPayload } from './payload.js';

/** Where consenting instances report. Overridable for tests/self-host mirrors. */
export const TELEMETRY_ENDPOINT = 'https://telemetry.adminium.ai/v1/ping';

export type TelemetryReport =
  | { sent: false; reason: 'disabled' | 'no-instance-id' | 'failed' }
  | { sent: true; payload: TelemetryPayload };

export interface TelemetryServiceDeps {
  meta: MetaDb;
  /** The running build (apps/server package.json). */
  version: string;
  endpoint?: string | undefined;
  /**
   * `ADMINIUM_TELEMETRY`, tri-state. Set ⇒ the ENVIRONMENT WINS OUTRIGHT over
   * the stored consent, in both directions (01 §7.2 "environment always wins");
   * `undefined` (unset) ⇒ the `telemetry.enabled` setting decides, which is the
   * normal self-host case.
   *
   * The variable was documented as the kill-switch and read by nothing: an org
   * that set `ADMINIUM_TELEMETRY=off` to enforce a no-phone-home policy had no
   * protection at all once any user answered "yes" on the first-run consent
   * screen. Since the operator who controls the process environment outranks the
   * person clicking through the wizard, `off` is now a real veto.
   */
  envOverride?: boolean | undefined;
  /** Injected so tests can observe calls; defaults to the global fetch. */
  fetchImpl?: typeof globalThis.fetch | undefined;
  now?: (() => number) | undefined;
}

export interface TelemetryService {
  /** The single gate: `ADMINIUM_TELEMETRY` if set, else `telemetry.enabled`. No network. */
  isEnabled(): Promise<boolean>;
  /**
   * The exact document `report()` would send, for the About/consent screens to
   * show ("here is what leaves this instance"). `null` when disabled.
   */
  preview(): Promise<TelemetryPayload | null>;
  /** No-op returning `{ sent: false, reason: 'disabled' }` when opted out. */
  report(): Promise<TelemetryReport>;
}

export function createTelemetryService(deps: TelemetryServiceDeps): TelemetryService {
  const { meta, version } = deps;
  const endpoint = deps.endpoint ?? TELEMETRY_ENDPOINT;
  const now = deps.now ?? (() => Date.now());
  const settings = settingsRepo(meta);

  async function isEnabled(): Promise<boolean> {
    // The env veto is checked FIRST and short-circuits the settings read, so an
    // `ADMINIUM_TELEMETRY=off` instance does not even touch the meta store to
    // decide — and, more importantly, cannot reach `fetch` by any path.
    if (deps.envOverride !== undefined) return deps.envOverride;
    return settings.get('telemetry.enabled');
  }

  async function build(): Promise<TelemetryPayload | null> {
    // `settings.get` can THROW rather than return, so this is not a redundant
    // null-check wrapper: on a Postgres meta store, reading any string-valued
    // setting currently raises a SyntaxError (`repos/util.ts` readJson
    // JSON.parses a jsonb value pg has already decoded — a pre-existing
    // cross-engine bug, not this module's). `system.instanceId` is
    // string-valued, so an opted-in Postgres instance would hit it. Telemetry
    // is never load-bearing: it degrades to "nothing to report" rather than
    // turning a background report into an unhandled rejection.
    let instanceId: string | null;
    try {
      instanceId = await settings.get('system.instanceId');
    } catch {
      return null;
    }
    if (instanceId === null) return null; // never bootstrapped — nothing to say

    // `engine` ONLY — deliberately not `connectionsRepo`, which would hand us
    // a DsnCrypto and rows carrying encrypted DSNs. Selecting the single
    // column makes it structurally impossible for connection material to reach
    // the payload builder, rather than merely unlikely (07 §3.13).
    const rows = await meta.db.selectFrom('adminium_connections').select('engine').execute();

    return buildTelemetryPayload({
      instanceId,
      version,
      metaEngine: meta.dialect as TelemetryEngine,
      sourceEngines: rows.map((row) => row.engine),
      sentAt: now(),
    });
  }

  return {
    isEnabled,

    async preview(): Promise<TelemetryPayload | null> {
      if (!(await isEnabled())) return null;
      return build();
    },

    async report(): Promise<TelemetryReport> {
      // FIRST, and before anything can touch the network: opted out ⇒ return.
      if (!(await isEnabled())) return { sent: false, reason: 'disabled' };

      const payload = await build();
      if (payload === null) return { sent: false, reason: 'no-instance-id' };

      const doFetch = deps.fetchImpl ?? globalThis.fetch;
      try {
        const response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) return { sent: false, reason: 'failed' };
        return { sent: true, payload };
      } catch {
        // Telemetry is never load-bearing: an unreachable endpoint must not
        // surface to the operator or fail a request.
        return { sent: false, reason: 'failed' };
      }
    },
  };
}
