import { Badge, EmptyState, IconTile, MonoText, Tag } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { feedIcon } from './feed-icons.js';
import { DEMO_EPOCH, RelativeTime, feedRowsOf, toneOf } from './feed-lib.js';
import type { TimelineVerticalConfig } from './feeds-config.js';
import type { TimelineEntry } from './feeds-types.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `timeline-vertical` (annex §4) — an icon-node vertical timeline with
 * connector lines. Variants: `activity` (record CRUD trail), `changelog`
 * (version gutter + tag-pill entry cards), `incidents` (severity halo dots +
 * postmortem notes), `trace` (per-step status dots + mono log snippets). Binds
 * to an ordered `record-list`.
 */

// Config schema + deterministic demo payload live in the pure `feeds-config`
// module, and the entry shape in `feeds-types`, so the registry metadata graph
// never reaches this component file (04 §2.3). Re-exported here to keep
// existing import points stable.
export { timelineVerticalConfigSchema, timelineVerticalDemoData } from './feeds-config.js';
export type { TimelineVerticalConfig } from './feeds-config.js';
export type { TimelineEntry } from './feeds-types.js';

const SEVERITY_TONE: Record<string, Tone> = { sev1: 'danger', sev2: 'warn', sev3: 'info', critical: 'danger', major: 'warn', minor: 'info' };

export interface TimelineVerticalProps {
  entries: readonly TimelineEntry[];
  variant?: TimelineVerticalConfig['variant'];
  connectorStyle?: 'solid' | 'dashed';
  tagToneMap?: Record<string, Tone> | undefined;
  now?: number | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  testId?: string | undefined;
}

export function TimelineVertical({
  entries,
  variant = 'activity',
  connectorStyle = 'solid',
  tagToneMap,
  now,
  locale,
  emptyTitle,
  emptyBody,
  testId,
}: TimelineVerticalProps) {
  const t = useMaybeT();
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        preset="nothing-scheduled"
        title={emptyTitle ?? t('ui:widgets.feeds.timelineVertical.emptyTitle', 'Nothing here yet')}
        body={emptyBody ?? t('ui:widgets.feeds.timelineVertical.emptyBody', 'Events will appear on this timeline as they happen.')}
      />
    );
  }
  const connector =
    connectorStyle === 'dashed'
      ? 'w-0 flex-1 border-s border-dashed border-border'
      : 'w-px flex-1 bg-border';

  return (
    <ol data-widget="timeline-vertical" data-variant={variant} data-testid={testId} className="flex h-full flex-col gap-0 overflow-y-auto px-3 py-2">
      {entries.map((entry, index) => {
        const tone = toneOf(entry.tone, variant === 'incidents' ? (SEVERITY_TONE[entry.severity ?? ''] ?? 'danger') : 'accent');
        const isLast = index === entries.length - 1;
        return (
          <li key={entry.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              {variant === 'trace' ? (
                <span
                  data-part="trace-dot"
                  className={`mt-1 size-3 shrink-0 rounded-full ${DOT_BG[tone]}`}
                />
              ) : variant === 'incidents' ? (
                <span
                  data-part="incident-dot"
                  className={`mt-0.5 size-3.5 shrink-0 rounded-full ring-4 ${DOT_BG[tone]} ${RING[tone]}`}
                />
              ) : (
                <IconTile size="sm" tone={tone} icon={feedIcon(entry.icon)} />
              )}
              {!isLast && <span aria-hidden="true" className={`my-1 ${connector}`} />}
            </div>
            <div className={`min-w-0 flex-1 ${isLast ? 'pb-1' : 'pb-4'}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {variant === 'changelog' && entry.version !== undefined && (
                  <Badge tone={tone} className="font-mono">{entry.version}</Badge>
                )}
                <span className="text-body-sm font-semibold text-fg">{entry.title}</span>
                <RelativeTime iso={entry.ts} {...(now === undefined ? {} : { now })} {...(locale === undefined ? {} : { locale })} className="ms-auto" />
              </div>
              {entry.body !== undefined && <p className="mt-1 text-body-sm text-fg-muted">{entry.body}</p>}
              {entry.tags !== undefined && entry.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {entry.tags.map((tag) => (
                    <Tag key={tag} tone={tagToneMap?.[tag] ?? 'neutral'}>{tag}</Tag>
                  ))}
                </div>
              )}
              {entry.log !== undefined && (
                <pre className="mt-1.5 overflow-x-auto rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
                  <MonoText className="text-caption text-fg-muted">{entry.log}</MonoText>
                </pre>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const DOT_BG: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};
const RING: Record<Tone, string> = {
  neutral: 'ring-fg-subtle/20',
  accent: 'ring-accent/20',
  pos: 'ring-pos/20',
  warn: 'ring-warn/20',
  danger: 'ring-danger/20',
  info: 'ring-info/20',
};

function timelineEntriesOf(data: unknown): TimelineEntry[] {
  return feedRowsOf(data).map((row, index) => ({
    id: (row['id'] as string | number | undefined) ?? index,
    title: typeof row['title'] === 'string' ? row['title'] : String(row['title'] ?? ''),
    ts: typeof row['ts'] === 'string' ? row['ts'] : new Date(DEMO_EPOCH).toISOString(),
    body: typeof row['body'] === 'string' ? row['body'] : undefined,
    tone: typeof row['tone'] === 'string' ? row['tone'] : undefined,
    icon: typeof row['icon'] === 'string' ? row['icon'] : undefined,
    tags: Array.isArray(row['tags']) ? (row['tags'] as string[]) : undefined,
    log: typeof row['log'] === 'string' ? row['log'] : undefined,
    version: typeof row['version'] === 'string' ? row['version'] : undefined,
    severity: typeof row['severity'] === 'string' ? row['severity'] : undefined,
  }));
}

export function TimelineVerticalWidget({ config, data }: WidgetProps<TimelineVerticalConfig>) {
  return (
    <TimelineVertical
      entries={timelineEntriesOf(data)}
      variant={config.variant}
      connectorStyle={config.connectorStyle}
      {...(config.tagToneMap === undefined ? {} : { tagToneMap: config.tagToneMap })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.format?.referenceTime === undefined ? {} : { now: config.format.referenceTime })}
    />
  );
}

