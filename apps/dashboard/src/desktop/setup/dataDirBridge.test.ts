// SPDX-License-Identifier: AGPL-3.0-only
/**
 * §6 step 1's three bridge calls. The module's own rule is what is tested:
 * every function answers `null` with no bridge rather than throwing, because
 * this code is reachable from a browser tab pointed at `/desktop/setup` and a
 * `TypeError` there is a worse answer than "this affordance does not exist".
 *
 * The one non-obvious call is `chooseDataDir`, which must NOT send a
 * `defaultPath` key when there is no directory to start from — the native
 * dialog treats an explicit `undefined` differently from an absent option.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminiumDesktopApi } from '@adminium/desktop/api';

import { chooseDataDir, commitDataDir, readDataDir } from './dataDirBridge.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function installBridge(overrides: Partial<AdminiumDesktopApi> = {}) {
  const bridge = {
    getRuntimeInfo: vi.fn().mockResolvedValue({ dataDir: '/Users/ava/Adminium/data' }),
    chooseDirectory: vi.fn().mockResolvedValue('/Users/ava/Elsewhere'),
    setDataDir: vi.fn().mockResolvedValue({ status: 'applied' }),
    ...overrides,
  } as unknown as AdminiumDesktopApi;
  vi.stubGlobal('adminiumDesktop', bridge);
  return bridge as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

describe('with no bridge', () => {
  it('answers null everywhere instead of throwing', async () => {
    await expect(readDataDir()).resolves.toBeNull();
    await expect(chooseDataDir('/Users/ava')).resolves.toBeNull();
    await expect(commitDataDir('/Users/ava', true)).resolves.toBeNull();
  });
});

describe('readDataDir', () => {
  it('reads the directory the app booted against out of the runtime info', async () => {
    installBridge();
    expect(await readDataDir()).toBe('/Users/ava/Adminium/data');
  });
});

describe('chooseDataDir', () => {
  it('opens the native picker at the current directory, with a title', async () => {
    const bridge = installBridge();
    expect(await chooseDataDir('/Users/ava/Adminium/data')).toBe('/Users/ava/Elsewhere');
    expect(bridge['chooseDirectory']).toHaveBeenCalledWith({
      title: 'Choose where Adminium keeps your data',
      defaultPath: '/Users/ava/Adminium/data',
    });
  });

  it('omits defaultPath entirely when there is nowhere to start from', async () => {
    const bridge = installBridge();
    await chooseDataDir(null);
    expect(bridge['chooseDirectory']).toHaveBeenCalledWith({
      title: 'Choose where Adminium keeps your data',
    });
    expect(bridge['chooseDirectory']?.mock.calls[0]?.[0]).not.toHaveProperty('defaultPath');
  });

  it('reports a cancelled dialog as null, exactly like no bridge', async () => {
    // The caller treats both the same way — nothing was chosen — which is why
    // the two are deliberately not distinguished.
    installBridge({ chooseDirectory: vi.fn().mockResolvedValue(null) } as never);
    expect(await chooseDataDir('/Users/ava')).toBeNull();
  });
});

describe('commitDataDir', () => {
  it('forwards the directory and the cloud-sync acknowledgement', async () => {
    const bridge = installBridge();
    expect(await commitDataDir('/Users/ava/Dropbox/Adminium', true)).toEqual({ status: 'applied' });
    expect(bridge['setDataDir']).toHaveBeenCalledWith({
      dir: '/Users/ava/Dropbox/Adminium',
      acknowledgeCloudSync: true,
    });
  });

  it('passes an unacknowledged commit through so the main process can refuse it', async () => {
    // The gate is the main process's; this call must not pre-empt it, or the
    // wizard would never see the warning it has to render.
    const bridge = installBridge({
      setDataDir: vi.fn().mockResolvedValue({ status: 'cloud-sync-warning', provider: 'Dropbox' }),
    } as never);
    expect(await commitDataDir('/Users/ava/Dropbox/Adminium', false)).toEqual({
      status: 'cloud-sync-warning',
      provider: 'Dropbox',
    });
    expect(bridge['setDataDir']).toHaveBeenCalledWith({
      dir: '/Users/ava/Dropbox/Adminium',
      acknowledgeCloudSync: false,
    });
  });
});
