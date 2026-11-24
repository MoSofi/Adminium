// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Each card of the install check, as the only card of its plan. A card a plan
 * holds alone must still be seen, because Install is the say on what it asks:
 * a role given a right nobody was shown, with no way to untick it, is the bug
 * this file pins. Unticking a card alone must still send its own field.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { InstallAppWizard } from './InstallAppWizard.js';

const CONNECTION = { id: 'con_1', name: 'Practice', engine: 'postgres', readOnly: false, tableCount: 9 };

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

let calls: Call[];
let plan: Record<string, unknown>;

function planWith(card: Record<string, unknown>): Record<string, unknown> {
  return {
    key: 'clients',
    version: '1.0.0',
    installable: true,
    touchesData: true,
    create: [{ ref: 'clients', columns: [{ ref: 'id', type: 'int' }] }],
    reuse: [],
    references: [],
    problems: [],
    requiresSchemaChange: true,
    checksum: 'c'.repeat(64),
    tables: [{ ref: 'clients', table: 'clients_clients', class: 'new', action: 'create', offers: [], edits: [], blocked: [], columns: [{ ref: 'id', type: 'int' }] }],
    names: { clients: 'clients_clients' },
    addOns: [],
    ...card,
  };
}

const SUGGESTED = {
  key: 'invoices',
  name: 'Invoices & Receipts',
  need: 'suggests',
  range: '>=1.1.0',
  reason: { 'en-US': 'Why invoices.' },
  checked: true,
  features: [],
  state: 'installed',
  source: 'catalog',
  installedVersion: '1.1.0',
  offeredVersion: null,
  satisfiesRange: true,
  staged: true,
  enabled: true,
  action: 'attach',
  usedBy: [],
  plan: null,
  problems: [],
};

const INSTALLED = { key: 'clients', version: '1.0.0', source: 'file', installedAt: 0, connectionId: CONNECTION.id, sides: [], missing: false, schema: { created: ['clients'], reused: [] } };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ url: url.split('?')[0] ?? url, method, body });
      if (url.startsWith('/api/v1/connections')) return Promise.resolve(jsonResponse(200, { connections: [CONNECTION] }));
      if (url.startsWith('/api/v1/apps/upload')) {
        return Promise.resolve(jsonResponse(200, { key: 'clients', version: '1.0.0', name: 'Client Portal', files: 3, integrity: 'sha512-x', sides: ['staff'] }));
      }
      if (url === '/api/v1/apps/plan') return Promise.resolve(jsonResponse(200, { plan }));
      if (url === '/api/v1/apps/install') return Promise.resolve(jsonResponse(200, INSTALLED));
      if (url === '/api/v1/apps/clients/sample-data' && method === 'POST') return Promise.resolve(jsonResponse(200, { jobId: 'job_sample' }));
      if (url === '/api/v1/jobs/job_sample') {
        return Promise.resolve(jsonResponse(200, { data: { id: 'job_sample', status: 'succeeded', progress: { pct: 100 }, lastError: null } }));
      }
      if (url === '/api/v1/add-ons/catalog') return Promise.resolve(jsonResponse(200, { addOns: [], catalogFetchedAt: null, onlineEnabled: false }));
      if (url.startsWith('/api/v1/apps')) return Promise.resolve(jsonResponse(200, { apps: [], staged: [] }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
    }),
  );
}

