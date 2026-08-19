// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desktop-only half of the About screen (11-electron.md §13), unit-level.
 *
 * Two properties here are worth more than the rest of the file put together.
 *
 * EVERY reader must survive the bridge being absent. This module ships in the
 * one SPA bundle that self-host and Cloud also serve, where
 * `window.adminiumDesktop` does not exist — so "no bridge" has to be a `null`
 * or a no-op at every entry point, never a `TypeError` in a browser tab.
 *
 * AND `buildDiagnostics` carries NO USER DATA. It is a blob the user copies to
 * a clipboard and pastes into a support thread, and the rule that keeps that
 * safe is that it is assembled from a closed, named set of fields — versions, a
 * platform, a byte COUNT, a locale. This suite pins the exact field list, so
 * adding a field that could name a table, a path, or a person is a failing test
 * rather than a silent leak.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminiumDesktopApi } from '@adminium/desktop/api';

import { jsonResponse } from '../test/fixtures.js';
import {
  buildDiagnostics,
  checkForUpdates,
  dataDirBytes,
  desktopPlatform,
  desktopRuntimeQuery,
  desktopVersions,
  formatBytes,
  readBundledText,
  revealPath,
  setTelemetry,
  showLogs,
  type DiagnosticsInput,
} from './desktopAbout.js';

/** §4's detection contract is `window.adminiumDesktop !== undefined` — nothing else. */
function installBridge(overrides: Partial<AdminiumDesktopApi> = {}) {
  const bridge = {
    versions: { app: '0.6.0', electron: '38.0.0', chromium: '140.0', node: '22.14.0' },
    platform: 'darwin',
    getRuntimeInfo: vi.fn().mockResolvedValue({ dataDir: '/data', secretStorage: 'safeStorage' }),
    showItemInFolder: vi.fn().mockResolvedValue(undefined),
    showLogs: vi.fn().mockResolvedValue(undefined),
    readBundledText: vi.fn().mockResolvedValue('AGPL-3.0-only …'),
    checkForUpdates: vi.fn().mockResolvedValue({ status: 'none' }),
    getDiagnostics: vi.fn().mockResolvedValue({ dataDirBytes: 4096 }),
    ...overrides,
  } as unknown as AdminiumDesktopApi;
  vi.stubGlobal('adminiumDesktop', bridge);
  return bridge as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('with no bridge (self-host and Cloud serve this same bundle)', () => {
  it('reports the static facts as null instead of throwing', () => {
    expect(desktopVersions()).toBeNull();
    expect(desktopPlatform()).toBeNull();
  });

  it('makes every native affordance a no-op', async () => {
    await expect(revealPath('/data')).resolves.toBeUndefined();
    await expect(showLogs()).resolves.toBeUndefined();
    await expect(readBundledText('license')).resolves.toBeNull();
    await expect(dataDirBytes()).resolves.toBeNull();
  });

  it('answers the update check "unavailable" rather than erroring', async () => {
    expect(await checkForUpdates()).toEqual({ status: 'unavailable' });
  });

  it('resolves the runtime query to null — the panel then draws nothing desktop-specific', async () => {
    await expect(desktopRuntimeQuery().queryFn?.({} as never)).resolves.toBeNull();
  });
});

describe('with the bridge present', () => {
  it('reads the static versions and platform straight off it', () => {
    installBridge();
    expect(desktopVersions()?.electron).toBe('38.0.0');
    expect(desktopPlatform()).toBe('darwin');
  });

  it('forwards the reveal and log calls with their arguments', async () => {
    const bridge = installBridge();
    await revealPath('/Users/ava/Library/Application Support/Adminium/data');
    expect(bridge['showItemInFolder']).toHaveBeenCalledWith(
      '/Users/ava/Library/Application Support/Adminium/data',
    );
    await showLogs();
    expect(bridge['showLogs']).toHaveBeenCalledTimes(1);
  });

  it('passes the licence kind through to the bundled-text reader', async () => {
    const bridge = installBridge();
    expect(await readBundledText('third-party-notices')).toBe('AGPL-3.0-only …');
    expect(bridge['readBundledText']).toHaveBeenCalledWith('third-party-notices');
  });

  it('reads the data-directory size out of the diagnostics call', async () => {
    installBridge();
    expect(await dataDirBytes()).toBe(4096);
  });

  it('resolves the runtime query through the bridge', async () => {
    installBridge();
    await expect(desktopRuntimeQuery().queryFn?.({} as never)).resolves.toMatchObject({
      dataDir: '/data',
    });
  });

  it('never polls: the runtime facts change on a relaunch, not on a navigation', () => {
    expect(desktopRuntimeQuery().staleTime).toBe(Infinity);
    expect(desktopRuntimeQuery().queryKey).toEqual(['about', 'desktop-runtime']);
  });
});

describe('checkForUpdates', () => {
  it('carries the version through when one is available', async () => {
    installBridge({
      checkForUpdates: vi.fn().mockResolvedValue({ status: 'available', version: '0.7.0' }),
    } as unknown as Partial<AdminiumDesktopApi>);
    expect(await checkForUpdates()).toEqual({ status: 'available', version: '0.7.0' });
  });

  it('passes the non-available statuses straight through', async () => {
    installBridge({ checkForUpdates: vi.fn().mockResolvedValue({ status: 'none' }) } as never);
    expect(await checkForUpdates()).toEqual({ status: 'none' });
    installBridge({ checkForUpdates: vi.fn().mockResolvedValue({ status: 'error' }) } as never);
    expect(await checkForUpdates()).toEqual({ status: 'error' });
  });

  it('folds a rejection — `disabled` mode included — into "unavailable"', async () => {
    // §11 never constructs the updater in `disabled` mode, so the bridge
    // rejects with UNAVAILABLE. The §13 panel already shows the mode; an error
    // box on top of it would say the same thing twice, and wrongly.
    installBridge({
      checkForUpdates: vi.fn().mockRejectedValue(new Error('UNAVAILABLE')),
    } as never);
    expect(await checkForUpdates()).toEqual({ status: 'unavailable' });
  });
});

describe('setTelemetry', () => {
  it('writes BOTH consents, so the toggle cannot silently clear the other one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: { telemetry: true, updateCheck: true } }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await setTelemetry({ telemetry: true, updateCheck: true })).toEqual({
      telemetry: true,
      updateCheck: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('/api/v1/settings/telemetry');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ telemetry: true, updateCheck: true });
  });
});

