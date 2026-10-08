// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Architecture tab over the architecture route: not applied yet; the
 * waiting changes and the node a change selects; the list form and its
 * selection, with the lines and where the node opens; the seven lists.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { ArchitectureDoc, DesignerSession } from '../api.js';
import ArchitectureTab from './ArchitectureTab.js';

const SESSION: DesignerSession = {
  id: 'ds_00000000000000000000000a',
  appKey: 'repairs',
  title: 'Repair Desk',
  target: 'auto',
  connectionId: 'env:ollama',
  model: 'm',
  createdAt: 1,
  updatedAt: 1,
  turns: 2,
  version: 4,
  createdApp: true,
  tokens: { in: 0, out: 0 },
};

const DOC: ArchitectureDoc = {
  name: 'Repair Desk',
  applied: true,
  people: [
    { id: 'r_mechanic', kind: 'role', label: 'Mechanic' },
    { id: 'customers', kind: 'customers', label: 'Customers' },
  ],
  uses: [
    { id: 'dashboard', label: 'Dashboard', count: 2 },
    { id: 'staff', label: 'Staff side', count: 1 },
    { id: 'customer', label: 'Customer side', count: 1 },
  ],
  tables: [
    { id: 't_customers', ref: 'customers', name: 'repairs_customers', rows: 12, columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'text' }], relations: [] },
    { id: 't_jobs', ref: 'jobs', name: 'repairs_jobs', rows: 340, columns: [{ name: 'id', type: 'int' }, { name: 'customer_id', type: 'fk' }], relations: [{ to: 'customers', column: 'customer_id' }] },
  ],
  addOns: [{ id: 'a_invoices', key: 'invoices', name: 'Invoices & Receipts', need: 'required', state: 'not-installed', version: null, reason: 'Repair Desk makes its invoices with it.' }],
  builtIn: ['sign-in', 'files', 'automations', 'import-export', 'reports', 'api'],
  emails: [{ id: 'e_ready', key: 'repairs-ready', name: 'Your bike is ready', when: 'When jobs.status becomes ready' }],
  edges: [
    { id: '1', from: 'r_mechanic', to: 'dashboard', kind: 'session' },
    { id: '2', from: 'dashboard', to: 't_jobs', kind: 'uses' },
    { id: '3', from: 't_customers', to: 't_jobs', kind: 'relation' },
    { id: '4', from: 'customer', to: 't_jobs', kind: 'customer-key', reads: 1, writes: 1 },
  ],
  lists: {
    pages: [{ ref: 'repairs-jobs', name: 'Jobs', kind: 'page-crud', shows: 'jobs' }],
    roles: { tables: ['customers', 'jobs'], rows: [{ id: 'r_mechanic', role: 'Mechanic', cells: ['read', 'write'], notes: [null, 'no delete'] }] },
    access: ['jobs: read (status), its own rows only'],
    screens: [{ id: 'customer:find', name: 'Find my repair', side: 'customer' }],
  },
  pending: [
    { part: 'Table jobs', node: 't_jobs' },
    { part: 'Add-ons', node: null },
  ],
};

let doc: ArchitectureDoc;

