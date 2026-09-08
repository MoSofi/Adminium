// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workflow Logs, part by part (`designs/Workflow Logs.dc.html` 73-128,
 * 189-228; 42-automations-and-workflow-logs.md §4.2, 42-T24).
 *
 * Four pieces, each mapped to its lines of the comp: the KPI strip (73-80),
 * the four filter pills (84-86), the run list (87-98) and the detail with its
 * execution trace (101-128). They live in one file because they are one
 * screen's worth of markup and none of them is reusable anywhere else — the
 * comp's own structure, not a component library.
 *
 * DEPARTURE D9 runs through all four: the product has seven run statuses
 * where the comp draws three. "Running" is the filter word for pending +
 * running + waiting, and `skipped` / `cancelled` appear under All with the
 * trace's own `minus` glyph. `model/vocabulary.ts` holds the mapping so the
 * two pages cannot disagree about it.
 */

import type { ReactNode } from 'react';
import { EmptyState } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { automationIcon } from '../icons.js';
import type { RunRow, RunView, TraceStep } from '../api.js';
import { STATUS_META, STEP_META, type RunStatus } from '../model/vocabulary.js';

// --- shared formatting ------------------------------------------------------

/** `820ms` / `2.4s` — the comp's own two shapes (Workflow Logs 195). */
export function formatDuration(ms: number | null): string {
  if (ms === null) return t('automations:dur.none', '—');
  if (ms < 1000) return t('automations:dur.ms', '{ms}ms', { ms });
  return t('automations:dur.s', '{s}s', { s: Math.round(ms / 100) / 10 });
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 1000],
  ['minute', 60_000],
  ['hour', 3_600_000],
  ['day', 86_400_000],
];

/**
 * "4m ago" / "in 2 days" — `Intl.RelativeTimeFormat`, with the absolute
 * stamp carried as the element's `title` so nothing is lost to rounding.
 */
export function formatRelative(at: number, now: number, locale?: string): string {
  const delta = at - now;
  const abs = Math.abs(delta);
  if (abs < 45_000 && delta <= 0) return t('automations:logs.justNow', 'just now');
  let unit: Intl.RelativeTimeFormatUnit = 'day';
  let size = 86_400_000;
  for (const [candidate, ms] of RELATIVE_UNITS) {
    if (abs < ms * 60 || candidate === 'day') {
      unit = candidate;
      size = ms;
      break;
    }
  }
  const format = new Intl.RelativeTimeFormat(locale ?? undefined, { numeric: 'auto' });
  return format.format(Math.round(delta / size), unit);
}

export function statusLabel(run: Pick<RunRow, 'status' | 'wakeAt'>, now: number): string {
  const meta = STATUS_META[run.status];
  if (run.status === 'pending' || run.status === 'waiting') {
    const when = run.wakeAt === null ? '' : formatRelative(run.wakeAt, now);
    return t(meta.key, meta.fallback, { when });
  }
  return t(meta.key, meta.fallback);
}

function Glyph({ name, spin, className }: { name: string; spin: boolean; className?: string }): ReactNode {
  const Icon = automationIcon(name);
  return <Icon aria-hidden className={`${className ?? 'size-[15px]'} ${spin ? 'animate-spin' : ''}`} />;
}

// --- the KPI strip (Workflow Logs 73-80, 189-195) ---------------------------

export interface LogsKpi {
  icon: string;
  label: string;
  value: string;
  /** The comp tints the tile per KPI and colours the number to match (191-194). */
  tone: 'accent' | 'pos' | 'danger' | 'warn';
  /** `warn` tints the tile but leaves the number in `fg` (194). */
  valueClass: string;
}

const TONE_TILE: Record<LogsKpi['tone'], string> = {
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  danger: 'bg-danger-soft text-danger',
  warn: 'bg-warn-soft text-warn',
};

