// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Apps from the online app catalog, in Studio (b G8-D7).
 *
 * Router-mounted through the real `/studio/apps` page, like
 * `hostedAppsPage.test.tsx`, because the claims live in the page's wiring
 * rather than in any one card:
 *
 *  1. the switch writes the APP switch and a veto is said out loud;
 *  2. "Check for newer" and a download are JOBS followed to the end, not
 *     requests that say "done" when they are merely queued;
 *  3. a catalog-only app downloads first, then the wizard opens on it — and a
 *     failed download opens nothing;
 *  4. a release this server is too old for is listed, and cannot be clicked;
 *  5. Update downloads when it has to, shows the tables a new version would
 *     create BEFORE creating them, and applies directly when there are none;
 *  6. a refused update names the tables short of columns.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { AppCatalogReply, CatalogApp, InstalledApp } from './appsApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function row(over: Partial<CatalogApp> = {}): CatalogApp {
  return {
    key: 'clinic',
    version: '0.1.2',
    name: 'Clinic Desk',
    description: 'Appointments for small practices.',
    categories: ['health'],
    publisher: 'Adminium',
    capabilities: [],
    sides: ['staff', 'customer'],
    installed: false,
    installedVersion: null,
    readable: true,
    source: 'catalog',
    state: 'available',
    updateTo: null,
    updateStaged: false,
    needsNewerAdminium: null,
    ...over,
  };
}

const INSTALLED: InstalledApp = {
  key: 'clinic',
  version: '0.1.1',
  source: 'file',
  installedAt: 0,
  connectionId: 'con_1',
  sides: [{ side: 'staff', prefix: '/apps/clinic/staff', navAvailable: true }],
  missing: false,
};

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

let calls: Call[];
let catalog: AppCatalogReply;
let installed: { apps: InstalledApp[]; staged: { key: string; version: string }[] };
let switchReply: { onlineEnabled: boolean; vetoed: boolean };
let job: { status: string; lastError: string | null };
let plan: Record<string, unknown>;
let updateReply: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  catalog = { apps: [], catalogFetchedAt: null, onlineEnabled: false };
  installed = { apps: [], staged: [] };
  switchReply = { onlineEnabled: true, vetoed: false };
  job = { status: 'succeeded', lastError: null };
  plan = {
    key: 'clinic',
    version: '0.1.2',
    installable: true,
    touchesData: true,
    create: [],
    reuse: [{ ref: 'clinicians', missingColumns: [] }],
    references: [],
    problems: [],
    requiresSchemaChange: false,
  };
  updateReply = {
    status: 200,
    body: { app: { ...INSTALLED, version: '0.1.2' }, from: '0.1.1', to: '0.1.2', pruned: ['0.1.1'] },
  };
});

function stubFetch() {
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url, ...(body === undefined ? {} : { body }) });

    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(
        jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }) }),
      );
    }
    if (url === '/api/v1/surfaces' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { instances: {}, surfaces: [], domains: {} }));
    }
    if (url === '/api/v1/connections' && method === 'GET') {
      return Promise.resolve(
        jsonResponse(200, {
          connections: [{ id: 'con_1', name: 'Practice', engine: 'postgres', readOnly: false, tableCount: 3 }],
        }),
      );
    }
    if (url === '/api/v1/apps/catalog' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, catalog));
    }
    if (url === '/api/v1/apps/catalog' && method === 'PUT') {
      return Promise.resolve(jsonResponse(200, switchReply));
    }
    if (url === '/api/v1/apps/catalog/refresh' && method === 'POST') {
      return Promise.resolve(jsonResponse(200, { jobId: 'job_refresh' }));
    }
    if (url === '/api/v1/apps/download' && method === 'POST') {
      return Promise.resolve(jsonResponse(200, { jobId: 'job_download' }));
    }
    if (url.startsWith('/api/v1/jobs/')) {
      return Promise.resolve(
        jsonResponse(200, {
          data: {
            id: url.split('/').pop(),
            status: job.status,
            progress: { pct: job.status === 'succeeded' ? 100 : 40, message: null },
            lastError: job.lastError,
          },
        }),
      );
    }
    if (url === '/api/v1/apps/plan' && method === 'POST') {
      return Promise.resolve(jsonResponse(200, { plan }));
    }
    if (url === '/api/v1/apps/clinic/update' && method === 'POST') {
      return Promise.resolve(jsonResponse(updateReply.status, updateReply.body));
    }
    if (url === '/api/v1/apps' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, installed));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function renderPage() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/studio/apps'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByText('Apps you can install');
}

const posted = (url: string) => calls.filter((c) => c.method === 'POST' && c.url === url);

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

