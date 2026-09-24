// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A template's KPI strip reads money in the connection's currency.
 *
 * A money card stored without a currency drew US dollars on every template but
 * the dashboard: a clinic in pounds saw `$0.00` over its Appointments calendar.
 * Each template that draws stored widgets now merges the page's currency into
 * a card that names none, and leaves a card that names its own alone.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withCurrency } from './page-currency.js';
import { PageBoard } from './page-board/PageBoard.js';
import { PageCalendar } from './page-calendar/PageCalendar.js';
import { PageDirectory } from './page-directory/PageDirectory.js';
import { PageLogViewer } from './page-log-viewer/PageLogViewer.js';
import { PageQueueInbox } from './page-queue-inbox/PageQueueInbox.js';
import { PageScheduler } from './page-scheduler/PageScheduler.js';

afterEach(cleanup);

const kpi = (i: string, x: number, config: Record<string, unknown>) => ({ i, widget: 'kpi-stat-card', x, y: 0, w: 3, h: 3, config });
const TAKEN = kpi('taken', 0, { title: 'Taken', metricFormat: 'currency' });
const DOLLARS = kpi('dollars', 3, { title: 'Dollars', metricFormat: 'currency', format: { currency: 'USD' } });
const states = {
  taken: { status: 'success' as const, data: { value: 40 } },
  dollars: { status: 'success' as const, data: { value: 40 } },
};
const page = (items: Record<string, unknown>[]) => ({
  templateVersion: 1,
  toolbar: [],
  overlays: [],
  layout: { version: 1, items },
});

async function expectPoundsAndDollars(): Promise<void> {
  expect(await screen.findByText(/£40/)).toBeDefined();
  expect(await screen.findByText(/\$40/)).toBeDefined();
}

describe('withCurrency', () => {
  it('fills a card that names no currency and keeps one that does', () => {
    expect(withCurrency({ metricFormat: 'currency' }, 'GBP')).toEqual({ metricFormat: 'currency', format: { currency: 'GBP' } });
    expect(withCurrency({ format: { currency: 'USD', decimals: 0 } }, 'GBP')).toEqual({ format: { currency: 'USD', decimals: 0 } });
    expect(withCurrency({ format: { decimals: 0 } }, 'GBP')).toEqual({ format: { decimals: 0, currency: 'GBP' } });
    const stored = { metricFormat: 'currency' };
    expect(withCurrency(stored, undefined)).toBe(stored);
    // Merged as the page draws, never into what is stored.
    withCurrency(stored, 'GBP');
    expect(stored).toEqual({ metricFormat: 'currency' });
  });
});

describe('the connection’s currency on each template’s KPI cards', () => {
  it('page-calendar', async () => {
    render(<PageCalendar config={page([TAKEN, DOLLARS])} states={states} referenceDate="2026-09-24" currency="GBP" />);
    await expectPoundsAndDollars();
  });

  it('page-scheduler', async () => {
    render(<PageScheduler config={page([TAKEN, DOLLARS])} states={states} referenceDate="2026-09-24" currency="GBP" />);
    await expectPoundsAndDollars();
  });

  it('page-board', async () => {
    render(<PageBoard config={page([TAKEN, DOLLARS])} states={states} currency="GBP" />);
    await expectPoundsAndDollars();
  });

  it('page-queue-inbox', async () => {
    // The KPI row is its instances `kpi-row-1`, `kpi-row-2`, …
    const row = { 'kpi-row-1': states.taken, 'kpi-row-2': states.dollars };
    render(<PageQueueInbox config={page([{ ...TAKEN, i: 'kpi-row-1' }, { ...DOLLARS, i: 'kpi-row-2' }])} states={row} currency="GBP" />);
    await expectPoundsAndDollars();
  });

  it('page-log-viewer', async () => {
    render(<PageLogViewer layout={{ version: 1, items: [TAKEN, DOLLARS] }} states={states} currency="GBP" />);
    await expectPoundsAndDollars();
  });

  it('page-directory', async () => {
    render(<PageDirectory config={page([{ ...TAKEN, i: 'summary' }])} states={{ summary: states.taken }} currency="GBP" />);
    expect(await screen.findByText(/£40/)).toBeDefined();
  });
});