describe('formatBytes', () => {
  it('shows whole bytes below 1 KB, and one decimal above', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('climbs the base-1024 units a file manager shows', () => {
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
  });

  it('stops at TB instead of inventing a unit', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024.0 TB');
  });

  it('em-dashes a value that is not a size', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('buildDiagnostics', () => {
  const input: DiagnosticsInput = {
    appVersion: '0.6.0',
    serverVersion: '0.6.0',
    metaMigrationVersion: '0042_add_widgets',
    electron: '38.0.0',
    chromium: '140.0',
    node: '22.14.0',
    platform: 'darwin',
    dataDirBytes: 1024 * 1024 * 3,
    secretStorage: 'safeStorage',
    updateMode: 'notify',
    locale: 'en_US',
  };

  it('emits exactly the closed field set — nothing that could name a person or a path', () => {
    // The blob is pasted into a support thread. Pinning the LINE LIST (not just
    // a substring) is what makes a new field a failing test rather than a leak.
    expect(buildDiagnostics(input).split('\n')).toEqual([
      'Adminium desktop diagnostics',
      'App version: 0.6.0',
      'Server version: 0.6.0',
      'Meta-store migration: 0042_add_widgets',
      'Electron: 38.0.0',
      'Chromium: 140.0',
      'Node: 22.14.0',
      'Platform: darwin',
      'Data size: 3.0 MB',
      'Secret storage: safeStorage',
      'Update mode: notify',
      'Locale: en_US',
    ]);
  });

  it('says "unknown" for every field a browser-served build cannot fill', () => {
    const lines = buildDiagnostics({
      appVersion: undefined,
      serverVersion: '0.6.0',
      metaMigrationVersion: null,
      electron: undefined,
      chromium: undefined,
      node: undefined,
      platform: null,
      dataDirBytes: null,
      secretStorage: undefined,
      updateMode: undefined,
      locale: 'de_DE',
    }).split('\n');
    expect(lines.filter((line) => line.endsWith('unknown'))).toHaveLength(9);
    expect(lines).toContain('Data size: unknown');
    expect(lines).toContain('Locale: de_DE');
  });
});
