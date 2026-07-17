/**
 * §13's desktop About panel — the sections that exist ONLY in the Electron shell
 * (11-electron.md §13). Renders the whole `AboutPage` with `window.adminiumDesktop`
 * present, proving the wiring end to end: `AboutPage` detects the shell, mounts
 * `DesktopAboutSections`, and every §13 field paints — including the plaintext
 * secret WARN banner, which is the one that is a security control rather than a
 * label.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  AdminiumDesktopApi,
  DesktopRuntimeInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateEvent,
} from '@adminium/desktop/api';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import type { AboutData } from './aboutApi.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function makeAbout(overrides: Partial<AboutData> = {}): AboutData {
  return {
    version: '0.6.0',
    license: 'AGPL-3.0-only',
    sourceUrl: 'https://github.com/adminium/adminium',
    licenseUrl: 'https://github.com/adminium/adminium/blob/main/LICENSE',
    metaEngine: 'sqlite',
    metaMigrationVersion: '0042_add_widgets',
    node: 'v22.14.0',
    telemetry: { enabled: false },
    updates: { checkEnabled: false },
    ...overrides,
  };
}

function makeRuntime(overrides: Partial<DesktopRuntimeInfo> = {}): DesktopRuntimeInfo {
  return {
    dataDir: '/Users/ava/Library/Application Support/Adminium/data',
    serverPort: 51234,
    singleUser: true,
    lanShare: { enabled: false, port: 4600, urls: [] },
    updates: { mode: 'notify' },
    secretStorage: 'safeStorage',
    ...overrides,
  };
}

/** A stub §4 bridge; `window.adminiumDesktop !== undefined` is the detection contract. */
function installBridge(
  runtime: DesktopRuntimeInfo,
  checkResult: DesktopUpdateCheckResult = { status: 'none' },
) {
  // §11's `onUpdateEvent` supports multiple subscribers (the About card's flow
  // and AppShell's global toaster both listen); collect them so a test can emit.
  const listeners: Array<(e: DesktopUpdateEvent) => void> = [];
  const downloadUpdate = vi.fn(() => Promise.resolve());
  const quitAndInstall = vi.fn(() => Promise.resolve());
  const bridge = {
    platform: 'darwin',
    versions: { app: '1.4.2', electron: '43.1.1', chrome: '140.0.7259.5', node: '22.19.0' },
    getRuntimeInfo: vi.fn(() => Promise.resolve(runtime)),
    showItemInFolder: vi.fn(() => Promise.resolve()),
    checkForUpdates: vi.fn(() => Promise.resolve(checkResult)),
    downloadUpdate,
    quitAndInstall,
    onUpdateEvent: (cb: (e: DesktopUpdateEvent) => void) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    readBundledText: vi.fn(() => Promise.resolve('GNU AFFERO GENERAL PUBLIC LICENSE')),
    getDiagnostics: vi.fn(() => Promise.resolve({ dataDirBytes: 5_242_880 })),
    showLogs: vi.fn(() => Promise.resolve()),
  } as unknown as AdminiumDesktopApi;
  (window as { adminiumDesktop?: AdminiumDesktopApi }).adminiumDesktop = bridge;
  const emitUpdate = (event: DesktopUpdateEvent): void => {
    for (const cb of [...listeners]) cb(event);
  };
  return { bridge, emitUpdate, downloadUpdate, quitAndInstall };
}

function stubFetch(about: AboutData) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
      }
      if (url === '/api/v1/about') return Promise.resolve(jsonResponse(200, { data: about }));
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
      );
    }),
  );
}

async function renderDesktopAbout(
  about: AboutData,
  runtime: DesktopRuntimeInfo,
  checkResult?: DesktopUpdateCheckResult,
) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const handle = installBridge(runtime, checkResult);
  stubFetch(about);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/about'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return handle;
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
  delete (window as { adminiumDesktop?: AdminiumDesktopApi }).adminiumDesktop;
});