async function reachCheck(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <InstallAppWizard onClose={() => {}} />
    </QueryClientProvider>,
  );
  const file = new File(['pretend'], 'clients-1.0.0.tgz', { type: 'application/gzip' });
  await user.upload(await screen.findByLabelText(/Bundle file/i), file);
  await user.click(screen.getByRole('button', { name: 'Upload' }));
  await screen.findByText(/Install into which database/i);
  await user.click(screen.getByRole('radio', { name: /Practice/i }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('button', { name: 'Install' });
}

/** The check's row of cards, holding this one card and no other. */
function onlyCard(testId: string): HTMLElement {
  const row = document.querySelector('[data-part="plan-cards"]') as HTMLElement;
  expect([...row.children].map((card) => card.getAttribute('data-testid'))).toEqual([testId]);
  return row.children[0] as HTMLElement;
}

async function install(user: ReturnType<typeof userEvent.setup>): Promise<Record<string, unknown>> {
  await user.click(screen.getByRole('button', { name: 'Install' }));
  await screen.findByText(/^Client Portal \S+ is installed on /);
  return calls.filter((call) => call.url === '/api/v1/apps/install').at(-1)?.body as Record<string, unknown>;
}

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a card that is its plan’s only card', () => {
  it('public access: shown, and unticking sends publicAccess false', async () => {
    const endpoint = { ref: 'clients_faqs', table: 'faqs', methods: ['GET'], select: ['id'], writable: [], claim: null, kind: 'records', confirms: false, pending: false, issues: [] };
    plan = planWith({ publicAccess: { endpoints: [endpoint], warnings: [], canGrant: true } });
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(within(onlyCard('install-public-access')).getByRole('checkbox', { name: 'Allow this public access' }));
    expect((await install(user))['publicAccess']).toBe(false);
  });

  it('add-on settings: said on the add-on’s row, and unticking leaves the add-on out', async () => {
    plan = planWith({ addOns: [SUGGESTED], addOnGrants: [{ role: 'clients-cashier', roleName: 'Cashier', addOn: 'invoices', grant: 'settings' }] });
    const user = userEvent.setup();
    await reachCheck(user);
    const card = onlyCard('install-add-ons');
    expect(card.textContent).toContain('Cashier');
    await user.click(within(card).getByRole('checkbox', { name: 'Invoices & Receipts' }));
    expect((await install(user))['addOns']).toEqual([]);
  });

  it('another app’s role given more of an add-on: shown, and Install is the say', async () => {
    plan = planWith({
      roleTables: [{ app: 'shop', appName: 'Shop', role: 'shop-owner', roleName: 'Owner', addOn: 'invoices', table: 'files', actions: ['read'], wider: { actions: ['read'], columns: ['*'] } }],
    });
    const user = userEvent.setup();
    await reachCheck(user);
    expect(onlyCard('add-on-role-tables-wider').textContent).toContain('Owner');
    expect((await install(user))['roleTables']).toBe(true);
  });

  it('erasing people: shown', async () => {
    plan = planWith({ privacyGrants: [{ role: 'clients-manager', roleName: 'Studio manager' }] });
    await reachCheck(userEvent.setup());
    expect(onlyCard('privacy-grants').textContent).toContain('Studio manager');
  });

  it('refunds: shown, and unticking sends the role in refundsUnticked', async () => {
    plan = planWith({ refundGrants: [{ role: 'clients-manager', roleName: 'Studio manager' }, { role: 'clients-deputy', roleName: 'Deputy' }] });
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(within(onlyCard('refund-grants')).getByTestId('refund-grant-clients-deputy'));
    expect((await install(user))['refundsUnticked']).toEqual(['clients-deputy']);
  });

  it('shipping rights: shown, and unticking sends that role and right alone', async () => {
    plan = planWith({
      shippingGrants: [
        { role: 'clients-packer', roleName: 'Packer', action: 'book' },
        { role: 'clients-packer', roleName: 'Packer', action: 'cancel' },
      ],
    });
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(within(onlyCard('shipping-grants')).getByRole('checkbox', { name: /refund/i }));
    expect((await install(user))['shippingUnticked']).toEqual([{ role: 'clients-packer', action: 'cancel' }]);
  });

  it('shipping rights: left ticked, the install says so with an empty answer', async () => {
    plan = planWith({ shippingGrants: [{ role: 'clients-packer', roleName: 'Packer', action: 'book' }] });
    const user = userEvent.setup();
    await reachCheck(user);
    onlyCard('shipping-grants');
    expect((await install(user))['shippingUnticked']).toEqual([]);
  });

  it('parts: shown, and unticking sends the part off', async () => {
    plan = planWith({ modules: [{ id: 'bookings', label: { 'en-US': 'Bookings' }, default: 'on', needs: [], leftOut: false, tables: [], roles: [] }] });
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(within(onlyCard('install-parts')).getByRole('checkbox', { name: 'Start with Bookings' }));
    expect((await install(user))['modules']).toEqual({ bookings: false });
  });

  it('maps: shown, and unticking sends maps false', async () => {
    plan = planWith({ maps: true });
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(within(onlyCard('install-maps')).getByRole('checkbox'));
    expect((await install(user))['maps']).toBe(false);
  });

  it('sample data: shown, and ticking it adds the sample after the install', async () => {
    plan = planWith({ sampleData: true });
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(within(onlyCard('install-sample-data')).getByRole('checkbox'));
    await install(user);
    await waitFor(() => expect(calls.some((call) => call.url === '/api/v1/apps/clients/sample-data' && call.method === 'POST')).toBe(true));
  });

  it('a plan with no card leaves an empty row that hides itself', async () => {
    plan = planWith({});
    await reachCheck(userEvent.setup());
    const row = document.querySelector('[data-part="plan-cards"]') as HTMLElement;
    expect(row.matches(':empty')).toBe(true);
    expect(row.className.split(' ')).toContain('empty:hidden');
  });
});
