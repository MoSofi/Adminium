// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-engine capability matrix — 05-introspection-engine.md §2.1/§4,
 * research/gap-analysis.md §2.1 (M9-T04).
 *
 * The canonical static dialect-level `AdapterCapabilities` per source engine.
 * Adapter packages re-export their slice (`POSTGRES_CAPABILITIES` etc. are
 * `ENGINE_CAPABILITY_MATRIX.<dialect>`) so the wizard, the remap editor, and
 * the adapters all degrade from the SAME facts; per-connection probes refine
 * these at runtime (e.g. MariaDB 10.5+ RETURNING) but never contradict the
 * static shape shown during setup.
 *
 * Alongside the raw flags, this module derives DEGRADATION NOTES — stable
 * codes for the honesty copy Studio shows ("MySQL row counts are estimates",
 * "SQLite enums are synthesized from CHECK constraints", "schema files have
 * no live health"). Codes, not copy: user-facing text lives behind the
 * dashboard's i18n layer.
 */
import type { AdapterCapabilities } from './schema-model.js';

/** Engines a live connection can use ('generic' is import-only). */
export const SOURCE_ENGINES = ['postgres', 'mysql', 'sqlite'] as const;
export type SourceEngine = (typeof SOURCE_ENGINES)[number];

/**
 * Where a model's metadata came from, for degradation purposes: a live
 * engine connection or a parsed schema file (no live database at all).
 */
export type CapabilitySource =
  | { kind: 'live'; engine: SourceEngine }
  | { kind: 'import' };

/** Static dialect capabilities — 05 §4.1 (probe refines per-connection). */
const POSTGRES: AdapterCapabilities = {
  hasEnums: true,
  hasFKs: true,
  hasSchemas: true,
  hasComments: true,
  hasChecks: true,
  hasRLS: true,
  hasMaterializedViews: true,
  hasRowEstimates: true,
  supportsStatementTimeout: true,
  supportsReturning: true,
  maxIdentifierLength: 63,
};

/** 05 §4.2 — MySQL 8 / MariaDB 10.5+. */
const MYSQL: AdapterCapabilities = {
  hasEnums: true, // column enums: enum('a','b') — 05 §2.1
  hasFKs: true, // false per-table for MyISAM (warning emitted)
  hasSchemas: false,
  hasComments: true,
  hasChecks: true, // 8.0.16+/10.2+ — feature-detected, degrades with a warning
  hasRLS: false,
  hasMaterializedViews: false,
  hasRowEstimates: true, // TABLE_ROWS — InnoDB estimates drift, display with ≈
  supportsStatementTimeout: true,
  supportsReturning: false, // MySQL mutate re-selects; MariaDB 10.5+ detected at runtime
  maxIdentifierLength: 64,
};

/** 05 §4.3 — SQLite ≥ 3.35 (file-path connections; the Electron engine). */
const SQLITE: AdapterCapabilities = {
  hasEnums: false, // CHECK synthesis only — 05 §4.3
  hasFKs: true,
  hasSchemas: false,
  hasComments: false, // no comment syntax — Studio remap is the labeling path
  hasChecks: true,
  hasRLS: false,
  hasMaterializedViews: false,
  hasRowEstimates: true, // sqlite_stat1 / small-file exact counts
  supportsStatementTimeout: false, // worker termination is the timeout story
  supportsReturning: true, // SQLite ≥ 3.35 (minimum supported — 05 §4.3)
  maxIdentifierLength: 128,
};

/**
 * Baseline for schema-file imports — 05 §5.2: parsers refine per-format
 * (e.g. Prisma `///` comments), but no import ever has live row estimates,
 * RLS, or health/drift signals.
 */
const IMPORT: AdapterCapabilities = {
  hasEnums: true,
  hasFKs: true,
  hasSchemas: false,
  hasComments: false,
  hasChecks: false,
  hasRLS: false,
  hasMaterializedViews: false,
  hasRowEstimates: false,
  supportsStatementTimeout: false,
  supportsReturning: false,
  maxIdentifierLength: 128,
};

/** The matrix (gap-analysis §2.1): one column per live engine. */
export const ENGINE_CAPABILITY_MATRIX: Readonly<Record<SourceEngine, AdapterCapabilities>> = {
  postgres: POSTGRES,
  mysql: MYSQL,
  sqlite: SQLITE,
};

/** Import baseline (see above) — exported for parsers and the wizard. */
export const IMPORT_BASE_CAPABILITIES: AdapterCapabilities = IMPORT;

/** Static capabilities for a source (live engine column or import baseline). */
export function capabilitiesForSource(source: CapabilitySource): AdapterCapabilities {
  return source.kind === 'live' ? ENGINE_CAPABILITY_MATRIX[source.engine] : IMPORT_BASE_CAPABILITIES;
}

// ---------------------------------------------------------------------------
// Degradation notes
// ---------------------------------------------------------------------------

/**
 * Stable degradation-note codes. The dashboard maps each to translated copy;
 * anything not listed for a source needs no caveat there.
 */
export const CAPABILITY_NOTE_CODES = [
  /** TABLE_ROWS drifts up to ±40% on InnoDB — always display with ≈ (05 §4.2). */
  'mysql-approximate-row-estimates',
  /** MyISAM tables carry no FKs; enums are column-typed; CHECKs need 8.0.16+/10.2+ (05 §4.2). */
  'mysql-weaker-fk-enum-metadata',
  /** No native enum type — enums are synthesized from CHECK (col IN (…)) (05 §4.3). */
  'sqlite-check-enum-synthesis',
  /** No comment syntax — the remap editor is the labeling path (05 §4.3). */
  'sqlite-no-comments',
  /** Imports carry no row counts — placeholder seeding happens downstream (05 §5.2). */
  'import-no-row-counts',
  /** No live connection: health checks, drift detection and probes unavailable. */
  'import-no-live-health',
] as const;
export type CapabilityNoteCode = (typeof CAPABILITY_NOTE_CODES)[number];

/**
 * Degradation notes for a source, derived from the matrix flags where the
 * flags express the fact, with the per-engine specials (estimate drift,
 * MyISAM) keyed explicitly. Order = display order.
 */
export function capabilityNotesForSource(source: CapabilitySource): CapabilityNoteCode[] {
  const caps = capabilitiesForSource(source);
  const notes: CapabilityNoteCode[] = [];
  if (source.kind === 'import') {
    if (!caps.hasRowEstimates) notes.push('import-no-row-counts');
    notes.push('import-no-live-health');
    return notes;
  }
  if (source.engine === 'mysql') {
    if (caps.hasRowEstimates) notes.push('mysql-approximate-row-estimates');
    notes.push('mysql-weaker-fk-enum-metadata');
  }
  if (source.engine === 'sqlite') {
    if (!caps.hasEnums && caps.hasChecks) notes.push('sqlite-check-enum-synthesis');
    if (!caps.hasComments) notes.push('sqlite-no-comments');
  }
  return notes;
}

/**
 * How trustworthy `rowCountEstimate` is for a source — drives the wizard's
 * row-count column: 'estimate' renders plain, 'approximate' with a leading ≈,
 * 'none' as an em-dash with an explanation (never wrong data).
 */
export type RowEstimateQuality = 'estimate' | 'approximate' | 'none';

export function rowEstimateQualityForSource(source: CapabilitySource): RowEstimateQuality {
  const caps = capabilitiesForSource(source);
  if (!caps.hasRowEstimates) return 'none';
  if (source.kind === 'live' && source.engine === 'mysql') return 'approximate';
  return 'estimate';
}
