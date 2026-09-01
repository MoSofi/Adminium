// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/add-ons` (26-T14).
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
 *     Install when the plan cannot be applied (26 §7 — the security surface);
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
    ...over,
  };
}

function makeAddOn(over: Partial<AddOnDto> = {}): AddOnDto {
  return {
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
}

function stubFetch(options: StubOptions = {}) {
  const calls: { method: string; url: string }[] = [];
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });

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
    if (url.startsWith('/api/v1/add-ons/download') || url.endsWith('/catalog/refresh')) {
      return Promise.resolve(jsonResponse(200, { jobId: 'job_1' }));
    }
    return Promise.resolve(jsonResponse(200, { ok: true, jobId: 'job_1' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

async function renderPage(options: StubOptions = {}) {
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

describe('AddOnsPage', () => {
  it('resolves the lazy route and lists what is available', async () => {
    await renderPage();
    expect(await screen.findByText('Holiday Calendars')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
  });

  it('browses air-gapped, and says so instead of offering a broken action', async () => {
    // 32 D8: browse is a disk read. The page must be useful before anyone
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

  it('refuses to offer Install when the plan cannot be applied', async () => {
    // 26 §7: the dialog is the security surface. A plan that names a missing
    // host table must not have a live Install button beside it.
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

  it('names the tables it will CREATE, before consent is given (26-T02)', async () => {
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

  describe('32-T10: the acquisition story', () => {
    it('follows a download to completion instead of calling it done when enqueued', async () => {
      /*
       * A download is a JOB (32 D10) — `POST /add-ons/download` answers
       * `{ jobId }` immediately and the bytes arrive later. Reporting success on
       * the enqueue is how an operator refreshes to find nothing staged.
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
      await user.click(await screen.findByRole('button', { name: 'Download' }));
      await waitFor(() => {
        expect(calls.some((c) => c.url.startsWith('/api/v1/jobs/'))).toBe(true);
      });
      // It kept reading until the job actually finished.
      await waitFor(() => {
        expect(calls.filter((c) => c.url.startsWith('/api/v1/jobs/')).length).toBeGreaterThan(1);
      });
    });

    it('surfaces a failed download as the failure it was, not as success', async () => {
      const user = userEvent.setup();
      jobSteps = [{ status: 'failed', progress: null, lastError: 'the hash did not match' }];
      await renderPage({ entries: [makeEntry({ state: 'available' })], onlineEnabled: true });
      await user.click(await screen.findByRole('button', { name: 'Download' }));
      expect(await screen.findByText(/the hash did not match/)).toBeTruthy();
    });

    it('switches the online catalogue on from the page that uses it', async () => {
      // 26 D3: this lives with the add-on routes and `manifests.manage`, not
      // under /settings/* and `settings.manage`.
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
       * disabled until there is one.
       */
      const user = userEvent.setup();
      await renderPage();
      const upload = await screen.findByRole('button', { name: 'Upload' });
      expect((upload as HTMLButtonElement).disabled).toBe(true);

      const file = new File([new Uint8Array([1, 2, 3])], 'add-on.tgz', { type: 'application/gzip' });
      await user.upload(screen.getByLabelText('Package file (.tgz)'), file);
      await user.type(screen.getByLabelText('Add-on key'), 'holiday-calendars');
      await user.type(screen.getByLabelText('Version'), '1.0.0');
      // Still disabled — everything but the hash.
      expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(
        true,
      );

      await user.type(screen.getByLabelText(/Integrity/), 'sha512-abc==');
      expect((screen.getByRole('button', { name: 'Upload' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    });

    it('sends the sideload as raw bytes with its key, version and hash', async () => {
      const user = userEvent.setup();
      const { calls } = await renderPage();
      await screen.findByRole('button', { name: 'Upload' });
      const file = new File([new Uint8Array([1, 2, 3])], 'add-on.tgz', { type: 'application/gzip' });
      await user.upload(screen.getByLabelText('Package file (.tgz)'), file);
      await user.type(screen.getByLabelText('Add-on key'), 'holiday-calendars');
      await user.type(screen.getByLabelText('Version'), '1.0.0');
      await user.type(screen.getByLabelText(/Integrity/), 'sha512-abc==');
      await user.click(screen.getByRole('button', { name: 'Upload' }));

      await waitFor(() => {
        const upload = calls.find((c) => c.url.startsWith('/api/v1/add-ons/upload'));
        expect(upload, 'no upload was sent').toBeTruthy();
        expect(upload?.url).toContain('key=holiday-calendars');
        expect(upload?.url).toContain('version=1.0.0');
        expect(upload?.url).toContain('expectedSha512=sha512-abc');
      });
    });
  });

  it('tells an empty instance what to do rather than showing a bare list', async () => {
    await renderPage({ entries: [], installed: [] });
    expect(await screen.findByText('No add-ons available')).toBeTruthy();
    expect(screen.getByText('Nothing installed yet')).toBeTruthy();
  });
});
