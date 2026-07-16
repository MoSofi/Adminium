import { EmptyState, IconTile } from '@adminium/ui';
import { Pause, Play, Radio } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { feedIcon } from './feed-icons.js';
import { DEMO_EPOCH, FeedSentence, RelativeTime, feedRowsOf, toneOf } from './feed-lib.js';
import type { RealtimeFeedConfig } from './feeds-config.js';
import type { StreamEvent } from './feeds-types.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `realtime-feed` (annex §4) — an interval-driven live stream that prepends
 * incoming events with an insert flash, keeps at most `maxRows`, supports
 * pause/play (buffering while paused, flushing on resume), shows relative
 * timestamps under a bottom fade mask, and carries an optional throughput
 * pulse (rolling counter + 20-bucket spark). Binds to the `stream` shape;
 * Track G wires the live transport by re-feeding `data.snapshot`.
 */

// Config schema + deterministic demo payload live in the pure `feeds-config`
// module, and the event shape in `feeds-types`, so the registry metadata graph
// never reaches this component file (04 §2.3). Re-exported here to keep
// existing import points stable.
export { realtimeFeedConfigSchema, realtimeFeedDemoData } from './feeds-config.js';
export type { RealtimeFeedConfig } from './feeds-config.js';
export type { StreamEvent } from './feeds-types.js';

const idOf = (event: StreamEvent): string => String(event.id);

/** Union of event ids across the given groups — the bounded "still live" set. */
function liveIds(...groups: readonly (readonly StreamEvent[])[]): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) for (const event of group) ids.add(idOf(event));
  return ids;
}

/** 20-bucket histogram of event recency over the trailing `windowMs` from `now`. */
export function pulseBuckets(events: readonly StreamEvent[], now: number, windowMs = 60_000, bins = 20): number[] {
  const buckets = new Array<number>(bins).fill(0);
  const span = windowMs / bins;
  for (const event of events) {
    const age = now - new Date(event.ts).getTime();
    if (age < 0 || age >= windowMs) continue;
    const index = Math.min(bins - 1, Math.floor((windowMs - age) / span));
    buckets[index] = (buckets[index] ?? 0) + 1;
  }
  return buckets;
}

