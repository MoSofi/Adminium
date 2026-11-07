// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing a file saved from a dashboard, and a file whose app is installed
 * already: the review's own cards, the refusals said per database, and the
 * routing by version — every copy updated in turn, each through its own
 * review, then optionally a copy on another database.
 *
 * What is proved is what the person can be sure of: nothing installs while a
 * pasted fingerprint differs, a page address taken here or a table that can't
 * be used; what is chosen is what is sent; and an update names its copy by
 * its database.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { InstallAppWizard } from './InstallAppWizard.js';
import { InstanceCard, NO_INSTANCE_ANSWERS, unusableWhy } from './installReview.js';
import type { AppInstallPlan, InstancePart } from './appsApi.js';

const CONNECTIONS = [
  { id: 'c1', name: 'fernhill', engine: 'postgres', readOnly: false, tableCount: 30 },
  { id: 'c2', name: 'kiln', engine: 'mysql', readOnly: false, tableCount: 9 },
  { id: 'c3', name: 'suppliers', engine: 'postgres', readOnly: false, tableCount: 3 },
];

interface Call {
  url: string;
  query: string;
  method: string;
  body?: unknown;
}

let calls: Call[];
let uploadReply: { status: number; body: unknown };
let plans: Record<string, unknown>[];
let plan: Record<string, unknown>;
let updateReplies: { status: number; body: unknown }[];

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const raw = String(input);
      const [url = raw, query = ''] = raw.split('?');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ url, query, method, body });
      if (url.startsWith('/api/v1/connections')) return Promise.resolve(jsonResponse(200, { connections: CONNECTIONS }));
      if (url === '/api/v1/apps/upload') return Promise.resolve(jsonResponse(uploadReply.status, uploadReply.body));
      if (url === '/api/v1/apps/plan') return Promise.resolve(jsonResponse(200, { plan: plans.shift() ?? plan }));
      if (url === '/api/v1/apps/clinic/update') {
        const reply = updateReplies.shift() ?? { status: 200, body: { app: installedApp('1.1.0'), from: '1.0.0', to: '1.1.0', pruned: [] } };
        return Promise.resolve(jsonResponse(reply.status, reply.body));
      }
      if (url === '/api/v1/apps/install') {
        return Promise.resolve(jsonResponse(200, { ...installedApp('1.0.0'), schema: { created: [], reused: ['orders'] } }));
      }
      if (url.startsWith('/api/v1/apps')) return Promise.resolve(jsonResponse(200, { apps: [], staged: [] }));
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
    }),
  );
}

function installedApp(version: string) {
  return { key: 'clinic', version, source: 'file', installedAt: 0, connectionId: 'c3', sides: [], missing: false };
}

/** A self-made file's plan, as the server answers for a copy of the database it was saved from. */
function ownPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'clinic',
    version: '1.0.0',
    installable: true,
    touchesData: true,
    create: [],
    reuse: [],
    references: [],
    problems: [],
    requiresSchemaChange: false,
    pageWarnings: [],
    checksum: 'c'.repeat(64),
    tables: [
      { ref: 'orders', table: 'orders', class: 'taken', action: 'undecided', offers: ['reuse', 'rename-existing'], edits: [], blocked: [], columns: [{ ref: 'id', type: 'int' }] },
    ],
    madeAt: { label: 'Fernhill main', savedAt: '2026-11-01T10:00:00.000Z', adminiumVersion: '0.3.49' },
    afterInstall: [
      { kind: 'webhook', item: 'post-wholesale-orders', field: 'url' },
      { kind: 'sender', item: 'order-confirmed', field: 'brand.fromEmail' },
      { kind: 'system-grant', item: 'finance', field: 'system:audit:read' },
    ],
    pageClashes: [{ page: 'orders', title: 'Orders', holder: 'generated', untouched: true, offers: ['replace', 'rename-existing', 'skip'], action: 'undecided' }],
    ...overrides,
  };
}

const LOCAL = { key: 'clinic', version: '1.0.0', name: 'Clinic Desk', files: 3, integrity: 'sha512-right=', sides: ['staff'], publisher: { id: 'local', name: 'Local' } };

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  plans = [];
  updateReplies = [];
  plan = ownPlan();
  uploadReply = { status: 200, body: { ...LOCAL, route: 'install', installs: [], databasesFree: 3 } };
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

