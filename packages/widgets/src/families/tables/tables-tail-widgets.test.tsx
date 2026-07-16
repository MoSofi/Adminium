// @vitest-environment happy-dom
/**
 * TRACK TABLES-CAL-BOARDS — the `tables` family M7 Wave-4 TAIL (annex §3):
 * sparkline-table, top-movers-list, ranked-entity-list, accordion-list,
 * comparison-matrix, chip-cloud.
 *
 * The generic properties every widget shares (four states, determinism,
 * config-fuzz, registry parity, chunk budget) are covered once for the whole
 * registry by the `qa/` harness. What is tested here is what only THIS slice
 * knows: the good/bad delta polarity, the proportional bar maths, the accordion
 * open-state machine, the matrix cell vocabulary, the chip projection, and the
 * annex-mandated event contracts.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccordionList, accordionRowsOf } from './AccordionList.js';
import { ChipCloud, ChipCloudWidget, cloudChipsOf } from './ChipCloud.js';
import { ComparisonMatrix, comparisonDataOf } from './ComparisonMatrix.js';
import { RankedEntityList, RankedEntityListWidget, rankedEntitiesOf } from './RankedEntityList.js';
import { SparklineTable, sparkRowsOf } from './SparklineTable.js';
import { TopMoversList, moverRowsOf } from './TopMoversList.js';
import {
  accordionListDemoData,
  chipCloudConfigSchema,
  chipCloudDemoData,
  comparisonMatrixConfigSchema,
  comparisonMatrixDemoData,
  rankedEntityListConfigSchema,
  rankedEntityListDemoData,
  sparklineTableDemoData,
  topMoversListDemoData,
} from './tables-tail-config.js';
import { formatDelta, goodDirectionFor, isBadMove, rankRows, toggleOpen, trendOf } from './tables-tail-lib.js';
import { tablesTailDefinitions } from './tables-tail.definitions.js';

afterEach(cleanup);

const parse = <T,>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T =>
  schema.parse(overrides);

// ── tables-tail-lib: the delta polarity every metric widget shares ──────────

describe('delta polarity (annex §3 "good/bad aware")', () => {
  it('defaults to up-is-good, and lets the row override it', () => {
    expect(goodDirectionFor('Sessions', undefined, undefined)).toBe('up');
    expect(goodDirectionFor('Error rate', 'down', undefined)).toBe('down');
  });

  it('lets a per-metric config override beat the row (annex goodDirectionByMetric)', () => {
    // The binding may not know a metric's polarity; the dashboard author does.
    expect(goodDirectionFor('Latency', 'up', { Latency: 'down' })).toBe('down');
  });

  it('treats an unknown direction string as up-is-good rather than throwing', () => {
    expect(goodDirectionFor('X', 'sideways', undefined)).toBe('up');
  });

  it('reads a rise in a down-is-good metric as a BAD move (the whole point)', () => {
    expect(isBadMove(12, 'down')).toBe(true); // errors up = bad
    expect(isBadMove(-12, 'down')).toBe(false); // errors down = good
    expect(isBadMove(12, 'up')).toBe(false); // sessions up = good
    expect(isBadMove(-12, 'up')).toBe(true); // sessions down = bad
  });

  it('never calls a zero delta a move in either polarity', () => {
    expect(isBadMove(0, 'up')).toBe(false);
    expect(isBadMove(0, 'down')).toBe(false);
    expect(trendOf(0)).toBe('flat');
    expect(trendOf(undefined)).toBe('flat');
  });

  it('composes the delta sign so the glyph cannot detach from its digits', () => {
    expect(formatDelta(12.4, 'en-US')).toBe('+12.4%');
    expect(formatDelta(-3.1, 'en-US')).toBe('−3.1%');
    expect(formatDelta(undefined, 'en-US')).toBe('—');
  });
});

// ── sparkline-table ─────────────────────────────────────────────────────────

describe('sparkline-table (annex §3)', () => {
  it('renders a row per metric with its value and delta pill, capped at `rows`', () => {
    render(<SparklineTable rows={sparkRowsOf(sparklineTableDemoData(7))} limit={4} />);
    expect(document.querySelectorAll('[data-part="spark-row"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-part="spark-delta"]').length).toBeGreaterThan(0);
  });

  it('inverts the delta pill tone for a down-is-good metric', () => {
    render(
      <SparklineTable
        rows={[
          { id: 1, name: 'Error rate', value: 12, delta: 8, goodDirection: 'down', spark: [1, 2, 3] },
          { id: 2, name: 'Sessions', value: 900, delta: 8, goodDirection: 'up', spark: [1, 2, 3] },
        ]}
      />
    );
    const pills = document.querySelectorAll('[data-part="spark-delta"]');
    // Same +8 delta, opposite meaning: danger for the error rate, pos for sessions.
    expect(pills[0]?.getAttribute('data-tone')).toBe('danger');
    expect(pills[1]?.getAttribute('data-tone')).toBe('pos');
  });

  it('lets a config goodDirectionByMetric override flip an existing row', () => {
    render(
      <SparklineTable
        rows={[{ id: 1, name: 'Latency', value: 120, delta: 5, goodDirection: 'up' }]}
        goodDirectionByMetric={{ Latency: 'down' }}
      />
    );
    expect(document.querySelector('[data-part="spark-delta"]')?.getAttribute('data-tone')).toBe('danger');
  });

  it('renders a row with no sparkline and no delta rather than crashing', () => {
    render(<SparklineTable rows={[{ id: 1, name: 'Bare', value: 5 }]} />);
    expect(screen.getByText('Bare')).toBeTruthy();
    expect(document.querySelector('[data-part="spark-delta"]')).toBeNull();
  });

  it('shows the per-widget empty copy with no rows', () => {
    render(<SparklineTable rows={[]} emptyTitle="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  it('projects a pg-style numeric string value without mangling it', () => {
    const rows = sparkRowsOf({ data: [{ id: 1, name: 'MRR', value: '1200', delta: 4 }], total: 1 });
    expect(rows[0]?.value).toBe('1200');
  });
});

// ── top-movers-list ─────────────────────────────────────────────────────────

describe('top-movers-list (annex §3)', () => {
  it('re-ranks by |delta| defensively, so an unsorted binding still shows movers', () => {
    render(
      <TopMoversList
        rows={[
          { id: 'a', name: 'Small', value: 1, delta: 2 },
          { id: 'b', name: 'Huge', value: 1, delta: -90 },
          { id: 'c', name: 'Mid', value: 1, delta: 40 },
        ]}
        n={2}
      />
    );
    const rows = [...document.querySelectorAll('[data-part="mover-row"]')];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute('data-metric'))).toEqual(['Huge', 'Mid']);
  });

  it('marks a bad mover regardless of the delta sign (annex "danger for bad movers")', () => {
    render(
      <TopMoversList
        rows={[
          { id: 'a', name: 'Checkout errors', value: 9, delta: 40, goodDirection: 'down' },
          { id: 'b', name: 'Signups', value: 9, delta: 40, goodDirection: 'up' },
        ]}
      />
    );
    const rows = [...document.querySelectorAll('[data-part="mover-row"]')];
    expect(rows[0]?.hasAttribute('data-bad')).toBe(true);
    expect(rows[1]?.hasAttribute('data-bad')).toBe(false);
  });

  it('keeps the rows inert (no dead buttons) when no drill-through is configured', () => {
    render(<TopMoversList rows={moverRowsOf(topMoversListDemoData(3))} />);
    expect(document.querySelectorAll('[data-part="mover-row"] button')).toHaveLength(0);
  });

  it('ships its demo payload already ranked, as the annex contract promises', () => {
    const { data } = topMoversListDemoData(11);
    const deltas = data.map((row) => Math.abs(row.delta));
    expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
  });
});

// ── ranked-entity-list ──────────────────────────────────────────────────────

describe('ranked-entity-list (annex §3)', () => {
  it('scales the bars against the slice leader, not the grand total', () => {
    const ranked = rankRows(
      [
        { id: 1, name: 'A', value: 100 },
        { id: 2, name: 'B', value: 50 },
        { id: 3, name: 'C', value: 25 },
      ],
      3,
    );
    // The leader fills the track; the rest read as a share OF THE LEADER.
    expect(ranked.map((row) => row.pct)).toEqual([100, 50, 25]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('keeps the true total-relative share available for the percent format', () => {
    const ranked = rankRows(
      [
        { id: 1, name: 'A', value: 75 },
        { id: 2, name: 'B', value: 25 },
      ],
      2,
    );
    expect(ranked[0]?.share).toBeCloseTo(0.75);
    expect(ranked[1]?.share).toBeCloseTo(0.25);
  });

  it('computes the share against the FULL set, not just the visible top-N', () => {
    const ranked = rankRows(
      [
        { id: 1, name: 'A', value: 50 },
        { id: 2, name: 'B', value: 25 },
        { id: 3, name: 'C', value: 25 },
      ],
      1,
    );
    // A is 50% of everything — cutting the list to one row must not inflate it to 100%.
    expect(ranked[0]?.share).toBeCloseTo(0.5);
    expect(ranked[0]?.pct).toBe(100);
  });

  it('survives an all-zero metric without dividing by zero', () => {
    const ranked = rankRows([{ id: 1, name: 'A', value: 0 }], 5);
    expect(ranked[0]?.pct).toBe(0);
    expect(ranked[0]?.share).toBe(0);
  });

  it('sorts and slices to the configured top-N', () => {
    render(<RankedEntityList rows={rankedEntitiesOf(rankedEntityListDemoData(5))} n={3} />);
    const rows = [...document.querySelectorAll('[data-part="rank-row"]')];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.getAttribute('data-rank'))).toEqual(['1', '2', '3']);
  });

  it('emits a drill-through carrying the row key against the sibling linkTarget', () => {
    const onEvent = vi.fn();
    render(
      <RankedEntityListWidget
        config={parse(rankedEntityListConfigSchema, { linkTarget: 'map-1', href: '/analytics' })}
        data={{ data: [{ id: 1, name: 'Germany', key: 'germany', value: 10 }], total: 1 }}
        instanceId="ranked-1"
        onEvent={onEvent}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Germany/ }));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/analytics#map-1=germany' });
  });

  it('renders inert rows when neither linkTarget nor href is set', () => {
    render(
      <RankedEntityListWidget
        config={parse(rankedEntityListConfigSchema)}
        data={{ data: [{ id: 1, name: 'Germany', value: 10 }], total: 1 }}
        instanceId="ranked-2"
        onEvent={vi.fn()}
      />
    );
    expect(document.querySelectorAll('[data-part="rank-row"] button')).toHaveLength(0);
  });
});

// ── accordion-list ──────────────────────────────────────────────────────────

describe('accordion-list open-state (annex §3 "single- or multi-open")', () => {
  it('multi-open accumulates and removes independently', () => {
    let open: ReadonlySet<string> = new Set<string>();
    open = toggleOpen(open, 'a', false);
    open = toggleOpen(open, 'b', false);
    expect([...open].sort()).toEqual(['a', 'b']);
    open = toggleOpen(open, 'a', false);
    expect([...open]).toEqual(['b']);
  });

  it('exclusive collapses the sibling, and re-clicking still closes the row', () => {
    let open: ReadonlySet<string> = new Set(['a']);
    open = toggleOpen(open, 'b', true);
    expect([...open]).toEqual(['b']);
    open = toggleOpen(open, 'b', true);
    expect([...open]).toEqual([]);
  });
});

describe('accordion-list (annex §3)', () => {
  it('unmounts a collapsed panel, so it is not tabbable or findable', () => {
    render(<AccordionList rows={accordionRowsOf(accordionListDemoData(2))} />);
    expect(document.querySelectorAll('[data-part="accordion-panel"]')).toHaveLength(0);
    fireEvent.click(document.querySelectorAll('[data-part="accordion-header"]')[0] as HTMLElement);
    expect(document.querySelectorAll('[data-part="accordion-panel"]')).toHaveLength(1);
  });

  it('wires aria-expanded + aria-controls to the panel it opens', () => {
    render(<AccordionList rows={accordionRowsOf(accordionListDemoData(2))} defaultOpen={['ep-1']} />);
    const header = document.querySelector('[data-part="accordion-header"]') as HTMLElement;
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(header.getAttribute('aria-controls') as string)).not.toBeNull();
  });

  it('honours defaultOpen but only for rows that exist', () => {
    render(<AccordionList rows={accordionRowsOf(accordionListDemoData(2))} defaultOpen={['nope', 'ep-2']} />);
    const panels = document.querySelectorAll('[data-part="accordion-panel"]');
    expect(panels).toHaveLength(1);
  });

  it('opens at most one row in exclusive mode even if defaultOpen lists several', () => {
    render(
      <AccordionList rows={accordionRowsOf(accordionListDemoData(2))} exclusive defaultOpen={['ep-1', 'ep-2']} />
    );
    expect(document.querySelectorAll('[data-part="accordion-panel"]')).toHaveLength(1);
  });

  it('closes the open sibling when exclusive (only ever one panel)', () => {
    render(<AccordionList rows={accordionRowsOf(accordionListDemoData(2))} exclusive defaultOpen={['ep-1']} />);
    fireEvent.click(document.querySelectorAll('[data-part="accordion-header"]')[1] as HTMLElement);
    expect(document.querySelectorAll('[data-part="accordion-panel"]')).toHaveLength(1);
  });

  it('shows the per-widget empty copy with no rows', () => {
    render(<AccordionList rows={[]} emptyTitle="Nothing to expand" />);
    expect(screen.getByText('Nothing to expand')).toBeTruthy();
  });

  it('drops malformed field entries rather than rendering blank detail rows', () => {
    const rows = accordionRowsOf({
      data: [{ id: 'x', header: 'H', fields: [{ label: '', value: 'v' }, 'nope', { label: 'ok', value: 'v' }] }],
      total: 1,
    });
    expect(rows[0]?.fields?.map((f) => f.label)).toEqual(['ok']);
  });
});

// ── comparison-matrix ───────────────────────────────────────────────────────

describe('comparison-matrix (annex §3)', () => {
  const config = parse(comparisonMatrixConfigSchema, { promotedColumn: 'team' });

  it('renders the check / em-dash / mono-text cell vocabulary', () => {
    const matrix = comparisonDataOf(comparisonMatrixDemoData(4), config);
    render(
      <ComparisonMatrix columns={matrix.columns} rows={matrix.rows} groups={matrix.groups} promotedColumn="team" />
    );
    // Every row × column pair produces exactly one cell.
    expect(document.querySelectorAll('[data-part="cmp-cell"]')).toHaveLength(matrix.rows.length * matrix.columns.length);
    // false/undefined cells carry assistive text rather than a read-aloud dash.
    expect(screen.getAllByText('Not included').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Included').length).toBeGreaterThan(0);
  });

  it('marks the promoted column on its header and every one of its cells', () => {
    const matrix = comparisonDataOf(comparisonMatrixDemoData(4), config);
    render(<ComparisonMatrix columns={matrix.columns} rows={matrix.rows} promotedColumn="team" />);
    expect(document.querySelectorAll('[data-part="cmp-col"][data-promoted]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-part="cmp-cell"][data-promoted]')).toHaveLength(matrix.rows.length);
  });

  it('promotes nothing when promotedColumn names a column that is not there', () => {
    const matrix = comparisonDataOf(comparisonMatrixDemoData(4), config);
    render(<ComparisonMatrix columns={matrix.columns} rows={matrix.rows} promotedColumn="ghost" />);
    expect(document.querySelectorAll('[data-promoted]')).toHaveLength(0);
  });

  it('applies the config column allow-list AND its order', () => {
    const restricted = comparisonDataOf(
      comparisonMatrixDemoData(4),
      parse(comparisonMatrixConfigSchema, { columns: ['enterprise', 'starter'] }),
    );
    expect(restricted.columns.map((column) => column.id)).toEqual(['enterprise', 'starter']);
  });

  it('renders category bands, and ungrouped rows before the first band', () => {
    render(
      <ComparisonMatrix
        columns={[{ id: 'a', label: 'A' }]}
        rows={[
          { id: 'r1', label: 'Loose', cells: { a: true } },
          { id: 'r2', label: 'Banded', group: 'G', cells: { a: true } },
        ]}
        groups={['G']}
      />
    );
    const bands = [...document.querySelectorAll('[data-part="cmp-band"]')];
    expect(bands).toHaveLength(2);
    expect(bands[0]?.getAttribute('data-band')).toBeNull(); // the ungrouped band leads
    expect(bands[1]?.getAttribute('data-band')).toBe('G');
  });

  it('threads its seed (quota numbers vary) so the determinism gate stays meaningful', () => {
    const a = JSON.stringify(comparisonMatrixDemoData(1));
    const b = JSON.stringify(comparisonMatrixDemoData(2));
    expect(a).not.toBe(b);
  });

  it('renders an empty matrix payload without crashing', () => {
    render(<ComparisonMatrix columns={[]} rows={[]} />);
    expect(document.querySelector('[data-widget="comparison-matrix"]')).not.toBeNull();
  });
});

// ── chip-cloud ──────────────────────────────────────────────────────────────

describe('chip-cloud (annex §3)', () => {
  it('projects the canonical categorical envelope', () => {
    expect(cloudChipsOf(chipCloudDemoData(9)).length).toBeGreaterThan(0);
  });

  it('also projects a bare string array — the annex contract', () => {
    expect(cloudChipsOf(['a', 'b'])).toEqual([
      { label: 'a', value: 'a' },
      { label: 'b', value: 'b' },
    ]);
  });

  it('drops empty and malformed entries instead of rendering blank chips', () => {
    expect(cloudChipsOf(['', null, 42, { label: '' }, { name: 'ok' }])).toEqual([{ label: 'ok', value: 'ok' }]);
  });

  it('renders inert spans when no click action is configured', () => {
    render(<ChipCloud chips={cloudChipsOf(chipCloudDemoData(9))} />);
    expect(document.querySelectorAll('[data-part="cloud-chip"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders buttons once a click action AND a handler are supplied', () => {
    const onSelect = vi.fn();
    render(<ChipCloud chips={[{ label: 'public.orders' }]} clickAction="navigate" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('collapses past `limit` into a +N overflow chip', () => {
    render(<ChipCloud chips={cloudChipsOf(['a', 'b', 'c', 'd'])} limit={2} moreLabel="+{n} more" />);
    expect(document.querySelectorAll('[data-part="cloud-chip"]')).toHaveLength(2);
    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('shows the per-widget empty copy with no chips', () => {
    render(<ChipCloud chips={[]} emptyTitle="Nothing discovered yet" />);
    expect(screen.getByText('Nothing discovered yet')).toBeTruthy();
  });

  it('emits a navigate drill-through carrying the chip value, url-encoded', () => {
    const onEvent = vi.fn();
    render(
      <ChipCloudWidget
        config={parse(chipCloudConfigSchema, { clickAction: 'navigate', href: '/tables/' })}
        data={{ items: [{ label: 'public.orders' }] }}
        instanceId="chips-1"
        onEvent={onEvent}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/tables/public.orders' });
  });

  it('emits nothing for the insert action — pasting is the host composer’s job', () => {
    const onEvent = vi.fn();
    render(
      <ChipCloudWidget
        config={parse(chipCloudConfigSchema, { clickAction: 'insert', href: '/x' })}
        data={{ items: [{ label: 'first_name' }] }}
        instanceId="chips-2"
        onEvent={onEvent}
      />
    );
    // No handler ⇒ inert chips ⇒ nothing to click, and nothing emitted.
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(onEvent).not.toHaveBeenCalled();
  });
});

// ── definitions ─────────────────────────────────────────────────────────────

describe('tables tail definitions (annex §3)', () => {
  it('registers exactly the six remaining §3 ids', () => {
    expect(tablesTailDefinitions.map((d) => d.id).sort()).toEqual([
      'accordion-list',
      'chip-cloud',
      'comparison-matrix',
      'ranked-entity-list',
      'sparkline-table',
      'top-movers-list',
    ]);
  });

  it('declares every widget in the tables family', () => {
    expect(tablesTailDefinitions.every((d) => d.family === 'tables')).toBe(true);
  });

  it('sizes every widget at or above the annex minimum, in 40px half-units', () => {
    for (const definition of tablesTailDefinitions) {
      expect(definition.sizing.defaultW).toBeGreaterThanOrEqual(definition.sizing.minW);
      expect(definition.sizing.defaultH).toBeGreaterThanOrEqual(definition.sizing.minH);
    }
  });

  it('places chip-cloud inline (annex "inline / min 3×1")', () => {
    expect(tablesTailDefinitions.find((d) => d.id === 'chip-cloud')?.placement).toBe('inline');
  });
});
