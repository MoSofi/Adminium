// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/settings/desktop` — the "Require login on this device" toggle (11-electron.md
 * §5, §2.3).
 *
 * The load-bearing assertions: the toggle is the INVERSE of `config.singleUser`,
 * it writes the FILE through the bridge (not the server's mirror, which the next
 * boot would overwrite), and the surface does not exist outside the shell.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

interface BridgeStub {
  patches: Array<{ singleUser?: boolean | undefined }>;
}

/** Installs a §4-shaped `window.adminiumDesktop` with just the two members used. */
function stubBridge(opts: {
  singleUser: boolean;
  failWrite?: boolean;
  failRead?: boolean;
}): BridgeStub {
  const patches: BridgeStub['patches'] = [];
  vi.stubGlobal('adminiumDesktop', {
    getRuntimeInfo: () =>
      opts.failRead === true
        ? Promise.reject(new Error('UNAVAILABLE: no config'))
        : Promise.resolve({ singleUser: opts.singleUser }),
    setConfig: (patch: { singleUser?: boolean | undefined }) => {
      if (opts.failWrite === true) return Promise.reject(new Error('EACCES'));
      patches.push(patch);
      return Promise.resolve();
    },
  });
  return { patches };
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
      );
    }),
  );
}

function renderDesktopSettings(): void {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/settings/desktop'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const TOGGLE = { name: 'Require login on this device' };

let restoreI18n: () => void;

beforeAll(() => {
  restoreI18n = installTestI18n();
});

afterAll(() => {
  restoreI18n();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DesktopSettingsPage', () => {
  it('renders the toggle OFF while auto-login is on (singleUser: true)', async () => {
    stubBridge({ singleUser: true });
    renderDesktopSettings();

    const toggle = await screen.findByRole('switch', TOGGLE);
    // `singleUser: true` = "skip login on this computer" = do NOT require login.
    // The toggle is the inverse of the config field, and getting that backwards
    // would tell the user their machine is locked when it is not.
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('renders the toggle ON while a login is required (singleUser: false)', async () => {
    stubBridge({ singleUser: false });
    renderDesktopSettings();

    const toggle = await screen.findByRole('switch', TOGGLE);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('turning it on writes singleUser: false to config.json', async () => {
    const bridge = stubBridge({ singleUser: true });
    renderDesktopSettings();

    const toggle = await screen.findByRole('switch', TOGGLE);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
    await userEvent.click(toggle);

    // Through the BRIDGE — §2.3 makes config.json the source of truth, and the
    // server's `desktop.singleUser` setting is a mirror the next boot rewrites
    // from it. Writing the mirror instead would look like it worked and silently
    // revert on relaunch.
    await waitFor(() => {
      expect(bridge.patches).toEqual([{ singleUser: false }]);
    });
  });

  it('turning it back off re-enables auto-login', async () => {
    const bridge = stubBridge({ singleUser: false });
    renderDesktopSettings();

    const toggle = await screen.findByRole('switch', TOGGLE);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
    await userEvent.click(toggle);

    await waitFor(() => {
      expect(bridge.patches).toEqual([{ singleUser: true }]);
    });
  });

  it('says the change applies on the next launch — §5 promises exactly that', async () => {
    stubBridge({ singleUser: true });
    renderDesktopSettings();

    expect(await screen.findByText(/next time you open Adminium/)).toBeDefined();
  });

  it('reports a failed write instead of showing a state the file does not have', async () => {
    stubBridge({ singleUser: true, failWrite: true });
    renderDesktopSettings();

    const toggle = await screen.findByRole('switch', TOGGLE);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });
    await userEvent.click(toggle);

    expect(await screen.findByText('Could not save that setting. Try again.')).toBeDefined();
  });

  it('does not exist outside the desktop shell', async () => {
    // No `window.adminiumDesktop` — a browser tab or a self-host deployment (§4
    // detection contract). There is no config.json to write, so there is no
    // setting: the address is simply wrong.
    renderDesktopSettings();

    expect(await screen.findByText('This page went missing')).toBeDefined();
    expect(screen.queryByRole('switch', TOGGLE)).toBeNull();
  });

  it('shows the SAFER reading when the config cannot be read at all', async () => {
    stubBridge({ singleUser: true, failRead: true });
    renderDesktopSettings();

    // A switch that renders "login not required" on a failed read would tell the
    // user this machine is unlocked without having checked. Unknown ⇒ show the
    // protective state; the toggle still works, and the next read corrects it.
    const toggle = await screen.findByRole('switch', TOGGLE);
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });
});