async function upload(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(await screen.findByLabelText(/Bundle file/i), new File(['x'], 'clinic-1.0.0.tgz', { type: 'application/gzip' }));
  // The upload asks only for the file: the fingerprint is checked on the review.
  expect(screen.queryByPlaceholderText('sha512-…')).toBeNull();
  expect(screen.getByText('The app’s file (.tgz).')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Upload' }));
}

async function reachReview(user: ReturnType<typeof userEvent.setup>, database = 'suppliers') {
  await upload(user);
  await screen.findByText(/Install into which database/i);
  await user.click(screen.getByRole('radio', { name: new RegExp(database) }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Check before you install');
}

const lastPlanBody = (): Record<string, unknown> => calls.filter((call) => call.url === '/api/v1/apps/plan').at(-1)?.body as Record<string, unknown>;

describe('the review of a file saved from a dashboard', () => {
  it('says where it came from, the rules it switches off, its screens and what is filled in after', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachReview(user);

    expect(screen.getByText('Your own app')).toBeTruthy();
    expect(screen.getByText(/Made at Fernhill main on/)).toBeTruthy();
    expect(screen.getByText(/It was saved on another Adminium server/)).toBeTruthy();
    expect(screen.queryByText(/Made on this install/)).toBeNull();
    const outside = document.querySelector('[data-part="outside-addresses"]') as HTMLElement;
    expect(within(outside).getByText('post-wholesale-orders')).toBeTruthy();
    expect(within(outside).getByText('sends to a web address · address left empty')).toBeTruthy();
    expect(within(outside).getByText('Off')).toBeTruthy();
    expect(screen.getByText('This app has its own screens.')).toBeTruthy();
    const after = document.querySelector('[data-part="after-install"]') as HTMLElement;
    expect(after.textContent).toContain('The web address of the rule post-wholesale-orders');
    expect(after.textContent).toContain('The sender address of the email order-confirmed');
    expect(after.textContent).toContain('The finance role’s console rights');
  });

  it('holds Install until each taken page address has a choice, and sends the choice', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachReview(user);
    // The table question is answered first, all at once, so only the page holds Install.
    // The check's sentence says what will happen: a question open, then every table used and none made.
    expect(document.body.textContent).toContain('will create some of these in suppliers and use the others.');
    plans = [ownPlan({ tables: [{ ...(ownPlan().tables as Record<string, unknown>[])[0], action: 'reuse' }] })];
    await user.click(screen.getByRole('button', { name: 'Use the existing tables' }));
    await screen.findByText('1 used as it is · 0 changes to it');
    expect(document.body.textContent).toContain('will use these in suppliers and create none.');
    expect(document.body.textContent).not.toContain('will create these');
    expect(lastPlanBody()).toMatchObject({ existing: 'use' });
    expect(lastPlanBody().choices).toBeUndefined();

    const install = screen.getByRole('button', { name: 'Install' });
    expect(install.hasAttribute('disabled')).toBe(true);
    expect(document.getElementById(install.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Choose what to do with Orders.');

    plans = [ownPlan({ tables: [{ ...(ownPlan().tables as Record<string, unknown>[])[0], action: 'reuse' }], pageClashes: [{ ...(ownPlan().pageClashes as Record<string, unknown>[])[0], action: 'replace' }] })];
    await user.click(screen.getByRole('button', { name: 'Replace it' }));
    await screen.findByText('Replaced by the app’s page.');
    expect(lastPlanBody()).toMatchObject({ existing: 'use', pages: { orders: { action: 'replace' } } });
    // Focus moves on to what undoes the choice.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Change'));

    await user.click(screen.getByRole('button', { name: 'Install' }));
    await screen.findByText(/is installed on suppliers/);
    const sent = calls.find((call) => call.url === '/api/v1/apps/install')?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ connectionId: 'c3', existing: 'use', pages: { orders: { action: 'replace' } }, planChecksum: 'c'.repeat(64) });
    // The look and languages are never sent unticked.
    expect(sent.instance).toBeUndefined();
  });

  it('stops on a table that cannot be used as it is, with no way to leave it out', async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachReview(user);
    plans = [
      ownPlan({
        installable: false,
        pageClashes: [],
        tables: [
          {
            ref: 'orders',
            table: 'orders',
            class: 'taken',
            action: 'undecided',
            offers: ['rename-existing', 'alt-prefix'],
            reuseRefusal: 'It requires "channel", which this app never fills.',
            edits: [],
            blocked: [],
            columns: [{ ref: 'id', type: 'int' }],
          },
        ],
        problems: [{ code: 'EXISTING_TABLE_UNUSABLE', table: 'orders', message: '"orders" is here already and cannot be used as it is: its column channel is required.' }],
      }),
    ];
    await user.click(screen.getByRole('button', { name: 'Use the existing tables' }));
    const card = await screen.findByRole('alert');
    expect(card.textContent).toContain('orders can’t be used as it is.');
    // Worded here from the table the check made, never the server's English.
    expect(card.textContent).toContain('It requires columns the app never fills, so every row the app saves there would be refused.');
    expect(card.textContent).not.toContain('is here already');
    expect(within(card).queryByRole('button', { name: /leave/i })).toBeNull();
    // Said once, in its card: not again in the refusal list above.
    expect(screen.queryByText('This app cannot be installed here')).toBeNull();
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(true);
  });

  it('checks a pasted fingerprint in the browser: a mismatch holds Install until cleared', async () => {
    plan = ownPlan({ pageClashes: [], tables: [] });
    const user = userEvent.setup();
    renderWizard();
    await reachReview(user);
    const field = screen.getByLabelText('Check against the fingerprint shown when it was saved');
    await user.type(field, 'sha512-wrong=');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('Does not match. This is not the file that was saved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(true);
    await user.clear(field);
    await user.type(field, ' sha512-right= ');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('Matches. This is the file that was saved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(false);
  });

  it('checks a released file against the fingerprint published with it', async () => {
    uploadReply = { status: 200, body: { ...LOCAL, publisher: { id: 'acme', name: 'Acme' }, route: 'install', installs: [], databasesFree: 3 } };
    plan = ownPlan({ madeAt: undefined, afterInstall: undefined, pageClashes: [], tables: [] });
    const user = userEvent.setup();
    renderWizard();
    await upload(user);
    await screen.findByText(/Install into which database/i);
    await user.click(screen.getByRole('radio', { name: /suppliers/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const field = await screen.findByLabelText('Check against the fingerprint published with the release');
    // Not a file saved from a dashboard: no "Your own app", no review heading.
    expect(screen.queryByText('Your own app')).toBeNull();
    expect(screen.queryByText('Check before you install')).toBeNull();
    expect(screen.getByText('Published by Acme')).toBeTruthy();
    await user.type(field, 'sha512-other=');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('Does not match. This is not the file that was published.')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const install = screen.getByRole('button', { name: 'Install' });
    expect(install.hasAttribute('disabled')).toBe(true);
    expect(document.getElementById(install.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/The fingerprint does not match/);
    await user.clear(field);
    expect(screen.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(false);
  });

  it('replaces the review with a refusal when the file was saved from that database', async () => {
    plan = ownPlan({ installable: false, problems: [{ code: 'SAVED_FROM_HERE', table: 'clinic', message: 'server words' }] });
    const user = userEvent.setup();
    renderWizard();
    await upload(user);
    await screen.findByText(/Install into which database/i);
    await user.click(screen.getByRole('radio', { name: /fernhill/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('Saved from this database');
    expect(refusal.textContent).toContain('This file was saved from fernhill on this server.');
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });
});

describe('refusals said per database', () => {
  it('refuses an older file, naming what each database has', async () => {
    uploadReply = {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'server words',
          requestId: 'r',
          details: { reason: 'VERSION_OLDER', offered: '1.0.0', installed: [{ connectionName: 'fernhill', version: '1.1.0' }] },
        },
      },
    };
    const user = userEvent.setup();
    renderWizard();
    await upload(user);
    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('An older file');
    expect(refusal.textContent).toContain('fernhill already has 1.1.0. The file is the older 1.0.0.');
    await user.click(within(refusal).getByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText(/Bundle file/i)).toBeTruthy();
  });

  it('refuses another app with the same key, per server', async () => {
    uploadReply = {
      status: 422,
      body: { error: { code: 'VALIDATION_FAILED', message: 'server words', requestId: 'r', details: { reason: 'LINEAGE_DIFFERS', key: 'clinic', connectionName: 'kiln' } } },
    };
    const user = userEvent.setup();
    renderWizard();
    await upload(user);
    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('A different app with this key');
    expect(refusal.textContent).toContain('This server already has a different clinic, on kiln. Save this one with another key.');
  });
});

describe('routing by version', () => {
  const copies = [
    { installId: 'i1', connectionId: 'c1', connectionName: 'fernhill', slug: '', version: '1.0.0', status: 'installed' },
    { installId: 'i2', connectionId: 'c2', connectionName: 'kiln', slug: 'kiln', version: '1.0.0', status: 'installed' },
  ];

  it('updates every copy in turn, each through its own review on its own database, then offers another database', async () => {
    uploadReply = { status: 200, body: { ...LOCAL, version: '1.1.0', route: 'update', installs: copies, databasesFree: 1 } };
    plan = ownPlan({ version: '1.1.0', tables: [], pageClashes: [] });
    const user = userEvent.setup();
    renderWizard();
    await upload(user);

    expect(await screen.findByText('Update Clinic Desk to 1.1.0')).toBeTruthy();
    expect(screen.queryByText(/Install into which database/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Update every copy (fernhill and kiln)' }));

    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Update Clinic Desk on fernhill to v1.1.0')).toBeTruthy();
    expect(within(dialog).getByText('Copy 1 of 2 · 1.0.0 → 1.1.0')).toBeTruthy();
    expect(calls.filter((call) => call.url === '/api/v1/apps/plan').at(-1)?.body).toMatchObject({ connectionId: 'c1', version: '1.1.0' });
    await user.click(within(dialog).getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('Update Clinic Desk on kiln to v1.1.0'));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Copy 2 of 2 · 1.0.0 → 1.1.0')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Update' }));

    expect(await screen.findByText('Clinic Desk is on 1.1.0 on every database.')).toBeTruthy();
    // Each update named its copy by its database, one at a time, with the check it showed.
    const updates = calls.filter((call) => call.url === '/api/v1/apps/clinic/update');
    expect(updates.map((call) => call.query)).toEqual(['connectionId=c1', 'connectionId=c2']);
    expect(updates[0]?.body).toMatchObject({ planChecksum: 'c'.repeat(64) });

    // Then, optionally, another database: those with a copy are marked and can't be picked.
    await user.click(screen.getByRole('button', { name: 'Also install on another database' }));
    await screen.findByText(/Install into which database/i);
    expect(document.querySelector('[data-part="installing-version"]')?.textContent).toMatch(/^Installing Clinic Desk 1\.1\.0\./);
    expect(screen.getByRole('radio', { name: /fernhill/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('radio', { name: /kiln/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('radio', { name: /suppliers/ }).hasAttribute('disabled')).toBe(false);
    expect(document.querySelectorAll('[data-part="installed-marker"]')).toHaveLength(2);
    await user.click(screen.getByRole('radio', { name: /suppliers/ }));
    expect(screen.getByText('This copy gets its own settings, roles and email templates. Clinic Desk on fernhill and kiln is not touched.')).toBeTruthy();
  });

  it('warns that a version without the server-wide part puts the look back, and holds Update for someone who may not', async () => {
    uploadReply = { status: 200, body: { ...LOCAL, version: '1.1.0', route: 'update', installs: [copies[0]], databasesFree: 2 } };
    const restore = { needs: 'system:settings:manage', values: [{ kind: 'setting', item: 'branding.appName' }, { kind: 'word', item: 'de_DE:common:common.save' }] };
    plan = ownPlan({ version: '1.1.0', tables: [], pageClashes: [], instanceRestore: { ...restore, canRestore: false } });
    const user = userEvent.setup();
    renderWizard();
    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'Update every copy (fernhill)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('The server’s look goes back')).toBeTruthy();
    expect(within(dialog).getByText('This version no longer carries the server’s look and languages. 2 values it set go back to what they were: the look, the words and the system emails.')).toBeTruthy();
    expect(within(dialog).getByText('Only someone who may change the server’s settings can run this update: ask someone who has that permission.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Update' }).hasAttribute('disabled')).toBe(true);
    expect(calls.filter((call) => call.url === '/api/v1/apps/clinic/update')).toHaveLength(0);
  });

  it('lets a settings manager run the update that puts the look back', async () => {
    uploadReply = { status: 200, body: { ...LOCAL, version: '1.1.0', route: 'update', installs: [copies[0]], databasesFree: 2 } };
    plan = ownPlan({ version: '1.1.0', tables: [], pageClashes: [], instanceRestore: { needs: 'system:settings:manage', canRestore: true, values: [{ kind: 'setting', item: 'branding.appName' }] } });
    const user = userEvent.setup();
    renderWizard();
    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'Update every copy (fernhill)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Only someone who may change the server’s settings can run this update.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Update' }));
    expect(await screen.findByText('Clinic Desk is on 1.1.0 on every database.')).toBeTruthy();
  });

  it('finishes an update that stopped part way with the same update', async () => {
    uploadReply = { status: 200, body: { ...LOCAL, version: '1.1.0', route: 'update', installs: [copies[0]], databasesFree: 2 } };
    plan = ownPlan({ version: '1.1.0', tables: [], pageClashes: [] });
    updateReplies = [
      {
        status: 409,
        body: { error: { code: 'APP_UPDATE_INCOMPLETE', message: 'server words', requestId: 'r', details: { stage: 'pages', from: '1.0.0', to: '1.1.0', cause: 'a page failed' } } },
      },
    ];
    const user = userEvent.setup();
    renderWizard();
    await upload(user);
    await user.click(await screen.findByRole('button', { name: 'Update every copy (fernhill)' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Update' }));
    expect(await within(dialog).findByText('The update to 1.1.0 stopped while writing pages. Nothing was lost; 1.0.0’s pages are still here.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Finish the update' }));
    expect(await screen.findByText('Clinic Desk is on 1.1.0 on every database.')).toBeTruthy();
    const updates = calls.filter((call) => call.url === '/api/v1/apps/clinic/update');
    expect(updates).toHaveLength(2);
    // Finishing sends the same update again.
    expect(updates[1]?.body).toEqual(updates[0]?.body);
  });

  it('offers the same version for another database, and refuses when every database has it', async () => {
    uploadReply = { status: 200, body: { ...LOCAL, route: 'install-another', installs: copies, databasesFree: 1 } };
    const user = userEvent.setup();
    const first = renderWizard();
    await upload(user);
    expect(await screen.findByText('Install Clinic Desk on another database')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Install on another database' }));
    await screen.findByText(/Install into which database/i);
    first.unmount();

    uploadReply = { status: 200, body: { ...LOCAL, route: 'install-another', installs: copies, databasesFree: 0 } };
    renderWizard();
    await upload(user);
    const refusal = await screen.findByRole('alert');
    expect(refusal.textContent).toContain('Clinic Desk 1.0.0 is already installed on every database here.');
    expect(screen.queryByRole('button', { name: 'Install on another database' })).toBeNull();
  });
});

describe('the review words what the server checked', () => {
  it('says why a table cannot be used as it is, from the table the check made', () => {
    const table = { ref: 'orders', table: 'orders', class: 'taken', offers: [], edits: [], blocked: [], columns: [] };
    const why = (more: Record<string, unknown>) => unusableWhy({ problems: [], tables: [{ ...table, ...more }] } as unknown as AppInstallPlan, 'orders');
    expect(why({ action: 'rename-existing' })).toBe('Using the existing tables never renames one out of the way.');
    expect(why({ action: 'undecided' })).toBe('It isn’t offered for use as it is.');
    // The columns the check named, by name; a server older than that field sends its English alone, worded without them.
    expect(why({ action: 'undecided', reuseRequires: ['channel', 'source'], reuseRefusal: 'x' })).toBe('It requires channel and source, which the app never fills, so every row the app saves there would be refused.');
    expect(why({ action: 'undecided', reuseRefusal: 'x' })).toBe('It requires columns the app never fills, so every row the app saves there would be refused.');
    expect(why({ action: 'reuse', edits: [{ kind: 'add-column', column: 'paid' }, { kind: 'widen', column: 'note', from: 'varchar(40)', to: 'varchar(200)' }] })).toBe(
      'Using it would change these columns: paid and note. Using the existing tables changes none of them.',
    );
  });

  it('says, per link host of an edited system email, which placeholders ride to it', () => {
    const part = {
      needs: 'system:settings:manage',
      settings: [],
      files: [],
      languages: { on: [], off: [] },
      wording: { changed: 0, same: 0 },
      left: [],
      systemEmails: [
        {
          id: 'password-reset/en_US',
          key: 'password-reset',
          locale: 'en_US',
          subject: null,
          preheaderChanged: false,
          footerChanged: false,
          blocks: { added: [], removed: [], changed: [] },
          hosts: ['desk.fernhill.example', 'help.fernhill.example'],
          carried: { 'help.fernhill.example': ['appName'] },
        },
      ],
    } as InstancePart;
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <InstanceCard part={part} answers={NO_INSTANCE_ANSWERS} onAnswers={() => undefined} />
      </QueryClientProvider>,
    );
    const lines = [...container.querySelectorAll('[data-part="instance-carried"]')].map((line) => line.textContent);
    expect(lines).toEqual(['A link to help.fernhill.example carries {{appName}}, filled in when the email is sent.']);
  });
});
