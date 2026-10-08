// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/add-ons`.
 *
 * Router-mounted rather than bare, for the same three reasons the public-API
 * page is: the route is lazy, it sits behind `StudioGuard`, and the heading is
 * published through the PageActions channel so a bare render has no `<h1>`.
 *
 * What is worth proving here is what the page SAYS, not that it renders:
 *
 *  1. an air-gapped instance browses without the page reaching for anything,
 *     and says so rather than showing a broken "check for newer";
 *  2. the consent dialog shows the plan BEFORE consent, and refuses to offer
 * Install when the plan cannot be applied (the security surface);
 *  3. disconnect and uninstall say DIFFERENT things, because they do different
 *     things and the safest of them must not read like the most destructive.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import type { AddOnDto, CatalogEntry, InstallPlan } from './addOnsApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function makeEntry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    key: 'holiday-calendars',
    name: 'Holiday Calendars',
    version: '1.0.0',
    source: 'bundled',
    state: 'staged',
    upgradeTo: null,
    needsNewerAdminium: null,
    tagline: 'Public holidays for 30 countries, ready to attach.',
    categories: ['data'],
    connectKind: 'none',
    ...over,
  };
}

function makeAddOn(over: Partial<AddOnDto> = {}): AddOnDto {
  return {
    // The common case: its files are where the meta store says they are.
    missing: false,
    // The manifest's declared settings; the panel generates its form from
    // these. Empty here so existing cases are unchanged.
    settings: [],
    settingValues: {},
    key: 'shipping-dhl',
    name: 'DHL Shipping',
    version: '1.0.0',
    connectKind: 'api-key',
    connected: true,
    connectionExpiresAt: null,
    attachments: [{ attachedTo: 'printing', enabled: true }],
    slots: [],
    provides: [],
    networkAllow: ['express.api.dhl.com'],
    bundles: [],
    ...over,
  };
}

function makePlan(over: Partial<InstallPlan> = {}): InstallPlan {
  return {
    addOnKey: 'holiday-calendars',
    version: '1.0.0',
    installable: true,
    touchesData: false,
    create: [],
    reuse: [],
    references: [],
    problems: [],
    requiresSchemaChange: false,
    ...over,
  };
}

/** Successive job reads, consumed in order by the stubbed jobs route. */
let jobSteps: { status: string; progress: unknown; lastError: string | null }[] = [];

interface StubOptions {
  onlineEnabled?: boolean;
  vetoed?: boolean;
  entries?: CatalogEntry[];
  installed?: AddOnDto[];
  plan?: InstallPlan;
  /** What the sideload route answers — by default, the package it read. */
  upload?: { status: number; body: unknown };
  /** Answers a request first, when it has an answer of its own for it. */
  respond?: (method: string, url: string, body: unknown) => { status: number; body: unknown; after?: Promise<void> } | undefined;
}

