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
import { AppPartsCard, PartsInstallCard, partChoicesOf, partsSummary, strandedRoles } from './AppPartsCard.js';
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

  it('draws a part built on an add-on under that add-on, and names the roles left with nothing to open', async () => {
    parts = [
      part({ id: 'selling', label: 'Selling', default: 'always', pages: 12, roles: [{ slug: 'crm-rep', name: 'Sales rep', members: 4 }] }),
      part({ id: 'jobs', label: 'Jobs on site', default: 'off', switch: false, on: false, roles: [{ slug: 'crm-crew', name: 'Field crew', members: 2 }, { slug: 'crm-ops', name: 'Operations manager', members: 1 }] }),
      part({ id: 'quotes', label: 'Quotes', needs: [{ key: 'invoices', name: 'Invoices & Receipts' }], roles: [{ slug: 'crm-rep', name: 'Sales rep', members: 4 }] }),
      part({ id: 'supply', label: 'Supply', on: false, leftOut: true, needs: [{ key: 'inventory', name: 'Inventory' }], waiting: [{ key: 'inventory', name: 'Inventory' }], roles: [{ slug: 'crm-ops', name: 'Operations manager', members: 1 }] }),
    ];
    card();
    const list = await screen.findByTestId('app-parts');
    const invoices = list.querySelector('[data-part-addon="invoices"]') as HTMLElement;
    const inventory = list.querySelector('[data-part-addon="inventory"]') as HTMLElement;
    expect(within(invoices).getByText('Quotes')).toBeTruthy();
    expect(invoices.textContent).toContain('Connected: the parts below work with it.');
    expect(within(inventory).getByText('Supply')).toBeTruthy();
    expect(inventory.textContent).toContain('Not connected: the parts below wait for it.');
    expect(within(inventory).getByText('Not set up yet. Connect Inventory under Add-ons and it is put in.')).toBeTruthy();
    // Jobs is off and Supply waits: both of their roles have nothing; the rep has Selling.
    expect(within(list).getByRole('status').textContent).toBe('Field crew and Operations manager are left with nothing to open with these parts.');
    expect(strandedRoles(parts)).toEqual(['Field crew', 'Operations manager']);
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
    render(<PartsInstallCard appName="Sales CRM" modules={modules} picks={picks} addOns={addOns} onTick={onTick} busy={false} tables={4} />);
    const always = screen.getByRole('checkbox', { name: 'Start with Selling' });
    expect(always.getAttribute('aria-checked')).toBe('true');
    expect(always.hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Start with Jobs on site' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('checkbox', { name: 'Start with Inbox' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Waiting for the Invoices & Receipts add-on.')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Start with Jobs on site' }));
    expect(onTick).toHaveBeenCalledWith('jobs', true);
    expect(partChoicesOf(modules, picks)).toEqual({ jobs: true, inbox: true, quotes: true });
  });

  it('draws a part that waits for an add-on under that add-on, and counts what the ticks make', async () => {
    const user = userEvent.setup();
    const crm: PlanModule[] = [
      { ...modules[0]!, rules: 3 },
      { id: 'accounts', label: { 'en-US': 'Accounts' }, default: 'always', needs: [], leftOut: false, tables: ['companies'], roles: ['Sales rep', 'Marketer'], rules: 0 },
      { ...modules[1]!, rules: 2 },
      { ...modules[2]!, rules: 1 },
      { id: 'quotes', label: { 'en-US': 'Quotes' }, default: 'on', needs: ['invoices'], leftOut: false, tables: ['quotes'], roles: ['Sales rep'], rules: 4 },
      { id: 'supply', label: { 'en-US': 'Supply' }, default: 'on', needs: ['inventory'], leftOut: true, tables: [], roles: ['Operations manager'], rules: 0 },
    ];
    const whole = {
      roles: [
        { name: 'CRM admin', parts: [] },
        { name: 'Sales rep', parts: ['selling', 'quotes', 'accounts'] },
        { name: 'Marketer', parts: ['accounts', 'inbox'] },
        { name: 'Field crew', parts: ['jobs'] },
        { name: 'Operations manager', parts: ['jobs', 'supply'] },
      ],
      rules: 1,
    };
    const both = [
      { key: 'invoices', name: 'Invoices & Receipts' },
      { key: 'inventory', name: 'Inventory' },
    ] as never;
    const picks: Record<string, boolean> = {};
    const { rerender } = render(<PartsInstallCard appName="Sales CRM" modules={crm} picks={picks} addOns={both} onTick={(id, next) => (picks[id] = next)} busy={false} whole={whole} tables={40} />);
    const card = screen.getByTestId('install-parts');
    expect(card.textContent).toContain('6 parts. Selling and Accounts are always part of it.');
    // Quotes sits in the Invoices & Receipts box, Supply in Inventory's: one ticked under Add-ons, one not.
    const invoices = card.querySelector('[data-part-addon="invoices"]') as HTMLElement;
    const inventory = card.querySelector('[data-part-addon="inventory"]') as HTMLElement;
    expect(within(invoices).getByRole('checkbox', { name: 'Start with Quotes' }).getAttribute('aria-checked')).toBe('true');
    expect(invoices.textContent).toContain('Ticked under Add-ons');
    const supply = within(inventory).getByRole('checkbox', { name: 'Start with Supply' });
    expect(supply.getAttribute('aria-checked')).toBe('false');
    expect(supply.hasAttribute('disabled')).toBe(true);
    expect(inventory.textContent).toContain('Waiting for the Inventory add-on.');
    // Jobs is off and Supply waits: the field crew and the operations manager have nothing to open.
    expect(within(card).getByRole('status').textContent).toBe('Field crew and Operations manager are left with nothing to open with these parts.');
    // 40 tables; the admin, the rep and the marketer; 1 + 3 + 1 + 4 rules (selling, inbox, quotes, and one of no part).
    expect(card.querySelector('[data-part="will-make"]')!.textContent).toBe('Will make40 tables, 3 roles, 9 rules');
    await user.click(screen.getByRole('checkbox', { name: 'Start with Jobs on site' }));
    rerender(<PartsInstallCard appName="Sales CRM" modules={crm} picks={{ ...picks }} addOns={both} onTick={(id, next) => (picks[id] = next)} busy={false} whole={whole} tables={40} />);
    expect(card.querySelector('[data-part="stranded"]')).toBeNull();
    expect(card.querySelector('[data-part="will-make"]')!.textContent).toBe('Will make40 tables, 5 roles, 11 rules');
  });

  it('works nothing out from an older server that does not say the roles', () => {
    expect(partsSummary(modules, {}, undefined, 3)).toBeNull();
    render(<PartsInstallCard appName="Sales CRM" modules={modules} picks={{}} addOns={addOns} onTick={() => undefined} busy={false} tables={3} />);
    expect(screen.getByTestId('install-parts').querySelector('[data-part="will-make"]')).toBeNull();
  });

  it('starts from how a part stands on an app that is already installed', () => {
    expect(partChoicesOf([{ ...modules[1]!, on: true }], {})).toEqual({ jobs: true });
    expect(partChoicesOf([{ ...modules[1]!, on: true }], { jobs: false })).toEqual({ jobs: false });
  });
});
