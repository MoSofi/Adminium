// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The parts of an app in the dashboard: the settings page's Parts card with
 * the question each switch asks first, and the install check's ticks.
 *
 * Worth proving: a part that is always on has no switch; one that waits for
 * an add-on says so in place of a switch; switching off first reads what is
 * open in the part and lists it, and nothing is sent until the answer is yes;
 * switching on says that what was missed is not caught up; and the install is
 * sent with a tick for every part that has a switch.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { AppPartsCard, PartsInstallCard, partChoicesOf } from './AppPartsCard.js';
import type { AppPart, PlanModule } from './appsApi.js';

const part = (over: Partial<AppPart> & { id: string; label: string }): AppPart => ({ default: 'on', switch: true, on: true, waiting: [], leftOut: false, pages: 1, tables: 1, rules: 0, roles: [], ...over });

let parts: AppPart[];
let calls: { method: string; url: string; body?: unknown }[];

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  parts = [
    part({ id: 'selling', label: 'Selling', default: 'always', pages: 12 }),
    part({ id: 'jobs', label: 'Jobs on site', pages: 3, rules: 2, roles: [{ slug: 'crm-crew', name: 'Field crew', members: 2 }] }),
    part({ id: 'fleet', label: 'Vehicles and crew', default: 'off', switch: false, on: false }),
    part({ id: 'quotes', label: 'Quotes', on: false, leftOut: true, waiting: [{ key: 'invoices', name: 'Invoices & Receipts' }] }),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      calls.push({ method, url, ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}) });
      if (url.endsWith('/apps/crm/parts') && method === 'GET') return jsonResponse(200, { parts });
      if (url.endsWith('/parts/jobs/open')) {
        return jsonResponse(200, { id: 'jobs', label: 'Jobs on site', open: [{ table: 'jobs', label: 'Jobs', rows: 3 }], rules: 2, pages: 3, stranded: 1 });
      }
      if (method === 'PUT') {
        const id = url.split('/').pop()!;
        const on = (JSON.parse(String(init?.body)) as { on: boolean }).on;
        parts = parts.map((one) => (one.id === id ? { ...one, switch: on, on } : one));
        return jsonResponse(200, { parts });
      }
      return jsonResponse(200, { data: {} });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function card() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AppPartsCard appKey="crm" />
    </QueryClientProvider>,
  );
}

describe('the Parts card of an app', () => {
  it('shows each part with what it holds, and a switch only where there is one', async () => {
    card();
    const list = await screen.findByTestId('app-parts');
    const row = (id: string) => within(list.querySelector(`[data-part="${id}"]`) as HTMLElement);
    expect(row('selling').getByText('Always on')).toBeTruthy();
    expect(row('selling').queryByRole('switch')).toBeNull();
    expect(row('jobs').getByText('3 pages · 2 rules on · Roles: Field crew')).toBeTruthy();
    expect((row('jobs').getByRole('switch', { name: 'Jobs on site, on or off' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
    expect(row('fleet').getByRole('switch').getAttribute('aria-checked')).toBe('false');
    // A part that waits for an add-on has no switch: the add-on is what brings it.
    expect(row('quotes').queryByRole('switch')).toBeNull();
    expect(row('quotes').getByText('Needs an add-on')).toBeTruthy();
    expect(row('quotes').getByText('Not set up yet. Connect Invoices & Receipts under Add-ons and it is put in.')).toBeTruthy();
  });

  it('asks before switching off, with what is open in the part, and sends nothing until the answer is yes', async () => {
    const user = userEvent.setup();
    card();
    await user.click(await screen.findByRole('switch', { name: 'Jobs on site, on or off' }));
    const dialog = await screen.findByTestId('part-off-dialog');
    expect(within(dialog).getByText('3 not finished in Jobs')).toBeTruthy();
    expect(within(dialog).getByText('2 rules that are on will stop')).toBeTruthy();
    expect(within(dialog).getByText('1 person will have nothing switched on for them')).toBeTruthy();
    expect(within(dialog).getByText('Its records stay. A role of another part that reads them still does.')).toBeTruthy();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'PUT')).toMatchObject({ url: expect.stringContaining('/apps/crm/parts/jobs'), body: { on: false } }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Jobs on site, on or off' }).getAttribute('aria-checked')).toBe('false'));
  });

  it('leaves the part as it was when the answer is no', async () => {
    const user = userEvent.setup();
    card();
    await user.click(await screen.findByRole('switch', { name: 'Jobs on site, on or off' }));
    await screen.findByTestId('part-off-dialog');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    expect(screen.getByRole('switch', { name: 'Jobs on site, on or off' }).getAttribute('aria-checked')).toBe('true');
  });

  it('says, before switching on, that what was missed is not caught up', async () => {
    const user = userEvent.setup();
    card();
    await user.click(await screen.findByRole('switch', { name: 'Vehicles and crew, on or off' }));
    const dialog = await screen.findByTestId('part-on-dialog');
    expect(within(dialog).getByText(/Nothing that happened while it was off is caught up/)).toBeTruthy();
    // Nothing is asked of the server about what is open: that is the question of switching off.
    expect(calls.some((call) => call.url.endsWith('/open'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Switch on' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'PUT')).toMatchObject({ body: { on: true } }));
  });

  it('draws nothing for an app with no parts', async () => {
    parts = [];
    const { container } = card();
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/apps/crm/parts'))).toBe(true));
    expect(container.querySelector('[data-testid="app-parts"]')).toBeNull();
  });
});

describe('the parts in the install check', () => {
  const modules: PlanModule[] = [
    { id: 'selling', label: { 'en-US': 'Selling' }, default: 'always', needs: [], leftOut: false, tables: ['deals'], roles: ['Sales rep'] },
    { id: 'jobs', label: { 'en-US': 'Jobs on site' }, default: 'off', needs: [], leftOut: false, tables: ['jobs'], roles: ['Field crew'] },
    { id: 'inbox', label: { 'en-US': 'Inbox' }, default: 'on', needs: [], leftOut: false, tables: ['enquiries'], roles: [] },
    { id: 'quotes', label: { 'en-US': 'Quotes' }, default: 'on', needs: ['invoices'], leftOut: true, tables: ['quotes'], roles: [] },
  ];
  const addOns = [{ key: 'invoices', name: 'Invoices & Receipts' }] as never;

  it('ticks each part as the app says, and sends a tick for every part that has a switch', async () => {
    const user = userEvent.setup();
    const picks: Record<string, boolean> = {};
    const onTick = vi.fn((id: string, next: boolean) => {
      picks[id] = next;
    });
    render(<PartsInstallCard appName="Sales CRM" modules={modules} picks={picks} addOns={addOns} onTick={onTick} busy={false} />);
    const always = screen.getByRole('checkbox', { name: 'Start with Selling' });
    expect(always.getAttribute('aria-checked')).toBe('true');
    expect(always.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Start with Jobs on site' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('checkbox', { name: 'Start with Inbox' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/Left out of this install: it needs Invoices & Receipts\./)).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Start with Jobs on site' }));
    expect(onTick).toHaveBeenCalledWith('jobs', true);
    expect(partChoicesOf(modules, picks)).toEqual({ jobs: true, inbox: true, quotes: true });
  });

  it('starts from how a part stands on an app that is already installed', () => {
    expect(partChoicesOf([{ ...modules[1]!, on: true }], {})).toEqual({ jobs: true });
    expect(partChoicesOf([{ ...modules[1]!, on: true }], { jobs: false })).toEqual({ jobs: false });
  });
});
