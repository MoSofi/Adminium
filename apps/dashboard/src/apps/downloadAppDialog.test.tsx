// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Download on a project app: the version starts at the folder's and can't go
 * below it, the pack runs on the server, and the fingerprint appears only for
 * a file that was made. A refused pack says why, in the dialog.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scopeInstall } from '../app/api.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse } from '../test/fixtures.js';
import { DownloadAppDialog, compareVersions, versionProblem } from './DownloadAppDialog.js';

let calls: { method: string; url: string; body?: unknown; headers: Record<string, string> }[];
let packReply: { status: number; body: unknown };

beforeEach(async () => {
  await installTestI18n();
  calls = [];
  packReply = {
    status: 200,
    body: { key: 'fernhill-shop', version: '1.1.0', fileName: 'fernhill-shop-1.1.0.tgz', bytes: 2_516_582, integrity: 'sha512-AbC+/x==', fileCount: 41 },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}) });
      if (url === '/api/v1/project/apps/fernhill-shop/pack') return Promise.resolve(jsonResponse(packReply.status, packReply.body));
      if (url === '/api/v1/apps') return Promise.resolve(jsonResponse(200, { apps: [{ key: 'fernhill-shop', version: '1.0.0', folder: { state: 'here' } }], staged: [] }));
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderDialog(version: string | null = '1.0.0') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DownloadAppDialog appKey="fernhill-shop" appName="Fernhill Shop" version={version} serverName="Fernhill main" onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return screen.getByRole('dialog');
}

describe('Download', () => {
  it('refuses a version below the folder’s, and packs at a higher one', async () => {
    const dialog = renderDialog();
    expect(within(dialog).getByText('Download Fernhill Shop')).toBeTruthy();
    expect(within(dialog).queryByText('Fingerprint')).toBeNull();
    const field = within(dialog).getByLabelText('Version');
    await userEvent.clear(field);
    await userEvent.type(field, '0.9.0');
    expect(within(dialog).getByText('It can’t be lower than 1.0.0, the version the app is at.')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(field);
    await userEvent.type(field, '1.1.0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ version: '1.1.0' }));
    await within(dialog).findByText('sha512-AbC+/x==');
    expect(within(dialog).getByText('fernhill-shop-1.1.0.tgz')).toBeTruthy();
    expect(within(dialog).getByText('2.4 MB')).toBeTruthy();
    expect(within(dialog).getByText('Downloading fernhill-shop-1.1.0.tgz')).toBeTruthy();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('says why a pack was refused, with no fingerprint', async () => {
    packReply = { status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'too big', requestId: 'r', details: { reason: 'PACK_TOO_LARGE', bytes: 40 * 1024 * 1024 } } } };
    const dialog = renderDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('The file would be 40 MB, and an upload takes at most 32 MB.');
    expect(within(dialog).queryByText('Fingerprint')).toBeNull();
  });

  it('lists each file and line a refused pack would carry a secret or an id of this server in', async () => {
    const leaks = [
      { kind: 'secret', file: 'source/src/api.ts', line: 3 },
      { kind: 'id', file: 'seeds/notes.json', line: 1 },
    ];
    packReply = { status: 422, body: { error: { code: 'VALIDATION_FAILED', message: 'leaks', requestId: 'r', details: { reason: 'PACK_LEAKS', leaks } } } };
    const dialog = renderDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('The file would carry something that must stay on this server, so it was not made.');
    expect(within(alert).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['source/src/api.ts, line 3: a secret this server keeps', 'seeds/notes.json, line 1: an id of this server']);
    expect(within(dialog).queryByText('Fingerprint')).toBeNull();
  });

  it('reads the folder’s version when it was not given', async () => {
    const dialog = renderDialog(null);
    await waitFor(() => expect((within(dialog).getByLabelText('Version') as HTMLInputElement).value).toBe('1.0.0'));
  });
});

describe('versions', () => {
  it('compares three numbers, a pre-release below its release', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(versionProblem('1.0', '1.0.0')).toBe('A version is three numbers, like 1.2.0.');
    expect(versionProblem('1.0.1', '1.0.0')).toBeNull();
  });
});

describe('an install scoped by its path', () => {
  it('names the install on every call under the scope, and stops when it is lifted', async () => {
    const { api } = await import('../app/api.js');
    const off = scopeInstall('/api/v1/add-ons/invoices', 'mf_kiln');
    await api.get('/api/v1/add-ons/invoices/kit');
    await api.get('/api/v1/add-ons/invoices-two/kit');
    off();
    await api.get('/api/v1/add-ons/invoices/kit');
    expect(calls.map((call) => call.headers['x-adminium-install'] ?? null)).toEqual(['mf_kiln', null, null]);
  });

  it('keeps a scope per mount: two copies drawn at once name neither, and one left is whole again', async () => {
    const { api } = await import('../app/api.js');
    calls.length = 0;
    const kiln = scopeInstall('/api/v1/add-ons/invoices', 'mf_kiln');
    const fernhill = scopeInstall('/api/v1/add-ons/invoices', 'mf_fernhill');
    // Which copy's page asks cannot be told from the path: never the one mounted last.
    await api.get('/api/v1/add-ons/invoices/kit');
    fernhill();
    // The copy still drawn names itself again.
    await api.get('/api/v1/add-ons/invoices/kit');
    // Two mounts of one copy are one scope.
    const again = scopeInstall('/api/v1/add-ons/invoices', 'mf_kiln');
    await api.get('/api/v1/add-ons/invoices/kit');
    again();
    await api.get('/api/v1/add-ons/invoices/kit');
    kiln();
    await api.get('/api/v1/add-ons/invoices/kit');
    expect(calls.map((call) => call.headers['x-adminium-install'] ?? null)).toEqual([null, 'mf_kiln', 'mf_kiln', 'mf_kiln', null]);
    // A call that names its copy is sent as it says, whatever is mounted.
    const both = [scopeInstall('/api/v1/add-ons/invoices', 'mf_kiln'), scopeInstall('/api/v1/add-ons/invoices', 'mf_fernhill')];
    await api.get('/api/v1/add-ons/invoices/kit', { headers: { 'x-adminium-install': 'mf_fernhill' } });
    for (const off of both) off();
    expect(calls.at(-1)?.headers['x-adminium-install']).toBe('mf_fernhill');
  });
});
