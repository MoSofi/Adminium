// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK FCS `system` family stories (annex §12): each widget's loaded variant,
 * the four WidgetFrame states through WidgetHost (acceptance #4), and
 * light/dark × LTR/RTL matrices with REAL geometry mirroring (acceptance #9 —
 * the RTL frames set `dir="rtl"` so the icon-then-copy rows, the alert's
 * dismiss corner (`end-6`), the diagnostics label→value rhythm, and the status
 * hero's end-aligned KPI trio genuinely flip; a bare attribute would prove
 * nothing). Widgets resolve through a LOCAL registry override so the stories
 * work before the green loop merges the definitions into the global map.
 * Payloads are the same seeded generators `demoData` uses.
 */
import type { ReactNode } from 'react';

import {
  alertBannerDemoData,
  autosaveIndicatorDemoData,
  connectionStatusDemoData,
  diagnosticsReadoutDemoData,
  progressLogConsoleDemoData,
  statusBannerHeroDemoData,
  statusPillDemoData,
} from './system-config.js';
import { systemTrackDefinitions } from './system-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([...systemTrackDefinitions] as WidgetDefinition[]);

const meta = { title: 'Widgets/System' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  height = 'h-64',
) {
  return (
    <div className={`${height} w-full`}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('HEALTH_CHECK_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const HERO_STATS = [
  { key: 'uptime', label: 'Uptime', unit: '%' },
  { key: 'p95', label: 'p95', unit: 'ms' },
  { key: 'incidents', label: 'Incidents' },
];

const logConfig = { title: 'Introspecting', variant: 'live', showProgress: true };

// ── Per-widget loaded variants ─────────────────────────────────────────────

export const StateHeroStory = {
  name: 'state-hero',
  render: () =>
    host(
      'state-hero',
      's-hero',
      { view: '404', ornament: true, quickLinks: [{ label: 'Dashboard', href: '/' }, { label: 'Orders', href: '/orders' }] },
      { row: { view: '404' } },
      'success',
      'h-96',
    ),
};

export const EmptyStateStory = {
  name: 'empty-state',
  render: () =>
    host('empty-state', 's-empty', {
      variant: 'cta',
      glyph: 'inbox',
      heading: 'No exports yet',
      body: 'Exports you schedule will show up here.',
      primaryLabel: 'New export',
      primaryHref: '/exports/new',
    }, {}),
};

export const StatusPillStory = {
  name: 'status-pill',
  render: () => host('status-pill', 's-pill', { title: 'Status' }, statusPillDemoData(4), 'success', 'h-24'),
};

export const AlertBannerStory = {
  name: 'alert-banner',
  render: () => host('alert-banner', 's-alert', { dismissible: true }, alertBannerDemoData(1), 'success', 'h-32'),
};

export const StatusBannerHeroStory = {
  name: 'status-banner-hero',
  render: () => host('status-banner-hero', 's-banner', { stats: HERO_STATS }, statusBannerHeroDemoData(6), 'success', 'h-32'),
};

export const ConnectionStatusStory = {
  name: 'connection-status',
  render: () =>
    host('connection-status', 's-conn', { title: 'Database', testable: true }, connectionStatusDemoData(2), 'success', 'h-32'),
};

export const AutosaveIndicatorStory = {
  name: 'autosave-indicator',
  render: () => host('autosave-indicator', 's-autosave', {}, autosaveIndicatorDemoData(3), 'success', 'h-24'),
};

export const ProgressLogConsoleStory = {
  name: 'progress-log-console',
  render: () => host('progress-log-console', 's-log', logConfig, progressLogConsoleDemoData(8), 'success', 'h-80'),
};

export const DiagnosticsReadoutStory = {
  name: 'diagnostics-readout',
  render: () => host('diagnostics-readout', 's-diag', { title: 'Connection check' }, diagnosticsReadoutDemoData(5)),
};

// ── Four WidgetFrame states (acceptance #4) ────────────────────────────────

/** progress-log-console: loaded · skeleton · empty · error. */
export const States = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('progress-log-console', 'st-loaded', logConfig, progressLogConsoleDemoData(8), 'success', 'h-80')}
        {host('progress-log-console', 'st-skeleton', logConfig, undefined, 'loading', 'h-80')}
        {host(
          'progress-log-console',
          'st-empty',
          { ...logConfig, emptyState: { titleKey: 'Nothing to report yet' } },
          { rows: [], total: 0 },
          'success',
          'h-80',
        )}
        {host('progress-log-console', 'st-error', logConfig, undefined, 'error', 'h-80')}
      </div>
    </Frame>
  ),
};

/** diagnostics-readout: the same four states on a `record`-shaped widget. */
export const DiagnosticsStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('diagnostics-readout', 'ds-loaded', { title: 'Connection check' }, diagnosticsReadoutDemoData(5))}
        {host('diagnostics-readout', 'ds-skeleton', { title: 'Connection check' }, undefined, 'loading')}
        {host(
          'diagnostics-readout',
          'ds-empty',
          { title: 'Connection check', emptyState: { titleKey: 'No checks run yet' } },
          { row: null },
        )}
        {host('diagnostics-readout', 'ds-error', { title: 'Connection check' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

// ── Theme × direction matrix (acceptance #9) ───────────────────────────────

/**
 * REAL mirroring: each cell sets `dir` on a wrapper so the logical utilities
 * (`ps-`/`pe-`/`end-`) resolve for that direction — the alert's dismiss button
 * moves corner, the hero's KPI trio swaps side, and the console's glyph column
 * leads from the other edge.
 */
function matrixCells(key: string) {
  // Instance ids are derived from the cell key, never randomised: VRT captures
  // must be byte-identical across runs (04 §7.7), and a random id would also
  // remount the host on every render.
  return (
    <div className="grid gap-4">
      {host('status-banner-hero', `m-banner-${key}`, { stats: HERO_STATS }, statusBannerHeroDemoData(6), 'success', 'h-32')}
      {host('alert-banner', `m-alert-${key}`, { dismissible: true }, alertBannerDemoData(1), 'success', 'h-32')}
      {host('diagnostics-readout', `m-diag-${key}`, { title: 'Connection check' }, diagnosticsReadoutDemoData(5))}
    </div>
  );
}

export const LightLtr = { name: 'light · LTR', render: () => <Frame dir="ltr">{matrixCells('light-ltr')}</Frame> };
export const LightRtl = { name: 'light · RTL', render: () => <Frame dir="rtl">{matrixCells('light-rtl')}</Frame> };
export const DarkLtr = { name: 'dark · LTR', render: () => <Frame dark dir="ltr">{matrixCells('dark-ltr')}</Frame> };
export const DarkRtl = { name: 'dark · RTL', render: () => <Frame dark dir="rtl">{matrixCells('dark-rtl')}</Frame> };

// ── state-hero view map ────────────────────────────────────────────────────

/** Every `stateMap` view id the annex enumerates, in one frame. */
export const StateHeroViews = {
  name: 'state-hero · views',
  render: () => (
    <Frame>
      <div className="grid grid-cols-3 gap-4">
        {(['404', '500', 'offline', 'forbidden', 'maintenance', 'conn-error'] as const).map((view) =>
          host('state-hero', `v-${view}`, { view }, { row: { view } }, 'success', 'h-72'),
        )}
      </div>
    </Frame>
  ),
};
