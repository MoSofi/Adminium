/**
 * `auto-insights` (annex §1) — a short RANKED list of generated insights:
 * sparkles/tone icon, bold stat + sentence, and a mini sparkline; plus the
 * card-grid variant with tone icon + category tag + recommendation prose and a
 * Refresh that rotates the visible window through the pool. Renders only the
 * loaded state — skeleton/empty/error are WidgetFrame's job.
 *
 * NOT AN LLM CALL. The annex's "AI-flavoured" framing describes where the
 * sentences come from UPSTREAM (heuristics or an offline LLM pass over table
 * stats, materialised into the bound table) — this widget never calls a model at
 * render time. It ranks the bound rows by `scoreField` and renders their copy.
 * That keeps it deterministic, offline-safe, server-renderable for scheduled
 * reports, and free of a per-render token cost.
 *
 * Refresh rotates a LOCAL window offset over the already-bound pool — it does not
 * refetch. Re-querying is `refreshInterval` / the host's job (04 §5); rotating
 * locally is what the annex's "Refresh rotation" describes and costs nothing.
 */

import { IconTile, MonoText, Tag } from '@adminium/ui';
import { RotateCw } from 'lucide-react';
import { Sparkline } from '@adminium/charts';
import { useMaybeT } from '@adminium/i18n/react';
import { useState } from 'react';

