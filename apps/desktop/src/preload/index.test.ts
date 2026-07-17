/**
 * The §4 bridge as the renderer sees it: what is exposed, and what a rejection
 * looks like.
 *
 * The allow-list test below is the one with teeth. Every other property here
 * would fail loudly the first time somebody used the feature; a bridge that
 * quietly grew a thirteenth method — `ipcRenderer`, a `send(channel, …)`
 * passthrough, a node primitive, a debug helper somebody meant to remove — would
 * work perfectly and hand a compromised renderer main-process authority §2.4
 * spent four settings denying it. So the exposed key set is asserted EXACTLY,
 * and adding to §4 means editing this list on purpose.
 */

import { describe, expect, it, vi } from 'vitest';

import type { AdminiumDesktopApi } from './api.js';
import { BRIDGE_KEY, IPC_CHANNELS, ipcFail, ipcOk, type BridgeBootstrap } from './channels.js';
import {
  createDesktopApi,
  DesktopBridgeError,
  exposeBridge,
  isElectronPreload,
  readBootstrap,
  type IpcRendererLike,
} from './index.js';

// ─── Fakes ───────────────────────────────────────────────────────────────────

const BOOTSTRAP: BridgeBootstrap = {
  platform: 'darwin',
  versions: { app: '1.2.3', electron: '43.1.1', chrome: '140.0.0', node: '22.19.0' },
};

interface Listener {
  channel: string;
  listener: (event: unknown, ...args: unknown[]) => void;
}

/** An `ipcRenderer` the test answers by hand. */
class FakeIpc implements IpcRendererLike {
  readonly calls: Array<{ channel: string; args: unknown[] }> = [];
  readonly listeners: Listener[] = [];
  syncReply: unknown = ipcOk(BOOTSTRAP);
  reply: (channel: string, args: unknown[]) => unknown = () => ipcOk(null);

  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    this.calls.push({ channel, args });
    return Promise.resolve(this.reply(channel, args));
  }

  sendSync(channel: string, ...args: unknown[]): unknown {
    this.calls.push({ channel, args });
    return this.syncReply;
  }

  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown {
    this.listeners.push({ channel, listener });
    return this;
  }

  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown {
    const index = this.listeners.findIndex(
      (entry) => entry.channel === channel && entry.listener === listener,
    );
    if (index >= 0) this.listeners.splice(index, 1);
    return this;
  }

  /** Push a main → renderer message, as `emitUpdateEvent` does. */
  emit(channel: string, payload: unknown): void {
    for (const entry of this.listeners) {
      if (entry.channel === channel) entry.listener({}, payload);
    }
  }
}

const build = (ipc: IpcRendererLike = new FakeIpc()): AdminiumDesktopApi =>
  createDesktopApi({ ipc, bootstrap: BOOTSTRAP });

// ─── The allow-list ──────────────────────────────────────────────────────────

describe('the exposed surface', () => {
  /**
   * §4's `AdminiumDesktopApi`, spelled out. Not derived from the type — a test
   * that computed this list from the thing it is testing would agree with any
   * future version of it, including the one with `ipcRenderer` on it.
   */
  const SECTION_4_KEYS = [
    'capabilities',
    'checkForUpdates',
    'chooseDirectory',
    'downloadUpdate',
    'getRuntimeInfo',
    'onUpdateEvent',
    'openFile',
    'platform',
    'quitAndInstall',
    'relaunch',
    'saveFile',
    'setConfig',
    // NOT in §4's listing, and deliberately so: §6 step 1's "Change…" needs a
    // COMMIT, which `setConfig` must not be. Moving the data dir relaunches the
    // app and can refuse (cloud-sync path, non-empty target), so it gets its own
    // channel with its own gate rather than becoming a key `setConfigSchema`
    // exists to reject. See `main/ipc.ts`'s `setDataDirSchema`.
    'setDataDir',
    'showItemInFolder',
    'showLogs',
    'versions',
  ];

  it('is exactly §4 — no more, no less', () => {
    expect(Object.keys(build()).sort()).toEqual(SECTION_4_KEYS);
  });

  it('exposes §12 capabilities as exactly list + invoke', () => {
    expect(Object.keys(build().capabilities).sort()).toEqual(['invoke', 'list']);
  });

  it('exposes no ipcRenderer, and no function that forwards an arbitrary channel', () => {
    const api = build() as unknown as Record<string, unknown>;
    // The bridge holds an ipcRenderer; it must never hand one over — directly,
    // or through a member that happens to be one in disguise.
    for (const [key, value] of Object.entries(api)) {
      expect(key).not.toMatch(/^(ipc|ipcRenderer|send|sendSync|invoke|on|emit|require|process)$/);
      if (typeof value === 'object' && value !== null) {
        expect(Object.keys(value)).not.toContain('invoke2');
      }
    }
    expect(api['ipcRenderer']).toBeUndefined();
    expect(api['require']).toBeUndefined();
    expect(api['process']).toBeUndefined();
  });

  it('carries §4 platform + versions as plain values, not promises', () => {
    const api = build();
    expect(api.platform).toBe('darwin');
    expect(api.versions).toEqual(BOOTSTRAP.versions);
  });

  it('exposes under §4 the one key the SPA and the server both name', () => {
    const expose = vi.fn();
    exposeBridge({ ipc: new FakeIpc(), bootstrap: BOOTSTRAP, expose });
    expect(expose).toHaveBeenCalledTimes(1);
    expect(expose.mock.calls[0]?.[0]).toBe('adminiumDesktop');
    expect(BRIDGE_KEY).toBe('adminiumDesktop');
  });

  it('does not auto-expose outside a real Electron renderer', () => {
    // Importing this module in a unit test must not try to build a bridge — the
    // module-scope call at the bottom of index.ts is guarded by this.
    expect(isElectronPreload()).toBe(false);
  });
});