describe('the online app catalogue switch', () => {
  it('is off by default and offers no check', async () => {
    await renderPage();
    const toggle = screen.getByRole('switch', { name: 'Browse the online app catalogue' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Check for newer' })).toBeNull();
    expect(screen.getByText(/Ready-made apps that came with this build/)).toBeTruthy();
  });

  it('writes the APP switch, and says so when the environment vetoes it', async () => {
    switchReply = { onlineEnabled: false, vetoed: true };
    await renderPage();
    await userEvent.click(screen.getByRole('switch', { name: 'Browse the online app catalogue' }));

    expect(await screen.findByText('This deployment cannot browse online')).toBeTruthy();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toEqual({ method: 'PUT', url: '/api/v1/apps/catalog', body: { enabled: true } });
    // Never the add-on switch.
    expect(calls.some((c) => c.url.startsWith('/api/v1/add-ons'))).toBe(false);
  });

  it('once on and never checked, asks for a check, and follows the refresh job to the end', async () => {
    catalog = { apps: [], catalogFetchedAt: null, onlineEnabled: true };
    await renderPage();
    expect(screen.getByText(/has not been checked yet/)).toBeTruthy();
    const readsBefore = calls.filter((c) => c.url === '/api/v1/apps/catalog').length;

    await userEvent.click(screen.getByRole('button', { name: 'Check for newer' }));
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/v1/jobs/job_refresh')).toBe(true);
    });
    expect(posted('/api/v1/apps/catalog/refresh')).toHaveLength(1);
    // The shelf is re-read after the job, not after the request.
    await waitFor(() => {
      expect(calls.filter((c) => c.url === '/api/v1/apps/catalog').length).toBeGreaterThan(readsBefore);
    });
  });
});

describe('installing an app only the catalogue offers', () => {
  beforeEach(() => {
    catalog = { apps: [row()], catalogFetchedAt: 1, onlineEnabled: true };
  });

  it('downloads it, follows the job, then opens the wizard on what landed', async () => {
    await renderPage();
    expect(screen.getByText('Online')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));

    expect(await screen.findByText('Install Clinic Desk')).toBeTruthy();
    expect(screen.getByText(/Downloaded from the online app catalogue/)).toBeTruthy();
    expect(posted('/api/v1/apps/download')[0]?.body).toEqual({ key: 'clinic', version: '0.1.2' });
    expect(calls.some((c) => c.url === '/api/v1/jobs/job_download')).toBe(true);
    // The wizard starts at its first step: nothing is installed by a download.
    expect(posted('/api/v1/apps/install')).toHaveLength(0);
  });

  it('opens nothing when the download fails, and shows why', async () => {
    job = { status: 'failed', lastError: 'the downloaded file does not match its fingerprint' };
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));

    expect(await screen.findByText('the downloaded file does not match its fingerprint')).toBeTruthy();
    expect(screen.queryByText('Install Clinic Desk')).toBeNull();
  });

  it('lists a release this server is too old for, with the version it needs, and cannot start it', async () => {
    catalog = {
      apps: [row({ needsNewerAdminium: { version: '0.1.2', minAdminiumVersion: '0.2.9' } })],
      catalogFetchedAt: 1,
      onlineEnabled: true,
    };
    await renderPage();
    expect(screen.getByText('Needs Adminium 0.2.9 or later')).toBeTruthy();
    const install = screen.getByRole('button', { name: 'Install' });
    expect(install.hasAttribute('disabled')).toBe(true);
    await userEvent.click(install);
    expect(posted('/api/v1/apps/download')).toHaveLength(0);
  });
});

describe('an installed app whose files are gone', () => {
  it('is marked missing and says what to do, instead of reading as healthy', async () => {
    installed = { apps: [{ ...INSTALLED, sides: [], missing: true }], staged: [] };
    await renderPage();
    /*
     * The row's only other tell is an empty `sides`, which also means "this
     * build ships no frontends" — so without the badge a wiped data volume and
     * a healthy headless install render identically.
     */
    expect(screen.getByText('Missing')).toBeTruthy();
    expect(
      screen.getByText(/Its files are not on this server, so it is not served/),
    ).toBeTruthy();
  });

  it('shows Missing on the browse shelf instead of a green Installed', async () => {
    installed = { apps: [{ ...INSTALLED, sides: [], missing: true }], staged: [] };
    catalog = {
      apps: [row({ version: '0.1.1', source: 'disk', state: 'missing', installed: true })],
      catalogFetchedAt: 1,
      onlineEnabled: true,
    };
    await renderPage();
    // A green "Installed" on an app whose files are gone is the most
    // misleading thing the shelf could say.
    expect(screen.queryByText('Installed')).toBeNull();
    expect(screen.getAllByText('Missing').length).toBeGreaterThan(0);
  });

  it('leaves a healthy install unmarked', async () => {
    installed = { apps: [INSTALLED], staged: [] };
    await renderPage();
    expect(screen.queryByText('Missing')).toBeNull();
  });
});

