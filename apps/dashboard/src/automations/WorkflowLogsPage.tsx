// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/workflow-logs` — every execution of every rule.
 *
 * The comp's layout, unchanged: four KPIs, then a `400px minmax(0,1fr)` grid
 * with the filtered run list on the left and one run's trace on the right
 * (Workflow Logs 82). The three things it does not draw, and why each is here:
 *
 *  - **A SEVEN-DAY WINDOW.** The comp calls its list "today" and has no date
 *    picker. Seven days is the smallest window that still answers "did it run
 *    over the weekend?", it bounds the query, and the filter counts are over
 *    the same window so the pills and the list can never disagree. A date
 * range is a residual, not an omission.
 *  - **A 5 s POLL.** The comp has a Refresh button and stops there. A run
 *    that is pending, running or waiting changes on its own, so the list
 *    re-reads while one is on screen and stops when none is (`queries.ts`).
 *    Refresh stays: it is the manual path, and the only one for a page whose
 *    rows have all finished.
 *  - **`?run=` IN THE URL.** A run is a thing an operator links a colleague
 *    to. Selection lives in the URL for the same reason the rules page's
 *    `?rule=` does, and a run selected outside the current filter still shows
 *    in the detail (comp 202's "selection persists").
 */

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';
import { Button } from '@adminium/ui';

import { t } from '../i18n/t.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { automationIcon } from './icons.js';
import { invalidateRuns, runQuery, runsQuery, runsStatsQuery } from './queries.js';
import type { RunFilter, RunRow } from './api.js';
import {
  FilterPills,
  LogsKpiStrip,
  RunDetail,
  RunList,
  formatDuration,
  type LogsKpi,
} from './logs/parts.js';

const PILL_KEYS = ['all', 'success', 'failed', 'running'] as const;
type PillKey = (typeof PILL_KEYS)[number];

const PILL_LABELS: Record<PillKey, { key: string; fallback: string }> = {
  all: { key: 'automations:logs.filter.all', fallback: 'All' },
  success: { key: 'automations:logs.filter.success', fallback: 'Success' },
  failed: { key: 'automations:logs.filter.failed', fallback: 'Failed' },
  running: { key: 'automations:logs.filter.running', fallback: 'Running' },
};

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export function WorkflowLogsPage(): ReactNode {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { run?: string; status?: string };

  const filter: PillKey = PILL_KEYS.includes(search.status as PillKey)
    ? (search.status as PillKey)
    : 'all';
  const params = useMemo(
    () => (filter === 'all' ? {} : { status: filter as RunFilter }),
    [filter],
  );

  const list = useInfiniteQuery(runsQuery(params));
  const stats = useQuery(runsStatsQuery());
  const runs: RunRow[] = useMemo(
    () => (list.data?.pages ?? []).flatMap((page) => page.runs),
    [list.data],
  );
  const selectedId = search.run ?? runs[0]?.id ?? null;
  const detail = useQuery(runQuery(selectedId));

  const now = Date.now();
  // The counts are over the whole seven-day window, not the loaded pages, so
  // the pills say the same thing however far somebody has scrolled.
  const counts = list.data?.pages[0]?.counts ?? { all: 0, success: 0, failed: 0, running: 0 };

  const kpis: LogsKpi[] = [
    {
      icon: 'zap',
      label: t('automations:logs.kpi.runsToday', 'Runs today'),
      value: String(stats.data?.runsToday ?? 0),
      tone: 'accent',
      valueClass: 'text-fg',
    },
    {
      icon: 'circle-check-big',
      label: t('automations:logs.kpi.success', 'Success rate'),
      value: percent(stats.data?.successRateToday ?? null),
      tone: 'pos',
      valueClass: 'text-pos',
    },
    {
      icon: 'circle-x',
      label: t('automations:logs.kpi.failed', 'Failed'),
      value: String(stats.data?.failedToday ?? 0),
      tone: 'danger',
      valueClass: 'text-danger',
    },
    {
      icon: 'timer',
      label: t('automations:logs.kpi.avgDuration', 'Avg. duration'),
      value: formatDuration(stats.data?.avgDurationMsToday ?? null),
      tone: 'warn',
      valueClass: 'text-fg',
    },
  ];

  const RefreshIcon = automationIcon('refresh-cw');

  const select = (id: string): void => {
    void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, run: id }) });
  };

  return (
    <PageSurface width="wide" className="mx-auto flex w-full max-w-[1280px] flex-col gap-[18px]">
      <PageActions
        title={t('automations:logs.title', 'Workflow logs')}
        subtitle={t('automations:logs.subtitle', 'Execution history for your automations.')}
      >
        <Button
          variant="ghost"
          onClick={() => {
            void invalidateRuns(queryClient);
          }}
        >
          <RefreshIcon aria-hidden className="size-[15px]" />
          {t('automations:logs.refresh', 'Refresh')}
        </Button>
      </PageActions>

      <LogsKpiStrip kpis={kpis} />

      {/* 400px minmax(0,1fr) as drawn (comp 82); stacked below 1080 px, which
          the comp does not draw and every other page in this product does. */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1080px]:grid-cols-[400px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <FilterPills
            label={t('automations:logs.title', 'Workflow logs')}
            active={filter}
            pills={PILL_KEYS.map((key) => ({
              key,
              label: t(PILL_LABELS[key].key, PILL_LABELS[key].fallback),
              count: counts[key],
            }))}
            onSelect={(key) => {
              void navigate({
                to: '.',
                search: (prev: Record<string, unknown>) => ({
                  ...prev,
                  status: key === 'all' ? undefined : key,
                }),
              });
            }}
          />
          <RunList
            runs={runs}
            selectedId={selectedId}
            onSelect={select}
            now={now}
            emptyTitle={
              filter === 'all'
                ? t('automations:logs.empty.title', 'No runs yet')
                : t('automations:logs.empty.filtered', 'No {status} runs in the last 7 days', {
                    status: t(PILL_LABELS[filter].key, PILL_LABELS[filter].fallback).toLowerCase(),
                  })
            }
            hasMore={list.hasNextPage}
            onLoadOlder={() => {
              void list.fetchNextPage();
            }}
          />
        </div>
        <RunDetail run={detail.data?.run ?? null} now={now} />
      </div>
    </PageSurface>
  );
}