function stubFetch(options: StubOptions = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const sent: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body: sent });
    const own = options.respond?.(method, url, sent);
    if (own !== undefined) return (own.after ?? Promise.resolve()).then(() => jsonResponse(own.status, own.body));

    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(
        jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] }, roles: ['super-admin'] }) }),
      );
    }
    if (url === '/api/v1/add-ons' && method === 'GET') {
      return Promise.resolve(jsonResponse(200, { addOns: options.installed ?? [] }));
    }
    if (url === '/api/v1/add-ons/catalog' && method === 'GET') {
      return Promise.resolve(
        jsonResponse(200, {
          addOns: options.entries ?? [makeEntry()],
          catalogFetchedAt: null,
          onlineEnabled: options.onlineEnabled ?? false,
        }),
      );
    }
    if (url.endsWith('/plan')) {
      return Promise.resolve(jsonResponse(200, { plan: options.plan ?? makePlan() }));
    }
    if (url.startsWith('/api/v1/jobs/')) {
      const step = jobSteps.shift() ?? { status: 'succeeded', progress: null, lastError: null };
      return Promise.resolve(jsonResponse(200, { data: { id: 'job_1', ...step } }));
    }
    if (url === '/api/v1/add-ons/catalog' && method === 'PUT') {
      return Promise.resolve(
        jsonResponse(200, {
          onlineEnabled: !(options.vetoed ?? false),
          vetoed: options.vetoed ?? false,
        }),
      );
    }
    if (url.startsWith('/api/v1/add-ons/upload')) {
      const reply = options.upload ?? {
        status: 200,
        body: {
          key: 'holiday-calendars',
          version: '1.0.0',
          name: 'Holiday Calendars',
          files: 3,
          integrity: 'sha512-abc==',
        },
      };
      return Promise.resolve(jsonResponse(reply.status, reply.body));
    }
    if (url.startsWith('/api/v1/add-ons/download') || url.endsWith('/catalog/refresh')) {
      return Promise.resolve(jsonResponse(200, { jobId: 'job_1' }));
    }
    return Promise.resolve(jsonResponse(200, { ok: true, jobId: 'job_1' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

async function renderPage(options: StubOptions = {}) {
  // Each test opens the page as if for the first time.
  forgetStaleAsk();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const stub = stubFetch(options);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/studio/add-ons'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...stub, queryClient };
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
  jobSteps = [];
});

import { forgetStaleAsk } from './AddOnsPage.js';

describe('AddOnsPage', () => {
  it('resolves the lazy route and lists what is available', async () => {
    await renderPage();
    expect(await screen.findByText('Holiday Calendars')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
  });

  it('browses air-gapped, and says so instead of offering a broken action', async () => {
    // Browse is a disk read. The page must be useful before anyone
    // decides whether to switch the online catalogue on.
    const { calls } = await renderPage({ onlineEnabled: false });
    expect(await screen.findByText(/has contacted the internet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check for newer' })).toBeNull();
    // And browsing really did not reach for the catalogue endpoint.
    expect(calls.some((c) => c.url.includes('/catalog/refresh'))).toBe(false);
  });

  it('offers the refresh action only when browsing online is on', async () => {
    await renderPage({ onlineEnabled: true });
    expect(await screen.findByRole('button', { name: 'Check for newer' })).toBeTruthy();
  });

  it('shows the plan BEFORE consent, and asks for the plan when the dialog opens', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage();
    await user.click(await screen.findByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/v1/add-ons/holiday-calendars/plan')).toBe(true);
    });
    expect(await screen.findByText(/reads and writes no tables of its own/)).toBeTruthy();
    // Nothing was installed by opening the dialog.
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')).toBe(false);
  });

  it('says before consent that a package nobody vouches for installs without the code that decides', async () => {
    const user = userEvent.setup();
    await renderPage({ respond: (method, url) => (method === 'GET' && url.endsWith('/holiday-calendars/plan') ? { status: 200, body: { plan: makePlan(), codeWillNotRun: true } } : undefined) });
    await user.click(await screen.findByRole('button', { name: 'Install' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Adminium does not know who made it: the part of it that decides things while a record is saved will not run/)).toBeTruthy();
  });

  it('refuses to offer Install when the plan cannot be applied', async () => {
    // The dialog is the security surface. A plan that names a missing host
    // table must not have a live Install button beside it.
    const user = userEvent.setup();
    await renderPage({
      plan: makePlan({
        installable: false,
        touchesData: true,
        problems: [
          {
            code: 'UNRESOLVED_REFERENCE',
            message: '"artwork_designs.job_id" points at a table called "jobs", which is absent.',
            table: 'artwork_designs',
            column: 'job_id',
          },
        ],
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Install' }));

    expect(await screen.findByText(/points at a table called "jobs"/)).toBeTruthy();
    const confirm = screen
      .getAllByRole('button', { name: 'Install' })
      .find((button) => (button as HTMLButtonElement).disabled);
    expect(confirm).toBeTruthy();
  });

  it('names the tables it will CREATE, before consent is given', async () => {
    // Install creates them now. The dialog has to say so and name them, because
    // this is the moment someone agrees to a write against their own database.
    const user = userEvent.setup();
    await renderPage({
      plan: makePlan({
        touchesData: true,
        requiresSchemaChange: true,
        create: [{ ref: 'shipments', columns: [{ ref: 'id', type: 'id' }] }],
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Install' }));
    expect(await screen.findByText(/will create tables in your database/i)).toBeTruthy();
    expect(screen.getByText('shipments')).toBeTruthy();
    // And Install is LIVE — the tables are the thing being consented to, not a
    // reason to refuse.
    const dialog = await screen.findByRole('dialog');
    expect(
      (within(dialog).getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('refuses when a table exists but lacks columns the add-on needs', async () => {
    // The one schema case install still will not do: altering a table the
    // operator already owns.
    const user = userEvent.setup();
    await renderPage({
      plan: makePlan({
        touchesData: true,
        requiresSchemaChange: true,
        reuse: [{ ref: 'shipments', missingColumns: ['tracking'] }],
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Install' }));
    expect(await screen.findByText(/needs columns you do not have/)).toBeTruthy();
    expect(screen.getByText(/tracking/)).toBeTruthy();
    const dialog = await screen.findByRole('dialog');
    expect(
      (within(dialog).getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('says what an add-on may contact, from its own manifest', async () => {
    await renderPage({ installed: [makeAddOn()] });
    expect(await screen.findByText(/express\.api\.dhl\.com/)).toBeTruthy();
  });

  it('an add-on that ships sample data has the card on its own entry, asked of its own route; one that ships none has no card', async () => {
    const user = userEvent.setup();
    const status = { offered: true, loaded: false, total: 0, addedAt: null, tables: [], available: { total: 12, tables: [{ ref: 'items', count: 12 }], assets: 0 } };
    const { calls } = await renderPage({
      installed: [makeAddOn(), makeAddOn({ key: 'inventory', name: 'Inventory' })],
      respond: (method, url) => (method === 'GET' && url === '/api/v1/add-ons/inventory/sample-data' ? { status: 200, body: status } : method === 'GET' && url.endsWith('/sample-data') ? { status: 200, body: { ...status, offered: false, available: null } } : undefined),
    });
    const card = await screen.findByTestId('app-sample-data');
    expect(screen.getAllByTestId('app-sample-data')).toHaveLength(1);
    expect(card.closest('li')!.id).toBe('add-on-inventory');
    await user.click(within(card).getByRole('button', { name: 'Add sample data' }));
    const dialog = await screen.findByRole('dialog');
    // Said of the add-on's own tables; and the add is the add-on's route, never an app's of that name.
    expect(dialog.textContent).toContain('A few example records in the add-on’s own tables.');
    await user.click(within(dialog).getByRole('button', { name: 'Add sample data' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url === '/api/v1/add-ons/inventory/sample-data')).toBe(true));
    expect(calls.some((call) => call.url.startsWith('/api/v1/apps/'))).toBe(false);
  });

  it('DISCONNECT and UNINSTALL say different things', async () => {
    // The whole reason there are two confirms. Disconnect keeps the files;
    // uninstall removes them. Both keep every table, and both say so.
    const user = userEvent.setup();
    await renderPage({ installed: [makeAddOn()] });

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText(/stops making calls/)).toBeTruthy();
    expect(screen.getByText(/stays exactly as it is/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
    expect(await screen.findByText(/files are removed from this server/)).toBeTruthy();
  });

  it('fires nothing until the confirm is pressed', async () => {
    const user = userEvent.setup();
    const { calls } = await renderPage({ installed: [makeAddOn()] });
    await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    // Scoped to the dialog: the page behind it is correctly inert while it is
    // open, so a bare `getAllByRole` picks a button that cannot be clicked.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/add-ons/shipping-dhl'))).toBe(
        true,
      );
    });
  });

  it('reads the sidebar’s pages again once an add-on changed', async () => {
    /*
     * An add-on's own page rides the bootstrap. The page used to refresh its
     * two lists and nothing else, so a newly installed add-on was "on" with no
     * link to it in the sidebar until the page was reloaded.
     */
    const user = userEvent.setup();
    const { calls } = await renderPage({ installed: [makeAddOn()] });
    await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
    const before = calls.filter((c) => c.url.startsWith('/api/v1/bootstrap')).length;
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.url.startsWith('/api/v1/bootstrap')).length).toBeGreaterThan(before);
    });
  });

  describe('The acquisition story', () => {
    it('follows a download to completion instead of calling it done when enqueued', async () => {
      /*
       * A download is a JOB — `POST /add-ons/download` answers `{ jobId }`
       * immediately and the bytes arrive later. Reporting success on the enqueue
       * is how an operator refreshes to find nothing staged.
       */
      const user = userEvent.setup();
      jobSteps = [
        { status: 'running', progress: { pct: 40, message: 'Fetching' }, lastError: null },
        { status: 'succeeded', progress: { pct: 100, message: null }, lastError: null },
      ];
      const { calls } = await renderPage({
        entries: [makeEntry({ state: 'available' })],
        onlineEnabled: true,
      });
      // One click: Install on a row the list offers fetches it…
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      await waitFor(() => {
        expect(calls.some((c) => c.url.startsWith('/api/v1/jobs/'))).toBe(true);
      });
      // It kept reading until the job actually finished.
      await waitFor(() => {
        expect(calls.filter((c) => c.url.startsWith('/api/v1/jobs/')).length).toBeGreaterThan(1);
      });
      // …and then the confirmation opens on its plan. Nothing is installed before the dialog's own yes.
      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/add-ons/holiday-calendars/plan')).toBe(true));
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')).toBe(false);
      expect(within(dialog).getByRole('button', { name: /Install/ })).toBeTruthy();
    });

    it('marks a gone add-on in the Installed list, which shows it as Connected', async () => {
      /*
       * This list is a pure meta read plus the credential table, and BOTH
       * outlive a wiped volume — so the row rendered as a healthy install down
       * to its green "Connected" badge.
       */
      await renderPage({
        installed: [makeAddOn({ missing: true, connectKind: 'api-key', connected: true })],
      });
      expect(await screen.findByText('Missing')).toBeTruthy();
      expect(
        screen.getByText(/Its files are not on this server, so none of it loads/),
      ).toBeTruthy();
    });

    it('marks an installed add-on whose files are gone, and offers the re-download', async () => {
      /*
       * The server's catalog reply is assembled from bytes on disk plus
       * the cached feed, so before the `missing` state this row was either
       * labelled `installed` or absent from the reply entirely.
       */
      await renderPage({
        entries: [makeEntry({ state: 'missing', source: 'catalog' })],
        onlineEnabled: true,
      });
      expect(await screen.findByText('Missing')).toBeTruthy();
      expect(screen.getByText(/Its files are not on this server, so none of it loads/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    });

    it('offers no re-download for a missing add-on the catalogue does not carry', async () => {
      // Every uploaded add-on, and every install with no cached feed: there is
      // nowhere to fetch it from, so the line is the whole answer.
      await renderPage({
        entries: [makeEntry({ state: 'missing', source: 'bundled' })],
        onlineEnabled: true,
      });
      expect(await screen.findByText('Missing')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    });

    it('surfaces a failed download as the failure it was, not as success', async () => {
      const user = userEvent.setup();
      jobSteps = [{ status: 'failed', progress: null, lastError: 'the hash did not match' }];
      await renderPage({ entries: [makeEntry({ state: 'available' })], onlineEnabled: true });
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      expect(await screen.findByText(/the hash did not match/)).toBeTruthy();
      // A fetch that failed asks nothing: no confirmation over a package that is not there.
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('offers one button on a server whose list is off, says what it sends, and asks for the list when pressed', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ onlineEnabled: false });
      expect(await screen.findByText(/The list of adminium\.dev is off on this server\. Showing it asks adminium\.dev for the list, which tells it this server’s address, the time and its Adminium version\./)).toBeTruthy();
      // Off: the page asks adminium.dev for nothing by itself.
      expect(calls.some((c) => c.url === '/api/v1/add-ons/catalog/refresh')).toBe(false);
      await user.click(screen.getByRole('button', { name: 'Show what is available' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/add-ons/catalog')).toBe(true));
      // Switched on: the list is asked for at once.
      await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/add-ons/catalog/refresh')).toBe(true));
    });

    it('asks for a list that was never fetched when the page opens, once, and only while the list is on', async () => {
      const { calls } = await renderPage({ entries: [], onlineEnabled: true });
      await waitFor(() => expect(calls.filter((c) => c.url === '/api/v1/add-ons/catalog/refresh')).toHaveLength(1));
      // Once: the reads that follow the refresh do not start another.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(calls.filter((c) => c.url === '/api/v1/add-ons/catalog/refresh')).toHaveLength(1);
    });

    it('switches the online catalogue on from the page that uses it', async () => {
      // This lives with the add-on routes and `manifests.manage`, not under
      // /settings/* and `settings.manage`.
      const user = userEvent.setup();
      const { calls } = await renderPage({ onlineEnabled: false });
      await user.click(
        await screen.findByRole('switch', { name: 'Browse the online catalogue' }),
      );
      await waitFor(() => {
        expect(
          calls.some((c) => c.method === 'PUT' && c.url === '/api/v1/add-ons/catalog'),
        ).toBe(true);
      });
    });

    it('says so when the environment overrules the switch (O1)', async () => {
      // Saved, and still off. A toggle that springs back with no explanation
      // reads as a broken page rather than as a policy.
      const user = userEvent.setup();
      await renderPage({ onlineEnabled: false, vetoed: true });
      await user.click(
        await screen.findByRole('switch', { name: 'Browse the online catalogue' }),
      );
      expect(await screen.findByText(/cannot browse online/)).toBeTruthy();
    });

    it('offers sideload, and refuses to submit without the hash that verifies it', async () => {
      /*
       * D4: the upload runs the identical verify-then-unpack path a download
       * runs, so it needs the same thing a download gets from the registry — a
       * hash supplied by somebody other than the bytes. The button stays
       * disabled until there is one. It asks for nothing else: which add-on the
       * file is comes out of its manifest.
       */
      const user = userEvent.setup();
      await renderPage();
      const upload = await screen.findByRole('button', { name: 'Upload' });
      expect((upload as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByLabelText('Add-on key')).toBeNull();
      expect(screen.queryByLabelText('Version')).toBeNull();

      const file = new File([new Uint8Array([1, 2, 3])], 'add-on.tgz', { type: 'application/gzip' });
      await user.upload(screen.getByLabelText('Package file (.tgz)'), file);
      // Still disabled — a file, but no hash.
      expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(
        true,
      );

      await user.type(screen.getByLabelText(/Integrity/), 'sha512-abc==');
      expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });

    it('sends only the bytes and their hash, and names the add-on the server read', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage();
      await screen.findByRole('button', { name: 'Upload' });
      // A filename that says nothing about which add-on this is.
      const file = new File([new Uint8Array([1, 2, 3])], 'download.tgz', { type: 'application/gzip' });
      await user.upload(screen.getByLabelText('Package file (.tgz)'), file);
      await user.type(screen.getByLabelText(/Integrity/), 'sha512-abc==');
      await user.click(screen.getByRole('button', { name: 'Upload' }));

      expect(await screen.findByText('Uploaded Holiday Calendars 1.0.0')).toBeTruthy();
      const upload = calls.find((c) => c.url.startsWith('/api/v1/add-ons/upload'));
      expect(upload, 'no upload was sent').toBeTruthy();
      expect([...new URL(upload!.url, 'http://x').searchParams]).toEqual([
        ['expectedSha512', 'sha512-abc=='],
      ]);

      // The hash described that file; the form is ready for the next package.
      expect((screen.getByLabelText(/Integrity/) as HTMLInputElement).value).toBe('');
      expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });

    it('shows a package the server refused in its words, and confirms nothing', async () => {
      const user = userEvent.setup();
      await renderPage({
        upload: {
          status: 422,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message: '"sample-desk" is an app, not an add-on. Install it from Studio → Hosted apps.',
              requestId: 'r',
            },
          },
        },
      });
      await screen.findByRole('button', { name: 'Upload' });
      await user.upload(
        screen.getByLabelText('Package file (.tgz)'),
        new File([new Uint8Array([1])], 'clinic.tgz', { type: 'application/gzip' }),
      );
      await user.type(screen.getByLabelText(/Integrity/), 'sha512-abc==');
      await user.click(screen.getByRole('button', { name: 'Upload' }));

      expect(await screen.findByText(/is an app, not an add-on/)).toBeTruthy();
      expect(screen.queryByText(/^Uploaded /)).toBeNull();
      // Kept, so the operator can pick the right file without retyping the hash.
      expect((screen.getByLabelText(/Integrity/) as HTMLInputElement).value).toBe('sha512-abc==');
    });
  });

  it('tells an empty instance what to do rather than showing a bare list', async () => {
    await renderPage({ entries: [], installed: [] });
    expect(await screen.findByText('No add-ons available')).toBeTruthy();
    expect(screen.getByText('Nothing installed yet')).toBeTruthy();
  });
  /*
   * The browse surface (3-6).
   *
   * These drive the REAL page through the router, so every one of them also
   * proves the widened DTO survives the client mirror: a card cannot render a
   * tagline or a category the API layer dropped.
   */
  describe('the catalogue’s card', () => {
    it('shows its monogram, publisher and date, and a coming-soon add-on it cannot download', async () => {
      await renderPage({
        onlineEnabled: true,
        entries: [
          makeEntry({ source: 'catalog', state: 'available', author: 'Adminium', monogram: 'Hc', lastUpdatedAt: '2026-09-20T00:00:00.000Z' }),
          makeEntry({ key: 'add-on-payroll', name: 'Payroll', version: '', source: 'catalog', state: 'available', availability: 'coming-soon' }),
        ],
      });
      const holidays = (await screen.findByText('Holiday Calendars')).closest('li') as HTMLElement;
      expect(within(holidays).getByText('Hc')).toBeTruthy();
      expect(within(holidays).getByText('by Adminium')).toBeTruthy();
      expect(within(holidays).getByText(/^Updated .*2026/)).toBeTruthy();
      expect(within(holidays).getByRole('button', { name: 'Install' })).toBeTruthy();

      const payroll = screen.getByText('Payroll').closest('li') as HTMLElement;
      expect(within(payroll).getByText('Coming soon')).toBeTruthy();
      expect(within(payroll).getByText('Not available yet')).toBeTruthy();
      expect(within(payroll).queryByRole('button', { name: 'Download' })).toBeNull();
    });
  });

  describe('browsing: rail, search and the three nothings (40)', () => {
    const many = [
      makeEntry({ key: 'barcode-labels', name: 'Barcode Labels', categories: ['data'] }),
      makeEntry({
        key: 'shipping-dhl',
        name: 'DHL Shipping',
        categories: ['delivery'],
        connectKind: 'api-key',
        state: 'available',
        source: 'catalog',
        tagline: 'Live rates and labels for parcels.',
      }),
      makeEntry({
        key: 'design-studio',
        name: 'Design Studio',
        categories: ['artwork'],
        tagline: 'Lay out artwork on the product page.',
      }),
    ];

    it('filters the grid by category, with counts that match what a click shows', async () => {
      const user = userEvent.setup();
      await renderPage({ entries: many });
      await screen.findByText('Barcode Labels');

      // The rail lists only categories that are actually present, plus All.
      const rail = screen.getByRole('navigation', { name: 'Categories' });
      const labels = within(rail)
        .getAllByRole('button')
        .map((b) => b.textContent);
      expect(labels).toEqual(['All3', 'Artwork1', 'Delivery1', 'Data1']);

      await user.click(within(rail).getByRole('button', { name: /Delivery/ }));
      expect(screen.getByText('DHL Shipping')).toBeTruthy();
      expect(screen.queryByText('Barcode Labels')).toBeNull();
      expect(screen.queryByText('Design Studio')).toBeNull();
    });

    it('searches on the tagline as well as the name (D6)', async () => {
      const user = userEvent.setup();
      await renderPage({ entries: many });
      await screen.findByText('Design Studio');

      // "parcels" appears only in DHL's tagline, never in any name.
      await user.type(screen.getByRole('textbox', { name: 'Search add-ons' }), 'parcels');
      expect(screen.getByText('DHL Shipping')).toBeTruthy();
      expect(screen.queryByText('Design Studio')).toBeNull();
    });

    it('says what installing will ask for, before a download (D5)', async () => {
      await renderPage({ entries: many });
      await screen.findByText('DHL Shipping');
      expect(screen.getByText('Needs an API key')).toBeTruthy();
      // …and says nothing at all for the add-ons that need no credential.
      expect(screen.queryByText('Connects with OAuth')).toBeNull();
    });

    it('renders an unknown category as its own slug rather than dropping the row (D4)', async () => {
      const user = userEvent.setup();
      await renderPage({
        entries: [makeEntry({ key: 'future-thing', name: 'Future Thing', categories: ['telemetry'] })],
      });
      await screen.findByText('Future Thing');
      const rail = screen.getByRole('navigation', { name: 'Categories' });
      const slug = within(rail).getByRole('button', { name: /telemetry/ });
      await user.click(slug);
      // Reachable through the rail, not merely visible on the card.
      expect(screen.getByText('Future Thing')).toBeTruthy();
    });

    it('distinguishes a filter that matched nothing from an empty catalogue (D8)', async () => {
      const user = userEvent.setup();
      await renderPage({ entries: many });
      await screen.findByText('Barcode Labels');

      await user.type(screen.getByRole('textbox', { name: 'Search add-ons' }), 'zzzz');
      expect(screen.getByText('Nothing matches')).toBeTruthy();
      // NOT the configuration answer: there are add-ons, the filter hid them.
      expect(screen.queryByText('No add-ons available')).toBeNull();
    });

    it('blames the catalogue, not the build, when online is on and found nothing', async () => {
      await renderPage({ entries: [], onlineEnabled: true });
      await screen.findByText('No add-ons available');
      expect(
        screen.getByText(/the last check found nothing/, { exact: false }),
      ).toBeTruthy();
    });
  });


  describe('an add-on that keeps tables of its own', () => {
    const SHOP = { id: 'conn_shop', name: 'Shop' };
    const ARCHIVE = { id: 'conn_old', name: 'Archive' };
    const MAKES = { pages: [{ ref: 'kit-items', title: 'Items' }, { ref: 'kit-count', title: 'Count' }], roles: [{ key: 'manager', name: 'Stock manager' }], lists: ['zones'], documents: 2, seeds: true };
    const asked = { status: 409, body: { error: { code: 'ADD_ON_SCHEMA_CONNECTION', message: 'Which database?', requestId: 'r', details: { connections: [SHOP, ARCHIVE] } } } };
    const planned = (connection: { id: string; name: string }) => ({
      status: 200,
      body: { plan: makePlan({ touchesData: true, create: [{ ref: 'items', columns: [] }] }), connectionId: connection.id, connectionName: connection.name, checksum: `sum-${connection.id}`, makes: MAKES },
    });
    /** Two databases: the first check is answered with the list, a check that names one with its plan. */
    const twoDatabases: NonNullable<StubOptions['respond']> = (method, url, body) => {
      if (method === 'GET' && url.endsWith('/holiday-calendars/plan')) return asked;
      if (method === 'POST' && url === '/api/v1/add-ons/plan') return planned((body as { connectionId: string }).connectionId === SHOP.id ? SHOP : ARCHIVE);
      return undefined;
    };

    it('picks a database when asked, shows what will be made there, and installs in the one chosen', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ respond: twoDatabases });
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      const dialog = await screen.findByRole('dialog');
      const pick = await within(dialog).findByLabelText('Which database?');
      // Until one is chosen there is no plan to agree to, and nothing to install.
      expect((within(dialog).getByRole('button', { name: 'Install' }) as HTMLButtonElement).disabled).toBe(true);
      expect(within(dialog).queryByText(/Working out/)).toBeNull();
      expect(within(pick).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a database', 'Shop', 'Archive']);

      await user.selectOptions(pick, SHOP.id);
      expect(await within(dialog).findByText('Its tables go in the database “Shop”.')).toBeTruthy();
      expect(within(dialog).getByText('Pages: Items, Count.')).toBeTruthy();
      expect(within(dialog).getByText(/^Roles: Stock manager\. You are given the first one/)).toBeTruthy();
      expect(within(dialog).getByText('Lists of choices: zones.')).toBeTruthy();
      expect(within(dialog).getByText('Document layouts: 2.')).toBeTruthy();
      expect(within(dialog).getByText(/start with a few rows/)).toBeTruthy();
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/v1/add-ons/plan')?.body).toMatchObject({ key: 'holiday-calendars', connectionId: SHOP.id });

      await user.click(within(dialog).getByRole('button', { name: 'Install' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')).toBe(true));
      // The database chosen, and the identity of the plan that was read.
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')?.body).toMatchObject({ key: 'holiday-calendars', connectionId: SHOP.id, planChecksum: 'sum-conn_shop' });
    });

    it('choosing another database asks again, and the install carries the last one chosen', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ respond: twoDatabases });
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      const dialog = await screen.findByRole('dialog');
      const pick = await within(dialog).findByLabelText('Which database?');
      await user.selectOptions(pick, SHOP.id);
      await within(dialog).findByText('Its tables go in the database “Shop”.');
      await user.selectOptions(pick, ARCHIVE.id);
      expect(await within(dialog).findByText('Its tables go in the database “Archive”.')).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: 'Install' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')).toBe(true));
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')?.body).toMatchObject({ connectionId: ARCHIVE.id, planChecksum: 'sum-conn_old' });
    });

    it('an answer that comes late for a database no longer chosen is not what the dialog shows or installs', async () => {
      const user = userEvent.setup();
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { calls } = await renderPage({
        respond: (method, url, body) => {
          const answer = twoDatabases(method, url, body);
          // The first database's plan is slow to come.
          return answer !== undefined && method === 'POST' && (body as { connectionId?: string }).connectionId === SHOP.id ? { ...answer, after: held } : answer;
        },
      });
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      const dialog = await screen.findByRole('dialog');
      const pick = await within(dialog).findByLabelText('Which database?');
      await user.selectOptions(pick, SHOP.id);
      await user.selectOptions(pick, ARCHIVE.id);
      await within(dialog).findByText('Its tables go in the database “Archive”.');
      release();
      await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/add-ons/plan')).toHaveLength(2));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(within(dialog).queryByText('Its tables go in the database “Shop”.')).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: 'Install' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')).toBe(true));
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')?.body).toMatchObject({ connectionId: ARCHIVE.id, planChecksum: 'sum-conn_old' });
    });

    it('with one database nobody is asked: the plan says where, and the install names no database', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ respond: (method, url) => (method === 'GET' && url.endsWith('/holiday-calendars/plan') ? planned(SHOP) : undefined) });
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('Its tables go in the database “Shop”.')).toBeTruthy();
      expect(within(dialog).queryByLabelText('Which database?')).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: 'Install' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')).toBe(true));
      const sent = calls.find((c) => c.method === 'POST' && c.url === '/api/v1/add-ons')?.body as Record<string, unknown>;
      expect(sent).toMatchObject({ planChecksum: 'sum-conn_shop' });
      expect(sent).not.toHaveProperty('connectionId');
    });

    it('an add-on that makes nothing beside tables is shown no list of what else is added', async () => {
      const user = userEvent.setup();
      await renderPage();
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      const dialog = await screen.findByRole('dialog');
      await within(dialog).findByText(/reads and writes no tables of its own/);
      expect(within(dialog).queryByText('Installing also adds')).toBeNull();
    });

    it('an install that stopped part way says at which step, and that the same button finishes it', async () => {
      const user = userEvent.setup();
      await renderPage({
        respond: (method, url) =>
          method === 'POST' && url === '/api/v1/add-ons'
            ? { status: 409, body: { error: { code: 'ADD_ON_INSTALL_INCOMPLETE', message: 'raw server words', requestId: 'r', details: { addOn: 'holiday-calendars', stage: 'seeds', created: ['items'], pending: [] } } } }
            : undefined,
      });
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      const dialog = await screen.findByRole('dialog');
      await within(dialog).findByText(/reads and writes no tables of its own/);
      await user.click(within(dialog).getByRole('button', { name: 'Install' }));
      expect(await screen.findByText('The install stopped while adding the rows its tables start with. Nothing was undone, and nothing is lost: install it again to finish.')).toBeTruthy();
      expect(screen.queryByText('raw server words')).toBeNull();
    });

    it('a package stored but not trusted says it is stored, and what will not run', async () => {
      const user = userEvent.setup();
      await renderPage({ upload: { status: 422, body: { error: { code: 'ADD_ON_UNTRUSTED', message: 'raw server words', requestId: 'r', details: { key: 'kit', version: '1.0.0', stored: true } } } } });
      await screen.findByRole('button', { name: 'Upload' });
      await user.upload(screen.getByLabelText('Package file (.tgz)'), new File([new Uint8Array([1, 2, 3])], 'kit.tgz', { type: 'application/gzip' }));
      await user.type(screen.getByLabelText(/Integrity/), 'sha512-abc==');
      await user.click(screen.getByRole('button', { name: 'Upload' }));
      expect(await screen.findByText(/The package is stored and can be installed, but Adminium does not know who made it/)).toBeTruthy();
    });
  });

  describe('removing and updating an add-on that keeps tables of its own', () => {
    const KIT = makeAddOn({ key: 'stock-kit', name: 'Stock kit', version: '1.0.0', connectKind: 'none', connected: false, attachments: [], networkAllow: [] });
    const PLAN = {
      key: 'stock-kit',
      version: '1.0.0',
      likeApp: true,
      pages: { removed: ['stock-kit-items'], kept: ['stock-kit-notes'] },
      roles: [{ slug: 'stock-kit-manager', members: 2 }, { slug: 'stock-kit-reader', members: 1 }],
      tables: [{ table: 'stock_kit_items', droppable: true }, { table: 'stock_kit_takes', droppable: true }],
      inUse: { postings: [], features: [] },
      requiredBy: [],
    };
    const withPlan = (plan: unknown): NonNullable<StubOptions['respond']> => (method, url) => (method === 'GET' && url.endsWith('/stock-kit/uninstall-plan') ? { status: 200, body: plan } : undefined);
    const removal = (calls: { method: string; url: string; body?: unknown }[]) => calls.find((c) => c.method === 'DELETE' && c.url === '/api/v1/add-ons/stock-kit');

    it('says what goes and what stays before anybody confirms, and removes it with its tables kept', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ installed: [KIT], entries: [], respond: withPlan(PLAN) });
      await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('Its pages go: stock-kit-items.')).toBeTruthy();
      expect(within(dialog).getByText('Pages you edited stay, as your own: stock-kit-notes.')).toBeTruthy();
      expect(within(dialog).getByText('Its roles go: stock-kit-manager, stock-kit-reader. People who hold one lose it (3).')).toBeTruthy();
      expect(within(dialog).getByText('Its tables stay, with every row: stock_kit_items, stock_kit_takes.')).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
      await waitFor(() => expect(removal(calls)).toBeTruthy());
      // Nothing was asked to be dropped.
      expect(removal(calls)?.body).toBeUndefined();
    });

    it('deletes its tables only once the box is ticked and its key typed', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ installed: [KIT], entries: [], respond: withPlan(PLAN) });
      await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(await within(dialog).findByRole('checkbox'));
      const confirm = within(dialog).getByRole('button', { name: 'Uninstall' }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      const field = within(dialog).getByLabelText('Type stock-kit to delete its tables');
      await user.type(field, 'stock');
      expect(confirm.disabled).toBe(true);
      await user.type(field, '-kit');
      expect(confirm.disabled).toBe(false);
      await user.click(confirm);
      await waitFor(() => expect(removal(calls)).toBeTruthy());
      expect(removal(calls)?.body).toEqual({ dropTables: true, confirmKey: 'stock-kit' });
    });

    it('cannot be removed while a rule still hands rows to it, and says which', async () => {
      const user = userEvent.setup();
      const inUse = { ...PLAN, inUse: { postings: [{ table: 'shipments', posting: 'ship' }, { table: 'carts', posting: 'price' }], features: [{ app: 'shop', name: 'Shop', feature: 'stock' }] } };
      const { calls } = await renderPage({ installed: [KIT], entries: [], respond: withPlan(inUse) });
      await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('It is still in use')).toBeTruthy();
      expect(within(dialog).getByText('A rule on “shipments” hands rows to it.')).toBeTruthy();
      expect(within(dialog).getByText('The price rule on “carts” asks it for prices.')).toBeTruthy();
      expect(within(dialog).getByText('Shop uses it for “stock”. Switch it off for Shop first.')).toBeTruthy();
      expect((within(dialog).getByRole('button', { name: 'Uninstall' }) as HTMLButtonElement).disabled).toBe(true);
      expect(within(dialog).queryByRole('checkbox')).toBeNull();
      expect(removal(calls)).toBeUndefined();
    });

    it('nothing can be confirmed before what it takes with it has been read', async () => {
      const user = userEvent.setup();
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await renderPage({ installed: [KIT], entries: [], respond: (method, url) => (method === 'GET' && url.endsWith('/stock-kit/uninstall-plan') ? { status: 200, body: PLAN, after: held } : undefined) });
      await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
      const dialog = await screen.findByRole('dialog');
      const confirm = within(dialog).getByRole('button', { name: 'Uninstall' }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      release();
      await waitFor(() => expect(confirm.disabled).toBe(false));
    });

    it('tables it only found and took are never offered for deletion', async () => {
      const user = userEvent.setup();
      await renderPage({ installed: [KIT], entries: [], respond: withPlan({ ...PLAN, tables: [{ table: 'shipments', droppable: false }] }) });
      await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
      const dialog = await screen.findByRole('dialog');
      await within(dialog).findByText('Its tables stay, with every row: shipments.');
      expect(within(dialog).queryByRole('checkbox')).toBeNull();
    });

    it('an add-on that only ever had its files is asked the plain question, with nothing to tick', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ installed: [KIT], entries: [], respond: withPlan({ ...PLAN, likeApp: false, pages: { removed: [], kept: [] }, roles: [], tables: [] }) });
      await user.click(await screen.findByRole('button', { name: 'Uninstall' }));
      const dialog = await screen.findByRole('dialog');
      const confirm = within(dialog).getByRole('button', { name: 'Uninstall' }) as HTMLButtonElement;
      await waitFor(() => expect(confirm.disabled).toBe(false));
      expect(within(dialog).queryByRole('checkbox')).toBeNull();
      await user.click(confirm);
      await waitFor(() => expect(removal(calls)).toBeTruthy());
    });

    const NEWER = makeEntry({ key: 'stock-kit', name: 'Stock kit', version: '1.0.0', state: 'installed', upgradeTo: '1.0.1' });
    const updatePlan = (requiresSchemaChange: boolean) => ({
      status: 200,
      body: { plan: makePlan({ addOnKey: 'stock-kit', version: '1.0.1', touchesData: true, requiresSchemaChange, create: requiresSchemaChange ? [{ ref: 'counts', columns: [] }] : [] }), from: '1.0.0', to: '1.0.1', connectionId: 'conn_shop', checksum: 'sum-1' },
    });
    const updating = (requiresSchemaChange: boolean): NonNullable<StubOptions['respond']> => (method, url) => (method === 'POST' && url.endsWith('/stock-kit/update/plan') ? updatePlan(requiresSchemaChange) : undefined);
    const update = (calls: { method: string; url: string; body?: unknown }[]) => calls.find((c) => c.method === 'POST' && c.url === '/api/v1/add-ons/stock-kit/update');

    it('an update that changes no table runs at once, on the route that could have changed one', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ installed: [KIT], entries: [NEWER], respond: updating(false) });
      await user.click(await screen.findByRole('button', { name: /Upgrade|Update/ }));
      await waitFor(() => expect(update(calls)).toBeTruthy());
      expect(update(calls)?.body).toEqual({ planChecksum: 'sum-1' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('an update that adds to its tables shows what it adds first, and runs only when confirmed', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ installed: [KIT], entries: [NEWER], respond: updating(true) });
      await user.click(await screen.findByRole('button', { name: /Upgrade|Update/ }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Update to 1.0.1')).toBeTruthy();
      expect(within(dialog).getByText(/changes the add-on’s own tables/)).toBeTruthy();
      expect(within(dialog).getByText('counts')).toBeTruthy();
      expect(update(calls)).toBeUndefined();
      await user.click(within(dialog).getByRole('button', { name: 'Update' }));
      await waitFor(() => expect(update(calls)).toBeTruthy());
      expect(update(calls)?.body).toEqual({ planChecksum: 'sum-1' });
    });
  });

  describe('an add-on with a public side', () => {
    const PUBLIC = (canGrant: boolean, adds: string[] = ['cards_kit_cards_unlocked']) => ({
      endpoints: [
        { ref: 'cards_kit_cards_unlocked', table: 'cards', methods: ['GET'], key: 'customer' },
        { ref: 'cards_kit_cards_claimed', table: 'cards', methods: ['GET'], key: 'cards-link' },
      ],
      byApp: { shop: { adds, held: [] } },
      linkKey: 'cards-link',
      canGrant,
    });
    const checked = (canGrant: boolean): NonNullable<StubOptions['respond']> => (method, url) =>
      method === 'GET' && url.endsWith('/holiday-calendars/plan')
        ? { status: 200, body: { plan: makePlan({ touchesData: true, create: [{ ref: 'cards', columns: [] }] }), connectionId: 'conn_shop', connectionName: 'Shop', checksum: 'sum-1', publicAccess: PUBLIC(canGrant) } }
        : undefined;
    const install = (calls: { method: string; url: string; body?: unknown }[]) => calls.find((c) => c.method === 'POST' && c.url === '/api/v1/add-ons');

    it('says what it would open, and opens nothing unless the box is ticked', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ respond: checked(true) });
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('Public access')).toBeTruthy();
      expect(within(dialog).getByText(/through the public key of an app it is attached to: cards_kit_cards_unlocked\./)).toBeTruthy();
      expect(within(dialog).getByText(/link key of its own/)).toBeTruthy();
      const tick = within(dialog).getByRole('checkbox');
      expect(tick.getAttribute('aria-checked') ?? String((tick as HTMLInputElement).checked)).toBe('false');
      await user.click(within(dialog).getByRole('button', { name: 'Install' }));
      await waitFor(() => expect(install(calls)).toBeTruthy());
      expect((install(calls)?.body as Record<string, unknown>)['publicAccess']).toBeUndefined();
    });

    it('ticked, the install says so', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage({ respond: checked(true) });
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(await within(dialog).findByRole('checkbox'));
      await user.click(within(dialog).getByRole('button', { name: 'Install' }));
      await waitFor(() => expect(install(calls)).toBeTruthy());
      expect(install(calls)?.body).toMatchObject({ key: 'holiday-calendars', publicAccess: true, planChecksum: 'sum-1' });
    });

    it('somebody who may not hand out API keys is told so and cannot tick it', async () => {
      const user = userEvent.setup();
      await renderPage({ respond: checked(false) });
      await user.click(await screen.findByRole('button', { name: 'Install' }));
      const dialog = await screen.findByRole('dialog');
      const tick = (await within(dialog).findByRole('checkbox')) as HTMLButtonElement;
      expect(tick.disabled).toBe(true);
      expect(within(dialog).getByText('Only someone who may manage API keys can allow this.')).toBeTruthy();
    });

    it('an update that would open something new is shown first, and opens it only when ticked', async () => {
      const user = userEvent.setup();
      const KIT = makeAddOn({ key: 'stock-kit', name: 'Stock kit', version: '1.0.0', connectKind: 'none', connected: false, attachments: [], networkAllow: [] });
      const respond: NonNullable<StubOptions['respond']> = (method, url) => {
        if (method === 'POST' && url.endsWith('/stock-kit/update/plan')) {
          return { status: 200, body: { plan: makePlan({ requiresSchemaChange: false }), from: '1.0.0', to: '1.0.1', connectionId: 'conn_shop', checksum: 'sum-1', publicAccess: PUBLIC(true) } };
        }
        if (method === 'POST' && url.endsWith('/stock-kit/update')) return { status: 200, body: { addOn: KIT, from: '1.0.0', to: '1.0.1', pruned: [] } };
        return undefined;
      };
      const { calls } = await renderPage({ installed: [KIT], entries: [makeEntry({ key: 'stock-kit', name: 'Stock kit', version: '1.0.1', state: 'installed', upgradeTo: '1.0.1' })], respond });
      await user.click(await screen.findByRole('button', { name: /Upgrade|Update/ }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/would open more of the add-on to the public/)).toBeTruthy();
      await user.click(within(dialog).getByRole('checkbox'));
      await user.click(within(dialog).getByRole('button', { name: 'Update' }));
      const sent = () => calls.find((c) => c.method === 'POST' && c.url === '/api/v1/add-ons/stock-kit/update');
      await waitFor(() => expect(sent()).toBeTruthy());
      expect(sent()?.body).toEqual({ planChecksum: 'sum-1', publicAccess: true });
    });

    it('switched on for an app with its public entries left off, the page asks; allowing it attaches with the say', async () => {
      const user = userEvent.setup();
      const KIT = makeAddOn({ key: 'cards-kit', name: 'Cards kit', connectKind: 'none', connected: false, attachments: [{ attachedTo: 'shop', enabled: false }], networkAllow: [] });
      const respond: NonNullable<StubOptions['respond']> = (method, url) => {
        if (method === 'PATCH' && url === '/api/v1/add-ons/cards-kit') {
          return { status: 200, body: { addOn: KIT, publicAccess: { granted: [], withdrawn: [], skipped: [{ ref: 'cards_kit_cards_unlocked', reason: 'not allowed' }] } } };
        }
        if (method === 'POST' && url === '/api/v1/add-ons/cards-kit/attachments') return { status: 200, body: { addOn: KIT, change: null, publicAccess: { granted: ['cards_kit_cards_unlocked'], withdrawn: [], skipped: [] } } };
        return undefined;
      };
      const { calls } = await renderPage({ installed: [KIT], entries: [], respond });
      await user.click(await screen.findByRole('button', { name: /^shop · off$/ }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Allow public access?')).toBeTruthy();
      expect(within(dialog).getByText(/Cards kit is on for shop.*cards_kit_cards_unlocked\./)).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: 'Allow' }));
      const attach = () => calls.find((c) => c.method === 'POST' && c.url === '/api/v1/add-ons/cards-kit/attachments');
      await waitFor(() => expect(attach()).toBeTruthy());
      expect(attach()?.body).toEqual({ app: 'shop', publicAccess: true });
    });
  });
});
