// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { AdminiumDesktopApi, DesktopProjectInfo, DesktopShareResult } from '@adminium/desktop/api';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ShareBanner } from '../../desktop/ShareBanner.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import { BuildShare } from './DesktopProject.js';

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'adminiumDesktop');
});

const INFO: DesktopProjectInfo = { name: 'Juniper Kitchen', displayPath: '~/Adminium/juniper-kitchen', mode: 'design' };

/** The Designer's server: whether the owner still needs a password, and the route that sets one. */
function server(needs: boolean, set: (body: { email: string; password: string }) => Response = () => jsonResponse(200, { email: 'ava@example.com' })) {
  let ownerNeedsPassword = needs;
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/v1/designer/state') return Promise.resolve(jsonResponse(200, { mode: 'local', project: 'juniper', limits: { maxSteps: 60, turnTokens: 1, sessionTokens: 1 }, active: null, ownerNeedsPassword, ignoredEnv: [] }));
    if (url === '/api/v1/designer/owner-password') {
      const reply = set(JSON.parse(String(init?.body)) as { email: string; password: string });
      if (reply.ok) ownerNeedsPassword = false;
      return Promise.resolve(reply);
    }
    return Promise.resolve(jsonResponse(404, {}));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
function app(share: () => Promise<DesktopShareResult>) {
  const api = { share: vi.fn(share) };
  Object.defineProperty(window, 'adminiumDesktop', { value: { platform: 'darwin', project: api } as unknown as AdminiumDesktopApi, configurable: true });
  return api;
}
const mount = (): void => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BuildShare project={INFO} />
    </QueryClientProvider>,
  );
};

describe('Share, from the Designer inside the app', () => {
  it('with an owner password already: one step, what sharing means, then the app is asked to share', async () => {
    server(false);
    const api = app(() => new Promise(() => undefined));
    mount();
    await userEvent.click(screen.getByRole('radio', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Before you share' });
    expect(dialog.textContent).toContain('Share · 1 of 1');
    expect(dialog.textContent).toContain('Your project’s data stays on this computer.');
    expect(dialog.textContent).toContain('Traffic on your local network is not encrypted.');
    const go = screen.getByRole('button', { name: 'Share now' });
    await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(go);
    expect(api.share).toHaveBeenCalledTimes(1);
    // While the app works the dialog cannot be left and says so.
    expect(await screen.findByRole('button', { name: 'Sharing…' })).toHaveProperty('disabled', true);
  });

  it('with no owner password: first how to sign in from other devices, and only then the switch', async () => {
    const fetch = server(true);
    const api = app(() => Promise.resolve({ status: 'shared' }));
    mount();
    await userEvent.click(screen.getByRole('radio', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose how you sign in from other devices' });
    expect(dialog.textContent).toContain('Share · 1 of 2');
    expect(dialog.textContent).toContain('On this computer you never need them.');
    expect(screen.queryByRole('button', { name: 'Share now' })).toBeNull();

    await userEvent.type(screen.getByLabelText(/Your email/), 'ava@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'correct horse battery');
    await userEvent.type(screen.getByLabelText(/The same password again/), 'not the same');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('The two passwords are not the same.')).toBeTruthy();
    expect(fetch.mock.calls.some(([url]) => url === '/api/v1/designer/owner-password')).toBe(false);

    await userEvent.clear(screen.getByLabelText(/The same password again/));
    await userEvent.type(screen.getByLabelText(/The same password again/), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('dialog', { name: 'Before you share' })).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('Share · 2 of 2');
    await userEvent.click(screen.getByRole('button', { name: 'Share now' }));
    expect(api.share).toHaveBeenCalledTimes(1);
  });

  it('says what the server refused about the address or the password, on its field', async () => {
    server(true, () => jsonResponse(400, { error: { code: 'VALIDATION', message: 'Use at least 12 characters.', details: { reason: 'PASSWORD' } } }));
    app(() => Promise.resolve({ status: 'shared' }));
    mount();
    await userEvent.click(screen.getByRole('radio', { name: 'Share' }));
    await screen.findByRole('dialog', { name: 'Choose how you sign in from other devices' });
    await userEvent.type(screen.getByLabelText(/Your email/), 'ava@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'short');
    await userEvent.type(screen.getByLabelText(/The same password again/), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Use at least 12 characters.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Share now' })).toBeNull();
  });

  it('when the app itself says a password is needed, it is asked for; kept working closes; a failure is said', async () => {
    server(false);
    const share = vi
      .fn<() => Promise<DesktopShareResult>>()
      .mockResolvedValueOnce({ status: 'needs-password' })
      .mockResolvedValueOnce({ status: 'failed', detail: 'No port from 4700 to 4799 is free on this computer.' })
      .mockResolvedValueOnce({ status: 'kept-working' });
    app(share);
    mount();
    await userEvent.click(screen.getByRole('radio', { name: 'Share' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Share now' }));
    expect(await screen.findByRole('dialog', { name: 'Choose how you sign in from other devices' })).toBeTruthy();
    cleanup();

    mount();
    await userEvent.click(screen.getByRole('radio', { name: 'Share' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Share now' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No port from 4700 to 4799 is free on this computer.');
    await userEvent.click(screen.getByRole('button', { name: 'Share now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"Cancel" shares nothing', async () => {
    server(false);
    const api = app(() => Promise.resolve({ status: 'shared' }));
    mount();
    await userEvent.click(screen.getByRole('radio', { name: 'Share' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.share).not.toHaveBeenCalled();
  });
});

describe('the dashboard of a project that is shared', () => {
  const withBridge = (project: Record<string, unknown> | undefined): void => {
    Object.defineProperty(window, 'adminiumDesktop', { value: { platform: 'darwin', ...(project === undefined ? {} : { project }) } as unknown as AdminiumDesktopApi, configurable: true });
  };

  it('says so in one line, with the way back to the sharing details', async () => {
    const showShared = vi.fn(() => Promise.resolve());
    withBridge({ shareInfo: () => Promise.resolve({ name: 'Juniper', port: 4712, addresses: [], changedFrom: null, language: null, theme: 'system' }), showShared });
    render(<ShareBanner />);
    expect((await screen.findByRole('status')).textContent).toContain('This project is shared on your network.');
    await userEvent.click(screen.getByRole('button', { name: 'Sharing details' }));
    expect(showShared).toHaveBeenCalledTimes(1);
  });

  it('is nothing while a project is being built, in the classic workspace, in an older app, and when the app does not answer', async () => {
    for (const project of [{ shareInfo: () => Promise.resolve(null), showShared: vi.fn() }, {}, undefined, { shareInfo: () => Promise.reject(new Error('gone')), showShared: vi.fn() }]) {
      withBridge(project);
      render(<ShareBanner />);
      await Promise.resolve();
      await Promise.resolve();
      expect(screen.queryByRole('status')).toBeNull();
      cleanup();
    }
  });
});
