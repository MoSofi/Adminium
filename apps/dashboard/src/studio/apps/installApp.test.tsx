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
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
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
/** Install replies to hand out before the default success, first one first. */
let installReplies: { status: number; body: unknown }[];
/** Plans to hand out before `plan`, first one first. */
let planReplies: Record<string, unknown>[];
/** What `GET /apps/clinic/uninstall-plan` answers. */
let uninstallPlan: Record<string, unknown>;
/** How the sample-data job ends. */
let sampleJob: 'succeeded' | 'failed';
/** Connections listed after the one the wizard installs into. */
let moreConnections: (typeof CONNECTION)[];

function stubFetch() {
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url: url.split('?')[0] ?? url, method, body });

    if (url.startsWith('/api/v1/connections')) {
      return Promise.resolve(jsonResponse(200, { connections: [CONNECTION, ...moreConnections] }));
    }
    if (url.startsWith('/api/v1/apps/upload')) {
      return Promise.resolve(jsonResponse(uploadReply.status, uploadReply.body));
    }
    if (url === '/api/v1/apps/clinic/sample-data' && method === 'POST') {
      return Promise.resolve(jsonResponse(200, { jobId: 'job_sample' }));
    }
    if (url === '/api/v1/jobs/job_sample') {
      return Promise.resolve(
        jsonResponse(200, { data: { id: 'job_sample', status: sampleJob, progress: { pct: 100 }, lastError: 'The café is closed.' } }),
      );
    }
    if (url === '/api/v1/apps/clinic/uninstall-plan') {
      return Promise.resolve(jsonResponse(200, uninstallPlan));
    }
    if (url === '/api/v1/apps/plan') {
      return Promise.resolve(jsonResponse(200, { plan: planReplies.shift() ?? plan }));
    }
    if (url === '/api/v1/apps/install') {
      const queued = installReplies.shift();
      if (queued !== undefined) return Promise.resolve(jsonResponse(queued.status, queued.body));
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
  sampleJob = 'succeeded';
  moreConnections = [];
  installReplies = [];
  planReplies = [];
  uninstallPlan = {
    key: 'clinic',
    pages: { removed: [{ slug: 'visits', title: 'Visits' }], kept: [] },
    keys: 0,
    endpoints: 0,
    roles: [],
    tables: [{ table: 'clinicians', droppable: true }],
    hosts: [],
    rules: 2,
    canDropTables: false,
  };
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
    await screen.findByText('Clinic Desk is installed');

    const install = calls.find((call) => call.url === '/api/v1/apps/install');
    expect(install?.body).toEqual({ key: 'clinic', version: '1.0.0', connectionId: CONNECTION.id });
    expect(screen.getByText('/apps/clinic/staff/')).toBeTruthy();
  });

  it('sends back the checksum of the plan it showed, and re-checks when the database moved', async () => {
    plan = { ...plan, checksum: 'a'.repeat(64) };
    installReplies = [
      {
        status: 409,
        body: {
          error: {
            code: 'SCHEMA_DRIFT',
            message: 'The database changed since this install was checked. Review the new check before installing.',
            requestId: 'r',
          },
        },
      },
    ];
    const user = userEvent.setup();
    renderWizard();
    await reachPlan(user);
    await user.click(screen.getByRole('button', { name: 'Install' }));

    await screen.findByText(/The database changed since this install was checked/i);
    const installs = calls.filter((call) => call.url === '/api/v1/apps/install');
    expect(installs[0]?.body).toMatchObject({ planChecksum: 'a'.repeat(64) });
    // The stale check was replaced by a fresh one, and nothing installed.
    expect(calls.filter((call) => call.url === '/api/v1/apps/plan')).toHaveLength(2);
    expect(screen.queryByText('Clinic Desk is installed')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Clinic Desk is installed');
  });

  it('names a reused table missing columns on the check step, and does not offer Install', async () => {
    plan = {
      ...plan,
      installable: false,
      create: [],
      reuse: [{ ref: 'payments', missingColumns: ['tip'] }],
      problems: [
        {
          code: 'COLUMNS_REQUIRED',
          table: 'payments',
          column: 'tip',
          message: 'This database already has a "payments" table, and it is missing "tip", which this app writes.',
        },
      ],
    };
    const user = userEvent.setup();
    renderWizard();
    await reachPlan(user);
    expect(screen.getByText(/missing "tip", which this app writes/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(true);
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
    await screen.findByText('Clinic Desk is installed');

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

  it('says which rules stay out because they would show what a reused table keeps hidden, and still lets the install go', async () => {
    plan = {
      ...plan,
      ruleWarnings: [
        {
          table: 'users',
          column: 'api_token',
          message: 'It would show "users.api_token", which is kept from readers, on a table that was here before the app: only an operator can show it, in Studio, as Super Admin.',
        },
      ],
    };
    const user = userEvent.setup();
    renderWizard();
    await reachPlan(user);
    const warning = await screen.findByTestId('app-install-rule-warnings');
    expect(warning.textContent).toContain('users.api_token');
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

  it('names the connection an app is already installed on, and does not offer Install', async () => {
    moreConnections = [{ id: 'con_2', name: 'Old books', engine: 'mysql', readOnly: true, tableCount: 4 }];
    plan = {
      ...plan,
      installable: false,
      create: [],
      problems: [{ code: 'APP_INSTALLED_ELSEWHERE', table: 'clinic', connectionId: 'con_2', message: 'server words' }],
    };
    const user = userEvent.setup();
    renderWizard();
    await reachPlan(user);

    expect(
      screen.getByText(
        'Clinic Desk is already installed on the connection Old books. An app runs on one connection: update it there, or uninstall it there before installing it on another.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(true);
  });
});

/** A plan table as the server sends it. */
function planned(overrides: Record<string, unknown> & { ref: string }): Record<string, unknown> {
  return {
    table: `clinic_${overrides.ref}`,
    class: 'new',
    action: 'create',
    offers: [],
    edits: [],
    blocked: [],
    columns: [
      { ref: 'id', type: 'int' },
      { ref: 'name', type: 'text' },
    ],
    ...overrides,
  };
}

/** A plan with the check's classes: one new table, one from before, one taken. */
function checkPlan(taken: Record<string, unknown> = {}): Record<string, unknown> {
  const takenRow = planned({
    ref: 'shifts',
    class: 'taken',
    action: 'undecided',
    offers: ['rename-existing', 'alt-prefix'],
    reuseRefusal: 'It requires "location_id", which this app never fills.',
    ...taken,
  });
  const undecided = takenRow.action === 'undecided';
  return {
    ...plan,
    checksum: 'c'.repeat(64),
    installable: !undecided,
    create: [{ ref: 'clinicians', columns: [{ ref: 'id', type: 'int' }, { ref: 'name', type: 'text' }] }],
    reuse: [{ ref: 'visits', missingColumns: [] }],
    problems: undecided
      ? [
          {
            code: 'TABLE_TAKEN',
            table: 'shifts',
            message: '"clinic_shifts" already exists and was made by hand. Pick what to do with it before you install.',
          },
        ]
      : [],
    tables: [
      planned({ ref: 'clinicians' }),
      planned({
        ref: 'visits',
        class: 'own-leftover',
        action: 'reuse',
        offers: ['reuse', 'rename-existing', 'alt-prefix'],
        edits: [{ kind: 'add-column', column: 'tip' }],
      }),
      takenRow,
    ],
    names: { clinicians: 'clinic_clinicians', visits: 'clinic_visits', shifts: 'clinic_shifts' },
  };
}

async function reachCheck(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(['pretend-tarball'], 'clinic-1.0.0.tgz', { type: 'application/gzip' });
  await user.upload(await screen.findByLabelText(/Bundle file/i), file);
  await user.type(screen.getByLabelText(/Integrity/i), 'sha512-abc=');
  await user.click(screen.getByRole('button', { name: 'Upload' }));
  await screen.findByText(/Install into which database/i);
  await user.click(screen.getByRole('radio', { name: /Practice/i }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Check the tables');
}

describe('the table check', () => {
  it('sorts the tables into new, from before, and taken, and waits for an answer', async () => {
    plan = checkPlan();
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);

    const summary = document.querySelector('[data-part="check-summary"]');
    expect(summary?.textContent).toContain('1 new');
    expect(summary?.textContent).toContain('1 from your earlier install');
    expect(summary?.textContent).toContain('1 name taken');
    // The connection is named where the tables go.
    expect(screen.getByText('Practice')).toBeTruthy();
    // Undecided is a question on the card and in the footer, not a refusal.
    expect(screen.queryByText('This app cannot be installed here')).toBeNull();
    expect(screen.getByText('Pick what to do with clinic_shifts before you install.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(true);

    // A new table: its columns and the statement, under its real name.
    await user.click(screen.getByRole('button', { name: /clinicians/ }));
    expect(screen.getByText('Create preview')).toBeTruthy();
    expect(screen.getByText(/CREATE TABLE clinic_clinicians/)).toBeTruthy();
    // One from before: kept, with the column it gains.
    await user.click(screen.getByRole('button', { name: /visits/ }));
    const visits = screen.getByTestId('check-table-visits');
    expect(visits.textContent).toContain('Adminium made this table on an earlier install of Clinic Desk.');
    expect(visits.textContent).toContain('Adds 1 column:');
    expect(visits.textContent).toContain('tip');
    // The column count and the column list come from the same place.
    expect(screen.getByTestId('check-table-clinicians').textContent).toContain('2 columns');
  });

  it('says a column is made one of a kind, alone or for one parent row', async () => {
    const unique = checkPlan();
    (unique.tables as Record<string, unknown>[])[1]!.edits = [
      { kind: 'add-unique', column: 'ref_no' },
      { kind: 'add-unique', column: 'v', with: ['proposal_id'] },
    ];
    plan = unique;
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: /visits/ }));
    const visits = screen.getByTestId('check-table-visits');
    expect(visits.textContent).toContain('ref_no may no longer hold the same value twice.');
    expect(visits.textContent).toContain('v may no longer hold the same value twice for one proposal_id.');
  });

  it('does not claim it made a table an earlier install only found', async () => {
    const adopted = checkPlan();
    (adopted.tables as Record<string, unknown>[])[1]!.adopted = true;
    plan = adopted;
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: /visits/ }));
    const visits = screen.getByTestId('check-table-visits');
    expect(visits.textContent).toContain('An earlier install of Clinic Desk used this table as it found it.');
    expect(visits.textContent).not.toContain('Adminium made this table');
  });

  it('refuses reuse with the reason, and re-checks with the rename it was given', async () => {
    plan = checkPlan();
    planReplies = [
      checkPlan(),
      checkPlan({ action: 'rename-existing', renameExistingTo: 'clinic_shifts_old' }),
    ];
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: /shifts/ }));

    const keep = screen.getByRole('radio', { name: /Use it and keep its data/ });
    expect(keep.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/requires "location_id"/)).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: /Rename the existing table/ }));
    await waitFor(() => expect(calls.filter((call) => call.url === '/api/v1/apps/plan')).toHaveLength(2));
    expect(calls.filter((call) => call.url === '/api/v1/apps/plan')[1]?.body).toMatchObject({
      choices: { shifts: { action: 'rename-existing', to: 'clinic_shifts_old' } },
    });
    expect(await screen.findByText('Nothing changes until you press Install.')).toBeTruthy();
    expect((screen.getByLabelText('New name for the existing table') as HTMLInputElement).value).toBe(
      'clinic_shifts_old',
    );

    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Clinic Desk is installed');
    const install = calls.find((call) => call.url === '/api/v1/apps/install');
    // The answers the check was made with, and that check's checksum.
    expect(install?.body).toMatchObject({
      planChecksum: 'c'.repeat(64),
      choices: { shifts: { action: 'rename-existing', to: 'clinic_shifts_old' } },
    });
  });

  it('asks for the check again after a typed name, before it offers Install', async () => {
    plan = checkPlan();
    planReplies = [
      checkPlan(),
      checkPlan({ action: 'rename-existing', renameExistingTo: 'clinic_shifts_old' }),
      checkPlan({ action: 'rename-existing', renameExistingTo: 'old_shifts' }),
    ];
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: /shifts/ }));
    await user.click(screen.getByRole('radio', { name: /Rename the existing table/ }));
    await screen.findByText('Nothing changes until you press Install.');

    const field = screen.getByLabelText('New name for the existing table');
    await user.clear(field);
    await user.type(field, 'old_shifts');
    expect(screen.getByText('Check the tables again before you install.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText('Nothing changes until you press Install.');
    expect(calls.filter((call) => call.url === '/api/v1/apps/plan').at(-1)?.body).toMatchObject({
      choices: { shifts: { action: 'rename-existing', to: 'old_shifts' } },
    });
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(false);
  });

  it('checks every table again under a different prefix, and can go back to the usual one', async () => {
    plan = checkPlan();
    const moved = {
      ...checkPlan(),
      installable: true,
      problems: [],
      tables: [
        planned({ ref: 'clinicians', table: 'clinic2_clinicians' }),
        planned({ ref: 'visits', table: 'clinic2_visits' }),
        planned({ ref: 'shifts', table: 'clinic2_shifts' }),
      ],
    };
    planReplies = [checkPlan(), moved, checkPlan()];
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: /shifts/ }));
    await user.click(screen.getByRole('radio', { name: /different prefix/ }));

    // Picked, but not checked: the suggestion is there, and Install waits.
    expect((screen.getByLabelText('Prefix') as HTMLInputElement).value).toBe('clinic2_');
    expect(screen.getByText('Check the tables again before you install.')).toBeTruthy();
    expect(screen.getByText('All 3 tables will be checked again.')).toBeTruthy();
    expect(calls.filter((call) => call.url === '/api/v1/apps/plan')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Check again' }));

    await screen.findByText('Checked with the prefix', { exact: false });
    expect(calls.filter((call) => call.url === '/api/v1/apps/plan').at(-1)?.body).toMatchObject({
      altPrefix: 'clinic2_',
    });
    expect(document.querySelector('[data-part="check-summary"]')?.textContent).toContain('3 new');

    await user.click(screen.getByRole('button', { name: 'Use the usual prefix' }));
    await screen.findByText('Pick what to do with clinic_shifts before you install.');
    expect(calls.filter((call) => call.url === '/api/v1/apps/plan').at(-1)?.body).not.toHaveProperty(
      'altPrefix',
    );
  });

  it('shows where an install stopped, and tries the same install again', async () => {
    plan = checkPlan({ action: 'rename-existing', renameExistingTo: 'clinic_shifts_old' });
    installReplies = [
      {
        status: 409,
        body: {
          error: {
            code: 'APP_INSTALL_INCOMPLETE',
            message: 'Installing "clinic" stopped at the pages step.',
            requestId: 'r',
            details: {
              stage: 'pages',
              table: null,
              created: ['clinicians', 'shifts'],
              pending: [],
              cause: 'permission denied for table adminium_pages',
            },
          },
        },
      },
    ];
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: 'Install' }));

    const stopped = await screen.findByTestId('install-stopped');
    expect(stopped.textContent).toContain('The install stopped part way');
    expect(stopped.textContent).toContain('The tables were made. Creating the pages failed');
    expect(stopped.textContent).toContain('2 created');
    expect(stopped.textContent).toContain('permission denied for table adminium_pages');
    // Its own screen, not the generic failure banner.
    expect(screen.queryByText('Install failed')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Clinic Desk is installed');
    const installs = calls.filter((call) => call.url === '/api/v1/apps/install');
    expect(installs).toHaveLength(2);
    expect(installs[1]?.body).toEqual(installs[0]?.body);
  });

  it('goes back to a fresh check from a stopped install', async () => {
    plan = checkPlan({ action: 'rename-existing', renameExistingTo: 'clinic_shifts_old' });
    installReplies = [
      {
        status: 409,
        body: {
          error: {
            code: 'APP_INSTALL_INCOMPLETE',
            message: 'stopped',
            requestId: 'r',
            details: { stage: 'tables', table: 'clinic_visits', created: [], pending: ['visits'], cause: 'boom' },
          },
        },
      },
    ];
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByTestId('install-stopped');
    expect(screen.getByText('clinic_visits')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back to Schema plan' }));
    await screen.findByText('Check the tables');
    expect(calls.filter((call) => call.url === '/api/v1/apps/plan')).toHaveLength(2);
  });

  it('sums up what the install made', async () => {
    plan = checkPlan({ action: 'rename-existing', renameExistingTo: 'clinic_shifts_old' });
    installReplies = [
      {
        status: 200,
        body: {
          key: 'clinic',
          version: '1.0.0',
          source: 'file',
          installedAt: 0,
          connectionId: CONNECTION.id,
          sides: [],
          missing: false,
          schema: { created: ['clinicians', 'shifts'], reused: ['visits'] },
          pages: { created: ['clinicians', 'visits', 'shifts'], recomposed: [], kept: [], warnings: [] },
        },
      },
    ];
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Clinic Desk is installed');
    const summary = document.querySelector('[data-part="done-summary"]');
    expect(summary?.textContent).toContain('Tables created in Practice2');
    expect(summary?.textContent).toContain('Tables used as they were1');
    expect(summary?.textContent).toContain('Pages generated3');
  });
});

