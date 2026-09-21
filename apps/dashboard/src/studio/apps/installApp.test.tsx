// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing an app from Studio.
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
import { APP_CATALOG_QUERY_KEY, APPS_QUERY_KEY, ddlPreview, type CatalogApp } from './appsApi.js';

const CONNECTION = { id: 'con_1', name: 'Practice', engine: 'postgres', readOnly: false, tableCount: 9 };

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

let calls: Call[];
let plan: Record<string, unknown>;
let installed: { apps: unknown[]; staged: unknown[] };
/** What the upload route answers — the identity the server read from the bundle. */
let uploadReply: { status: number; body: unknown };

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
      return Promise.resolve(jsonResponse(uploadReply.status, uploadReply.body));
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
  uploadReply = {
    status: 200,
    body: {
      key: 'clinic',
      version: '1.0.0',
      name: 'Clinic Desk',
      files: 12,
      integrity: 'sha512-x',
      sides: ['staff'],
    },
  };
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

  it('asks only for the file, and installs the app the bundle says it is', async () => {
    /*
     * The form used to ask for the key and version too. The server staged the
     * bundle under whatever was typed, and a key that differed from the
     * manifest — "clinicx" for "clinic" — was refused on the NEXT step. Now the
     * reply names the app and every later call is addressed by it, so the
     * filename below deliberately says nothing about which app this is.
     */
    uploadReply = {
      status: 200,
      body: { key: 'clinic', version: '0.1.1', name: 'Clinic Desk', files: 3, integrity: 'sha512-x', sides: ['staff'] },
    };
    const user = userEvent.setup();
    renderWizard();
    await screen.findByLabelText(/Bundle file/i);
    expect(screen.queryByLabelText(/App key/i)).toBeNull();
    expect(screen.queryByLabelText(/^Version/i)).toBeNull();
    // The file alone is enough to upload.
    expect(screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled')).toBe(true);
    await user.upload(
      screen.getByLabelText(/Bundle file/i),
      new File(['pretend-tarball'], 'download.tgz', { type: 'application/gzip' }),
    );
    await user.type(screen.getByLabelText(/Integrity/i), 'sha512-abc=');
    expect(screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await screen.findByText(/Install into which database/i);
    const raw = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((args) => String(args[0]))
      .find((url) => url.startsWith('/api/v1/apps/upload'));
    expect([...new URL(raw!, 'http://x').searchParams.keys()]).toEqual(['expectedSha512']);
    expect(screen.getByText('Step 2 of 4 · clinic')).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: /Practice/i }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/Review the schema plan/i);
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Installed');

    const identity = { key: 'clinic', version: '0.1.1', connectionId: CONNECTION.id };
    expect(calls.find((call) => call.url === '/api/v1/apps/plan')?.body).toEqual(identity);
    expect(calls.find((call) => call.url === '/api/v1/apps/install')?.body).toEqual(identity);
  });

  it('shows a bundle the server could not read on the bundle step, in its words', async () => {
    uploadReply = {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'This bundle carries no `manifest.json` at its root, so it is not an app bundle.',
          requestId: 'r',
        },
      },
    };
    const user = userEvent.setup();
    renderWizard();
    await user.upload(
      await screen.findByLabelText(/Bundle file/i),
      new File(['x'], 'photos.tgz', { type: 'application/gzip' }),
    );
    await user.type(screen.getByLabelText(/Integrity/i), 'sha512-abc=');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await screen.findByText(/not an app bundle/i);
    // Still on the step where the file was chosen, with nothing to continue to.
    expect(screen.getByLabelText(/Bundle file/i)).toBeTruthy();
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
  });

  it('confirms what it read when stepping back after an upload, and can start over', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.upload(
      await screen.findByLabelText(/Bundle file/i),
      new File(['x'], 'clinic-1.0.0.tgz', { type: 'application/gzip' }),
    );
    await user.type(screen.getByLabelText(/Integrity/i), 'sha512-abc=');
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await screen.findByText(/Install into which database/i);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    // The app, as the bundle named it — not an empty file picker that would
    // upload the same file again.
    expect(await screen.findByText('Install Clinic Desk')).toBeTruthy();
    expect(screen.getByText('1.0.0')).toBeTruthy();
    expect(screen.getByText(/Read from the manifest.json/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Bundle file/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/Install into which database/i);
    expect(calls.filter((call) => call.url === '/api/v1/apps/upload')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: /Upload a different bundle/i }));
    expect(screen.getByLabelText(/Bundle file/i)).toBeTruthy();
    // The old pasted hash described the old file; it does not carry over.
    expect((screen.getByLabelText(/Integrity/i) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
  });

  it('marks the installed list and the shelf stale as soon as a bundle is uploaded', async () => {
    /*
     * An upload changes what is on disk, so both lists are out of date the
     * moment it lands, not only after an install. When only a finished install
     * said so, cancelling after an upload went back to the lists as they were
     * before it: a suspense query refetches on remount only once it is a second
     * old, so a quick Cancel left the staged bundle invisible until a reload.
     * Every e2e engine hit it (app-install.spec.ts) whenever Cancel landed
     * inside that second. Asserted on the cache rather than on timing, because
     * timing is exactly what hid it.
     */
    const client = createQueryClient();
    client.setQueryData(APPS_QUERY_KEY, { apps: [], staged: [] });
    client.setQueryData(APP_CATALOG_QUERY_KEY, { apps: [] });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <InstallAppWizard onClose={() => {}} />
      </QueryClientProvider>,
    );

    const file = new File(['pretend-tarball'], 'clinic-1.0.0.tgz', { type: 'application/gzip' });
    await user.upload(await screen.findByLabelText(/Bundle file/i), file);
    await user.type(screen.getByLabelText(/Integrity/i), 'sha512-abc=');
    expect(client.getQueryState(APPS_QUERY_KEY)?.isInvalidated).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await screen.findByText(/Install into which database/i);

    await waitFor(() => {
      expect(client.getQueryState(APPS_QUERY_KEY)?.isInvalidated).toBe(true);
      expect(client.getQueryState(APP_CATALOG_QUERY_KEY)?.isInvalidated).toBe(true);
    });
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
    // the card it was opened from; here the bundle has not been read yet.
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();

    await reachPlan(user);
    expect(screen.getByText('Step 3 of 4 · clinic')).toBeTruthy();

    // G5 — the summary pill carries the comp's diff glyph.
    const summary = document.querySelector('[data-part="plan-summary"]');
    expect(summary?.querySelector('svg')).toBeTruthy();
    expect(summary?.textContent).toContain('1 created');
  });

  it('warns about pages that will arrive without a table, and still lets the install go', async () => {
    plan = {
      ...plan,
      pageWarnings: [
        {
          page: 'clinic-day',
          code: 'PAGE_UNBOUND',
          message: 'page "clinic-day" (page-calendar) declares no table in `bindings`, so it installs as an empty page',
        },
      ],
    };
    const user = userEvent.setup();
    renderWizard();
    await reachPlan(user);
    const warning = await screen.findByTestId('app-install-page-warnings');
    expect(warning.textContent).toContain('clinic-day');
    // A warning, not a refusal.
    expect(screen.queryByText('This app cannot be installed here')).toBeNull();
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(false);
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

/** Whether the app catalogue was read again after the call that changed what is on disk. */
function catalogueReadAfter(method: string, url: string): boolean {
  const at = calls.findIndex((call) => call.method === method && call.url === url);
  return at !== -1 && calls.slice(at + 1).some((call) => call.method === 'GET' && call.url === '/api/v1/apps/catalog');
}

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
    const client = createQueryClient();
    client.setQueryData(APP_CATALOG_QUERY_KEY, { apps: [] });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <InstalledAppsCard onInstall={() => {}} onUpdate={() => {}} />
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

    // Disabling never destroys data, and the dialog says so.
    expect(screen.getByText(/tables it created in your database are left alone/i)).toBeTruthy();

    await user.type(screen.getByLabelText(/Type clinic to confirm/i), 'clinic');
    await user.click(screen.getAllByRole('button', { name: /Uninstall/i }).at(-1)!);

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/v1/apps/clinic')).toBe(
        true,
      );
    });
    // An uninstall also removes the key's package from disk, so the shelf
    // card that offered it is gone too. This card reads the catalogue itself
    // (for its update pills), so the invalidation re-reads it at once rather
    // than leaving it marked stale.
    await waitFor(() => {
      expect(catalogueReadAfter('DELETE', '/api/v1/apps/clinic')).toBe(true);
    });
  });

  it('discards a bundle that was uploaded and never installed', async () => {
    installed = { apps: [], staged: [{ key: 'clinic', version: '1.0.0' }] };
    const client = createQueryClient();
    client.setQueryData(APP_CATALOG_QUERY_KEY, { apps: [] });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <InstalledAppsCard onInstall={() => {}} onUpdate={() => {}} />
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
    // The shelf lists what is on disk, and a discarded package no longer is.
    await waitFor(() => {
      expect(catalogueReadAfter('DELETE', '/api/v1/apps/staged/clinic/1.0.0')).toBe(true);
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
        source: 'disk',
        state: 'staged',
        updateTo: null,
        updateStaged: false,
        needsNewerAdminium: null,
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
        source: 'disk',
        state: 'installed',
        updateTo: null,
        updateStaged: false,
        needsNewerAdminium: null,
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
        source: 'disk',
        state: 'staged',
        updateTo: null,
        updateStaged: false,
        needsNewerAdminium: null,
      },
    ],
    catalogFetchedAt: null,
    onlineEnabled: false,
  };

  function renderShelf(onInstall: (app: CatalogApp) => void = () => {}) {
    installed = CATALOG as never;
    return render(
      <QueryClientProvider client={createQueryClient()}>
        <AppBrowser onInstall={onInstall} onToggleOnline={() => {}} onRefresh={() => {}} />
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
