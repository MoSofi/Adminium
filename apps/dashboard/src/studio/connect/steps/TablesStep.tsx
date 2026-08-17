// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 4 — table inclusion (M5-T02, 09 §8.2 step 3): every introspected
 * table with mono row-count estimates and PII warn badges; high-volume
 * tables (> 100k rows, 05) start UNCHECKED; join/system tables are
 * pre-hidden with an explanatory note; search filter; `{included}/{total}`
 * counter. Selection persists to `adminium_connections.settings.includedTables`
 * on Continue (wizard-level PATCH).
 *
 * M9-T04: the row-count column degrades per source instead of showing wrong
 * data — MySQL estimates render with ≈ (InnoDB drift), schema files render —
 * (no live database), both explained by a tooltip.
 *
 * M7 Wave 4: the checklist itself is `@adminium/widgets`'
 * `TableInclusionChecklist` — the annex §10 `table-inclusion-checklist` widget's
 * presentational half — and the >100k rule behind the default selection is that
 * widget's rule too. This step used to own both. What stays here is what the
 * widget cannot know: the query, the search filter, the per-source row-count
 * degradation (passed in as `renderRowMeta`), and the explanatory notes.
 */
import { useQuery } from '@tanstack/react-query';
import { EyeOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { TableInclusionChecklist } from '@adminium/widgets';
import { MonoText, SearchInput, Skeleton, Tooltip } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import { studioApi, type SchemaTable } from '../../api.js';
import { rowEstimateQuality, rowEstimateTooltip, type CapabilitySource } from '../capabilityNotes.js';
import {
  defaultIncludedIds,
  formatRowEstimate,
  summarizeTables,
  type WizardTable,
} from '../wizardState.js';

export interface TablesStepProps {
  /** Live connection (created in step 3) — null in schema-file mode. */
  connectionId: string | null;
  /** Parsed tables for schema-file mode. */
  fileTables: SchemaTable[] | null;
  /** What the tables came from — drives row-count degradation (M9-T04). */
  source: CapabilitySource;
  included: string[] | null;
  onIncludedChange: (included: string[]) => void;
}

export function TablesStep({ connectionId, fileTables, source, included, onIncludedChange }: TablesStepProps) {
  const [query, setQuery] = useState('');

  const schemaQuery = useQuery({
    queryKey: ['studio', 'schema', connectionId] as const,
    enabled: connectionId !== null,
    queryFn: async () => (connectionId === null ? null : studioApi.getSchema(connectionId)),
    staleTime: 30_000,
  });

  const sourceTables: SchemaTable[] | null =
    connectionId !== null ? (schemaQuery.data?.model.tables ?? null) : fileTables;
  const tables: WizardTable[] = useMemo(
    () => (sourceTables === null ? [] : summarizeTables(sourceTables)),
    [sourceTables],
  );
  const visible = tables.filter((table) => !table.preHidden);
  const hiddenCount = tables.length - visible.length;

  // First render with data: apply the default-inclusion rule once.
  const selected = useMemo(() => {
    if (included !== null) return new Set(included);
    return new Set(defaultIncludedIds(tables));
  }, [included, tables]);

  // Push the computed default up so Continue persists it even untouched
  // (high-volume unchecked must reach settings.includedTables — M5-T02).
  useEffect(() => {
    if (included === null && tables.length > 0) {
      onIncludedChange(defaultIncludedIds(tables).sort());
    }
  }, [included, tables, onIncludedChange]);

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onIncludedChange([...next].sort());
  };

  const filtered = visible.filter((table) => table.id.toLowerCase().includes(query.trim().toLowerCase()));

  if (connectionId !== null && schemaQuery.isPending) {
    return (
      <section aria-label={t('studio.tables.title', 'Choose your tables')} className="flex flex-col gap-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </section>
    );
  }

  return (
    <section aria-label={t('studio.tables.title', 'Choose your tables')} className="flex flex-col gap-4">
      <div>
        <h2 className="text-section text-fg">{t('studio.tables.title', 'Choose your tables')}</h2>
        <p className="mt-1 text-body-sm text-fg-muted">
          {t('studio.tables.subtitle', 'Choose which to include. You can change this anytime.')}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t('studio.tables.search', 'Filter tables…')}
          aria-label={t('studio.tables.search', 'Filter tables…')}
          className="flex-1"
        />
        <MonoText className="shrink-0 text-body-sm text-fg-muted">{`${selected.size}/${visible.length}`}</MonoText>
      </div>

      <TableInclusionChecklist
        tables={filtered}
        selected={selected}
        onToggle={toggle}
        piiLabel={t('studio.tables.pii', 'PII')}
        highVolumeLabel={t('studio.tables.highVolume', 'high volume')}
        // The list gets its OWN name, narrower than the enclosing <section>'s.
        // Reusing the step title here would give two nested landmarks the same
        // accessible name ("Choose your tables, region" then "Choose your
        // tables, list"), which distinguishes neither.
        a11yLabel={t('studio.tables.listLabel', 'Includable tables')}
        // The counter lives next to the search box on this screen, so the
        // widget's own header count would be a second copy of it.
        emptyContent={t('studio.tables.emptyFilter', 'No tables match your filter.')}
        renderRowMeta={(table) => <RowEstimateCell source={source} estimate={table.rowEstimate} />}
      />

      <div className="flex flex-col gap-1">
        {source.kind === 'import' ? (
          <p className="text-caption text-fg-subtle">
            {t('studio.tables.importNoCounts', 'Schema files carry no row counts — the column shows — until a live database is connected.')}
          </p>
        ) : null}
        <p className="text-caption text-fg-subtle">
          {t('studio.tables.highVolumeNote', 'Tables over 100,000 rows start unchecked — ops tables rarely belong in a dashboard.')}
        </p>
        {hiddenCount > 0 ? (
          <p className="flex items-center gap-1.5 text-caption text-fg-subtle">
            <EyeOff aria-hidden="true" className="size-3.5" />
            {t('studio.tables.joinHidden', '{count} join/system tables are pre-hidden — they still power many-to-many relations.', { count: String(hiddenCount), })}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Row-count cell with per-source degradation (M9-T04): `—` when the source
 * cannot provide counts, `≈` when the engine only estimates approximately —
 * each explained by a tooltip rather than presented as exact data.
 */
function RowEstimateCell({ source, estimate }: { source: CapabilitySource; estimate: number | null }) {
  const text = formatRowEstimate(estimate, rowEstimateQuality(source));
  const tooltip = rowEstimateTooltip(source, estimate);
  const cell = (
    <MonoText className="w-24 shrink-0 text-end text-body-sm text-fg-muted">{text}</MonoText>
  );
  if (tooltip === null) return cell;
  return (
    <Tooltip content={tooltip}>
      <span className="flex w-24 shrink-0 justify-end" tabIndex={0}>
        <MonoText className="text-end text-body-sm text-fg-muted">{text}</MonoText>
      </span>
    </Tooltip>
  );
}