// ─── Channel wiring ──────────────────────────────────────────────────────────

describe('each method addresses exactly its own channel', () => {
  it.each([
    ['openFile', (api: AdminiumDesktopApi) => api.openFile({ kind: 'sqlite' }), IPC_CHANNELS.openFile, [{ kind: 'sqlite' }]],
    [
      'saveFile',
      (api: AdminiumDesktopApi) => api.saveFile({ kind: 'backup', defaultName: 'b.zip' }),
      IPC_CHANNELS.saveFile,
      [{ kind: 'backup', defaultName: 'b.zip' }],
    ],
    [
      'showItemInFolder',
      (api: AdminiumDesktopApi) => api.showItemInFolder('/tmp/x'),
      IPC_CHANNELS.showItemInFolder,
      ['/tmp/x'],
    ],
    [
      'chooseDirectory',
      (api: AdminiumDesktopApi) => api.chooseDirectory({ title: 'Data' }),
      IPC_CHANNELS.chooseDirectory,
      [{ title: 'Data' }],
    ],
    ['getRuntimeInfo', (api: AdminiumDesktopApi) => api.getRuntimeInfo(), IPC_CHANNELS.getRuntimeInfo, []],
    [
      'setConfig',
      (api: AdminiumDesktopApi) => api.setConfig({ singleUser: false }),
      IPC_CHANNELS.setConfig,
      [{ singleUser: false }],
    ],
    ['checkForUpdates', (api: AdminiumDesktopApi) => api.checkForUpdates(), IPC_CHANNELS.checkForUpdates, []],
    ['downloadUpdate', (api: AdminiumDesktopApi) => api.downloadUpdate(), IPC_CHANNELS.downloadUpdate, []],
    ['quitAndInstall', (api: AdminiumDesktopApi) => api.quitAndInstall(), IPC_CHANNELS.quitAndInstall, []],
    [
      'capabilities.list',
      (api: AdminiumDesktopApi) => api.capabilities.list(),
      IPC_CHANNELS.capabilitiesList,
      [],
    ],
    [
      'capabilities.invoke',
      (api: AdminiumDesktopApi) => api.capabilities.invoke('printer.escpos', 'print', { copies: 1 }),
      IPC_CHANNELS.capabilitiesInvoke,
      [{ capabilityId: 'printer.escpos', method: 'print', payload: { copies: 1 } }],
    ],
    ['relaunch', (api: AdminiumDesktopApi) => api.relaunch(), IPC_CHANNELS.relaunch, []],
    ['showLogs', (api: AdminiumDesktopApi) => api.showLogs(), IPC_CHANNELS.showLogs, []],
  ])('%s', async (_name, call, channel, args) => {
    const ipc = new FakeIpc();
    await call(build(ipc));
    expect(ipc.calls).toEqual([{ channel, args }]);
  });
});

// ─── Errors ──────────────────────────────────────────────────────────────────

