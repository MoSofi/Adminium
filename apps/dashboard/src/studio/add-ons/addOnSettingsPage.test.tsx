// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE ADD-ON'S SETTINGS SCREEN, FOR THE COPY CHOSEN.
 *
 * An add-on installed on two databases has two sets of settings. The
 * screen's address names the copy (`<key>`, or `<key>~<slug>` for a later
 * one): it shows that copy's values, and its saves and its calls to the
 * add-on's routes name that copy. With one copy, the plain key opens it,
 * whatever its slug; an address that names no copy says the add-on is not
 * here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeBootstrap } from '../../test/fixtures.js';
import { installTestI18n } from '../../i18n/testing.js';
import { studioMessagesReady } from '../studioMessages.js';
import { ADD_ONS_QUERY_KEY, type AddOnDto } from './addOnsApi.js';

const at = vi.hoisted(() => ({ address: 'holiday-calendars' }));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ key: at.address }),
}));

const { AddOnSettingsPage, copyAtAddress } = await import('./AddOnSettingsPage.js');

/** Each request's method, path and the install it named. */
const sent: { method: string; path: string; install: string | null }[] = [];
vi.stubGlobal(
  'fetch',
  vi.fn(async (path: string, init?: RequestInit) => {
    sent.push({ method: init?.method ?? 'GET', path, install: new Headers(init?.headers).get('x-adminium-install') });
    return new Response(JSON.stringify({ key: 'holiday-calendars', values: {}, updatedAt: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
  }),
);

const copy = (over: Partial<AddOnDto>): AddOnDto =>
  ({
    key: 'holiday-calendars',
    name: 'Holiday Calendars',
    version: '1.0.0',
    connectKind: 'none',
    connected: false,
    missing: false,
    connectionExpiresAt: null,
    attachments: [],
    slots: [],
    provides: [],
    networkAllow: [],
    settings: [{ key: 'note', type: 'string', required: false, secret: false, label: null, help: null, options: [] }],
    settingValues: {},
    bundles: [],
    ...over,
  }) as AddOnDto;

const FERNHILL = copy({ installId: 'man_fernhill', connectionId: 'conn_f', slug: '', settingValues: { note: 'Fernhill note' } });
const KILN = copy({ installId: 'man_kiln', connectionId: 'conn_k', slug: 'kiln', settingValues: { note: 'Kiln note' } });

async function draw(address: string, listed: AddOnDto[]): Promise<void> {
  at.address = address;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(ADD_ONS_QUERY_KEY, listed);
  client.setQueryData(
    ['bootstrap'],
    makeBootstrap({
      addOnSettings: [
        { key: 'holiday-calendars', name: 'Holiday Calendars', connectionName: 'Fernhill' },
        { key: 'holiday-calendars~kiln', name: 'Holiday Calendars', connectionName: 'Kiln' },
      ],
    } as never),
  );
  // Awaited: the screen waits for Studio's words before it draws.
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <AddOnSettingsPage />
      </QueryClientProvider>,
    );
  });
}

let restoreI18n: () => void;
// Studio's words load with its chunk, once: the first screen drawn would otherwise wait for them alone.
beforeAll(async () => {
  restoreI18n = installTestI18n();
  await studioMessagesReady();
}, 60_000);
afterAll(() => {
  restoreI18n();
});

afterEach(() => {
  cleanup();
  sent.length = 0;
});

describe('the copy an address names', () => {
  it('is the one with that slug; with one copy, the plain key names it too', () => {
    expect(copyAtAddress([FERNHILL, KILN], 'holiday-calendars')?.installId).toBe('man_fernhill');
    expect(copyAtAddress([FERNHILL, KILN], 'holiday-calendars~kiln')?.installId).toBe('man_kiln');
    expect(copyAtAddress([KILN], 'holiday-calendars')?.installId).toBe('man_kiln');
    expect(copyAtAddress([FERNHILL, KILN], 'holiday-calendars~nowhere')).toBeUndefined();
    // A server that does not say its slug: its one row is the bare copy.
    expect(copyAtAddress([copy({})], 'holiday-calendars')?.key).toBe('holiday-calendars');
  });
});

describe('the settings screen', () => {
  it('opens the later copy at its address, and saves to it', async () => {
    const user = userEvent.setup();
    await draw('holiday-calendars~kiln', [FERNHILL, KILN]);
    const box = (await screen.findByDisplayValue('Kiln note')) as HTMLInputElement;
    expect(screen.queryByDisplayValue('Fernhill note')).toBeNull();
    await user.clear(box);
    await user.type(box, 'Closed in August');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(sent.filter((one) => one.method === 'PUT')).toEqual([{ method: 'PUT', path: '/api/v1/add-ons/holiday-calendars/settings', install: 'man_kiln' }]));
  });

  it('opens the first copy at the plain key, and saves to it', async () => {
    const user = userEvent.setup();
    await draw('holiday-calendars', [FERNHILL, KILN]);
    await screen.findByDisplayValue('Fernhill note');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(sent.filter((one) => one.method === 'PUT').map((one) => one.install)).toEqual(['man_fernhill']));
  });

  it('opens a lone copy at the plain key, as before', async () => {
    await draw('holiday-calendars', [KILN]);
    expect(await screen.findByDisplayValue('Kiln note')).toBeTruthy();
  });

  it('says the add-on is not here for an address that names no copy', async () => {
    await draw('holiday-calendars~nowhere', [FERNHILL, KILN]);
    expect(await screen.findByText('This add-on is not installed')).toBeTruthy();
  });
});
