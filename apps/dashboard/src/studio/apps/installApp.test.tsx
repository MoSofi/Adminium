// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing an app from Studio (47-app-installation.md step 3).
 *
 * What is worth proving here is the consent seam, because it is the whole
 * reason the flow has four steps instead of one button:
 *
 *  1. the plan is fetched and SHOWN before anything is installed, and no
 *     install call goes out while the operator is looking at it;
 *  2. a plan the server refused cannot be installed from this screen — the
 *     button is disabled and the reason is on the page, in the server's words;
 *  3. the connection the operator picked is what the install is sent with,
 *     since it is both where the tables go and what the app reads afterwards;
 *  4. uninstall asks for the app's name back and says, in the dialog, that the
 *     tables it created are NOT removed — because they are not.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { AppBrowser } from './AppBrowser.js';
import { InstallAppWizard } from './InstallAppWizard.js';
import { InstalledAppsCard } from './InstalledAppsCard.js';
import { ddlPreview, type CatalogApp } from './appsApi.js';

const CONNECTION = { id: 'con_1', name: 'Practice', engine: 'postgres', readOnly: false, tableCount: 9 };

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

let calls: Call[];
let plan: Record<string, unknown>;
let installed: { apps: unknown[]; staged: unknown[] };

function stubFetch() {
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url: url.split('?')[0] ?? url, method, body });

    if (url.startsWith('/api/v1/connections')) {
      return Promise.resolve(jsonResponse(200, { connections: [CONNECTION] }));
    }
    if (url.startsWith('/api/v1/apps/upload')) {
      return Promise.resolve(
        jsonResponse(200, {
          key: 'clinic',
          version: '1.0.0',
          files: 12,
          integrity: 'sha512-x',
          sides: ['staff'],
        }),
      );
    }
    if (url === '/api/v1/apps/plan') return Promise.resolve(jsonResponse(200, { plan }));
    if (url === '/api/v1/apps/install') {
      return Promise.resolve(
        jsonResponse(200, {
          key: 'clinic',
          version: '1.0.0',
          source: 'file',
          installedAt: 0,
          connectionId: CONNECTION.id,
          sides: [{ side: 'staff', prefix: '/apps/clinic/staff', navAvailable: true }],
          schema: { created: ['clinicians'], reused: [] },
        }),
      );
    }
    if (url.startsWith('/api/v1/apps')) {
      return Promise.resolve(jsonResponse(200, installed));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  installed = { apps: [], staged: [] };
  plan = {
    key: 'clinic',
    version: '1.0.0',
    installable: true,
    touchesData: true,
    create: [{ ref: 'clinicians', columns: [{ ref: 'id', type: 'int' }, { ref: 'name', type: 'text' }] }],
    reuse: [],
    references: [],
    problems: [],
    requiresSchemaChange: true,
  };
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWizard() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <InstallAppWizard onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/** Drives the first two steps, which every plan assertion needs behind it. */
async function reachPlan(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(['pretend-tarball'], 'clinic-1.0.0.tgz', { type: 'application/gzip' });
  // The wizard suspends on the connection list before its first step paints —
  // the picker's options ARE that list, and offering an empty menu that fills
  // in underneath is the bug the suspense is there to prevent.
  await user.upload(await screen.findByLabelText(/Bundle file/i), file);
  await user.type(screen.getByLabelText(/App key/i), 'clinic');
  await user.type(screen.getByLabelText(/^Version/i), '1.0.0');
  // The operator's own hash — the path where the check is real end to end, and
  // the one that does not need WebCrypto in the test environment.
  await user.type(screen.getByLabelText(/Integrity/i), 'sha512-abc=');
  await user.click(screen.getByRole('button', { name: 'Upload' }));

  await screen.findByText(/Install into which database/i);
  await user.click(screen.getByRole('radio', { name: /Practice/i }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText(/Review the schema plan/i);
}

describe('the install wizard', () => {
  it('shows the plan before installing, and installs nothing until asked', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachPlan(user);

    expect(screen.getByText('clinicians')).toBeTruthy();
    // The consent property, stated as an assertion: the plan has been fetched
    // and rendered, and no install has gone out.
    expect(calls.some((call) => call.url === '/api/v1/apps/plan')).toBe(true);
    expect(calls.some((call) => call.url === '/api/v1/apps/install')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Installed');

    const install = calls.find((call) => call.url === '/api/v1/apps/install');
    expect(install?.body).toEqual({ key: 'clinic', version: '1.0.0', connectionId: CONNECTION.id });
    expect(screen.getByText('/apps/clinic/staff/')).toBeTruthy();
  });

  it('sends the operator’s own integrity value rather than one it computed', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachPlan(user);
    const upload = calls.find((call) => call.url === '/api/v1/apps/upload');
    expect(upload).toBeTruthy();
    // The query carries it; the recorded url is stripped of its query, so the
    // raw call is re-read from the mock's own argument list.
    const raw = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((args) => String(args[0]))
      .find((url) => url.startsWith('/api/v1/apps/upload'));
    expect(raw).toContain(encodeURIComponent('sha512-abc='));
  });

  it('shows a connection as a choice before one is made (G1)', async () => {
    const user = userEvent.setup();
    renderWizard();
    // Reach the database step without selecting anything.
    const file = new File(['x'], 'clinic-1.0.0.tgz', { type: 'application/gzip' });
    await user.upload(await screen.findByLabelText(/Bundle file/i), file);
    await user.type(screen.getByLabelText(/App key/i), 'clinic');
    await user.type(screen.getByLabelText(/^Version/i), '1.0.0');
    await user.type(screen.getByLabelText(/Integrity/i), 'sha512-abc=');
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await screen.findByText(/Install into which database/i);

    /*
     * The comp draws a radio at the row start. Without it, an instance with ONE
     * connection shows a card nobody has touched and nothing saying it is a
     * choice — which is what the comp walk found.
     */
    const radio = document.querySelector('[data-part="connection-radio"]');
    expect(radio).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Practice/i }).getAttribute('data-state')).toBe(
      'unchecked',
    );
  });

  it('counts the steps in the footer, and names the app once it has one (G4, G5)', async () => {
    const user = userEvent.setup();
    renderWizard();
    await screen.findByLabelText(/Bundle file/i);
    // Before an upload there is no app to name — the comp knows its app from
    // the card it was opened from; here the key is still being typed.
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();

    await reachPlan(user);
    expect(screen.getByText('Step 3 of 4 · clinic')).toBeTruthy();

    // G5 — the summary pill carries the comp's diff glyph.
    const summary = document.querySelector('[data-part="plan-summary"]');
    expect(summary?.querySelector('svg')).toBeTruthy();
    expect(summary?.textContent).toContain('1 created');
  });

  it('cannot install a plan the server refused', async () => {
    plan = {
      ...plan,
      installable: false,
      create: [],
      problems: [
        {
          code: 'UNRESOLVED_REFERENCE',
          table: 'visits',
          column: 'patient_id',
          message: 'points at a table called "patients", which this app does not create',
        },
      ],
    };
    const user = userEvent.setup();
    renderWizard();
    await reachPlan(user);

    expect(screen.getByText(/this app does not create/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('the installed list', () => {
  it('says the tables survive an uninstall, and asks for the key back', async () => {
    installed = {
      apps: [
        {
          key: 'clinic',
          version: '1.0.0',
          source: 'file',
          installedAt: 0,
          connectionId: null,
          sides: [{ side: 'staff', prefix: '/apps/clinic/staff', navAvailable: true }],
        },
      ],
      staged: [],
    };
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <InstalledAppsCard onInstall={() => {}} />
      </QueryClientProvider>,
    );

    await screen.findByText('clinic');

    // G2 — when it was installed, which the DTO always carried and the row did
    // not show. G3 — the mount is a link, not text to retype.
    // Lowercase and anchored: the card's own "Installed apps" title matches a
    // looser pattern, and a test that passes on the heading proves nothing.
    expect(screen.getByText(/^installed \S/)).toBeTruthy();
    const mount = screen.getByRole('link', { name: '/apps/clinic/staff/' });
    expect(mount.getAttribute('href')).toBe('/apps/clinic/staff/');

    await user.click(screen.getByRole('button', { name: /Uninstall/i }));

    // 24 D16 / 26 D5: disabling never destroys data, and the dialog says so.
    expect(screen.getByText(/tables it created in your database are left alone/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/Type clinic to confirm/i), 'clinic');
    await user.click(screen.getAllByRole('button', { name: /Uninstall/i }).at(-1)!);

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/v1/apps/clinic')).toBe(
        true,
      );
    });
  });

  it('discards a bundle that was uploaded and never installed', async () => {
    installed = { apps: [], staged: [{ key: 'clinic', version: '1.0.0' }] };
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={createQueryClient()}>
        <InstalledAppsCard onInstall={() => {}} />
      </QueryClientProvider>,
    );

    await screen.findByText('Uploaded but not installed');
    expect(screen.getByText('clinic@1.0.0')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      expect(
        calls.some(
          (call) => call.method === 'DELETE' && call.url === '/api/v1/apps/staged/clinic/1.0.0',
        ),
      ).toBe(true);
    });
  });
});

