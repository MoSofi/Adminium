// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-log-viewer` template stories (09 §7.8): the demo-mode composition
 * (KPI pair + log-table + trace timeline), a bound run over audit-shaped rows
 * with the toolbar filters live, the loading/error states through the `states`
 * override, and a live-tail run driven by the deterministic demo stream
 * transport — four states, matching the template-story idiom
 * (PageDashboard.stories.tsx).
 */
import { PageLogViewer } from './PageLogViewer.js';
import { demoLogViewerLayout } from './demo-layout.js';
import { createDemoStreamTransport } from '../../binding/demo-stream.js';

const meta = {
  title: 'Templates/PageLogViewer',
};
export default meta;

/** Fixed clock (matches the families' demo epoch) so stamps are stable. */
const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

const AUDIT_ROWS = Array.from({ length: 14 }, (_, index) => ({
  id: `evt-${String(index + 1)}`,
  created_at: new Date(NOW - index * 45 * 60_000).toISOString(),
  actor: index % 3 === 0 ? 'ava@acme.dev' : 'morgan@acme.dev',
  category: index % 4 === 0 ? 'auth' : 'orders',
  action: index % 5 === 0 ? 'deleted' : 'updated',
  resource: `orders/${String(1200 + index)}`,
  status: index % 5 === 0 ? 'error' : 'ok',
  ip: '10.0.4.21',
}));

/** Demo mode (04 §5.3): no adapter — every widget seeds from its instance id. */
export const DemoMode = {
  render: () => <PageLogViewer layout={demoLogViewerLayout} now={NOW} />,
};

/** Bound rows through the `states` override — toolbar filters fully live. */
export const BoundAuditLog = {
  render: () => (
    <PageLogViewer
      layout={demoLogViewerLayout}
      now={NOW}
      states={{
        log: { status: 'success', data: { rows: AUDIT_ROWS, total: AUDIT_ROWS.length } },
        trace: { status: 'success', data: { rows: [] } },
      }}
    />
  ),
};

/** Loading + failed query — the slot-level states, page never crashes. */
export const LoadingAndError = {
  render: () => (
    <div className="flex flex-col gap-8">
      <PageLogViewer layout={demoLogViewerLayout} now={NOW} states={{ log: { status: 'loading' } }} />
      <PageLogViewer
        layout={demoLogViewerLayout}
        now={NOW}
        states={{ log: { status: 'error', error: new Error('TABLE_FORBIDDEN'), refetch: () => {} } }}
      />
    </div>
  ),
};

/** Live tail over the deterministic demo stream transport (04 §5.3). */
export const LiveTail = {
  render: () => (
    <PageLogViewer
      layout={demoLogViewerLayout}
      now={NOW}
      liveChannel="widget-data:demo:public.order_audit"
      streamTransport={createDemoStreamTransport({ seed: 7, intervalMs: 1600 })}
      states={{ log: { status: 'success', data: { rows: AUDIT_ROWS.slice(0, 6) } } }}
    />
  ),
};