function mount() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(200, doc))),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ArchitectureTab session={SESSION} />
    </QueryClientProvider>,
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Architecture tab', () => {
  it('says nothing is drawn before the app is applied', async () => {
    doc = { ...DOC, applied: false };
    mount();
    expect(await screen.findByText('Nothing is applied yet. Once the Designer applies the app, it is drawn here.')).toBeTruthy();
  });

  it('names the version it draws and the changes waiting, and a change selects its node', async () => {
    doc = DOC;
    mount();
    expect(await screen.findByRole('heading', { name: 'How Repair Desk fits together' })).toBeTruthy();
    expect(screen.getByText('Read only · drawn from v4')).toBeTruthy();
    expect(screen.getByText('2 changes are waiting to be applied')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Legend' })).getByText('Not applied yet')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect((screen.getByRole('button', { name: 'Add-ons' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Table jobs' }));
    // The selection bar: the node's name, its lines, where it opens.
    expect(screen.getByRole('button', { name: 'Clear the selection' })).toBeTruthy();
    expect(screen.getByText('Lines to')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in the dashboard' }).getAttribute('href')).toBe('/p/repairs-jobs');
  });

  it('draws the same nodes as a list, with their lines, and the same selection', async () => {
    doc = DOC;
    mount();
    await userEvent.click(await screen.findByRole('switch'));
    expect(screen.getByRole('heading', { name: 'Repair Desk’s tables' })).toBeTruthy();
    const mechanic = screen.getByRole('button', { name: /Mechanic/ });
    expect(mechanic.textContent).toContain('Signs in Dashboard');
    await userEvent.click(screen.getByRole('button', { name: /^Customer side/ }));
    expect(screen.getByRole('button', { name: /^Customer side/ }).getAttribute('aria-pressed')).toBe('true');
    // Its line to jobs is a chip that selects jobs.
    const bar = screen.getByText('Lines to').parentElement as HTMLElement;
    await userEvent.click(within(bar).getByRole('button', { name: 'jobs' }));
    // The outline's own row for jobs is now the pressed one.
    expect(screen.getAllByRole('button', { name: /^jobs/, pressed: true })).toHaveLength(1);
  });

  it('a table that posts is joined to its add-on', async () => {
    doc = { ...DOC, edges: [...DOC.edges, { id: 't_jobs>a_invoices>add-on', from: 't_jobs', to: 'a_invoices', kind: 'add-on', does: 'posts' }] };
    mount();
    await userEvent.click(await screen.findByRole('switch'));
    // In the list, the table's own row says where its rows post; selecting it offers the add-on as a line.
    // (The pending change "Table jobs" is a button too: the outline's row is the one that carries its lines.)
    const jobs = screen.getAllByRole('button', { name: /^jobs/ }).find((button) => button.textContent?.includes('Posts into')) as HTMLElement;
    expect(jobs.textContent).toContain('Posts into Invoices & Receipts');
    await userEvent.click(jobs);
    const bar = screen.getByText('Lines to').parentElement as HTMLElement;
    expect(within(bar).getByRole('button', { name: 'Invoices & Receipts' })).toBeTruthy();
  });

  it('lists the tables, roles, customer access, emails, add-ons and screens', async () => {
    doc = DOC;
    mount();
    await screen.findByRole('heading', { name: 'How Repair Desk fits together' });
    const panel = (): HTMLElement => screen.getByRole('tabpanel');
    expect(within(panel()).getByText('340')).toBeTruthy();
    expect(within(panel()).getByText('customers', { selector: 'td' })).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: /Roles/ }));
    expect(panel().textContent).toContain('Read and write');
    expect(panel().textContent).toContain('(no delete)');
    await userEvent.click(screen.getByRole('tab', { name: /Customer access/ }));
    expect(panel().textContent).toContain('jobs: read (status), its own rows only');
    await userEvent.click(screen.getByRole('tab', { name: /Emails/ }));
    expect(panel().textContent).toContain('When jobs.status becomes ready');
    await userEvent.click(screen.getByRole('tab', { name: /Add-ons/ }));
    expect(within(panel()).getByRole('link', { name: 'Install' }).getAttribute('href')).toBe('/studio/add-ons');
    await userEvent.click(screen.getByRole('tab', { name: /Screens/ }));
    expect(panel().textContent).toContain('Find my repair');
    expect(panel().textContent).toContain('Customer side');
  });

  it('says an app without a customer side has none', async () => {
    doc = { ...DOC, lists: { ...DOC.lists, access: [] } };
    mount();
    await screen.findByRole('heading', { name: 'How Repair Desk fits together' });
    await userEvent.click(screen.getByRole('tab', { name: /Customer access/ }));
    expect(screen.getByRole('tabpanel').textContent).toContain('This app has no customer side.');
  });
});
