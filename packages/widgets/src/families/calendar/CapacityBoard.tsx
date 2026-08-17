// SPDX-License-Identifier: AGPL-3.0-only
import { getFormatters } from '@adminium/i18n';
import { useMaybeT } from '@adminium/i18n/react';
import { Avatar, EmptyState, MonoText, StatusPill } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { useMemo } from 'react';

import {
  TONE_SOLID_BG,
  categoryTone,
  resolveLocale,
  toneOf,
} from './calendar-lib.js';
import type { CapacityBoardConfig } from './calendar-config.js';
import type { CapacityAssignment, CapacityBoardData, CapacityMember } from './calendar-types.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure `calendar-config`
// module so the registry metadata graph never reaches this component file
// (04 §2.3). Re-exported here to keep existing import points stable.
export { capacityBoardConfigSchema, capacityBoardDemoData } from './calendar-config.js';
export type { CapacityBoardConfig } from './calendar-config.js';

/**
 * `capacity-board` (annex §5) — a per-member stacked utilization bar: the track
 * fills with per-project segments (width = hours / capacity, project-colored,
 * tooltips), with a legend row and a util-% + status pill (Overloaded > 100 /
 * Balanced 75–100 / Available < 75), scaled per week or month. Binds to a
 * `record-list` of members plus their project assignments.
 */

export interface CapacityBoardProps {
  data: CapacityBoardData;
  capacity?: number | undefined;
  period?: 'week' | 'month' | undefined;
  availableBelow?: number | undefined;
  overloadedAbove?: number | undefined;
  showLegend?: boolean | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

type LoadStatus = 'overloaded' | 'balanced' | 'available';
type CapacityPeriod = 'week' | 'month';
const STATUS_TONE: Record<LoadStatus, Tone> = {
  overloaded: 'danger',
  balanced: 'pos',
  available: 'info',
};
/** English defaults; rendered through the per-status capacityBoard bundle keys. */
const STATUS_LABEL: Record<LoadStatus, string> = {
  overloaded: 'Overloaded',
  balanced: 'Balanced',
  available: 'Available',
};
/**
 * Literal bundle key per status/period, so the extractor and the bundle-parity
 * tests see every key and a new enum member is a compile error (10 §2.5).
 */
const STATUS_KEY = {
  overloaded: 'ui:widgets.calendar.capacityBoard.status.overloaded',
  balanced: 'ui:widgets.calendar.capacityBoard.status.balanced',
  available: 'ui:widgets.calendar.capacityBoard.status.available',
} as const satisfies Record<LoadStatus, string>;
const PERIOD_KEY = {
  week: 'ui:widgets.calendar.capacityBoard.period.week',
  month: 'ui:widgets.calendar.capacityBoard.period.month',
} as const satisfies Record<CapacityPeriod, string>;

/** Tone for a project (explicit assignment tone, else stable per project name). */
function projectTone(assignment: CapacityAssignment): Tone {
  return assignment.tone !== undefined ? toneOf(assignment.tone) : categoryTone(assignment.project);
}

export function CapacityBoard({
  data,
  capacity = 40,
  period = 'week',
  availableBelow = 75,
  overloadedAbove = 100,
  showLegend = true,
  locale,
  emptyTitle,
  emptyBody,
  testId,
}: CapacityBoardProps) {
  const t = useMaybeT();
  const tag = resolveLocale(locale);
  const fmt = getFormatters(tag);
  const members = data.rows;
  const cap = capacity > 0 ? capacity : 40;

  const legend = useMemo(() => {
    const map = new Map<string, Tone>();
    for (const member of members) {
      for (const assignment of member.assignments) {
        if (!map.has(assignment.project)) map.set(assignment.project, projectTone(assignment));
      }
    }
    return [...map.entries()];
  }, [members]);

  if (members.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.calendar.capacityBoard.emptyTitle', 'No workload data')}
        body={emptyBody ?? t('ui:widgets.calendar.capacityBoard.emptyBody', 'Member utilization will appear here once assignments exist.')}
      />
    );
  }

  return (
    <div data-widget="capacity-board" data-testid={testId} className="flex h-full flex-col">
      <ul className="flex-1 space-y-3 overflow-auto p-3">
        {members.map((member) => {
          const totalHours = member.assignments.reduce((sum, a) => sum + a.hours, 0);
          const util = Math.round((totalHours / cap) * 100);
          const status: LoadStatus = util > overloadedAbove ? 'overloaded' : util >= availableBelow ? 'balanced' : 'available';
          return (
            <li key={member.id}>
              <div className="mb-1 flex items-center gap-2">
                <Avatar name={member.name} size="sm" locale={tag} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-semibold text-fg">{member.name}</p>
                  <p className="truncate text-caption text-fg-subtle">{member.role}</p>
                </div>
                <MonoText className="tabular-nums text-caption font-semibold text-fg">{fmt.percent(util / 100)}</MonoText>
                <StatusPill status={status} tone={STATUS_TONE[status]}>
                  {t(STATUS_KEY[status], STATUS_LABEL[status])}
                </StatusPill>
              </div>
              <div
                className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
                role="img"
                aria-label={t('ui:widgets.calendar.capacityBoard.utilizationLabel', '{name}: {util}%', {
                  name: member.name,
                  util,
                })}
              >
                {member.assignments.map((assignment, i) => {
                  const pct = Math.max(0, (assignment.hours / cap) * 100);
                  return (
                    <span
                      key={i}
                      title={t('ui:widgets.calendar.capacityBoard.assignmentLabel', '{project} · {hours}h', {
                        project: assignment.project,
                        hours: fmt.number(assignment.hours),
                      })}
                      className={`h-full w-[var(--seg)] ${TONE_SOLID_BG[projectTone(assignment)]}`}
                      style={{ '--seg': `${pct}%` }}
                    />
                  );
                })}
              </div>
              <p className="mt-1 text-caption text-fg-subtle">
                <MonoText className="tabular-nums">{fmt.number(totalHours)}</MonoText> / <MonoText className="tabular-nums">{fmt.number(cap)}</MonoText>
                {t('ui:widgets.calendar.capacityBoard.periodLabel', 'h · {period}', {
                  period: t(PERIOD_KEY[period], period),
                })}
              </p>
            </li>
          );
        })}
      </ul>

      {showLegend && legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2">
          {legend.map(([project, tone]) => (
            <span key={project} className="flex items-center gap-1.5 text-caption text-fg-muted">
              <span className={`size-2 shrink-0 rounded-full ${TONE_SOLID_BG[tone]}`} aria-hidden="true" />
              {project}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tolerant read of the capacity `record-list` envelope. */
export function capacityDataOf(data: unknown): CapacityBoardData {
  const source = (typeof data === 'object' && data !== null ? data : {}) as Partial<CapacityBoardData>;
  const rows = Array.isArray(source.rows) ? (source.rows as CapacityMember[]) : [];
  return { rows, total: typeof source.total === 'number' ? source.total : rows.length };
}

export function CapacityBoardWidget({ config, data }: WidgetProps<CapacityBoardConfig>) {
  return (
    <CapacityBoard
      data={capacityDataOf(data)}
      capacity={config.capacity}
      period={config.period}
      availableBelow={config.availableBelow}
      overloadedAbove={config.overloadedAbove}
      showLegend={config.showLegend}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
    />
  );
}

