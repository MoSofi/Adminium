// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The telemetry payload (M10-T04) — the EXACT and complete document a
 * consenting instance ever sends. Documented here because "what is sent" is a
 * promise, not an implementation detail: the first-run consent screen renders
 * this same list (dashboard `TelemetryConsent`), and `telemetry-payload.test.ts`
 * pins the key set so the shape cannot drift without a failing test.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS SENT (all of it):
 *   schemaVersion  1                          — envelope version
 *   instanceId     random UUIDv4              — seeded at bootstrap
 *                                               (`system.instanceId`); not
 *                                               derived from any host, user,
 *                                               network or database identity,
 *                                               so it cannot be reversed into
 *                                               one. Reset it and the instance
 *                                               is a new anonymous instance.
 *   version        e.g. "0.5.0"               — the running Adminium build
 *   metaEngine     postgres|mysql|sqlite      — meta-store ENGINE TYPE only
 *   sourceEngines  ["postgres","sqlite"]      — distinct connected ENGINE
 *                                               TYPES, deduped + sorted. A
 *                                               closed vocabulary; never a
 *                                               count, name, host or DSN.
 *   sentAt         epoch ms
 *
 * WHAT IS NEVER SENT — no schema content (no table/column/enum names), no row
 * data, no connection strings/hosts/credentials, no user identities (emails,
 * names, ids), no page/widget configs, no LLM run contents or prompts. The BYO
 * promise in 06-llm-assist.md §9 — that BYO runs are never reported — holds
 * because nothing about any LLM run has a field to travel in: the payload is
 * built from a fixed allow-list below, never by spreading a wider object.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Meta/source engine identifiers (07-meta-store.md); a closed vocabulary. */
export const TELEMETRY_ENGINES = ['postgres', 'mysql', 'sqlite'] as const;
export type TelemetryEngine = (typeof TELEMETRY_ENGINES)[number];

export interface TelemetryPayload {
  schemaVersion: 1;
  instanceId: string;
  version: string;
  metaEngine: TelemetryEngine;
  sourceEngines: TelemetryEngine[];
  sentAt: number;
}

/**
 * The complete key set of {@link TelemetryPayload}. The builder emits exactly
 * these and the test asserts equality both ways, so adding a field to the
 * interface without deciding it is safe to disclose fails CI.
 */
export const TELEMETRY_PAYLOAD_KEYS: readonly string[] = [
  'schemaVersion',
  'instanceId',
  'version',
  'metaEngine',
  'sourceEngines',
  'sentAt',
];

export interface TelemetryPayloadInput {
  instanceId: string;
  version: string;
  metaEngine: TelemetryEngine;
  /** Raw engine strings off `adminium_connections.engine`; filtered below. */
  sourceEngines: readonly string[];
  sentAt: number;
}

function isTelemetryEngine(value: string): value is TelemetryEngine {
  return (TELEMETRY_ENGINES as readonly string[]).includes(value);
}

/**
 * Builds the payload by NAMING every field (never by spreading input), so an
 * unrelated object growing a sensitive field can never widen what is sent.
 * Unknown engine strings are dropped rather than passed through — the wire
 * vocabulary stays closed even if a future adapter registers a new id.
 */
export function buildTelemetryPayload(input: TelemetryPayloadInput): TelemetryPayload {
  const sourceEngines = [...new Set(input.sourceEngines.filter(isTelemetryEngine))].sort();
  return {
    schemaVersion: 1,
    instanceId: input.instanceId,
    version: input.version,
    metaEngine: input.metaEngine,
    sourceEngines,
    sentAt: input.sentAt,
  };
}