describe('updating an installed app', () => {
  beforeEach(() => {
    installed = { apps: [INSTALLED], staged: [] };
  });

  function withUpdate(over: Partial<CatalogApp> = {}) {
    catalog = {
      apps: [
        row({
          version: '0.1.1',
          source: 'disk',
          state: 'installed',
          installed: true,
          updateTo: '0.1.2',
          ...over,
        }),
      ],
      catalogFetchedAt: 1,
      onlineEnabled: true,
    };
  }

  it('draws the comp’s update pills and button', async () => {
    withUpdate();
    await renderPage();
    expect(await screen.findByText('1 update available')).toBeTruthy();
    expect(screen.getByText('Update to v0.1.2')).toBeTruthy();
    // The one Update button on the page, beside the row it updates.
    const update = screen.getByRole('button', { name: 'Update' });
    expect(update.closest('li')?.textContent).toContain('clinic');
    // And the comp's sub-line: category first, then when it was installed. The
    // category is the installed package's own, out of the same reply.
    expect(update.closest('li')?.textContent).toContain('health');
  });

  it('downloads first, shows the tables the new version creates, and updates only when confirmed', async () => {
    withUpdate({ updateStaged: false });
    plan = {
      ...plan,
      create: [{ ref: 'visits', columns: [{ ref: 'id', type: 'int' }, { ref: 'note', type: 'text' }] }],
      requiresSchemaChange: true,
    };
    await renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Update' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Update clinic to v0.1.2')).toBeTruthy();
    expect(within(dialog).getAllByText(/visits/).length).toBeGreaterThan(0);
    expect(posted('/api/v1/apps/download')[0]?.body).toEqual({ key: 'clinic', version: '0.1.2' });
    // Planned against the connection the app already uses, for the version downloaded.
    expect(posted('/api/v1/apps/plan')[0]?.body).toEqual({
      key: 'clinic',
      version: '0.1.2',
      connectionId: 'con_1',
    });
    // Nothing is updated while the operator reads the dialog.
    expect(posted('/api/v1/apps/clinic/update')).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Update' }));
    expect(await screen.findByText('clinic updated to v0.1.2')).toBeTruthy();
    expect(posted('/api/v1/apps/clinic/update')).toHaveLength(1);
  });

  it('cancelling the dialog updates nothing', async () => {
    withUpdate({ updateStaged: true });
    plan = { ...plan, create: [{ ref: 'visits', columns: [{ ref: 'id', type: 'int' }] }] };
    await renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Update' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted('/api/v1/apps/clinic/update')).toHaveLength(0);
  });

  it('applies at once, with no download, when the version is on disk and needs no new table', async () => {
    withUpdate({ updateStaged: true });
    await renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Update' }));

    expect(await screen.findByText('clinic updated to v0.1.2')).toBeTruthy();
    expect(posted('/api/v1/apps/download')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the tables when the server refuses an update for missing columns', async () => {
    withUpdate({ updateStaged: true });
    plan = { ...plan, reuse: [{ ref: 'clinicians', missingColumns: ['email'] }] };
    updateReply = {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: '"clinic" needs columns that are missing from tables this database already has.',
          requestId: 'req_u',
          details: { reason: 'COLUMNS_REQUIRED', tables: [{ ref: 'clinicians', missingColumns: ['email'] }] },
        },
      },
    };
    await renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Update' }));

    expect(await screen.findByText(/needs columns that are missing.*Missing: clinicians \(email\)\./)).toBeTruthy();
    // A refused plan never opens the consent dialog; the refusal is the server's.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('answers an update beside the installed list, not above the shelf', async () => {
    withUpdate({ updateStaged: true });
    await renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Update' }));
    const notice = await screen.findByText('clinic updated to v0.1.2');

    // After the shelf's heading and before the installed list's: the operator is
    // looking at the Update button, and a long shelf would hide an answer at the top.
    const shelf = screen.getByText('Apps you can install');
    const list = screen.getByText('Installed apps');
    expect(shelf.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names a newer release this server cannot take, and offers no Update for it', async () => {
    withUpdate({ updateTo: null, needsNewerAdminium: { version: '0.2.0', minAdminiumVersion: '0.3.0' } });
    await renderPage();
    expect(await screen.findByText('v0.2.0 needs Adminium 0.3.0 or later')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(screen.queryByText(/update available/)).toBeNull();
  });
});
