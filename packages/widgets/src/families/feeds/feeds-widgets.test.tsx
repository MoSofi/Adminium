// @vitest-environment happy-dom
/**
 * `feeds` family (annex §4): render + interaction tests for the complete 7-id
 * slice — the Track-F five (activity-feed, notification-feed, realtime-feed,
 * timeline-vertical, unread-badge) plus the M7 Wave-4 tail
 * (load-older-paginator, toast-stack) — with deterministic demoData and the
 * four WidgetFrame states through WidgetHost. Clocks are pinned so relative
 * timestamps are stable.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActivityFeed, ActivityFeedWidget, activityFeedConfigSchema, activityFeedDemoData } from './ActivityFeed.js';
import {
  LoadOlderPaginator,
  LoadOlderPaginatorWidget,
  cursorStateOf,
  loadOlderPaginatorConfigSchema,
} from './LoadOlderPaginator.js';
import {
  MAX_VISIBLE_TOASTS,
  ToastStackWidget,
  toastStackConfigSchema,
  toastVariantOf,
  toastsOf,
  useToastQueue,
} from './ToastStack.js';
import {
  activityFeedDefinition,
  loadOlderPaginatorDefinition,
  notificationFeedDefinition,
  realtimeFeedDefinition,
  timelineVerticalDefinition,
  toastStackDefinition,
  unreadBadgeDefinition,
} from './feeds-track-f.definitions.js';
import { NotificationFeed, bucketOf, notificationFeedDemoData } from './NotificationFeed.js';
import { RealtimeFeed, pulseBuckets, realtimeFeedDemoData } from './RealtimeFeed.js';
import type { StreamEvent } from './RealtimeFeed.js';
import { TimelineVertical, timelineVerticalDemoData } from './TimelineVertical.js';
import { UnreadBadge, formatCount, unreadBadgeDemoData } from './UnreadBadge.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);
const noop = () => {};

describe('activity-feed', () => {
  it('renders tone-tinted rows with the actor/action/target sentence', () => {
    const { data } = activityFeedDemoData(7);
    render(<ActivityFeed items={data} now={NOW} />);
    expect(screen.getByText(data[0]!.actor as string)).toBeDefined();
    expect(document.querySelectorAll('[data-widget="activity-feed"] li').length).toBeGreaterThan(0);
  });

  it('honors the limit and fires View all', () => {
    const { data } = activityFeedDemoData(3);
    const events: string[] = [];
    render(<ActivityFeed items={data} limit={3} viewAllHref="/p/audit" onViewAll={() => events.push('view')} now={NOW} />);
    expect(document.querySelectorAll('[data-widget="activity-feed"] li')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /view all/i }));
    expect(events).toEqual(['view']);
  });

  it('shows per-widget empty copy when there are no items', () => {
    render(<ActivityFeed items={[]} emptyTitle="No recent activity" emptyBody="Nothing yet." />);
    expect(screen.getByText('No recent activity')).toBeDefined();
  });

  it('threads config.format.referenceTime into relative timestamps (wall-clock-independent)', () => {
    // The wrapper must pass a pinned reference clock through to `now`, so demo/
    // VRT captures render stable "Nh ago" text instead of drifting with Date.now().
    const { data } = activityFeedDemoData(7);
    const config = activityFeedConfigSchema.parse({ format: { referenceTime: NOW } });
    const renderAt = (wallClock: number): string => {
      const spy = vi.spyOn(Date, 'now').mockReturnValue(wallClock);
      const { container, unmount } = render(
        <ActivityFeedWidget config={config} instanceId="qa-clock" data={{ data }} onEvent={() => {}} />,
      );
      const text = container.querySelector('time')?.textContent ?? '';
      unmount();
      spy.mockRestore();
      return text;
    };
    const a = renderAt(NOW + 3 * 3_600_000);
    const b = renderAt(NOW + 900 * 86_400_000);
    expect(a).not.toBe('');
    expect(a).toBe(b); // pinned reference clock ⇒ identical regardless of the wall clock
  });
});

describe('unread-badge', () => {
  it('formats counts with an overflow cap and hides at zero', () => {
    expect(formatCount(7, 99)).toBe('7');
    expect(formatCount(250, 99)).toBe('99+');
    const { container } = render(<UnreadBadge count={0} hideZero />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an accent pill above zero', () => {
    render(<UnreadBadge count={12} />);
    expect(screen.getByText('12').className).toContain('bg-accent');
  });

  it('demoData is deterministic and positive', () => {
    expect(unreadBadgeDemoData(5)).toEqual(unreadBadgeDemoData(5));
    expect(unreadBadgeDemoData(5).value).toBeGreaterThan(0);
  });
});

describe('notification-feed', () => {
  it('buckets timestamps into today/yesterday/earlier', () => {
    expect(bucketOf(new Date(NOW).toISOString(), NOW)).toBe('today');
    expect(bucketOf(new Date(NOW - 86_400_000).toISOString(), NOW)).toBe('yesterday');
    expect(bucketOf(new Date(NOW - 5 * 86_400_000).toISOString(), NOW)).toBe('earlier');
  });

  it('filters to unread and marks all read', () => {
    const items = [
      { id: 1, category: 'billing', actor: 'System', action: 'failed', target: 'sub_1', ts: new Date(NOW).toISOString(), read: false },
      { id: 2, category: 'system', actor: 'System', action: 'done', target: 'x', ts: new Date(NOW).toISOString(), read: true },
    ];
    render(<NotificationFeed items={items} now={NOW} />);
    // Unread tab shows only the unread row.
    fireEvent.click(screen.getByRole('tab', { name: /unread/i }));
    const list = document.querySelector('[data-widget="notification-feed"]')!;
    expect(within(list as HTMLElement).getAllByRole('listitem')).toHaveLength(1);
    // Back to All, mark all read → the mark-all button disables.
    fireEvent.click(screen.getByRole('tab', { name: /^all/i }));
    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }));
    expect((screen.getByRole('button', { name: /mark all read/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('dismisses a notification', () => {
    const items = [
      { id: 1, category: 'mention', actor: 'Al', action: 'mentioned you', target: 'T-1', ts: new Date(NOW).toISOString() },
      { id: 2, category: 'mention', actor: 'Al', action: 'mentioned you', target: 'T-2', ts: new Date(NOW).toISOString() },
    ];
    render(<NotificationFeed items={items} now={NOW} tabs={false} markAllRead={false} />);
    expect(document.querySelectorAll('[data-widget="notification-feed"] li')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: /dismiss/i })[0]!);
    expect(document.querySelectorAll('[data-widget="notification-feed"] li')).toHaveLength(1);
  });

  it('demoData is deterministic', () => {
    expect(notificationFeedDemoData(9)).toEqual(notificationFeedDemoData(9));
    expect(notificationFeedDemoData(9).data.length).toBeGreaterThan(0);
  });
});

describe('realtime-feed', () => {
  it('renders the snapshot and toggles pause/resume', () => {
    const { snapshot } = realtimeFeedDemoData(4);
    render(<RealtimeFeed items={snapshot} now={NOW} />);
    const root = document.querySelector('[data-widget="realtime-feed"]')!;
    expect(root.getAttribute('data-paused')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(root.getAttribute('data-paused')).toBe('true');
  });

  it('optimistically prepends a newly-arrived event with a flash', () => {
    const { snapshot } = realtimeFeedDemoData(4);
    const { rerender } = render(<RealtimeFeed items={snapshot} now={NOW} />);
    const fresh: StreamEvent = { id: 'new_1', ts: new Date(NOW).toISOString(), actor: 'edge-9', action: 'GET', target: '/v1/ping', category: 'api', tone: 'info' };
    rerender(<RealtimeFeed items={[fresh, ...snapshot]} now={NOW} />);
    const first = document.querySelector('[data-widget="realtime-feed"] ul li')!;
    expect(first.getAttribute('data-flash')).toBe('true');
    expect(within(first as HTMLElement).getByText('/v1/ping')).toBeDefined();
  });

  it('re-flashes an id that rolled off the capped tail (dedupe set is pruned, not unbounded)', () => {
    // maxRows=1: each new event evicts the prior one from the display. The
    // dedupe set must forget evicted ids, so an id that reappears after rolling
    // off is treated as fresh again (proving the set stays bounded to live rows
    // rather than retaining every id ever seen).
    const evt = (id: string): StreamEvent => ({ id, ts: new Date(NOW).toISOString(), action: 'GET', target: `/${id}`, category: 'api' });
    const { rerender } = render(<RealtimeFeed items={[evt('a')]} maxRows={1} now={NOW} />);
    rerender(<RealtimeFeed items={[evt('b')]} maxRows={1} now={NOW} />);
    rerender(<RealtimeFeed items={[evt('a')]} maxRows={1} now={NOW} />);
    const first = document.querySelector('[data-widget="realtime-feed"] ul li')!;
    expect(within(first as HTMLElement).getByText('/a')).toBeDefined();
    expect(first.getAttribute('data-flash')).toBe('true');
  });

  it('pulseBuckets counts recency into 20 bins', () => {
    const buckets = pulseBuckets(
      [{ id: 1, ts: new Date(NOW - 1000).toISOString() }],
      NOW,
    );
    expect(buckets).toHaveLength(20);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('demoData is deterministic', () => {
    expect(realtimeFeedDemoData(2)).toEqual(realtimeFeedDemoData(2));
  });
});

describe('timeline-vertical', () => {
  it('renders the changelog variant with version pills', () => {
    const { data } = timelineVerticalDemoData(1, 'changelog');
    render(<TimelineVertical entries={data} variant="changelog" now={NOW} />);
    expect(screen.getByText('v2.4.0')).toBeDefined();
  });

  it('renders trace log snippets', () => {
    const { data } = timelineVerticalDemoData(1, 'trace');
    render(<TimelineVertical entries={data} variant="trace" now={NOW} />);
    expect(document.querySelector('[data-variant="trace"] pre')).not.toBeNull();
  });

  it('shows an empty state', () => {
    render(<TimelineVertical entries={[]} emptyTitle="Nothing here yet" />);
    expect(screen.getByText('Nothing here yet')).toBeDefined();
  });

  it('demoData is deterministic per variant', () => {
    expect(timelineVerticalDemoData(3, 'incidents')).toEqual(timelineVerticalDemoData(3, 'incidents'));
  });
});

// ── load-older-paginator (annex §4; M7 Wave 4) ─────────────────────────────

describe('load-older-paginator', () => {
  it('renders the button and the "N of M" count, and loads on click', () => {
    const onLoadOlder = vi.fn();
    render(<LoadOlderPaginator loaded={20} total={80} hasMore onLoadOlder={onLoadOlder} />);
    expect(screen.getByText('20 of 80')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /load older/i }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('relabels and disables on exhaustion (annex §4 "relabels/disappears")', () => {
    const { container } = render(<LoadOlderPaginator loaded={80} total={80} hasMore={false} onLoadOlder={noop} />);
    expect(container.querySelector('[data-part="load-older-paginator"]')?.getAttribute('data-exhausted')).toBe(
      'true',
    );
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('Nothing older');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('disappears entirely on exhaustion when hideWhenExhausted is set', () => {
    const { container } = render(
      <LoadOlderPaginator loaded={80} total={80} hasMore={false} onLoadOlder={noop} hideWhenExhausted />,
    );
    expect(container.querySelector('[data-part="load-older-paginator"]')).toBeNull();
  });

  it('shows only the loaded count when the pool size is unknown (cursor-only mode)', () => {
    render(<LoadOlderPaginator loaded={20} total={null} hasMore onLoadOlder={noop} />);
    expect(screen.getByText('20')).toBeDefined();
  });

  it('hides the count caption when showRemaining is off', () => {
    const { container } = render(
      <LoadOlderPaginator loaded={20} total={80} hasMore onLoadOlder={noop} showRemaining={false} />,
    );
    expect(container.querySelector('[data-part="paginator-count"]')).toBeNull();
  });

  it('disables the button and swaps the label while loading', () => {
    render(<LoadOlderPaginator loaded={20} total={80} hasMore onLoadOlder={noop} loading />);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain('Loading');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('narrows the cursor envelope, preferring an explicit `loaded` over rows.length', () => {
    expect(cursorStateOf({ rows: [{}, {}], total: 40, cursor: 'c1' })).toEqual({
      loaded: 2,
      total: 40,
      hasCursor: true,
    });
    expect(cursorStateOf({ rows: [{}], total: 40, loaded: 25, cursor: null })).toEqual({
      loaded: 25,
      total: 40,
      hasCursor: false,
    });
    expect(cursorStateOf(null)).toEqual({ loaded: 0, total: null, hasCursor: false });
  });

  it('the widget appends a batch per click and stops at the pool size', () => {
    render(
      <LoadOlderPaginatorWidget
        config={loadOlderPaginatorConfigSchema.parse({ batchSize: 20, format: { locale: 'en-US' } })}
        data={{ rows: [], total: 30, loaded: 10, cursor: 'c' }}
        instanceId="lop"
        onEvent={noop}
      />,
    );
    expect(screen.getByText('10 of 30')).toBeDefined();
    fireEvent.click(screen.getByRole('button'));
    // Clamped to the pool: 10 + 20 = 30, not past it.
    expect(screen.getByText('30 of 30')).toBeDefined();
    expect(screen.getByRole('button').textContent).toContain('Nothing older');
  });
});

// ── toast-stack (annex §4; cross-listed as undo-toast in §12) ──────────────

describe('toast-stack', () => {
  const toasts = [
    { id: 't1', message: 'Invoice #4821 deleted', variant: 'success', undoToken: 'u1', table: 'invoices', recordId: 4821 },
    { id: 't2', message: 'Export queued', variant: 'info' },
  ];

  function stack(config: Record<string, unknown> = {}, onEvent = noop, data: unknown = { toasts }) {
    const { container } = render(
      <ToastStackWidget
        config={toastStackConfigSchema.parse(config)}
        data={data}
        instanceId="ts"
        onEvent={onEvent}
      />,
    );
    return container;
  }

  it('renders one @adminium/ui toast per payload entry', () => {
    stack();
    expect(screen.getByText('Invoice #4821 deleted')).toBeDefined();
    expect(screen.getByText('Export queued')).toBeDefined();
  });

  it('offers Undo only on toasts carrying an undoToken', () => {
    stack();
    expect(screen.getAllByText('Undo')).toHaveLength(1);
  });

  it('Undo emits a mutate INTENT — the widget never performs the write itself', () => {
    const onEvent = vi.fn();
    // The binding descriptor is `binding.source.name` (+ optional schema) — the
    // connectionId rides on the emitted intent so the host targets the right DB.
    stack(
      { binding: { connectionId: 'conn-1', source: { name: 'invoices' }, shape: 'static' } },
      onEvent,
    );
    fireEvent.click(screen.getByText('Undo'));
    expect(onEvent).toHaveBeenCalledWith({
      type: 'mutate',
      intent: 'update',
      connectionId: 'conn-1',
      table: 'invoices',
      recordId: 4821,
      values: { undoToken: 'u1' },
    });
  });

  it('an unbound (demo) toast with no table dismisses without emitting a targetless intent', () => {
    const onEvent = vi.fn();
    stack({}, onEvent, { toasts: [{ id: 'x', message: 'Local only', undoToken: 'u9' }] });
    fireEvent.click(screen.getByText('Undo'));
    expect(onEvent).not.toHaveBeenCalled();
    expect(screen.queryByText('Local only')).toBeNull();
  });

  it('dismissal is local state — it never round-trips through the host', () => {
    const onEvent = vi.fn();
    stack({}, onEvent);
    fireEvent.click(screen.getAllByRole('button', { name: /dismiss/i })[0]!);
    expect(screen.queryByText('Invoice #4821 deleted')).toBeNull();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('clamps to maxVisible (annex §4: max 4)', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, message: `Toast ${i}` }));
    stack({ maxVisible: 2 }, noop, { toasts: many });
    expect(screen.getByText('Toast 0')).toBeDefined();
    expect(screen.getByText('Toast 1')).toBeDefined();
    expect(screen.queryByText('Toast 2')).toBeNull();
    expect(toastStackConfigSchema.safeParse({ maxVisible: 5 }).success).toBe(false);
  });

  it('applies the annex durations: 2.6s plain, 5.2s with undo', () => {
    const { container } = render(
      <ToastStackWidget
        config={toastStackConfigSchema.parse({})}
        data={{ toasts }}
        instanceId="ts-d"
        onEvent={noop}
      />,
    );
    const bars = container.querySelectorAll('[data-testid="toast-timer-bar"]');
    expect(bars[0]?.getAttribute('style')).toContain('5200ms'); // carries Undo
    expect(bars[1]?.getAttribute('style')).toContain('2600ms');
  });

  it('anchors by position with LOGICAL utilities so RTL flips the trailing edge', () => {
    // `end-4` resolves to the right in LTR and the LEFT in RTL — a physical
    // `right-4` would strand the toast under the RTL sidebar.
    expect(stack({ position: 'bottom-end' }).querySelector('[data-widget]')?.className).toContain('end-4');
    expect(stack({ position: 'top-end' }).querySelector('[data-widget]')?.className).toContain('top-4');
    const centered = stack({ position: 'bottom-center' }).querySelector('[data-widget]')?.className;
    expect(centered).toContain('start-1/2');
    expect(centered).toContain('rtl:translate-x-1/2'); // the mirror of the LTR centering shift
  });

  it('narrows the payload: drops malformed rows and unknown variants', () => {
    expect(toastVariantOf('success')).toBe('success');
    expect(toastVariantOf('explode')).toBe('info');
    expect(toastVariantOf(undefined)).toBe('info');
    expect(toastsOf({ toasts: [null, 42, { id: 'a' }, { id: 'b', message: '' }] })).toEqual([]);
    expect(toastsOf(null)).toEqual([]);
    expect(toastsOf({ toasts: [{ message: 'no id' }] })[0]?.id).toBe('toast-0');
  });

  it('re-exports @adminium/ui’s queue as the annex’s imperative toast API', () => {
    // annex §4: "Imperative API `toast(msg, icon, onUndo)`" — that IS
    // useToastQueue().push; the widget wraps the same primitive, it does not
    // fork a second queue implementation.
    expect(typeof useToastQueue).toBe('function');
    expect(MAX_VISIBLE_TOASTS).toBe(4);
  });
});

describe('feeds definitions + four WidgetFrame states', () => {
  const defs: WidgetDefinition[] = [
    activityFeedDefinition,
    notificationFeedDefinition,
    realtimeFeedDefinition,
    timelineVerticalDefinition,
    loadOlderPaginatorDefinition,
    toastStackDefinition,
    unreadBadgeDefinition,
  ];

  it('exposes the exact annex ids and the feeds family', () => {
    // M7 Wave 4 closed §4 out; ANNEX_PENDING.feeds is now [].
    expect(defs.map((d) => d.id).sort()).toEqual([
      'activity-feed',
      'load-older-paginator',
      'notification-feed',
      'realtime-feed',
      'timeline-vertical',
      'toast-stack',
      'unread-badge',
    ]);
    for (const def of defs) {
      expect(def.family).toBe('feeds');
      expect(def.configSchema.safeParse({}).success).toBe(true);
      expect(def.demoData(1)).toEqual(def.demoData(1));
    }
  });

  it('renders skeleton and error states through WidgetHost', () => {
    for (const def of defs) {
      const registry = buildRegistry([def]);
      const { unmount: u1 } = render(
        <WidgetHost widgetId={def.id} instanceId={`${def.id}-load`} data={{ status: 'loading' }} registry={registry} />,
      );
      expect(document.querySelector(`[data-skeleton-variant="${def.skeleton}"]`)).not.toBeNull();
      u1();

      const { unmount: u2 } = render(
        <WidgetHost
          widgetId={def.id}
          instanceId={`${def.id}-err`}
          data={{ status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }}
          registry={registry}
        />,
      );
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
      u2();
    }
  });

  it('routes empty record-list/stream payloads to the frame empty state', () => {
    const emptyByContract: Record<string, unknown> = {
      'record-list': { data: [], total: 0 },
      stream: { snapshot: [] },
    };
    for (const def of defs) {
      const contract = Array.isArray(def.dataContract) ? def.dataContract[0]! : def.dataContract;
      const payload = emptyByContract[contract];
      if (payload === undefined) continue; // single-metric is never empty
      const registry = buildRegistry([def]);
      const { unmount } = render(
        <WidgetHost
          widgetId={def.id}
          instanceId={`${def.id}-empty`}
          config={{ emptyState: { titleKey: `No ${def.id} yet` } }}
          data={{ status: 'success', data: payload }}
          registry={registry}
        />,
      );
      expect(screen.getByText(`No ${def.id} yet`)).toBeDefined();
      unmount();
    }
  });
});