import { insightIcon } from './kpi-icons.js';
import { insightIconOf, toneOf } from './kpi-lib.js';
import type { AutoInsightsConfig } from './kpi-config.js';
import type { InsightIcon } from './kpi-lib.js';
import type { Tone } from '@adminium/ui';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `kpi-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { autoInsightsConfigSchema, autoInsightsDemoData } from './kpi-config.js';
export type { AutoInsightsConfig } from './kpi-config.js';

export interface Insight {
  id: string;
  icon: InsightIcon;
  tone: Tone;
  tag?: string | undefined;
  title: string;
  body?: string | undefined;
  spark?: number[] | undefined;
  href?: string | undefined;
  score?: number | undefined;
}

function stringAt(row: Record<string, unknown>, field: string): string | undefined {
  const raw = row[field];
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

function numberAt(row: Record<string, unknown>, field: string): number | undefined {
  const raw = row[field];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Project the bound `record-list` onto ranked insights (04 §5 field naming).
 * Ranking is by `scoreField` DESCENDING; rows without a score keep their query
 * order behind the scored ones (a stable sort, so the annex's "ranked list" is
 * honest even on a partially-scored pool). Rows without a title are dropped —
 * an insight with no sentence has nothing to say.
 */
export function insightsOf(
  data: unknown,
  config: Pick<
    AutoInsightsConfig,
    | 'idField'
    | 'iconField'
    | 'toneField'
    | 'tagField'
    | 'titleField'
    | 'bodyField'
    | 'sparkField'
    | 'hrefField'
    | 'scoreField'
    | 'pool'
  >,
): Insight[] {
  const rows =
    typeof data === 'object' && data !== null && Array.isArray((data as { rows?: unknown }).rows)
      ? ((data as { rows: unknown[] }).rows as unknown[])
      : [];

  const insights: Insight[] = [];
  for (const [index, entry] of rows.entries()) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const title = stringAt(row, config.titleField);
    if (title === undefined) continue;
    const rawSpark = row[config.sparkField];
    const spark = Array.isArray(rawSpark)
      ? rawSpark.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      : undefined;
    insights.push({
      id: stringAt(row, config.idField) ?? `insight-${index}`,
      icon: insightIconOf(row[config.iconField]),
      tone: toneOf(row[config.toneField]),
      tag: stringAt(row, config.tagField),
      title,
      body: stringAt(row, config.bodyField),
      spark: spark !== undefined && spark.length > 0 ? spark : undefined,
      href: stringAt(row, config.hrefField),
      score: numberAt(row, config.scoreField),
    });
  }

  // Stable rank: scored rows descending, unscored rows after them in query order.
  const ranked = insights
    .map((insight, index) => ({ insight, index }))
    .sort((a, b) => {
      const sa = a.insight.score;
      const sb = b.insight.score;
      if (sa === undefined && sb === undefined) return a.index - b.index;
      if (sa === undefined) return 1;
      if (sb === undefined) return -1;
      return sb === sa ? a.index - b.index : sb - sa;
    })
    .map(({ insight }) => insight);

  return ranked.slice(0, config.pool);
}

/** The visible window, wrapping around the pool (Refresh advances `offset`). */
export function visibleWindow(insights: readonly Insight[], offset: number, count: number): Insight[] {
  if (insights.length === 0) return [];
  const size = Math.min(count, insights.length);
  return Array.from({ length: size }, (_, i) => insights[(offset + i) % insights.length] as Insight);
}

function InsightRow({
  insight,
  applyLabel,
  onApply,
  card,
}: {
  insight: Insight;
  applyLabel: string | undefined;
  onApply: (insight: Insight) => void;
  card: boolean;
}) {
  return (
    <div
      data-part={card ? 'insight-card' : 'insight-row'}
      data-tone={insight.tone}
      className={
        card
          ? 'flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3'
          : 'flex items-start gap-2.5'
      }
    >
      <div className="flex items-start gap-2.5">
        <IconTile tone={insight.tone} size="sm" icon={insightIcon(insight.icon)} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {insight.tag === undefined ? null : (
            <Tag tone={insight.tone} className="self-start">
              {insight.tag}
            </Tag>
          )}
          <p className="text-body-sm font-bold leading-snug text-fg">{insight.title}</p>
          {insight.body === undefined ? null : (
            <p className="text-caption leading-snug text-fg-muted">{insight.body}</p>
          )}
        </div>
        {insight.spark === undefined || card ? null : (
          <Sparkline data={insight.spark} variant="line" width={56} height={22} className="mt-0.5 shrink-0" />
        )}
      </div>
      {card && insight.spark !== undefined ? (
        <Sparkline data={insight.spark} variant="line" width={120} height={24} className="w-full" />
      ) : null}
      {applyLabel === undefined ? null : (
        <button
          type="button"
          onClick={() => onApply(insight)}
          className="self-start text-caption font-bold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {applyLabel}
        </button>
      )}
    </div>
  );
}

/** Card-grid columns — a lookup table so Tailwind sees the class literals. */
const GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
};

export function AutoInsights({ config, data, onEvent }: WidgetProps<AutoInsightsConfig>) {
  const t = useMaybeT();
  const [offset, setOffset] = useState(0);
  const insights = insightsOf(data, config);
  const visible = visibleWindow(insights, offset, config.count);

  if (visible.length === 0) {
    return <p className="px-[var(--widget-pad)] pb-[var(--widget-pad)] text-body-sm text-fg-muted">Unexpected data shape.</p>;
  }

  // Rotating past the pool's end is pointless when everything already fits.
  const canRotate = config.refreshable && insights.length > config.count;

  const apply = (insight: Insight): void => {
    const href = insight.href ?? config.href;
    if (href !== undefined) onEvent({ type: 'drill-through', href });
  };

  return (
    <div
      className="flex h-full flex-col gap-3 overflow-y-auto px-[var(--widget-pad)] pb-[var(--widget-pad)] compact:gap-2"
      data-widget="auto-insights"
      data-variant={config.variant}
    >
      {canRotate ? (
        <div className="flex justify-end">
          <button
            type="button"
            data-part="insights-refresh"
            onClick={() => setOffset((current) => (current + config.count) % insights.length)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-caption font-bold text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <RotateCw className="size-3" aria-hidden="true" />
            {config.refreshLabel ?? t('ui:widgets.kpi.autoInsights.refreshLabel', 'Refresh')}
          </button>
        </div>
      ) : null}

      <div
        className={
          config.variant === 'cards'
            ? `grid gap-2.5 ${GRID_COLUMNS[config.columns] ?? 'grid-cols-2'}`
            : 'flex flex-col gap-3'
        }
      >
        {visible.map((insight) => (
          <InsightRow
            key={insight.id}
            insight={insight}
            applyLabel={config.applyLabel}
            onApply={apply}
            card={config.variant === 'cards'}
          />
        ))}
      </div>

      {/* Pool position — the mono counter makes the rotation legible. */}
      {canRotate ? (
        <MonoText data-part="insights-position" className="text-micro text-fg-subtle">
          {`${Math.floor(offset / config.count) + 1}/${Math.ceil(insights.length / config.count)}`}
        </MonoText>
      ) : null}
    </div>
  );
}