describe('AboutPage — desktop §13 sections', () => {
  it('renders every §13 version field from the bridge and the server', async () => {
    await renderDesktopAbout(makeAbout(), makeRuntime());
    await screen.findByRole('heading', { name: 'About Adminium' });

    // app / server / migration / Electron / Chromium / Node (acceptance).
    expect(await screen.findByText('1.4.2')).toBeDefined(); // app version (bridge)
    expect(screen.getByText('0.6.0')).toBeDefined(); // server version (/about)
    expect(screen.getByText('0042_add_widgets')).toBeDefined(); // migration
    expect(screen.getByText('43.1.1')).toBeDefined(); // Electron
    expect(screen.getByText('140.0.7259.5')).toBeDefined(); // Chromium
    expect(screen.getByText('22.19.0')).toBeDefined(); // Node runtime
  });

  it('shows the data directory with a reveal control and the encrypted secret state', async () => {
    await renderDesktopAbout(makeAbout(), makeRuntime());
    expect(
      await screen.findByText('/Users/ava/Library/Application Support/Adminium/data'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /Show in folder/ })).toBeDefined();
    expect(screen.getByText('Encrypted by your operating system')).toBeDefined();
  });

  it('WARNS when the secret is stored in plaintext (§2.2-3) — a security control, not a label', async () => {
    await renderDesktopAbout(makeAbout(), makeRuntime({ secretStorage: 'plain' }));
    expect(await screen.findByTestId('about-secret-plain-warning')).toBeDefined();
    expect(screen.getByText(/stored unencrypted on disk/)).toBeDefined();
  });

  it('offers the update channel + a Check for updates button in notify mode', async () => {
    await renderDesktopAbout(makeAbout(), makeRuntime({ updates: { mode: 'notify' } }));
    await screen.findByRole('heading', { name: 'About Adminium' });
    expect(await screen.findByRole('button', { name: /Check for updates/ })).toBeDefined();
    expect(screen.getByText('Notify me about new versions')).toBeDefined();
  });

  it('explains the air-gapped state in disabled mode instead of offering a check', async () => {
    await renderDesktopAbout(makeAbout(), makeRuntime({ updates: { mode: 'disabled' } }));
    expect(await screen.findByTestId('about-updates-disabled')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Check for updates/ })).toBeNull();
  });

  // §11 acceptance: "downloads only on user action, and installs on restart".
  // Before this the whole flow was dead — nothing subscribed to onUpdateEvent and
  // nothing called downloadUpdate/quitAndInstall anywhere in the SPA.
  it('turns a discovered update into Download → progress → Restart-to-install', async () => {
    const h = await renderDesktopAbout(makeAbout(), makeRuntime({ updates: { mode: 'notify' } }), {
      status: 'available',
      version: '2.0.0',
    });
    fireEvent.click(await screen.findByRole('button', { name: /Check for updates/ }));

    // A discovered version surfaces a Download control, not a dead text line.
    const download = await screen.findByRole('button', { name: /Download update/ });
    fireEvent.click(download);
    expect(h.downloadUpdate).toHaveBeenCalledTimes(1);

    // §11's progress → downloaded events drive the card to the Restart control.
    act(() => {
      h.emitUpdate({ type: 'progress', percent: 42 });
    });
    expect(await screen.findByTestId('about-updates-downloading')).toBeDefined();
    act(() => {
      h.emitUpdate({ type: 'downloaded', version: '2.0.0' });
    });

    fireEvent.click(await screen.findByRole('button', { name: /Restart to install/ }));
    expect(h.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('surfaces an availability event with no manual check (notify mode is no longer dead)', async () => {
    const h = await renderDesktopAbout(makeAbout(), makeRuntime({ updates: { mode: 'notify' } }));
    await screen.findByRole('heading', { name: 'About Adminium' });
    // A broadcast `available` — the scheduled check §11 runs — now has a consumer.
    act(() => {
      h.emitUpdate({ type: 'available', version: '3.1.0' });
    });
    expect(await screen.findByRole('button', { name: /Download update/ })).toBeDefined();
  });

  it('renders the AGPL notice, the in-app licence viewers, and the source link', async () => {
    await renderDesktopAbout(makeAbout(), makeRuntime());
    await screen.findByRole('heading', { name: 'About Adminium' });
    expect(screen.getByText(/free software under the GNU Affero/)).toBeDefined();
    expect(screen.getByRole('button', { name: /View licence/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Third-party licences/ })).toBeDefined();
    const source = screen.getByRole('link', { name: /Source code/ });
    expect(source.getAttribute('href')).toBe('https://github.com/adminium/adminium');
  });

  it('renders the telemetry toggle and the diagnostics actions', async () => {
    await renderDesktopAbout(makeAbout(), makeRuntime());
    await screen.findByRole('heading', { name: 'About Adminium' });
    expect(screen.getByRole('switch', { name: /Share anonymous usage data/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Copy diagnostic info/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Show logs/ })).toBeDefined();
  });

  it('replaces the self-host GitHub update notice — no opt-out/current banner in the shell', async () => {
    await renderDesktopAbout(makeAbout(), makeRuntime());
    await screen.findByRole('heading', { name: 'About Adminium' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Check for updates/ })).toBeDefined();
    });
    // The self-host notice's testids belong to the non-desktop branch only.
    expect(screen.queryByTestId('about-update-optout')).toBeNull();
    expect(screen.queryByTestId('about-update-current')).toBeNull();
  });
});
