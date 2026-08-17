// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK TABLES-CAL-BOARDS `tables` M7 Wave-4 TAIL stories (annex §3): each
 * widget's loaded variant, the four WidgetFrame states through WidgetHost
 * (acceptance #4), and light/dark × LTR/RTL matrices with REAL geometry
 * mirroring (acceptance #9 — the RTL frames set `dir="rtl"` so the ranked bars
 * grow from the right, the delta-pill columns move to the left edge, the
 * accordion badges lead on the right, and the chip icons flip to the chip's
 * trailing side; a bare attribute would prove nothing).
 *
 * Widgets resolve through a LOCAL registry override so the stories work before
 * the green loop merges the definitions into the global map. Payloads are the
 * same seeded generators `demoData` uses.
 */
import type { ReactNode } from 'react';

import { AccordionList, accordionRowsOf } from './AccordionList.js';
import { ChipCloud, cloudChipsOf } from './ChipCloud.js';
import { ComparisonMatrix, comparisonDataOf } from './ComparisonMatrix.js';
import { RankedEntityList, rankedEntitiesOf } from './RankedEntityList.js';
import { SparklineTable, sparkRowsOf } from './SparklineTable.js';
import { TopMoversList, moverRowsOf } from './TopMoversList.js';
import {
  accordionListDemoData,
  chipCloudDemoData,
  comparisonMatrixConfigSchema,
  comparisonMatrixDemoData,
  rankedEntityListDemoData,
  sparklineTableDemoData,
  topMoversListDemoData,
} from './tables-tail-config.js';
import { tablesTailDefinitions } from './tables-tail.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([...tablesTailDefinitions] as WidgetDefinition[]);

const meta = { title: 'Widgets/Tables (tail)' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
) {
  return (
    <div className="h-80 w-full">
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('METRICS_FORBIDDEN'), refetch: () => {} }
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

/** Schema defaults + overrides — the same projection the host performs. */
function parse<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse(overrides);
}

// ── Per-widget loaded variants ─────────────────────────────────────────────

export const SparklineTableStory = {
  name: 'sparkline-table',
  render: () => host('sparkline-table', 's-spark', { title: 'Metrics' }, sparklineTableDemoData(7)),
};

export const TopMoversListStory = {
  name: 'top-movers-list',
  render: () => host('top-movers-list', 's-movers', { title: 'Top movers', n: 5 }, topMoversListDemoData(3)),
};

export const RankedEntityListStory = {
  name: 'ranked-entity-list',
  render: () => host('ranked-entity-list', 's-ranked', { title: 'Top regions' }, rankedEntityListDemoData(5)),
};

export const AccordionListStory = {
  name: 'accordion-list',
  render: () =>
    host('accordion-list', 's-accordion', { title: 'Endpoints', defaultOpen: ['ep-1'] }, accordionListDemoData(2)),
};

export const ComparisonMatrixStory = {
  name: 'comparison-matrix',
  render: () =>
    host(
      'comparison-matrix',
      's-compare',
      { title: 'Plans', promotedColumn: 'team', promotedLabel: 'Recommended' },
      comparisonMatrixDemoData(4),
    ),
};

export const ChipCloudStory = {
  name: 'chip-cloud',
  render: () => host('chip-cloud', 's-chips', { title: 'Discovered tables' }, chipCloudDemoData(9)),
};

// ── Four WidgetFrame states (acceptance #4) ────────────────────────────────

/** sparkline-table: loaded · skeleton · empty · error. */
export const States = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('sparkline-table', 'st-loaded', { title: 'Metrics' }, sparklineTableDemoData(7))}
        {host('sparkline-table', 'st-skeleton', { title: 'Metrics' }, undefined, 'loading')}
        {host(
          'sparkline-table',
          'st-empty',
          { title: 'Metrics', emptyState: { titleKey: 'No metrics to show' } },
          { data: [], total: 0 },
        )}
        {host('sparkline-table', 'st-error', { title: 'Metrics' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/** accordion-list: the same four states for the expandable list. */
export const AccordionStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('accordion-list', 'as-loaded', { title: 'Endpoints' }, accordionListDemoData(2))}
        {host('accordion-list', 'as-skeleton', { title: 'Endpoints' }, undefined, 'loading')}
        {host(
          'accordion-list',
          'as-empty',
          { title: 'Endpoints', emptyState: { titleKey: 'Nothing to expand' } },
          { data: [], total: 0 },
        )}
        {host('accordion-list', 'as-error', { title: 'Endpoints' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/** chip-cloud: the same four states for the inline cloud. */
export const ChipCloudStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('chip-cloud', 'cc-loaded', { title: 'Tables' }, chipCloudDemoData(9))}
        {host('chip-cloud', 'cc-skeleton', { title: 'Tables' }, undefined, 'loading')}
        {host('chip-cloud', 'cc-empty', { title: 'Tables', emptyState: { titleKey: 'Nothing discovered yet' } }, { items: [] })}
        {host('chip-cloud', 'cc-error', { title: 'Tables' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

// ── light/dark × LTR/RTL with real mirroring (acceptance #9) ───────────────

/**
 * The metric trio. Under RTL the rows genuinely reverse: the ranked bars grow
 * from the right edge (`start-0`), the fixed-width delta-pill column lands on
 * the left, and the trend arrows mirror (`rtl:-scale-x-100`).
 */
export const MetricsThemeAndDirectionMatrix = {
  render: () => {
    const spark = sparkRowsOf(sparklineTableDemoData(7));
    const movers = moverRowsOf(topMoversListDemoData(3));
    const ranked = rankedEntitiesOf(rankedEntityListDemoData(5));
    const row = () => (
      <div className="grid grid-cols-3 gap-4">
        <div className="h-64 overflow-hidden rounded-lg border border-border bg-surface">
          <SparklineTable rows={spark} />
        </div>
        <div className="h-64 overflow-hidden rounded-lg border border-border bg-surface">
          <TopMoversList rows={movers} />
        </div>
        <div className="h-64 overflow-hidden rounded-lg border border-border bg-surface">
          <RankedEntityList rows={ranked} />
        </div>
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{row()}</Frame>
        <Frame dir="rtl">{row()}</Frame>
        <Frame dark dir="ltr">{row()}</Frame>
        <Frame dark dir="rtl">{row()}</Frame>
      </div>
    );
  },
};

/**
 * The accordion + chip cloud. Under RTL the method badge leads on the right and
 * each chip's icon flips to the chip's trailing side (`me-1`).
 */
export const ListsThemeAndDirectionMatrix = {
  render: () => {
    const rows = accordionRowsOf(accordionListDemoData(2));
    const chips = cloudChipsOf(chipCloudDemoData(9));
    const row = () => (
      <div className="grid grid-cols-2 gap-4">
        <div className="h-72 overflow-hidden rounded-lg border border-border bg-surface">
          <AccordionList rows={rows} defaultOpen={['ep-1']} />
        </div>
        <div className="h-72 overflow-hidden rounded-lg border border-border bg-surface">
          <ChipCloud chips={chips} />
        </div>
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{row()}</Frame>
        <Frame dir="rtl">{row()}</Frame>
        <Frame dark dir="ltr">{row()}</Frame>
        <Frame dark dir="rtl">{row()}</Frame>
      </div>
    );
  },
};

/**
 * The comparison grid. Under RTL the feature-label column moves to the right and
 * the plan columns reverse with it — the grid's own inline axis flips, which is
 * exactly what a bare `dir` attribute on a `<table>`-less CSS grid must prove.
 */
export const ComparisonThemeAndDirectionMatrix = {
  render: () => {
    const config = parse(comparisonMatrixConfigSchema, { promotedColumn: 'team' });
    const matrix = comparisonDataOf(comparisonMatrixDemoData(4), config);
    const grid = () => (
      <div className="h-80 overflow-hidden rounded-lg border border-border bg-surface">
        <ComparisonMatrix
          columns={matrix.columns}
          rows={matrix.rows}
          groups={matrix.groups}
          promotedColumn="team"
          promotedLabel="Recommended"
        />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{grid()}</Frame>
        <Frame dir="rtl">{grid()}</Frame>
        <Frame dark dir="ltr">{grid()}</Frame>
        <Frame dark dir="rtl">{grid()}</Frame>
      </div>
    );
  },
};

// ── Interaction stories ────────────────────────────────────────────────────

/** Expanding an accordion row — the exclusive branch collapses its sibling. */
export const AccordionExclusiveInteraction = {
  name: 'accordion-list (exclusive)',
  render: () => (
    <Frame>
      <div className="h-72 rounded-lg border border-border bg-surface">
        <AccordionList rows={accordionRowsOf(accordionListDemoData(2))} exclusive defaultOpen={['ep-1']} />
      </div>
    </Frame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const headers = canvasElement.querySelectorAll<HTMLElement>('[data-part="accordion-header"]');
    headers[1]?.click(); // opens row 2 and closes row 1
  },
};
