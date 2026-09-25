// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install check's Add-ons card, and what it sends.
 *
 * The server says, per add-on, what state it is in and what installing the
 * app would do to it; the card puts that into words and decides only two
 * things — what is ticked, and "Update it too". What is worth proving:
 *
 *  1. each state reads as the comp draws it, and a required add-on is ticked
 *     and locked;
 *  2. the install body carries exactly the add-ons it acts on, at the version
 *     the check showed, and `update: true` only when ticked;
 *  3. every refusal holds Install and says why at the footer, in words —
 *     nothing that cannot work is sent;
 *  4. an add-on only in the catalogue is downloaded first, then checked again;
 *  5. the Installing, stopped and done screens name the add-ons.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { isSelected } from './AddOnsInstallCard.js';
import { InstallAppWizard } from './InstallAppWizard.js';

const CONNECTION = { id: 'con_1', name: 'Practice', engine: 'postgres', readOnly: false, tableCount: 9 };

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

let calls: Call[];
let plans: Record<string, unknown>[];
let installReply: () => Promise<Response>;
let catalogueOn: boolean;

/** One add-on row as `POST /apps/plan` answers it. */
function row(over: Record<string, unknown> & { key: string; name: string }): Record<string, unknown> {
  return {
    need: 'suggests',
    range: '>=1.1.0',
    reason: { 'en-US': `Why ${over.name}.`, 'de-DE': `Warum ${over.name}.` },
    checked: false,
    features: [],
    state: 'absent',
    source: 'bundled',
    installedVersion: null,
    offeredVersion: '1.1.0',
    satisfiesRange: false,
    staged: true,
    enabled: false,
    action: 'install',
    usedBy: [],
    plan: null,
    problems: [],
    ...over,
  };
}

const INVOICES = row({
  key: 'invoices',
  name: 'Invoices & Receipts',
  need: 'requires',
  checked: true,
  reason: { 'en-US': 'Proposals, invoices, receipts and reminders are made by this add-on.' },
  plan: {
    addOnKey: 'invoices',
    version: '1.1.0',
    installable: true,
    touchesData: true,
    create: [
      { ref: 'invoice_numbers', columns: [] },
      { ref: 'invoice_templates', columns: [] },
    ],
    reuse: [],
    problems: [],
    requiresSchemaChange: true,
  },
});

const HOLIDAYS = row({
  key: 'holiday-calendars',
  name: 'Holiday calendars',
  checked: true,
  state: 'installed',
  installedVersion: '1.1.0',
  offeredVersion: null,
  satisfiesRange: true,
  action: 'attach',
  source: 'catalog',
  reason: { 'en-US': 'Marks public holidays as the studio’s days off, for Capacity.' },
});

function planWith(addOns: Record<string, unknown>[]): Record<string, unknown> {
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
    tables: [
      {
        ref: 'clients',
        table: 'clients_clients',
        class: 'new',
        action: 'create',
        offers: [],
        edits: [],
        blocked: [],
        columns: [{ ref: 'id', type: 'int' }],
      },
    ],
    names: { clients: 'clients_clients' },
    addOns,
  };
}

const INSTALLED = {
  key: 'clients',
  version: '1.0.0',
  source: 'file',
  installedAt: 0,
  connectionId: CONNECTION.id,
  sides: [],
  missing: false,
  schema: { created: ['clients'], reused: [] },
};

