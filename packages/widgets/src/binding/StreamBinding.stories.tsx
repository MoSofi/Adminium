/**
 * `stream` binding demo (04-widget-registry.md §5.3). Drives the existing
 * `log-table` shell as a LIVE tail from `useWidgetStream` + the deterministic
 * demo transport — the same pipeline a bound `realtime-feed` / live log-table
 * uses over the real WS transport. Shows the unread-badge count, pause/resume
 * (events held while paused, flushed on resume), mark-read, and the connection
 * flag. Track F owns the production widget shells; this story exercises the
 * transport + hook + buffer this track delivers.
 */
import { Badge } from '@adminium/ui';

import { type DemoStreamRecord } from './demo-stream.js';
import { useWidgetStream } from './useWidgetStream.js';
import { LogTable, type LogRow } from '../families/tables/LogTable.js';

const meta = { title: 'Widgets/Binding/Stream' };
export default meta;

const NOW = Date.parse('2026-07-14T15:40:00.000Z');

function toLogRow(record: DemoStreamRecord): LogRow {
  return {
    id: record.id,
    ts: record.ts,
    actor: record.actor,
    category: record.category,
    categoryTone: record.categoryTone,
    action: record.action,
    resource: record.resource,
    ...(record.status === undefined ? {} : { status: record.status }),
    ...(record.code === undefined ? {} : { code: record.code }),
  };
}

/** A live log-table tail fed by the demo stream (unbound demo mode). */
function LiveLogFeed({ seed = 4242 }: { seed?: number }) {
  const stream = useWidgetStream<DemoStreamRecord>({
    getKey: (record) => record.id,
    demo: { seed, intervalMs: 1400 },
    max: 40,
  });
  const rows = stream.items.map(toLogRow);

  return (
    <div className="w-[42rem]">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-body-sm font-semibold text-fg">Live activity</span>
        {stream.unread > 0 && (
          <Badge tone="accent">{stream.unread > 99 ? '99+' : `${stream.unread} new`}</Badge>
        )}
        <span className="ms-auto inline-flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-fg-muted">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${stream.connected ? 'bg-pos' : 'bg-fg-subtle'}`}
          />
          {stream.connected ? 'Connected' : 'Offline'}
        </span>
        <button
          type="button"
          onClick={() => stream.setPaused(!stream.paused)}
          className="rounded-md border border-border px-2.5 py-1 text-caption font-semibold text-fg-muted hover:bg-surface-2"
        >
          {stream.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={stream.markRead}
          className="rounded-md border border-border px-2.5 py-1 text-caption font-semibold text-fg-muted hover:bg-surface-2"
        >
          Mark read
        </button>
      </div>
      <div className="h-[26rem] overflow-hidden rounded-xl border border-border bg-surface">
        <LogTable rows={rows} liveTail search={false} now={NOW} />
      </div>
    </div>
  );
}

export function LiveTail() {
  return <LiveLogFeed />;
}
