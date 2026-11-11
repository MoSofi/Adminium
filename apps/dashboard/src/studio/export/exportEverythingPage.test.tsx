// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Server settings → Export everything (`Trial Mode.dc.html` view 5):
 * idle, preparing with its percent, ready with the file's name and size and one
 * download, back to idle after it, expired, refused; Copy; the desktop's
 * pointer to its own export; and "Put this online", hidden when the operator
 * switched it off.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { ExportEverythingPage } from './ExportEverythingPage.js';
import type { ExportView } from './exportApi.js';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
    useNavigate: () => vi.fn(),
  };
});

const ID = 'a'.repeat(32);

/** What `GET /export/zip` answers, one per call; the last one repeats. */
let states: (ExportView | null)[];
let startReply: { status: number; body: unknown };
let deployLink: boolean;
let calls: { method: string; url: string }[];

beforeEach(async () => {
  await installTestI18n();
  states = [null];
  startReply = { status: 202, body: { export: { id: ID, state: 'preparing', percent: 0 } } };
  deployLink = true;
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (url.endsWith('/api/v1/system/info')) {
        return jsonResponse(200, { version: '0.3.57', node: 'v22', dialect: 'sqlite', runtime: 'self-host', smtpConfigured: false, networkFeaturesAllowed: true, lanShare: false, desktopDemo: false, deployLink });
      }
      if (url.endsWith('/api/v1/export/zip') && method === 'POST') return jsonResponse(startReply.status, startReply.body);
      if (url.endsWith('/api/v1/export/zip')) {
        const next = states.length > 1 ? states.shift() : states[0];
        return jsonResponse(200, { export: next ?? null });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { adminiumDesktop?: unknown }).adminiumDesktop;
});

function open(roles: string[] = ['super-admin']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(bootstrapQuery().queryKey, makeBootstrap({ roles }));
  render(
    <QueryClientProvider client={queryClient}>
      <ExportEverythingPage />
    </QueryClientProvider>,
  );
}

const downloadEverything = (): Promise<HTMLElement> => screen.findByRole('button', { name: 'Download everything' });

describe('Export everything', () => {
  it('says what the file holds and leaves out, and starts at "Download everything"', async () => {
    open();
    await downloadEverything();
    for (const item of ['Pages', 'Tables’ settings', 'Roles', 'Views', 'Apps’ settings', 'Uploaded files', 'People’s passwords', 'Secrets and keys']) {
      expect(screen.getByText(item)).toBeTruthy();
    }
    const rows = screen.getByRole('link', { name: 'export the database' });
    expect(rows.getAttribute('href')).toBe('https://docs.adminium.dev/self-hosting/export-everything/#database-rows');
    expect(rows.parentElement?.textContent).toBe('The database rows, unless you export the database');
    expect(screen.getByRole('heading', { name: 'Move to another host' })).toBeTruthy();
    expect(screen.getByText('adminium import-zip <file>')).toBeTruthy();
  });

  it('shows the percent while the file is made, then its name and size, and goes back to idle after the one download', async () => {
    const user = userEvent.setup();
    states = [null, { id: ID, state: 'preparing', percent: 40 }, { id: ID, state: 'ready', percent: 100, fileName: 'hollis-bakery-2026-11-10.zip', bytes: 38_200_000, expiresAt: Date.now() + 600_000 }];
    open();
    await user.click(await downloadEverything());
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/api/v1/export/zip'))).toBe(true);
    expect(await screen.findByText('Preparing your file… 40%', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');

    expect(await screen.findByText('hollis-bakery-2026-11-10.zip', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/^Ready · 38/)).toBeTruthy();
    const download = screen.getByRole('link', { name: 'Download' });
    expect(download.getAttribute('href')).toBe(`/api/v1/export/zip/${ID}`);
    expect(download.getAttribute('download')).toBe('hollis-bakery-2026-11-10.zip');
    // The browser saves it; jsdom does not navigate. The page is back at the start at once.
    download.addEventListener('click', (event) => event.preventDefault());
    await user.click(download);
    expect(await downloadEverything()).toBeTruthy();
    expect(screen.queryByText('hollis-bakery-2026-11-10.zip')).toBeNull();
  });

  it('says so when a waiting file expired, or when the server refuses a second export', async () => {
    const user = userEvent.setup();
    states = [{ id: ID, state: 'expired' }];
    startReply = { status: 409, body: { error: { code: 'CONFLICT', message: 'Another export waits for its download. Try again in a few minutes.', details: { reason: 'BUSY' } } } };
    open();
    expect(await screen.findByText('That file expired before it was downloaded. Download everything again.')).toBeTruthy();
    await user.click(await downloadEverything());
    expect(await screen.findByText('Another export waits for its download. Try again in a few minutes.')).toBeTruthy();
  });

  it('copies the import command, and says Copied', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open();
    await user.click(await screen.findByRole('button', { name: 'Copy the command' }));
    expect(writeText).toHaveBeenCalledWith('adminium import-zip <file>');
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('links "Put this online" to adminium.dev/deploy, and hides it when the operator switched it off', async () => {
    open();
    const card = await screen.findByTestId('export-put-online');
    expect(card.getAttribute('href')).toBe('https://adminium.dev/deploy');
    expect(card.getAttribute('target')).toBe('_blank');
    expect(card.textContent).toContain('Run this installation at its own public address.');
    cleanup();

    deployLink = false;
    open();
    await downloadEverything();
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/api/v1/system/info'))).toBe(true));
    expect(screen.queryByTestId('export-put-online')).toBeNull();
  });

  it('points to the desktop’s own "Export this project…" on the desktop', async () => {
    (window as { adminiumDesktop?: unknown }).adminiumDesktop = { project: { export: vi.fn() } };
    open();
    const pointer = await screen.findByTestId('export-desktop');
    expect(pointer.textContent).toContain('Export this project…');
    expect(screen.getByRole('link', { name: 'Open the Designer' }).getAttribute('href')).toBe('/design');
    expect(screen.queryByRole('button', { name: 'Download everything' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Move to another host' })).toBeNull();
    expect(calls.some((call) => call.url.endsWith('/api/v1/export/zip'))).toBe(false);
  });

  it('is for super admins only', async () => {
    open(['admin']);
    expect(await screen.findByText('Super admin required')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download everything' })).toBeNull();
    expect(screen.queryByTestId('export-put-online')).toBeNull();
  });
});