function stubFetch() {
  let jobPolls = 0;
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url: url.split('?')[0] ?? url, method, body });
    if (url.startsWith('/api/v1/connections')) return Promise.resolve(jsonResponse(200, { connections: [CONNECTION] }));
    if (url.startsWith('/api/v1/apps/upload')) {
      return Promise.resolve(
        jsonResponse(200, { key: 'clients', version: '1.0.0', name: 'Client Portal', files: 3, integrity: 'sha512-x', sides: ['staff'] }),
      );
    }
    if (url === '/api/v1/apps/plan') return Promise.resolve(jsonResponse(200, { plan: plans.length > 1 ? plans.shift() : plans[0] }));
    if (url === '/api/v1/apps/install') return installReply();
    if (url === '/api/v1/add-ons/catalog') {
      return Promise.resolve(jsonResponse(200, { addOns: [], catalogFetchedAt: null, onlineEnabled: catalogueOn }));
    }
    if (url === '/api/v1/add-ons/download' && method === 'POST') return Promise.resolve(jsonResponse(200, { jobId: 'job_dl' }));
    if (url === '/api/v1/jobs/job_dl') {
      jobPolls += 1;
      return Promise.resolve(
        jsonResponse(200, {
          data: { id: 'job_dl', status: jobPolls > 1 ? 'succeeded' : 'running', progress: { pct: jobPolls > 1 ? 100 : 40 }, lastError: null },
        }),
      );
    }
    if (url.startsWith('/api/v1/apps')) return Promise.resolve(jsonResponse(200, { apps: [], staged: [] }));
    return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  catalogueOn = false;
  plans = [planWith([INVOICES, HOLIDAYS])];
  installReply = () => Promise.resolve(jsonResponse(200, { ...INSTALLED, addOns: { installed: [{ key: 'invoices', name: 'Invoices & Receipts', version: '1.1.0' }], updated: [], attached: [] } }));
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function reachCheck(user: ReturnType<typeof userEvent.setup>) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <InstallAppWizard onClose={() => {}} />
    </QueryClientProvider>,
  );
  const file = new File(['pretend'], 'clients-1.0.0.tgz', { type: 'application/gzip' });
  await user.upload(await screen.findByLabelText(/Bundle file/i), file);
  await user.type(screen.getByLabelText(/Integrity/i), 'sha512-abc=');
  await user.click(screen.getByRole('button', { name: 'Upload' }));
  await screen.findByText(/Install into which database/i);
  await user.click(screen.getByRole('radio', { name: /Practice/i }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  return screen.findByTestId('install-add-ons');
}

const rowOf = (card: HTMLElement, key: string) => card.querySelector(`[data-add-on="${key}"]`) as HTMLElement;
const statusOf = (element: HTMLElement) => element.querySelector('[data-part="add-on-status"]')?.textContent ?? '';
const sentAddOns = () => (calls.filter((call) => call.url === '/api/v1/apps/install').at(-1)?.body as Record<string, unknown>)['addOns'];
const installButton = () => screen.getByRole('button', { name: 'Install' });
const hint = () => document.querySelector('[data-part="add-on-hint"]')?.textContent ?? null;

describe('the Add-ons card', () => {
  it('draws a required add-on ticked and locked, a suggestion as the manifest says, and sends both', async () => {
    const user = userEvent.setup();
    const card = await reachCheck(user);
    expect(card.textContent).toContain('Client Portal works with these add-ons.');
    expect(card.textContent).toContain('Add-ons are shared. Any other app you install can use them too.');

    const invoices = rowOf(card, 'invoices');
    const box = within(invoices).getByRole('checkbox', { name: 'Invoices & Receipts' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.hasAttribute('disabled')).toBe(true);
    expect(invoices.querySelector('[data-need="requires"]')?.textContent).toBe('Required');
    expect(invoices.textContent).toContain('v1.1.0 · Comes with Adminium');
    expect(invoices.textContent).toContain('Proposals, invoices, receipts and reminders are made by this add-on.');
    expect(statusOf(invoices)).toBe('Will be installed');
    // Its own plan, before consent: the tables it will make.
    expect(invoices.querySelector('[data-part="add-on-plan"]')?.textContent).toBe(
      'Creates 2 tables in Practice: invoice_numbers, invoice_templates',
    );

    const holidays = rowOf(card, 'holiday-calendars');
    expect(holidays.querySelector('[data-need="suggests"]')?.textContent).toBe('Suggested');
    expect(holidays.textContent).toContain('From the add-on catalogue');
    expect(statusOf(holidays)).toBe('Installed · v1.1.0 · will be connected to Client Portal');

    expect(hint()).toBeNull();
    await user.click(installButton());
    await screen.findByText('Client Portal is installed');
    expect(sentAddOns()).toEqual([
      { key: 'invoices', version: '1.1.0' },
      { key: 'holiday-calendars', version: '1.1.0' },
    ]);
    // The done line names what the install added, and where its settings are.
    const done = document.querySelector('[data-part="done-add-ons"]');
    expect(done?.textContent).toBe('Also installed: Invoices & Receipts. Its settings are under Add-ons.');
    expect(within(done as HTMLElement).getByRole('link', { name: 'Add-ons' }).getAttribute('href')).toBe('/studio/add-ons');
  });

  it('never leaves a required add-on out, whatever the ticks say', () => {
    const required = { ...INVOICES, checked: false } as never;
    expect(isSelected(required, { ticked: { invoices: false }, update: {} })).toBe(true);
  });

  it('says which of the app’s roles would be given an add-on’s shared settings', async () => {
    plans = [{ ...planWith([INVOICES, HOLIDAYS]), addOnGrants: [{ role: 'clients-manager', roleName: 'Studio manager', addOn: 'invoices', grant: 'settings' }] }];
    const user = userEvent.setup();
    const card = await reachCheck(user);
    expect(rowOf(card, 'invoices').querySelector('[data-part="add-on-grant"]')?.textContent).toBe(
      'Studio manager will be able to change its settings, which every app it serves shares.',
    );
    expect(rowOf(card, 'holiday-calendars').querySelector('[data-part="add-on-grant"]')).toBeNull();
  });

  it('leaves an unticked suggestion out, and says it won’t be connected', async () => {
    const user = userEvent.setup();
    const card = await reachCheck(user);
    const holidays = rowOf(card, 'holiday-calendars');
    await user.click(within(holidays).getByRole('checkbox', { name: 'Holiday calendars' }));
    expect(statusOf(holidays)).toBe('Installed · v1.1.0 · won’t be connected');
    await user.click(installButton());
    await screen.findByText('Client Portal is installed');
    expect(sentAddOns()).toEqual([{ key: 'invoices', version: '1.1.0' }]);
  });

  it('holds the install for a required add-on this Adminium cannot have, and says why', async () => {
    plans = [
      planWith([
        { ...INVOICES, state: 'unavailable', source: null, offeredVersion: null, action: null, plan: null, problems: [{ code: 'ADD_ON_UNAVAILABLE', message: 'server words' }] },
      ]),
    ];
    const user = userEvent.setup();
    const card = await reachCheck(user);
    const invoices = rowOf(card, 'invoices');
    expect(invoices.className).toContain('bg-danger-soft');
    expect(invoices.textContent).toContain('Doesn’t come with this Adminium, and the add-on catalogue is off');
    expect(statusOf(invoices)).toBe('Invoices & Receipts isn’t available on this Adminium');
    // The server's own sentence for the same thing is not said twice.
    expect(invoices.textContent).not.toContain('server words');
    expect(within(invoices).getByRole('link', { name: 'How to add an add-on' }).getAttribute('href')).toBe(
      'https://docs.adminium.dev/self-hosting/installing-add-ons',
    );
    expect(hint()).toBe('Client Portal needs Invoices & Receipts, which isn’t available here.');
    expect(installButton().hasAttribute('disabled')).toBe(true);
  });

  it('says so when the catalogue is on but has nothing it can use', async () => {
    catalogueOn = true;
    plans = [planWith([{ ...INVOICES, state: 'unavailable', source: null, offeredVersion: null, action: null, plan: null }])];
    const user = userEvent.setup();
    const card = await reachCheck(user);
    await waitFor(() =>
      expect(rowOf(card, 'invoices').textContent).toContain('Doesn’t come with this Adminium, and the add-on catalogue has no version it can use'),
    );
  });

  it('updates an add-on that is too old only when “Update it too” is ticked', async () => {
    plans = [
      planWith([
        {
          ...INVOICES,
          state: 'outdated',
          installedVersion: '1.0.2',
          offeredVersion: '1.1.0',
          action: 'update',
          plan: null,
          usedBy: [{ app: 'pos', appName: 'Point of Sale', status: 'installed', need: 'feature', range: '>=1.0.0', features: [] }],
        },
      ]),
    ];
    const user = userEvent.setup();
    const card = await reachCheck(user);
    const invoices = rowOf(card, 'invoices');
    expect(invoices.className).toContain('bg-warn-soft');
    expect(statusOf(invoices)).toBe('Installed v1.0.2 — Client Portal needs 1.1.0 or later');
    const update = within(invoices).getByRole('checkbox', { name: 'Update it too' });
    expect(update.getAttribute('aria-checked')).toBe('true');
    // Updating a shared add-on says who else uses it.
    expect(invoices.querySelector('[data-part="add-on-used-by"]')?.textContent).toBe('Also used by Point of Sale');

    await user.click(update);
    expect(invoices.className).toContain('bg-danger-soft');
    expect(hint()).toBe('Client Portal needs Invoices & Receipts 1.1.0 or later.');
    expect(installButton().hasAttribute('disabled')).toBe(true);

    await user.click(update);
    expect(hint()).toBeNull();
    await user.click(installButton());
    await screen.findByText('Client Portal is installed');
    expect(sentAddOns()).toEqual([{ key: 'invoices', version: '1.1.0', update: true }]);
  });

  it('offers a feature’s add-on unticked, and installs it once ticked', async () => {
    plans = [
      planWith([
        row({
          key: 'invoices',
          name: 'Invoices & Receipts',
          need: 'feature',
          features: [{ id: 'emailed-receipts', label: { 'en-US': 'Emailed receipts', 'de-DE': 'Belege per E-Mail' } }],
          reason: { 'en-US': 'Without it, the till prints receipts but can’t email them.' },
        }),
      ]),
    ];
    const user = userEvent.setup();
    const card = await reachCheck(user);
    const invoices = rowOf(card, 'invoices');
    expect(invoices.querySelector('[data-need="feature"]')?.textContent).toBe('Needed for: Emailed receipts');
    const box = within(invoices).getByRole('checkbox', { name: 'Invoices & Receipts' });
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(statusOf(invoices)).toBe('');
    await user.click(box);
    expect(statusOf(invoices)).toBe('Will be installed');
    await user.click(installButton());
    await screen.findByText('Client Portal is installed');
    expect(sentAddOns()).toEqual([{ key: 'invoices', version: '1.1.0' }]);
  });

  it('downloads an add-on that is only in the catalogue, then checks again', async () => {
    plans = [planWith([{ ...INVOICES, source: 'catalog', staged: false, plan: null }]), planWith([INVOICES])];
    const user = userEvent.setup();
    const card = await reachCheck(user);
    const invoices = rowOf(card, 'invoices');
    expect(statusOf(invoices)).toBe('Will be installed, once it is downloaded from the add-on catalogue');
    expect(hint()).toBe('Download Invoices & Receipts first: it is in the add-on catalogue, not on this server yet.');
    expect(installButton().hasAttribute('disabled')).toBe(true);

    await user.click(within(invoices).getByRole('button', { name: 'Download it' }));
    await waitFor(() => expect(hint()).toBeNull());
    expect(calls.find((call) => call.url === '/api/v1/add-ons/download')?.body).toEqual({ key: 'invoices', version: '1.1.0' });
    expect(calls.filter((call) => call.url === '/api/v1/apps/plan')).toHaveLength(2);
    await waitFor(() => expect(installButton().hasAttribute('disabled')).toBe(false));
  });

  it('holds a ticked suggestion whose own plan is refused, and lets it be unticked', async () => {
    plans = [
      planWith([
        INVOICES,
        { ...HOLIDAYS, problems: [{ code: 'ADD_ON_OTHER_DATABASE', message: 'Holiday calendars’s tables are not in this app’s database.' }] },
      ]),
    ];
    const user = userEvent.setup();
    const card = await reachCheck(user);
    const holidays = rowOf(card, 'holiday-calendars');
    expect(holidays.querySelector('[data-part="add-on-problems"]')?.textContent).toContain('tables are not in this app’s database');
    expect(hint()).toBe('Holiday calendars can’t be used with Client Portal here. Untick it to install Client Portal without it.');
    await user.click(within(holidays).getByRole('checkbox', { name: 'Holiday calendars' }));
    expect(hint()).toBeNull();
  });

  it('names the add-ons first while installing, and on a stop at the add-ons', async () => {
    let release: () => void = () => undefined;
    installReply = () =>
      new Promise((resolve) => {
        release = () =>
          resolve(
            jsonResponse(409, {
              error: {
                code: 'APP_INSTALL_INCOMPLETE',
                message: 'stopped',
                requestId: 'r',
                details: {
                  stage: 'add-ons',
                  table: null,
                  created: [],
                  pending: [],
                  cause: 'disk full',
                  addOns: { installed: [], updated: [], attached: [{ key: 'holiday-calendars', name: 'Holiday calendars', version: '1.1.0' }] },
                },
              },
            }),
          );
      });
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(installButton());
    const running = await screen.findByText('Installing Invoices & Receipts');
    const rows = [...(running.closest('ul') as HTMLElement).querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual(['Installing Invoices & Receipts', 'Connecting Holiday calendars', 'Tables', 'Pages']);
    release();
    const stopped = await screen.findByTestId('install-stopped');
    expect(stopped.textContent).toContain('Installing the add-ons it needs failed, so nothing after that ran.');
    expect([...stopped.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Connecting Holiday calendarsconnected',
      'Add-onsfailed',
      'Tablesnot started',
      'Pagesnot started',
    ]);
  });

  it('checks again after the server refuses an add-on, and shows its words', async () => {
    installReply = () =>
      Promise.resolve(
        jsonResponse(422, {
          error: { code: 'ADD_ON_REQUIRED', message: 'Client Portal needs Invoices & Receipts, which isn’t available here.', requestId: 'r' },
        }),
      );
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(installButton());
    await screen.findByText('Client Portal needs Invoices & Receipts, which isn’t available here.');
    await waitFor(() => expect(calls.filter((call) => call.url === '/api/v1/apps/plan')).toHaveLength(2));
  });

  it('is not there for an app that names no add-on, which installs as before', async () => {
    // Sample data draws the cards' grid, so the Add-ons card's own absence is what is tested.
    plans = [{ ...planWith([]), addOns: undefined, sampleData: true }];
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <InstallAppWizard onClose={() => {}} />
      </QueryClientProvider>,
    );
    const file = new File(['pretend'], 'clients-1.0.0.tgz', { type: 'application/gzip' });
    await user.upload(await screen.findByLabelText(/Bundle file/i), file);
    await user.type(screen.getByLabelText(/Integrity/i), 'sha512-abc=');
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await screen.findByText(/Install into which database/i);
    await user.click(screen.getByRole('radio', { name: /Practice/i }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Check the tables');
    expect(screen.queryByTestId('install-add-ons')).toBeNull();
    installReply = () => Promise.resolve(jsonResponse(200, INSTALLED));
    await user.click(installButton());
    await screen.findByText('Client Portal is installed');
    expect(sentAddOns()).toBeUndefined();
    expect(document.querySelector('[data-part="done-add-ons"]')).toBeNull();
  });
});
