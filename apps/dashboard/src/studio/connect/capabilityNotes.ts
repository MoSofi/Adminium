// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-engine capability degradation copy (M9-T04, gap-analysis §2.1).
 *
 * The FACTS come from @adminium/engine's capability matrix (the same module
 * the adapters re-export their static capabilities from); this file only
 * translates note codes into wizard/remap copy so the UI never invents its
 * own claims about what an engine can do. Consumed by the connect wizard's
 * TestStep log, the TablesStep row-count column, and the remap editor's
 * source banner.
 */
import {
  capabilityNotesForSource,
  rowEstimateQualityForSource,
  SOURCE_ENGINES,
  type CapabilityNoteCode,
  type CapabilitySource,
  type RowEstimateQuality,
  type SourceEngine,
} from '@adminium/engine';

import { t } from '../../i18n/t.js';
import type { WizardState } from './wizardState.js';
import { effectiveEngine } from './wizardState.js';

export type { CapabilitySource, RowEstimateQuality };

/** The wizard's source, in capability-matrix vocabulary. */
export function wizardCapabilitySource(state: WizardState): CapabilitySource {
  if (state.mode === 'file') return { kind: 'import' };
  return { kind: 'live', engine: effectiveEngine(state) ?? 'postgres' };
}

/** A schema reply's source, in capability-matrix vocabulary (remap editor). */
export function modelCapabilitySource(model: { dialect: string; source?: { kind: string } }): CapabilitySource {
  if (model.source?.kind === 'import' || !(SOURCE_ENGINES as readonly string[]).includes(model.dialect)) {
    return { kind: 'import' };
  }
  return { kind: 'live', engine: model.dialect as SourceEngine };
}

export function capabilityNoteCopy(code: CapabilityNoteCode): string {
  switch (code) {
    case 'mysql-approximate-row-estimates':
      return t(
        'studio.capability.mysqlApproxRows',
        'MySQL row counts are storage-engine estimates (they can drift up to ±40%) — shown with ≈.',
      );
    case 'mysql-weaker-fk-enum-metadata':
      return t(
        'studio.capability.mysqlFkEnum',
        'MySQL FK/enum metadata is weaker: MyISAM tables declare no foreign keys, enums are per-column enum(…) types, and CHECK constraints need MySQL 8.0.16+ / MariaDB 10.2+.',
      );
    case 'sqlite-check-enum-synthesis':
      return t(
        'studio.capability.sqliteCheckEnums',
        'SQLite has no native enum type — enums are synthesized from CHECK (col IN (…)) constraints.',
      );
    case 'sqlite-no-comments':
      return t(
        'studio.capability.sqliteNoComments',
        'SQLite has no column comments — use the schema remap editor to add labels.',
      );
    case 'import-no-row-counts':
      return t(
        'studio.capability.importNoRowCounts',
        'Schema files carry no row counts — the tables list shows — instead of made-up numbers.',
      );
    case 'import-no-live-health':
      return t(
        'studio.capability.importNoLiveHealth',
        'No live database connection — health checks and schema-drift detection are unavailable for this source.',
      );
  }
}

/** Translated degradation notes for a source, in display order. */
export function capabilityNotes(source: CapabilitySource): string[] {
  return capabilityNotesForSource(source).map(capabilityNoteCopy);
}

/** Row-count trust level for the source (drives ≈ / — rendering). */
export function rowEstimateQuality(source: CapabilitySource): RowEstimateQuality {
  return rowEstimateQualityForSource(source);
}

/**
 * Why a row-count cell shows what it shows — tooltip copy for the em-dash
 * (missing counts) and the ≈ prefix (approximate counts). `null` = no
 * tooltip needed (a plain trustworthy estimate).
 */
export function rowEstimateTooltip(
  source: CapabilitySource,
  estimate: number | null,
): string | null {
  const quality = rowEstimateQualityForSource(source);
  if (quality === 'none') {
    return t(
      'studio.capability.rowsUnavailable',
      'Schema files have no live database — row counts are unknown until you connect one.',
    );
  }
  if (estimate === null) {
    if (source.kind === 'live' && source.engine === 'sqlite') {
      return t('studio.capability.rowsRunAnalyze', 'No estimate yet — run ANALYZE on the database for row counts.');
    }
    return t('studio.capability.rowsNoEstimate', 'The engine reported no estimate for this table.');
  }
  if (quality === 'approximate') {
    return t('studio.capability.rowsApproximate', 'Storage-engine estimate — can drift up to ±40% on InnoDB.');
  }
  return null;
}