export function LogsKpiStrip({ kpis }: { kpis: readonly LogsKpi[] }): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="logs-kpis">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="rounded-[14px] border border-border bg-surface p-[18px] shadow-sm">
          <div className="flex items-center gap-[9px]">
            <div
              className={`flex size-[30px] items-center justify-center rounded-[9px] ${TONE_TILE[kpi.tone]}`}
            >
              <Glyph name={kpi.icon} spin={false} className="size-4" />
            </div>
            <span className="text-xs font-semibold text-fg-muted">{kpi.label}</span>
          </div>
          <div className={`mt-[11px] font-mono text-[25px] font-extrabold tracking-[-0.03em] ${kpi.valueClass}`}>
            {kpi.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- the filter pills (Workflow Logs 84-86, 197-200) ------------------------

export interface FilterPill<K extends string> {
  key: K;
  label: string;
  count: number;
}

export function FilterPills<K extends string>({
  pills,
  active,
  onSelect,
  label,
}: {
  pills: readonly FilterPill<K>[];
  active: K;
  onSelect: (key: K) => void;
  label: string;
}): ReactNode {
  return (
    <div className="flex items-center gap-[7px]" role="group" aria-label={label}>
      {pills.map((pill) => {
        const on = pill.key === active;
        return (
          <button
            key={pill.key}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onSelect(pill.key);
            }}
            className={`inline-flex items-center gap-1.5 rounded-[9px] border px-[11px] py-1.5 text-xs font-bold ${
              on ? 'border-transparent bg-accent text-accent-fg' : 'border-border bg-surface text-fg-muted'
            }`}
          >
            {pill.label}
            <span
              className={`rounded-full px-[5px] font-mono text-[10px] font-bold ${
                on ? 'bg-white/20 text-white' : 'bg-surface-3 text-fg-subtle'
              }`}
            >
              {pill.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// --- the run list (Workflow Logs 87-98, 202-210) ----------------------------

export function RunList({
  runs,
  selectedId,
  onSelect,
  now,
  emptyTitle,
  hasMore,
  onLoadOlder,
}: {
  runs: readonly RunRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
  emptyTitle: string;
  hasMore: boolean;
  onLoadOlder: () => void;
}): ReactNode {
  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm" data-testid="run-list">
      {runs.length === 0 ? (
        <EmptyState compact preset="no-data" title={emptyTitle} />
      ) : (
        <ul className="list-none p-0">
          {runs.map((run) => {
            const meta = STATUS_META[run.status];
            const selected = run.id === selectedId;
            return (
              <li key={run.id}>
                <button
                  type="button"
                  aria-current={selected}
                  onClick={() => {
                    onSelect(run.id);
                  }}
                  className={`flex w-full items-center gap-3 border-b border-s-[3px] border-b-border px-4 py-[13px] text-start hover:bg-surface-2 ${
                    selected ? `${meta.border} bg-surface-2` : 'border-s-transparent'
                  }`}
                >
                  <div
                    className={`flex size-[30px] shrink-0 items-center justify-center rounded-[9px] ${meta.soft} ${meta.text}`}
                  >
                    <Glyph name={meta.icon} spin={meta.spin} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">{run.ruleName}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-fg-subtle">{run.trigger}</div>
                  </div>
                  <div className="shrink-0 text-end">
                    <div
                      className={`font-mono text-xs font-bold ${run.status === 'failed' ? 'text-danger' : 'text-fg'}`}
                    >
                      {formatDuration(run.durationMs)}
                    </div>
                    <div
                      className="text-[10px] text-fg-subtle"
                      title={new Date(run.startedAt).toLocaleString()}
                    >
                      {formatRelative(run.startedAt, now)}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadOlder}
          className="w-full border-t border-border bg-surface-2 py-3 text-xs font-bold text-fg-muted hover:text-fg"
        >
          {t('automations:logs.loadOlder', 'Load older')}
        </button>
      ) : null}
    </div>
  );
}

// --- the detail and its trace (Workflow Logs 101-128, 212-228) --------------

export function RunDetail({ run, now }: { run: RunView | null; now: number }): ReactNode {
  if (run === null) {
    return (
      <div className="rounded-2xl border border-border bg-surface shadow-sm">
        <EmptyState
          preset="no-matches"
          title={t('automations:logs.select', 'Select a run to see its trace')}
        />
      </div>
    );
  }
  const meta = STATUS_META[run.status];
  const steps = run.trace?.steps ?? [];
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" data-testid="run-detail">
      <div className="border-b border-border px-[22px] py-[18px]">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-[10.5px] font-bold ${meta.soft} ${meta.text}`}
          >
            <Glyph name={meta.icon} spin={meta.spin} className="size-3" />
            {statusLabel(run, now)}
          </span>
          <span className="text-[15.5px] font-extrabold tracking-[-0.01em]">{run.ruleName}</span>
          <span className="ms-auto font-mono text-[11.5px] text-fg-subtle">{run.id}</span>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-[22px]">
          <Fact label={t('automations:logs.trigger', 'Trigger')} value={run.trigger} />
          <Fact label={t('automations:logs.duration', 'Duration')} value={formatDuration(run.durationMs)} />
          <Fact
            label={t('automations:logs.started', 'Started')}
            value={new Date(run.startedAt).toLocaleString()}
          />
        </div>
      </div>
      <div className="px-[22px] py-[18px]">
        <div className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.05em] text-fg-subtle">
          {t('automations:logs.trace', 'Execution trace')}
        </div>
        <div className="flex flex-col">
          {steps.map((step, index) => (
            <TraceRow key={`${step.nodeId}-${String(index)}`} step={step} last={index === steps.length - 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div>
      <div className="text-[11px] text-fg-subtle">{label}</div>
      <div className="mt-0.5 font-mono text-[12.5px] font-bold">{value}</div>
    </div>
  );
}

function TraceRow({ step, last }: { step: TraceStep; last: boolean }): ReactNode {
  const meta = STEP_META[step.status];
  return (
    <div className="flex gap-[13px]">
      <div className="flex shrink-0 flex-col items-center">
        <div className={`flex size-[26px] items-center justify-center rounded-full ${meta.soft} ${meta.text}`}>
          <Glyph name={meta.icon} spin={meta.spin} className="size-[13px]" />
        </div>
        {last ? null : <span className="min-h-4 w-0.5 flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-bold">{step.name}</span>
          <span className="ms-auto font-mono text-[11px] text-fg-subtle">
            {formatDuration(step.durationMs)}
          </span>
        </div>
        {step.log === null || step.log === '' ? null : (
          <div
            className={`mt-[5px] break-words rounded-[7px] border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] leading-[1.4] ${
              step.status === 'fail' ? 'text-danger' : 'text-fg-muted'
            }`}
          >
            {step.log}
          </div>
        )}
      </div>
    </div>
  );
}

export type { RunStatus };