describe('a handler failure reaches the renderer as a typed error', () => {
  it('carries the code on the error and in the message', async () => {
    const ipc = new FakeIpc();
    ipc.reply = () => ipcFail('CAPABILITY_NOT_GRANTED', 'printer.escpos is not granted.');

    const error = await build(ipc)
      .capabilities.invoke('printer.escpos', 'print', null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DesktopBridgeError);
    expect((error as DesktopBridgeError).code).toBe('CAPABILITY_NOT_GRANTED');
    // The prefix is the half of the contract that survives contextBridge, so it
    // is asserted as deliberately as the property.
    expect((error as DesktopBridgeError).message).toBe(
      'CAPABILITY_NOT_GRANTED: printer.escpos is not granted.',
    );
  });

  it.each(['INVALID_PAYLOAD', 'UNAVAILABLE', 'UNTRUSTED_SENDER', 'CAPABILITY_STUB', 'INTERNAL'] as const)(
    'preserves the %s code',
    async (code) => {
      const ipc = new FakeIpc();
      ipc.reply = () => ipcFail(code, 'nope');
      const error = await build(ipc).relaunch().catch((e: unknown) => e);
      expect((error as DesktopBridgeError).code).toBe(code);
    },
  );

  it('rejects rather than returning garbage when the reply is not an envelope', async () => {
    const ipc = new FakeIpc();
    // What a channel answered by something that is not registerIpcHandlers looks
    // like — a raw value, no envelope.
    ipc.reply = () => ({ dataDir: '/tmp' });
    const error = await build(ipc).getRuntimeInfo().catch((e: unknown) => e);
    expect((error as DesktopBridgeError).code).toBe('INTERNAL');
  });

  it('unwraps a success to the bare value', async () => {
    const ipc = new FakeIpc();
    ipc.reply = () => ipcOk('/Users/ava/db.sqlite');
    await expect(build(ipc).openFile({ kind: 'sqlite' })).resolves.toBe('/Users/ava/db.sqlite');
  });

  it('unwraps a cancelled dialog to null, not to an error', async () => {
    const ipc = new FakeIpc();
    ipc.reply = () => ipcOk(null);
    await expect(build(ipc).saveFile({ kind: 'export', defaultName: 'x.csv' })).resolves.toBeNull();
  });
});

// ─── onUpdateEvent ───────────────────────────────────────────────────────────

describe('onUpdateEvent', () => {
  it('delivers pushed events and stops on unsubscribe', () => {
    const ipc = new FakeIpc();
    const seen: unknown[] = [];
    const off = build(ipc).onUpdateEvent((event) => seen.push(event));

    ipc.emit(IPC_CHANNELS.updateEvent, { type: 'available', version: '1.3.0' });
    ipc.emit(IPC_CHANNELS.updateEvent, { type: 'progress', percent: 42 });
    off();
    ipc.emit(IPC_CHANNELS.updateEvent, { type: 'downloaded' });

    expect(seen).toEqual([
      { type: 'available', version: '1.3.0' },
      { type: 'progress', percent: 42 },
    ]);
    expect(ipc.listeners).toHaveLength(0);
  });

  it('gives each subscriber its own unsubscriber', () => {
    const ipc = new FakeIpc();
    const api = build(ipc);
    const a: unknown[] = [];
    const b: unknown[] = [];
    const offA = api.onUpdateEvent((e) => a.push(e));
    api.onUpdateEvent((e) => b.push(e));

    offA();
    ipc.emit(IPC_CHANNELS.updateEvent, { type: 'downloaded' });

    expect(a).toEqual([]);
    expect(b).toEqual([{ type: 'downloaded' }]);
  });
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────

describe('readBootstrap', () => {
  it('reads §4 platform + versions over the sync channel', () => {
    const ipc = new FakeIpc();
    expect(readBootstrap(ipc)).toEqual(BOOTSTRAP);
    expect(ipc.calls).toEqual([{ channel: IPC_CHANNELS.bootstrap, args: [] }]);
  });

  it.each([
    ['no handler registered (sendSync answers undefined)', undefined],
    ['a refusal', ipcFail('UNTRUSTED_SENDER', 'no')],
    ['a malformed platform', ipcOk({ platform: 'solaris', versions: BOOTSTRAP.versions })],
    ['a missing app version', ipcOk({ platform: 'linux', versions: { electron: '43' } })],
  ])('refuses to build a bridge on %s', (_name, syncReply) => {
    const ipc = new FakeIpc();
    ipc.syncReply = syncReply;
    // Throwing is the point: a `window.adminiumDesktop` that exists with a
    // made-up app version would satisfy §4's detection contract while lying to
    // §13's About screen. Failing here surfaces as "Unable to load preload
    // script" and the SPA correctly reports "not the desktop shell".
    expect(() => readBootstrap(ipc)).toThrow(/bootstrap/);
  });
});