describe('sample data at install', () => {
  const ready = () => ({ ...checkPlan({ action: 'rename-existing', renameExistingTo: 'clinic_shifts_old' }), sampleData: true });
  const summary = () => document.querySelector('[data-part="done-summary"]')?.textContent ?? '';

  it('is offered unticked, and nothing is added unless asked', async () => {
    plan = ready();
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    const box = within(screen.getByTestId('install-sample-data')).getByRole('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Clinic Desk is installed');
    expect(summary()).toContain('Sample datanot added');
    expect(calls.some((call) => call.url === '/api/v1/apps/clinic/sample-data')).toBe(false);
  });

  it('adds it after the install when ticked, and says so', async () => {
    plan = ready();
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(within(screen.getByTestId('install-sample-data')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Clinic Desk is installed');
    await waitFor(() => expect(summary()).toContain('Sample dataadded'));
    const order = calls.map((call) => `${call.method} ${call.url}`);
    // The app first; its sample data can only go into tables that exist.
    expect(order.indexOf('POST /api/v1/apps/clinic/sample-data')).toBeGreaterThan(order.indexOf('POST /api/v1/apps/install'));
  });

  it('says when the add failed, and that it can be done later', async () => {
    plan = ready();
    sampleJob = 'failed';
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(within(screen.getByTestId('install-sample-data')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Install' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The café is closed.');
    expect(alert.textContent).toContain('You can add it later from the app’s page.');
    expect(summary()).toContain('Sample datanot added');
  });

  it('is not offered for an app without sample data', async () => {
    plan = checkPlan({ action: 'rename-existing', renameExistingTo: 'clinic_shifts_old' });
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    expect(screen.queryByTestId('install-sample-data')).toBeNull();
  });
});

describe('public access at install', () => {
  const access = (over: Record<string, unknown> = {}) => ({
    endpoints: [
      { ref: 'clinic_slots', table: 'slots', methods: ['GET'], select: [], writable: [], claim: null, pending: false, issues: [] },
      { ref: 'clinic_visits', table: 'visits', methods: ['POST'], select: [], writable: ['mobile'], claim: null, confirms: true, pending: false, issues: [] },
      { ref: 'clinic_visits_claimed', table: 'visits', methods: ['GET'], select: [], writable: [], claim: ['code', 'mobile'], pending: false, issues: [] },
      { ref: 'clinic_slots_availability', table: 'slots', methods: ['GET'], select: [], writable: [], claim: null, kind: 'availability', pending: false, issues: [] },
      { ref: 'clinic_rooms', table: 'rooms', methods: ['GET'], select: [], writable: [], claim: null, pending: true, issues: [] },
    ],
    warnings: [
      { code: 'PUBLIC_API_OFF', message: 'server words' },
      { code: 'NO_EMAIL', message: 'server words' },
    ],
    canGrant: true,
    ...over,
  });
  const ready = (over: Record<string, unknown> = {}) => ({
    ...checkPlan({ action: 'rename-existing', renameExistingTo: 'clinic_shifts_old' }),
    publicAccess: access(over),
  });
  const sent = () => (calls.find((call) => call.url === '/api/v1/apps/install')?.body as Record<string, unknown>)['publicAccess'];

  it('says what the guests may do, is allowed by default, and sends that', async () => {
    plan = ready();
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    const card = screen.getByTestId('install-public-access');
    expect([...card.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Read slots',
      'Add to visits, and get a confirmation email',
      'Look up their own visits by code, mobile',
      'Read free or full times of slots',
      'Read free or full times of rooms · arrives in a later release',
      'The public API is switched off, so none of this answers until it is on.',
      'Email is not set up, so guests will not be sent a confirmation.',
    ]);
    expect(within(card).getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Clinic Desk is installed');
    expect(sent()).toBe(true);
  });

  it('sends a decline', async () => {
    plan = ready();
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    await user.click(within(screen.getByTestId('install-public-access')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Clinic Desk is installed');
    expect(sent()).toBe(false);
  });

  it('installs without it for someone who may not manage API keys, and says why', async () => {
    plan = ready({ canGrant: false });
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    const card = screen.getByTestId('install-public-access');
    const box = within(card).getByRole('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.hasAttribute('disabled')).toBe(true);
    expect(card.textContent).toContain('Only someone who may manage API keys can allow it');
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Clinic Desk is installed');
    expect(sent()).toBe(false);
  });

  it('is not shown for an app that asks for none', async () => {
    plan = checkPlan({ action: 'rename-existing', renameExistingTo: 'clinic_shifts_old' });
    const user = userEvent.setup();
    renderWizard();
    await reachCheck(user);
    expect(screen.queryByTestId('install-public-access')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText('Clinic Desk is installed');
    expect(sent()).toBeUndefined();
  });
});

/** Whether the app catalogue was read again after the call that changed what is on disk. */
function catalogueReadAfter(method: string, url: string): boolean {
  const at = calls.findIndex((call) => call.method === method && call.url === url);
  return at !== -1 && calls.slice(at + 1).some((call) => call.method === 'GET' && call.url === '/api/v1/apps/catalog');
}

/** The card links each row to the app's own page, so it renders inside a router, as it does in the app. */
function inRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  return <RouterProvider router={router} />;
}

describe('the installed list', () => {
  it('says what goes and what stays, and uninstalls without asking for the key', async () => {
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
        {inRouter(<InstalledAppsCard onInstall={() => {}} onUpdate={() => {}} />)}
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

    // The server's own list of what goes and what stays — the data stays.
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('The app’s files')).toBeTruthy();
    expect(within(dialog).getByText('1 page')).toBeTruthy();
    expect(within(dialog).getByText('1 table and every record in it')).toBeTruthy();
    // The rules it wrote that are still as it wrote them.
    expect(within(dialog).getByText('Its 2 column rules')).toBeTruthy();
    // Not Super Admin here: no offer to delete the data at all.
    expect(within(dialog).queryByText('Also delete its tables and data')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => {
      const call = calls.find((c) => c.method === 'DELETE' && c.url === '/api/v1/apps/clinic');
      expect(call).toBeTruthy();
      expect(call?.body).toBeUndefined();
    });
    // An uninstall also removes the key's package from disk, so the shelf
    // card that offered it is gone too. This card reads the catalogue itself
    // (for its update pills), so the invalidation re-reads it at once rather
    // than leaving it marked stale.
    await waitFor(() => {
      expect(catalogueReadAfter('DELETE', '/api/v1/apps/clinic')).toBe(true);
    });
  });

  it('deletes the data only when asked, and only with the key typed back', async () => {
    uninstallPlan = {
      ...uninstallPlan,
      canDropTables: true,
      roles: [{ slug: 'clinic-desk', name: 'Clinic desk', members: 3, apiKeys: 1 }],
    };
    installed = {
      apps: [{ key: 'clinic', version: '1.0.0', source: 'file', installedAt: 0, connectionId: null, missing: false, sides: [] }],
      staged: [],
    };
    const client = createQueryClient();
    client.setQueryData(APP_CATALOG_QUERY_KEY, { apps: [] });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        {inRouter(<InstalledAppsCard onInstall={() => {}} onUpdate={() => {}} />)}
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: /Uninstall/i }));
    const dialog = await screen.findByRole('dialog');
    // A role's cascade is named before it happens.
    expect(await within(dialog).findByText(/takes it from 3 people and deletes 1 API key/)).toBeTruthy();

    await user.click(within(dialog).getByRole('checkbox'));
    const confirm = within(dialog).getByRole('button', { name: 'Uninstall and delete data' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await user.type(within(dialog).getByLabelText(/Type the app’s key clinic to confirm/), 'clinic');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.click(confirm);
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'DELETE' && c.url === '/api/v1/apps/clinic')?.body).toEqual({
        dropTables: true,
        confirmKey: 'clinic',
      });
    });
  });

  it('discards a bundle that was uploaded and never installed', async () => {
    installed = { apps: [], staged: [{ key: 'clinic', version: '1.0.0' }] };
    const client = createQueryClient();
    client.setQueryData(APP_CATALOG_QUERY_KEY, { apps: [] });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        {inRouter(<InstalledAppsCard onInstall={() => {}} onUpdate={() => {}} />)}
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