export interface RealtimeFeedProps {
  items: readonly StreamEvent[];
  maxRows?: number | undefined;
  pausable?: boolean | undefined;
  pulseCompanion?: boolean | undefined;
  labels?: RealtimeFeedConfig['labels'];
  now?: number | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

export function RealtimeFeed({
  items,
  maxRows = 40,
  pausable = true,
  pulseCompanion = true,
  labels,
  now,
  locale,
  testId,
}: RealtimeFeedProps) {
  const [displayed, setDisplayed] = useState<StreamEvent[]>(() => items.slice(0, maxRows));
  const [buffer, setBuffer] = useState<StreamEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(new Set());
  const seenRef = useRef<Set<string> | null>(null);
  if (seenRef.current === null) seenRef.current = new Set(items.map(idOf));
  // Mirror the display/buffer state into refs so the effect can re-derive the
  // bounded "still live" id set without adding them to its dependency array.
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;

  useEffect(() => {
    const seen = seenRef.current;
    if (seen === null) return;
    const incoming = items.filter((event) => !seen.has(idOf(event)));
    if (incoming.length === 0) return;
    if (paused) {
      setBuffer((prev) => {
        const next = [...incoming, ...prev];
        // Prune the dedupe set to ids still live (displayed ∪ buffered ∪ the
        // current feed) so it can't grow unbounded as rows roll off the tail.
        seenRef.current = liveIds(displayedRef.current, next, items);
        return next;
      });
    } else {
      setDisplayed((prev) => {
        const next = [...incoming, ...prev].slice(0, maxRows);
        seenRef.current = liveIds(next, bufferRef.current, items);
        return next;
      });
      setFlashIds(new Set(incoming.map(idOf)));
    }
  }, [items, paused, maxRows]);

  const resume = () => {
    setDisplayed((prev) => [...buffer, ...prev].slice(0, maxRows));
    setFlashIds(new Set(buffer.map(idOf)));
    setBuffer([]);
    setPaused(false);
  };

  const clock = now ?? Date.now();
  const buckets = pulseCompanion ? pulseBuckets(displayed, clock) : [];
  const maxBucket = Math.max(1, ...buckets);

  return (
    <div data-widget="realtime-feed" data-testid={testId} data-paused={paused} className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-caption font-bold uppercase tracking-wide text-fg-muted">
          <Radio
            className={`size-3.5 ${paused ? 'text-fg-subtle' : 'text-pos motion-safe:animate-pulse'}`}
            aria-hidden="true"
          />
          {paused ? (labels?.paused ?? 'Paused') : (labels?.live ?? 'Live')}
        </span>
        {pulseCompanion && (
          <div className="ms-1 flex items-end gap-px" aria-hidden="true">
            {buckets.map((count, index) => (
              <span
                key={index}
                className="w-1 rounded-t-sm bg-accent/70 h-[var(--adm-h)]"
                style={{ '--adm-h': `${String(Math.max(2, Math.round((count / maxBucket) * 16)))}px` }}
              />
            ))}
          </div>
        )}
        {pausable && (
          <button
            type="button"
            data-part="realtime-toggle"
            onClick={() => (paused ? resume() : setPaused(true))}
            className="ms-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-semibold text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            {paused ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
            {paused
              ? buffer.length > 0
                ? `${labels?.resume ?? 'Resume'} · ${String(buffer.length)}`
                : (labels?.resume ?? 'Resume')
              : (labels?.pause ?? 'Pause')}
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-y-auto">
          {displayed.length === 0 ? (
            <EmptyState
              compact
              preset="nothing-scheduled"
              title={labels?.emptyTitle ?? 'Waiting for events'}
              body={labels?.emptyBody ?? 'Live events will stream in as they happen.'}
            />
          ) : (
            <ul className="divide-y divide-border/50">
              {displayed.map((event) => (
                <li
                  key={event.id}
                  data-flash={flashIds.has(idOf(event))}
                  className="flex items-start gap-3 px-4 py-2 motion-safe:transition-colors motion-safe:duration-[1200ms] motion-safe:data-[flash=true]:bg-accent/10"
                >
                  <IconTile size="sm" tone={toneOf(event.tone, 'info')} icon={feedIcon(event.category)} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <FeedSentence
                      {...(event.actor === undefined ? {} : { actor: event.actor })}
                      {...(event.action === undefined ? {} : { action: event.action })}
                      {...(event.target === undefined ? {} : { target: event.target })}
                    />
                  </div>
                  <RelativeTime iso={event.ts} now={clock} {...(locale === undefined ? {} : { locale })} className="mt-0.5 shrink-0" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent"
        />
      </div>
    </div>
  );
}

function streamEventsOf(data: unknown): StreamEvent[] {
  return feedRowsOf(data).map((row, index) => ({
    id: (row['id'] as string | number | undefined) ?? index,
    ts: typeof row['ts'] === 'string' ? row['ts'] : new Date(DEMO_EPOCH).toISOString(),
    actor: typeof row['actor'] === 'string' ? row['actor'] : undefined,
    action: typeof row['action'] === 'string' ? row['action'] : undefined,
    target: typeof row['target'] === 'string' ? row['target'] : undefined,
    category: typeof row['category'] === 'string' ? row['category'] : undefined,
    tone: typeof row['tone'] === 'string' ? row['tone'] : undefined,
  }));
}

export function RealtimeFeedWidget({ config, data }: WidgetProps<RealtimeFeedConfig>) {
  return (
    <RealtimeFeed
      items={streamEventsOf(data)}
      maxRows={config.maxRows}
      pausable={config.pausable}
      pulseCompanion={config.pulseCompanion}
      {...(config.labels === undefined ? {} : { labels: config.labels })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.format?.referenceTime === undefined ? {} : { now: config.format.referenceTime })}
    />
  );
}

