import { getFormatters } from '@adminium/i18n';
import { Avatar, EmptyState, MonoText, StatusPill } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { useMemo } from 'react';
import { z } from 'zod';

import {
  PERSONA_NAMES,
  TONE_SOLID_BG,
  categoryTone,
  mulberry32,
  resolveLocale,
  toneOf,
} from './calendar-lib.js';
import type { CapacityAssignment, CapacityBoardData, CapacityMember } from './calendar-types.js';
import type { WidgetProps } from '../../registry/types.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `capacity-board` (annex §5) — a per-member stacked utilization bar: the track
 * fills with per-project segments (width = hours / capacity, project-colored,
 * tooltips), with a legend row and a util-% + status pill (Overloaded > 100 /
 * Balanced 75–100 / Available < 75), scaled per week or month. Binds to a
 * `record-list` of members plus their project assignments.
 */

export const capacityBoardConfigSchema = widgetSharedConfigSchema.extend({
  /** Hours of capacity per period (the 100% mark). */
  capacity: z.number().int().min(1).max(400).default(40),
  period: z.enum(['week', 'month']).default('week'),
  /** Below this util % a member is "Available". */
  availableBelow: z.number().int().min(1).max(100).default(75),
  /** Above this util % a member is "Overloaded". */
  overloadedAbove: z.number().int().min(1).max(300).default(100),
  showLegend: z.boolean().default(true),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type CapacityBoardConfig = z.infer<typeof capacityBoardConfigSchema>;

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
const STATUS_TONE: Record<LoadStatus, Tone> = {
  overloaded: 'danger',
  balanced: 'pos',
  available: 'info',
};
const STATUS_LABEL: Record<LoadStatus, string> = {
  overloaded: 'Overloaded',
  balanced: 'Balanced',
  available: 'Available',
};

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
        title={emptyTitle ?? 'No workload data'}
        body={emptyBody ?? 'Member utilization will appear here once assignments exist.'}
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
                  {STATUS_LABEL[status]}
                </StatusPill>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${member.name}: ${util}%`}>
                {member.assignments.map((assignment, i) => {
                  const pct = Math.max(0, (assignment.hours / cap) * 100);
                  return (
                    <span
                      key={i}
                      title={`${assignment.project} · ${fmt.number(assignment.hours)}h`}
                      className={`h-full w-[var(--seg)] ${TONE_SOLID_BG[projectTone(assignment)]}`}
                      style={{ '--seg': `${pct}%` }}
                    />
                  );
                })}
              </div>
              <p className="mt-1 text-caption text-fg-subtle">
                <MonoText className="tabular-nums">{fmt.number(totalHours)}</MonoText> / <MonoText className="tabular-nums">{fmt.number(cap)}</MonoText>h · {period}
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

const PROJECTS = [
  { name: 'Platform', tone: 'accent' },
  { name: 'Mobile app', tone: 'info' },
  { name: 'Data migration', tone: 'pos' },
  { name: 'Infra', tone: 'warn' },
  { name: 'Redesign', tone: 'danger' },
] as const;

/** Deterministic member-capacity `record-list` payload (04 §7.7). */
export function capacityBoardDemoData(seed: number): CapacityBoardData {
  const random = mulberry32(seed || 1);
  const rows: CapacityMember[] = PERSONA_NAMES.slice(0, 6).map((name, i) => {
    const projectCount = 1 + Math.floor(random() * 3);
    const assignments: CapacityAssignment[] = [];
    const used = new Set<number>();
    for (let p = 0; p < projectCount; p += 1) {
      let index = Math.floor(random() * PROJECTS.length);
      for (let guard = 0; guard < PROJECTS.length && used.has(index); guard += 1) index = (index + 1) % PROJECTS.length;
      used.add(index);
      const project = PROJECTS[index] as (typeof PROJECTS)[number];
      assignments.push({ project: project.name, hours: 6 + Math.floor(random() * 16), tone: project.tone });
    }
    return {
      id: `m-${i + 1}`,
      name,
      role: (['Engineer', 'Designer', 'PM', 'Engineer', 'Analyst', 'Engineer'] as const)[i] ?? 'Contributor',
      assignments,
    };
  });
  return { rows, total: rows.length };
}