describe('the app shelf (47 step 4b)', () => {
  const CATALOG = {
    apps: [
      {
        key: 'clinic',
        version: '1.0.0',
        name: 'Clinic Desk',
        description: 'An appointment desk.',
        categories: ['operations'],
        publisher: 'Adminium',
        capabilities: ['payments', 'realtime'],
        sides: ['staff', 'customer'],
        installed: false,
        installedVersion: null,
        readable: true,
      },
      {
        key: 'shopfront',
        version: '2.0.0',
        name: 'Shopfront',
        description: 'A storefront.',
        categories: ['commerce'],
        publisher: 'Adminium',
        capabilities: [],
        sides: ['customer'],
        installed: true,
        installedVersion: null,
        readable: true,
      },
      {
        key: 'broken',
        version: '1.0.0',
        name: 'broken',
        description: '',
        categories: [],
        publisher: '',
        capabilities: [],
        sides: [],
        installed: false,
        installedVersion: null,
        readable: false,
      },
    ],
  };

  function renderShelf(onInstall: (app: CatalogApp) => void = () => {}) {
    installed = CATALOG as never;
    return render(
      <QueryClientProvider client={createQueryClient()}>
        <AppBrowser onInstall={onInstall} />
      </QueryClientProvider>,
    );
  }

  it('lists what is on disk, with its byline and declared capabilities', async () => {
    renderShelf();
    await screen.findByText('Clinic Desk');
    // Two cards share the publisher, which is the normal case for first-party apps.
    expect(screen.getAllByText('by Adminium').length).toBeGreaterThan(0);
    // The chips are the manifest's own `capabilities`, not invented features.
    expect(screen.getByText('payments')).toBeTruthy();
    expect(screen.getByText('realtime')).toBeTruthy();
    // Browsing is a DISK read — no catalogue fetch went anywhere but our own API.
    expect(calls.every((call) => call.url.startsWith('/api/v1/'))).toBe(true);
  });

  it('offers Install only for what can be installed', async () => {
    renderShelf();
    await screen.findByText('Clinic Desk');

    // Already installed: a badge, not a button that would re-do it.
    expect(screen.getByText('Installed')).toBeTruthy();
    // Unreadable: the row is SHOWN — hiding it is how a store grows packages
    // nobody can account for — but it cannot be installed.
    expect(screen.getByText(/manifest could not be read/i)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: /^Install$/ });
    expect(buttons).toHaveLength(2);
    expect(buttons.filter((b) => b.hasAttribute('disabled'))).toHaveLength(1);
  });

  it('filters by search and by category', async () => {
    const user = userEvent.setup();
    renderShelf();
    await screen.findByText('Clinic Desk');

    await user.type(screen.getByLabelText(/Search apps/i), 'shop');
    expect(screen.queryByText('Clinic Desk')).toBeNull();
    expect(screen.getByText('Shopfront')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Clear the search/i }));
    await user.click(screen.getByRole('button', { name: /^operations/ }));
    expect(screen.getByText('Clinic Desk')).toBeTruthy();
    expect(screen.queryByText('Shopfront')).toBeNull();
  });

  it('hands the wizard the app that was clicked', async () => {
    const chosen: CatalogApp[] = [];
    const user = userEvent.setup();
    renderShelf((app) => {
      chosen.push(app);
    });
    await screen.findByText('Clinic Desk');
    // Cards sort by name, so the first Install button belongs to `broken` and is
    // disabled — click the one that can actually act.
    const enabled = screen
      .getAllByRole('button', { name: /^Install$/ })
      .find((b) => !b.hasAttribute('disabled'));
    await user.click(enabled!);
    expect(chosen[0]).toMatchObject({ key: 'clinic', name: 'Clinic Desk' });
  });

  it('a shelf app skips the upload step entirely', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <InstallAppWizard
          onClose={() => {}}
          preselected={{ key: 'clinic', version: '1.0.0', name: 'Clinic Desk' }}
        />
      </QueryClientProvider>,
    );
    // The comp's source step, as a confirmation of the card that was clicked —
    // the bundled package is already on disk, so there is nothing to upload.
    await screen.findByText('Install Clinic Desk');
    expect(screen.queryByLabelText(/Bundle file/i)).toBeNull();
    expect(screen.getByText('Step 1 of 4 · clinic')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });
});

describe('ddlPreview', () => {
  it('lines a table up the way the comp draws it', () => {
    expect(
      ddlPreview({ ref: 'clinicians', columns: [{ ref: 'id', type: 'int' }, { ref: 'full_name', type: 'text' }] }),
    ).toBe('CREATE TABLE clinicians (\n  id         int,\n  full_name  text\n);');
  });
});
