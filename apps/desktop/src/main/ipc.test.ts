// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The main-process half of the bridge, driven through a fake `ipcMain`.
 *
 * These tests exist because of one asymmetry: everything the handlers do
 * correctly is visible the first time a feature is used, and everything they
 * fail to REFUSE is invisible until someone refuses it for us. So the weight is
 * on the refusals — a payload zod should have rejected, a key that must not be
 * settable, a sender that must not be served, an updater that must not exist —
 * and on the shape of a failure, since typed codes are the SPA's control flow
 * and not decoration.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  INVOKE_CHANNELS,
  START_CHANNELS,
  IPC_CHANNELS,
  type BridgeBootstrap,
  type IpcResult, VERSIONS_CHANNELS, SHARE_CHANNELS } from '../preload/channels.js';
import { CAPABILITY_NOT_GRANTED, CAPABILITY_STUB, type CapabilityHost } from './capabilities/host.js';
import { createDefaultConfig, type DesktopConfig } from './config.js';
import {
  isLoopbackHostname,
  loopbackSenderPolicy,
  pinnedSenderPolicy,
  registerIpcHandlers,
  toErrorPayload,
  type DesktopDialogs,
  type DesktopRuntimeSnapshot,
  type IpcInvokeEventLike,
  type IpcMainLike,
  type IpcSyncEventLike,
  ownPagePolicy,
  type RegisterIpcHandlersOptions,
} from './ipc.js';
import type { StartService } from './start.js';
import type { SetDataDirResult } from '../preload/api.js';
import type { UpdateManager } from './updates.js';

// ─── Fakes ───────────────────────────────────────────────────────────────────

const BOOTSTRAP: BridgeBootstrap = {
  platform: 'linux',
  versions: { app: '1.2.3', electron: '43.1.1', chrome: '140.0.0', node: '22.19.0' },
};

const DATA_DIR = '/home/ava/.local/share/Adminium/data';

/** A frame at the loopback origin — what the SPA always is. */
const APP_FRAME: IpcInvokeEventLike = { senderFrame: { url: 'http://127.0.0.1:51234/studio' } };

class FakeIpcMain implements IpcMainLike {
  readonly handlers = new Map<
    string,
    (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<IpcResult<unknown>>
  >();
  readonly syncListeners = new Map<string, (event: IpcSyncEventLike, ...args: unknown[]) => void>();

  handle(
    channel: string,
    listener: (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<IpcResult<unknown>>,
  ): void {
    if (this.handlers.has(channel)) throw new Error(`duplicate handler for ${channel}`);
    this.handlers.set(channel, listener);
  }

  on(channel: string, listener: (event: IpcSyncEventLike, ...args: unknown[]) => void): unknown {
    this.syncListeners.set(channel, listener);
    return this;
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  removeAllListeners(channel: string): unknown {
    this.syncListeners.delete(channel);
    return this;
  }

  /** Invoke a channel the way a renderer would. */
  invoke(
    channel: string,
    payload?: unknown,
    event: IpcInvokeEventLike = APP_FRAME,
  ): Promise<IpcResult<unknown>> {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`no handler registered for ${channel}`);
    return payload === undefined ? handler(event) : handler(event, payload);
  }

  sendSync(channel: string, event: IpcSyncEventLike): unknown {
    this.syncListeners.get(channel)?.(event);
    return event.returnValue;
  }
}

const stubDialogs = (): DesktopDialogs => ({
  openFile: vi.fn(() => Promise.resolve('/tmp/opened.sqlite')),
  saveFile: vi.fn(() => Promise.resolve('/tmp/saved.zip')),
  chooseDirectory: vi.fn(() => Promise.resolve('/tmp/dir')),
  showItemInFolder: vi.fn(() => Promise.resolve()),
});

const stubCapabilities = (): CapabilityHost => ({
  register: vi.fn(),
  list: vi.fn(() => [
    { id: 'printer.escpos', version: 1 as const, status: 'stub' as const, methods: ['print'] },
  ]),
  invoke: vi.fn(() => Promise.resolve(null)),
});

const stubUpdates = (): UpdateManager => ({
  checkForUpdates: vi.fn(() => Promise.resolve({ status: 'available' as const, version: '1.3.0' })),
  downloadUpdate: vi.fn(() => Promise.resolve()),
  quitAndInstall: vi.fn(),
  dispose: vi.fn(),
});

const RUNTIME: DesktopRuntimeSnapshot = {
  dataDir: DATA_DIR,
  secretStorage: 'safeStorage',
  serverPort: 51234,
  updatesDisabledByEnv: false,
};

interface Harness {
  ipc: FakeIpcMain;
  config: DesktopConfig;
  dialogs: DesktopDialogs;
  capabilities: CapabilityHost;
  updates: UpdateManager | null;
  writeConfig: ReturnType<typeof vi.fn>;
  setDataDir: ReturnType<typeof vi.fn>;
  relaunch: ReturnType<typeof vi.fn>;
  showLogs: ReturnType<typeof vi.fn>;
  broadcast: ReturnType<typeof vi.fn>;
  handlers: ReturnType<typeof registerIpcHandlers>;
}

/**
 * `updates` is the RESOLVED manager (or null), not the getter wires — the boot
 * creates the manager after config load and `ipc.ts` reads it through a `() =>
 * UpdateManager | null` port. The harness takes the value for readability and
 * wraps it in the getter below, so the disabled case is `{ updates: null }`.
 */
function harness(
  overrides: Partial<Omit<RegisterIpcHandlersOptions, 'updates'>> & {
    updates?: UpdateManager | null;
  } = {},
): Harness {
  const ipc = new FakeIpcMain();
  const config = createDefaultConfig(DATA_DIR);
  const dialogs = overrides.dialogs ?? stubDialogs();
  const capabilities = overrides.capabilities ?? stubCapabilities();
  const updates = overrides.updates === undefined ? stubUpdates() : overrides.updates;
  const writeConfig = vi.fn(() => Promise.resolve());
  const setDataDir = vi.fn(() =>
    Promise.resolve<SetDataDirResult>({ status: 'applied', dataDir: '/data' }),
  );
  const relaunch = vi.fn();
  const showLogs = vi.fn(() => Promise.resolve());
  const broadcast = vi.fn();

  const handlers = registerIpcHandlers({
    ipc,
    bootstrap: BOOTSTRAP,
    broadcast,
    runtime: () => RUNTIME,
    readConfig: () => config,
    writeConfig,
    setDataDir,
    dialogs,
    capabilities,
    setMenuLabels: vi.fn(),
    getDiagnostics: vi.fn(() => Promise.resolve({ dataDirBytes: 4096 })),
    readBundledText: vi.fn(() => Promise.resolve('licence text')),
    showLogs,
    relaunch,
    ...overrides,
    // The resolved manager wrapped as the getter `ipc.ts` reads. Placed AFTER
    // the spread so it wins over `overrides.updates` (which carries the VALUE
    // the harness took for readability, not the getter the port wants).
    updates: () => updates,
  });

  return {
    ipc,
    config,
    dialogs,
    capabilities,
    updates,
    writeConfig,
    setDataDir,
    relaunch,
    showLogs,
    broadcast,
    handlers,
  };
}

const expectOk = <T>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
};

const expectFail = (result: IpcResult<unknown>): { code: string; message: string } => {
  if (result.ok) throw new Error(`expected a failure, got ${JSON.stringify(result.value)}`);
  return result.error;
};

// ─── Registration ────────────────────────────────────────────────────────────

describe('registration', () => {
  it('answers every channel and nothing else', () => {
    const { ipc } = harness();
    // The registered `invoke` handlers are EXACTLY `INVOKE_CHANNELS` — the same
    // list `dispose()` tears down, so this pins the two together: a channel added
    // to `INVOKE_CHANNELS` without a `register()` call fails here, and one
    // registered but left off the list leaks a handler `dispose()` never removes.
    // Asserting against that source of truth (rather than a second hand-kept copy)
    // is also what lets parallel tracks add channels — updates,
    // capabilities, diagnostics, `setMenuLabels` — without this test going
    // stale the moment a sibling lands.
    expect([...ipc.handlers.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect([...ipc.syncListeners.keys()]).toEqual([IPC_CHANNELS.bootstrap]);
  });

  it('dispose removes every handler, so a re-register does not throw', () => {
    const { ipc, handlers } = harness();
    handlers.dispose();
    expect(ipc.handlers.size).toBe(0);
    expect(ipc.syncListeners.size).toBe(0);
  });

  it('answers the bootstrap synchronously with platform + versions', () => {
    const { ipc } = harness();
    const event: IpcSyncEventLike = { ...APP_FRAME, returnValue: undefined };
    expect(ipc.sendSync(IPC_CHANNELS.bootstrap, event)).toEqual({ ok: true, value: BOOTSTRAP });
  });
});

// ─── Zod at the boundary ─────────────────────────────────────────────────────

describe('an invalid payload is rejected by zod, not passed through', () => {
  it.each([
    ['openFile with an unknown kind', IPC_CHANNELS.openFile, { kind: 'exe' }],
    ['openFile with no payload at all', IPC_CHANNELS.openFile, null],
    ['openFile with an extra key', IPC_CHANNELS.openFile, { kind: 'sqlite', filters: ['*'] }],
    ['saveFile with a missing name', IPC_CHANNELS.saveFile, { kind: 'backup' }],
    ['saveFile with a path traversal in the name', IPC_CHANNELS.saveFile, { kind: 'backup', defaultName: '../../evil.zip' }],
    ['saveFile with a nested path', IPC_CHANNELS.saveFile, { kind: 'export', defaultName: 'a/b.csv' }],
    ['showItemInFolder with a relative path', IPC_CHANNELS.showItemInFolder, '../secrets'],
    ['showItemInFolder with a non-string', IPC_CHANNELS.showItemInFolder, 42],
    ['showItemInFolder with an empty path', IPC_CHANNELS.showItemInFolder, ''],
    ['chooseDirectory with a relative defaultPath', IPC_CHANNELS.chooseDirectory, { title: 'x', defaultPath: 'rel' }],
    ['chooseDirectory with no title', IPC_CHANNELS.chooseDirectory, {}],
    ['setConfig with a bad port', IPC_CHANNELS.setConfig, { lanShare: { enabled: true, port: 99999 } }],
    ['setConfig with a bad update mode', IPC_CHANNELS.setConfig, { updates: { mode: 'silent' } }],
    ['setConfig with keep out of range', IPC_CHANNELS.setConfig, { autoBackup: { enabled: true, keep: 0 } }],
    ['setConfig with a non-boolean', IPC_CHANNELS.setConfig, { singleUser: 'yes' }],
    ['setConfig with a language that is not a tag', IPC_CHANNELS.setConfig, { language: '../../etc' }],
    ['setConfig with a theme that is not one', IPC_CHANNELS.setConfig, { theme: 'neon' }],
    ['capabilities.invoke with an empty id', IPC_CHANNELS.capabilitiesInvoke, { capabilityId: '', method: 'print' }],
    ['relaunch with a smuggled argument', IPC_CHANNELS.relaunch, { force: true }],
  ])('%s', async (_name, channel, payload) => {
    const { ipc } = harness();
    expect(expectFail(await ipc.invoke(channel, payload)).code).toBe('INVALID_PAYLOAD');
  });

  it('never lets an unparsed payload reach a port', async () => {
    const dialogs = stubDialogs();
    const { ipc } = harness({ dialogs });
    await ipc.invoke(IPC_CHANNELS.openFile, { kind: 'exe' });
    await ipc.invoke(IPC_CHANNELS.saveFile, { kind: 'backup', defaultName: '../x.zip' });
    expect(dialogs.openFile).not.toHaveBeenCalled();
    expect(dialogs.saveFile).not.toHaveBeenCalled();
  });

  /**
   * The own words: `config.json` "is the source of truth for values the server
   * cannot own because they affect how the server itself is launched". A
   * renderer that could write `dataDir` would repoint the app's storage; one
   * that could write `secretEncrypted` would own every encrypted DSN in the
   * meta-store. Five keys are settable, and `strictObject` is what makes
   * that list true rather than aspirational.
   */
  it.each([
    ['dataDir', { dataDir: '/tmp/evil' }],
    ['secretEncrypted', { secretEncrypted: 'AAAA' }],
    ['secretPlain', { secretPlain: 'hunter2' }],
    ['secretStorage', { secretStorage: 'plain' }],
    ['version', { version: 99 }],
    ['window', { window: { width: 1, height: 1, maximized: false } }],
  ])('setConfig refuses to write %s', async (_key, patch) => {
    const { ipc, writeConfig } = harness();
    expect(expectFail(await ipc.invoke(IPC_CHANNELS.setConfig, patch)).code).toBe('INVALID_PAYLOAD');
    expect(writeConfig).not.toHaveBeenCalled();
  });

  it('accepts the five keys', async () => {
    const { ipc, writeConfig } = harness();
    const patch = {
      singleUser: false,
      lanShare: { enabled: true, port: 4600 },
      updates: { mode: 'manual' },
      telemetryOptIn: true,
      autoBackup: { enabled: true, keep: 7 },
    };
    expectOk(await ipc.invoke(IPC_CHANNELS.setConfig, patch));
    expect(writeConfig).toHaveBeenCalledWith(patch);
  });

  it('accepts an empty patch as the no-op it is', async () => {
    const { ipc, writeConfig } = harness();
    expectOk(await ipc.invoke(IPC_CHANNELS.setConfig, {}));
    expect(writeConfig).toHaveBeenCalledWith({});
  });
});

// ─── Sender policy ───────────────────────────────────────────────────────────

describe('sender policy', () => {
  it.each([
    ['the loopback server on its random port', 'http://127.0.0.1:51234/', true],
    ['another loopback port (a restart)', 'http://127.0.0.1:60001/studio', true],
    ['the dev loop’s vite server', 'http://localhost:5173/', true],
    ['IPv6 loopback', 'http://[::1]:51234/', true],
    ['a 127.x.x.x address', 'http://127.1.2.3:80/', true],
    ['the bundled boot/crash pages', 'file:///opt/app/out/renderer/crash.html', true],
    ['a remote origin', 'https://evil.example/', false],
    ['a lookalike host', 'http://127.0.0.1.evil.example/', false],
    ['a host merely containing localhost', 'http://localhost.evil.example/', false],
    ['a LAN address (peers authenticate normally, they do not get the bridge)', 'http://192.168.1.9:4600/', false],
    ['a data: URL', 'data:text/html,<script>x</script>', false],
    ['garbage', 'not a url', false],
  ])('%s', (_name, url, allowed) => {
    expect(loopbackSenderPolicy(url)).toBe(allowed);
  });

  it('refuses a frame that is already gone', () => {
    expect(loopbackSenderPolicy(null)).toBe(false);
  });

  describe('pinned, in the packaged app', () => {
    let port: number | null = 51234;
    const pinned = pinnedSenderPolicy(() => port);

    it.each([
      ['the server main started', 'http://127.0.0.1:51234/design', true],
      ['the bundled boot/crash pages', 'file:///opt/app/out/renderer/crash.html', true],
      ['the preview’s name on the same port (pages a model wrote)', 'http://localhost:51234/a/repairs/', false],
      ['another Adminium on this machine', 'http://127.0.0.1:4600/', false],
      ['another Adminium on localhost', 'http://localhost:4600/', false],
      ['the same port over https', 'https://127.0.0.1:51234/', false],
      ['IPv6 loopback', 'http://[::1]:51234/', false],
      ['a lookalike host', 'http://127.0.0.1.evil.example:51234/', false],
      ['a blob minted on the app', 'blob:http://127.0.0.1:51234/abc', false],
      ['garbage', 'not a url', false],
    ])('%s', (_name, url, allowed) => {
      port = 51234;
      expect(pinned(url)).toBe(allowed);
    });

    it('follows a restart on a new port at once, and knows no server before one is up', () => {
      port = 60001;
      expect(pinned('http://127.0.0.1:60001/')).toBe(true);
      expect(pinned('http://127.0.0.1:51234/')).toBe(false);
      port = null;
      expect(pinned('http://127.0.0.1:60001/')).toBe(false);
      expect(pinned('file:///opt/app/out/renderer/crash.html')).toBe(true);
      expect(pinned(null)).toBe(false);
    });
  });

  it('classifies loopback hostnames', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('10.0.0.1')).toBe(false);
    expect(isLoopbackHostname('1127.0.0.1')).toBe(false);
  });

  it('refuses an untrusted frame before parsing or acting', async () => {
    const dialogs = stubDialogs();
    const { ipc } = harness({ dialogs });
    const remote: IpcInvokeEventLike = { senderFrame: { url: 'https://evil.example/' } };

    const result = await ipc.invoke(IPC_CHANNELS.openFile, { kind: 'sqlite' }, remote);

    expect(expectFail(result).code).toBe('UNTRUSTED_SENDER');
    expect(dialogs.openFile).not.toHaveBeenCalled();
  });

  it('refuses the bootstrap to an untrusted frame', () => {
    const { ipc } = harness();
    const event: IpcSyncEventLike = { senderFrame: { url: 'https://evil.example/' }, returnValue: undefined };
    const reply = ipc.sendSync(IPC_CHANNELS.bootstrap, event) as IpcResult<unknown>;
    expect(expectFail(reply).code).toBe('UNTRUSTED_SENDER');
  });

  it('treats a senderFrame that throws as no sender at all', async () => {
    const { ipc } = harness();
    // Electron's senderFrame is a getter over a live frame; reading it after the
    // frame is destroyed can throw rather than answer null.
    const detached = {
      get senderFrame(): never {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed');
      },
    } as unknown as IpcInvokeEventLike;
    expect(expectFail(await ipc.invoke(IPC_CHANNELS.showLogs, undefined, detached)).code).toBe(
      'UNTRUSTED_SENDER',
    );
  });

  it('honours an injected policy', async () => {
    const { ipc } = harness({ senderPolicy: () => false });
    expect(expectFail(await ipc.invoke(IPC_CHANNELS.showLogs)).code).toBe('UNTRUSTED_SENDER');
  });
});

// ─── getRuntimeInfo ──────────────────────────────────────────────────────────

describe('getRuntimeInfo', () => {
  it('reports the shape from the runtime and the config', async () => {
    const { ipc } = harness();
    expect(expectOk(await ipc.invoke(IPC_CHANNELS.getRuntimeInfo))).toEqual({
      dataDir: DATA_DIR,
      serverPort: 51234,
      singleUser: true,
      lanShare: { enabled: false, port: 4600, urls: [] },
      updates: { mode: 'notify' },
      secretStorage: 'safeStorage',
    });
  });

  it('reports `disabled` when the env kill-switch forced it, even if config says notify', async () => {
    // The fleet-admin case: `ADMINIUM_DISABLE_UPDATES=1` set, but `config.json`
    // kept the default `notify`. `main/index.ts` resolves the override into the
    // runtime snapshot, so the About panel shows the air-gapped state instead of
    // "Notify me about new versions" over an install that makes zero traffic.
    const { ipc } = harness({
      runtime: () => ({ ...RUNTIME, updatesDisabledByEnv: true }),
    });
    expect(expectOk(await ipc.invoke(IPC_CHANNELS.getRuntimeInfo))).toMatchObject({
      updates: { mode: 'disabled' },
    });
  });

  it('lists LAN URLs only while sharing is on', async () => {
    const lanShareUrls = vi.fn(() => ['http://192.168.1.9:4600']);
    const { ipc, config } = harness({ lanShareUrls });

    expect(expectOk(await ipc.invoke(IPC_CHANNELS.getRuntimeInfo))).toMatchObject({
      lanShare: { enabled: false, urls: [] },
    });
    // The addresses of this machine are not handed to a renderer that did not
    // ask to share them.
    expect(lanShareUrls).not.toHaveBeenCalled();

    config.lanShare = { enabled: true, port: 4600 };
    expect(expectOk(await ipc.invoke(IPC_CHANNELS.getRuntimeInfo))).toMatchObject({
      lanShare: { enabled: true, port: 4600, urls: ['http://192.168.1.9:4600'] },
    });
  });

  it('says UNAVAILABLE rather than inventing a runtime before boot', async () => {
    const { ipc } = harness({ runtime: () => null });
    expect(expectFail(await ipc.invoke(IPC_CHANNELS.getRuntimeInfo)).code).toBe('UNAVAILABLE');
  });
});

// ─── Updates ─────────────────────────────────────────────────────────────────

describe('updates', () => {
  it('routes the three methods to the manager', async () => {
    const updates = stubUpdates();
    const { ipc } = harness({ updates });

    expect(expectOk(await ipc.invoke(IPC_CHANNELS.checkForUpdates))).toEqual({
      status: 'available',
      version: '1.3.0',
    });
    expectOk(await ipc.invoke(IPC_CHANNELS.downloadUpdate));
    expectOk(await ipc.invoke(IPC_CHANNELS.quitAndInstall));

    expect(updates.downloadUpdate).toHaveBeenCalledOnce();
    expect(updates.quitAndInstall).toHaveBeenCalledOnce();
  });

  /**
   * `disabled` mode means the updater is never INITIALIZED — "not
   * initialized-then-not-asked" — which is why the port is nullable. The
   * acceptance criterion is zero non-loopback traffic; a manager that exists is
   * a manager that can check.
   */
  it.each([IPC_CHANNELS.checkForUpdates, IPC_CHANNELS.downloadUpdate, IPC_CHANNELS.quitAndInstall])(
    '%s answers UNAVAILABLE when updates are disabled',
    async (channel) => {
      const { ipc } = harness({ updates: null });
      expect(expectFail(await ipc.invoke(channel)).code).toBe('UNAVAILABLE');
    },
  );

  it('pushes onUpdateEvent payloads on the update channel', () => {
    const { handlers, broadcast } = harness();
    handlers.emitUpdateEvent({ type: 'progress', percent: 42 });
    expect(broadcast).toHaveBeenCalledWith(IPC_CHANNELS.updateEvent, {
      type: 'progress',
      percent: 42,
    });
  });
});

// ─── Capabilities ────────────────────────────────────────────────────────────

describe('capabilities', () => {
  it('lists descriptors', async () => {
    const { ipc } = harness();
    expect(expectOk(await ipc.invoke(IPC_CHANNELS.capabilitiesList))).toEqual([
      { id: 'printer.escpos', version: 1, status: 'stub', methods: ['print'] },
    ]);
  });

  it('routes an invoke with its payload untouched', async () => {
    const capabilities = stubCapabilities();
    const { ipc } = harness({ capabilities });
    expectOk(
      await ipc.invoke(IPC_CHANNELS.capabilitiesInvoke, {
        capabilityId: 'printer.escpos',
        method: 'print',
        payload: { copies: 2, lines: ['a'] },
      }),
    );
    expect(capabilities.invoke).toHaveBeenCalledWith('printer.escpos', 'print', {
      copies: 2,
      lines: ['a'],
    });
  });

  it('allows an absent payload — lets a method take none', async () => {
    const capabilities = stubCapabilities();
    const { ipc } = harness({ capabilities });
    expectOk(
      await ipc.invoke(IPC_CHANNELS.capabilitiesInvoke, {
        capabilityId: 'printer.escpos',
        method: 'listDevices',
      }),
    );
    expect(capabilities.invoke).toHaveBeenCalledWith('printer.escpos', 'listDevices', undefined);
  });

  /**
   * The rejections are a contract the SPA branches on ("ungranted invokes reject
   * with CAPABILITY_NOT_GRANTED... stub invokes reject with CAPABILITY_STUB" is
   * an acceptance criterion). They arrive as a code inside a message; they must
   * leave as a code.
   */
  it.each([CAPABILITY_NOT_GRANTED, CAPABILITY_STUB])('keeps %s a code, not prose', async (code) => {
    const capabilities = stubCapabilities();
    vi.mocked(capabilities.invoke).mockRejectedValue(
      new Error(`${code}: printer.escpos.print has no driver in this build.`),
    );
    const { ipc } = harness({ capabilities });

    const error = expectFail(
      await ipc.invoke(IPC_CHANNELS.capabilitiesInvoke, {
        capabilityId: 'printer.escpos',
        method: 'print',
        payload: null,
      }),
    );

    expect(error.code).toBe(code);
    // Stripped, because the preload re-applies the prefix when it rebuilds the
    // error — otherwise the renderer sees `CODE: CODE: …`.
    expect(error.message).toBe('printer.escpos.print has no driver in this build.');
  });
});

// ─── Failure shape ───────────────────────────────────────────────────────────

describe('a throwing port becomes a typed envelope, never an Electron rejection', () => {
  it('maps an unexpected throw to INTERNAL and keeps the message', async () => {
    const dialogs = stubDialogs();
    vi.mocked(dialogs.openFile).mockRejectedValue(new Error('EACCES: permission denied'));
    const { ipc } = harness({ dialogs });

    const result = await ipc.invoke(IPC_CHANNELS.openFile, { kind: 'sqlite' });

    expect(result.ok).toBe(false);
    expect(expectFail(result)).toEqual({ code: 'INTERNAL', message: 'EACCES: permission denied' });
  });

  it('does not leak a stack to the renderer', async () => {
    const dialogs = stubDialogs();
    vi.mocked(dialogs.openFile).mockRejectedValue(new Error('boom'));
    const { ipc } = harness({ dialogs });
    const error = expectFail(await ipc.invoke(IPC_CHANNELS.openFile, { kind: 'sqlite' }));
    expect(Object.keys(error).sort()).toEqual(['code', 'message']);
  });

  it('survives a port that throws a non-Error', async () => {
    const { relaunch, ipc } = harness();
    vi.mocked(relaunch).mockImplementation(() => {
      throw 'nope';
    });
    expect(expectFail(await ipc.invoke(IPC_CHANNELS.relaunch))).toEqual({
      code: 'INTERNAL',
      message: 'nope',
    });
  });

  it('logs refusals and failures rather than swallowing them', async () => {
    const log = vi.fn();
    const { ipc } = harness({ log });
    await ipc.invoke(IPC_CHANNELS.openFile, { kind: 'exe' });
    await ipc.invoke(IPC_CHANNELS.showLogs, undefined, { senderFrame: { url: 'https://evil.example' } });
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat().join('\n')).toMatch(/rejected[\s\S]*refused/);
  });

  it('maps error shapes', () => {
    expect(toErrorPayload(new Error('x'))).toEqual({ code: 'INTERNAL', message: 'x' });
    expect(toErrorPayload('x')).toEqual({ code: 'INTERNAL', message: 'x' });
    expect(toErrorPayload(new Error(`${CAPABILITY_STUB}: y`))).toEqual({
      code: CAPABILITY_STUB,
      message: 'y',
    });
  });
});

// ─── Routing ─────────────────────────────────────────────────────────────────

describe('dialogs and lifecycle route to their ports', () => {
  it('passes parsed dialog options through and returns the path', async () => {
    const { ipc, dialogs } = harness();

    expect(expectOk(await ipc.invoke(IPC_CHANNELS.openFile, { kind: 'schema' }))).toBe(
      '/tmp/opened.sqlite',
    );
    expect(dialogs.openFile).toHaveBeenCalledWith({ kind: 'schema' });

    expect(
      expectOk(await ipc.invoke(IPC_CHANNELS.saveFile, { kind: 'backup', defaultName: 'b.zip' })),
    ).toBe('/tmp/saved.zip');
    expect(dialogs.saveFile).toHaveBeenCalledWith({ kind: 'backup', defaultName: 'b.zip' });

    expect(expectOk(await ipc.invoke(IPC_CHANNELS.chooseDirectory, { title: 'Data' }))).toBe(
      '/tmp/dir',
    );
    expectOk(await ipc.invoke(IPC_CHANNELS.showItemInFolder, `${DATA_DIR}/meta.db`));
    expect(dialogs.showItemInFolder).toHaveBeenCalledWith(`${DATA_DIR}/meta.db`);
  });

  it('reveals a log path outside dataDir — have three legitimate trees', async () => {
    const { ipc, dialogs } = harness();
    expectOk(await ipc.invoke(IPC_CHANNELS.showItemInFolder, '/home/ava/.config/Adminium/logs'));
    expect(dialogs.showItemInFolder).toHaveBeenCalled();
  });

  it('routes relaunch and showLogs', async () => {
    const { ipc, relaunch, showLogs } = harness();
    expectOk(await ipc.invoke(IPC_CHANNELS.relaunch));
    expectOk(await ipc.invoke(IPC_CHANNELS.showLogs));
    expect(relaunch).toHaveBeenCalledOnce();
    expect(showLogs).toHaveBeenCalledOnce();
  });
});

// ─── the first screens ───────────────────────────────────────────────────────

describe('the first screens’ channels', () => {
  const OWN_PAGE: IpcInvokeEventLike = { senderFrame: { url: 'file:///Applications/Adminium.app/Contents/Resources/app.asar/out/renderer/app/index.html#/new' } };

  const service = (): StartService => ({
    state: vi.fn(() => ({ firstLaunch: true, recent: [], proposedParent: '/home/ava/Adminium', proposedParentDisplay: '~/Adminium', language: null, theme: 'system' as const })),
    judgeNewFolder: vi.fn(() => ({ ok: true as const, path: '/home/ava/Adminium/shop', displayPath: '~/Adminium/shop', warning: null })),
    chooseParent: vi.fn(() => Promise.resolve('/picked')),
    createProject: vi.fn(() => Promise.resolve({ status: 'created' as const, path: '/home/ava/Adminium/shop' })),
    makeProgress: vi.fn(() => ({ step: 'packages' as const, since: 1 })),
    chooseFolder: vi.fn(() => Promise.resolve({ path: '/p', displayPath: '/p' })),
    openProject: vi.fn(() => Promise.resolve({ status: 'opened' as const })),
    getPackages: vi.fn(() => Promise.resolve({ status: 'opened' as const })),
    resolveKey: vi.fn(() => Promise.resolve({ status: 'done' as const })),
    updateProject: vi.fn(() => Promise.resolve({ status: 'updated' as const })),
    updateApp: vi.fn(() => true),
    connect: vi.fn(() => Promise.resolve({ status: 'opened' as const, guests: [] })),
    guests: vi.fn(() => []),
    forgetGuest: vi.fn(() => Promise.resolve([])),
    forgetProject: vi.fn(() => Promise.resolve([])),
    locateProject: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
    useClassic: vi.fn(),
    trustNow: vi.fn(() => Promise.resolve()),
  });

  const PAYLOADS: Record<string, unknown> = {
    [IPC_CHANNELS.startState]: undefined,
    [IPC_CHANNELS.startJudgeNewFolder]: { parent: '/home/ava/Adminium', name: 'Shop' },
    [IPC_CHANNELS.startChooseParent]: { from: '/home/ava/Adminium', title: 'Where to keep it' },
    [IPC_CHANNELS.startCreateProject]: { parent: '/home/ava/Adminium', name: 'Shop', acceptWarning: true },
    [IPC_CHANNELS.startMakeProgress]: undefined,
    [IPC_CHANNELS.startChooseFolder]: { title: 'Open a folder' },
    [IPC_CHANNELS.startOpenProject]: { path: '/home/ava/Adminium/shop', agreed: true, seen: ['found', 'accounts'] },
    [IPC_CHANNELS.startResolveKey]: { path: '/home/ava/Adminium/shop', answer: 'env', title: 'Choose the .env file' },
    [IPC_CHANNELS.startUpdateProject]: { path: '/home/ava/Adminium/shop' },
    [IPC_CHANNELS.startUpdateApp]: undefined,
    [IPC_CHANNELS.startConnect]: { address: 'office-pc.local:4600', anyway: true },
    [IPC_CHANNELS.startGuests]: undefined,
    [IPC_CHANNELS.startForgetGuest]: 'http://office-pc.local:4600',
    [IPC_CHANNELS.startGetPackages]: { path: '/home/ava/Adminium/shop', land: 'dashboard' },
    [IPC_CHANNELS.startForgetProject]: '/home/ava/Adminium/shop',
    [IPC_CHANNELS.startLocateProject]: { path: '/home/ava/Adminium/shop', title: 'Where is Shop now?' },
    [IPC_CHANNELS.startUseClassic]: undefined,
  };

  it('are answered for the app’s own pages, each by its own call', async () => {
    const start = service();
    const h = harness({ start: () => start });
    for (const channel of START_CHANNELS) expectOk(await h.ipc.invoke(channel, PAYLOADS[channel], OWN_PAGE));
    expect(start.judgeNewFolder).toHaveBeenCalledWith({ parent: '/home/ava/Adminium', name: 'Shop' });
    expect(start.chooseParent).toHaveBeenCalledWith({ from: '/home/ava/Adminium', title: 'Where to keep it' });
    expect(start.createProject).toHaveBeenCalledWith({ parent: '/home/ava/Adminium', name: 'Shop', acceptWarning: true });
    expect(start.chooseFolder).toHaveBeenCalledWith({ title: 'Open a folder' });
    expect(start.openProject).toHaveBeenCalledWith({ path: '/home/ava/Adminium/shop', agreed: true, seen: ['found', 'accounts'] });
    expect(start.resolveKey).toHaveBeenCalledWith({ path: '/home/ava/Adminium/shop', answer: 'env', title: 'Choose the .env file' });
    expect(start.updateProject).toHaveBeenCalledWith({ path: '/home/ava/Adminium/shop' });
    expect(start.updateApp).toHaveBeenCalledTimes(1);
    expect(start.connect).toHaveBeenCalledWith({ address: 'office-pc.local:4600', anyway: true });
    expect(start.forgetGuest).toHaveBeenCalledWith('http://office-pc.local:4600');
    expect(start.forgetProject).toHaveBeenCalledWith('/home/ava/Adminium/shop');
    expect(start.locateProject).toHaveBeenCalledWith({ path: '/home/ava/Adminium/shop', title: 'Where is Shop now?' });
    expect(start.useClassic).toHaveBeenCalledTimes(1);
    expect(start.state).toHaveBeenCalledTimes(1);
  });

  it('leaves out what the page did not say rather than passing undefined', async () => {
    const start = service();
    const h = harness({ start: () => start });
    expectOk(await h.ipc.invoke(IPC_CHANNELS.startCreateProject, { parent: '/p', name: 'Shop' }, OWN_PAGE));
    expectOk(await h.ipc.invoke(IPC_CHANNELS.startOpenProject, { path: '/p' }, OWN_PAGE));
    expect(start.createProject).toHaveBeenCalledWith({ parent: '/p', name: 'Shop' });
    expect(start.openProject).toHaveBeenCalledWith({ path: '/p' });
  });

  it('are refused for a project’s dashboard, which holds the rest of the bridge: every one of them', async () => {
    const start = service();
    const log = vi.fn();
    const h = harness({ start: () => start, log });
    for (const channel of START_CHANNELS) {
      // The loopback page is trusted for the rest of the bridge…
      expect(expectFail(await h.ipc.invoke(channel, PAYLOADS[channel], APP_FRAME)).code).toBe('UNTRUSTED_SENDER');
      // …and a frame with no address at all is nobody.
      expect(expectFail(await h.ipc.invoke(channel, PAYLOADS[channel], { senderFrame: null })).code).toBe('UNTRUSTED_SENDER');
    }
    for (const call of Object.values(start)) expect(call).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not the app’s own'.replace('’', "'")));
  });

  it('say so when Start is not what the window holds', async () => {
    for (const h of [harness({ start: () => null }), harness()]) {
      expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.startState, undefined, OWN_PAGE)).code).toBe('UNAVAILABLE');
    }
  });

  it('refuse a path that is not absolute, a title that is empty, and a field nobody named', async () => {
    const start = service();
    const h = harness({ start: () => start });
    const bad: Array<[string, unknown]> = [
      [IPC_CHANNELS.startOpenProject, { path: 'relative/shop' }],
      [IPC_CHANNELS.startJudgeNewFolder, { parent: '../up', name: 'Shop' }],
      [IPC_CHANNELS.startChooseFolder, { title: '' }],
      [IPC_CHANNELS.startCreateProject, { parent: '/p', name: 'Shop', extra: true }],
      [IPC_CHANNELS.startForgetProject, 42],
      [IPC_CHANNELS.startUseClassic, { anything: 1 }],
    ];
    for (const [channel, payload] of bad) expect(expectFail(await h.ipc.invoke(channel, payload, OWN_PAGE)).code).toBe('INVALID_PAYLOAD');
    expect(start.openProject).not.toHaveBeenCalled();
    expect(start.createProject).not.toHaveBeenCalled();
  });

  it('the own-page rule is the file: scheme and nothing else', () => {
    expect(ownPagePolicy('file:///opt/Adminium/resources/app.asar/out/renderer/app/index.html')).toBe(true);
    expect(ownPagePolicy('http://127.0.0.1:4700/design')).toBe(false);
    expect(ownPagePolicy('https://example.com/file://')).toBe(false);
    expect(ownPagePolicy(null)).toBe(false);
  });
});

// ─── the project this window holds ───────────────────────────────────────────

describe('the project’s channels', () => {
  const INFO = { root: '/home/ava/Adminium/shop', displayPath: '~/Adminium/shop', name: 'Shop', mode: 'design' as const };

  it('say what the window holds, without the folder’s real path', async () => {
    const h = harness({ project: { info: () => INFO, close: () => Promise.resolve(true) } });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectInfo))).toEqual({ name: 'Shop', displayPath: '~/Adminium/shop', mode: 'design' });
  });

  it('answer null in the classic workspace, and refuse the two that act', async () => {
    for (const h of [harness(), harness({ project: { info: () => null, close: () => Promise.resolve(true) } })]) {
      expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectInfo))).toBeNull();
      expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectShowInFolder)).code).toBe('UNAVAILABLE');
      expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectClose)).code).toBe('UNAVAILABLE');
      expect(h.dialogs.showItemInFolder).not.toHaveBeenCalled();
    }
  });

  it('show the project’s own folder, whatever the page sends', async () => {
    const h = harness({ project: { info: () => INFO, close: () => Promise.resolve(true) } });
    expectOk(await h.ipc.invoke(IPC_CHANNELS.projectShowInFolder));
    expect(h.dialogs.showItemInFolder).toHaveBeenCalledWith('/home/ava/Adminium/shop');
    // No call takes a path: a page cannot aim one at another folder.
    expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectShowInFolder, '/etc')).code).toBe('INVALID_PAYLOAD');
    expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectClose, { path: '/etc' })).code).toBe('INVALID_PAYLOAD');
    expect(h.dialogs.showItemInFolder).toHaveBeenCalledTimes(1);
  });

  it('close it, and say whether the person kept working', async () => {
    const close = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const h = harness({ project: { info: () => INFO, close } });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectClose))).toBe(true);
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectClose))).toBe(false);
  });

  it('take the quit and close questions’ words whole, bounded, and never from a stranger', async () => {
    const setStopWords = vi.fn();
    const h = harness({ project: { info: () => INFO, close: () => Promise.resolve(true), setStopWords } });
    const words = { turn: 'a', start: 'b', save: 'c', restore: 'd', style: 'e', other: 'f', quitDetail: 'g', closeDetail: 'h', quitAnyway: 'i', closeAnyway: 'j', keepWorking: 'k', shareDetail: 'l', shareAnyway: 'm' };
    expectOk(await h.ipc.invoke(IPC_CHANNELS.projectStopWords, words));
    expect(setStopWords).toHaveBeenCalledWith(words);
    // A native dialog's words: all of them, each of a sentence's length, and nothing else.
    expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectStopWords, { ...words, turn: undefined })).code).toBe('INVALID_PAYLOAD');
    expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectStopWords, { ...words, turn: 'x'.repeat(301) })).code).toBe('INVALID_PAYLOAD');
    expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectStopWords, { ...words, extra: 'x' })).code).toBe('INVALID_PAYLOAD');
    expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectStopWords, words, { senderFrame: { url: 'https://example.com/' } })).code).toBe('UNTRUSTED_SENDER');
    expect(setStopWords).toHaveBeenCalledTimes(1);
    // A build with nowhere to keep them answers all the same.
    expectOk(await harness().ipc.invoke(IPC_CHANNELS.projectStopWords, words));
  });

  it('carry the export: a kind and a title, never where the file goes', async () => {
    const exporting = {
      run: vi.fn(() => Promise.resolve({ status: 'saved' as const, file: 'shop.zip', megabytes: 4.2 })),
      takeResult: vi.fn(() => ({ status: 'saved' as const, file: 'shop.zip', megabytes: 4.2 })),
      show: vi.fn(() => Promise.resolve()),
    };
    const h = harness({ project: { info: () => INFO, close: () => Promise.resolve(true), exporting: () => exporting } });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectExport, { kind: 'everything', title: 'Export Shop' }))).toEqual({ status: 'saved', file: 'shop.zip', megabytes: 4.2 });
    expect(exporting.run).toHaveBeenCalledWith({ kind: 'everything', title: 'Export Shop' });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectExportResult))).toMatchObject({ status: 'saved' });
    expectOk(await h.ipc.invoke(IPC_CHANNELS.projectShowExport));
    expect(exporting.show).toHaveBeenCalledTimes(1);
    // A page cannot say where the file is written, nor ask for a kind there is none of.
    expectOk(await h.ipc.invoke(IPC_CHANNELS.projectExport, { kind: 'apps', title: 't', from: '/design/ds_abc?x=1' }));
    expect(exporting.run).toHaveBeenLastCalledWith({ kind: 'apps', title: 't', from: '/design/ds_abc?x=1' });
    for (const bad of [{ kind: 'apps', title: 't', from: '//evil.example/x' }, { kind: 'apps', title: 't', from: 'https://evil.example/' }, { kind: 'apps', title: 't', from: '/x#designToken=1' }, { kind: 'everything', title: 't', to: '/etc/cron.d/x' }, { kind: 'secrets', title: 't' }, { kind: 'apps' }, undefined]) {
      expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectExport, bad)).code).toBe('INVALID_PAYLOAD');
    }
    expect(exporting.run).toHaveBeenCalledTimes(2);
    const stranger: IpcInvokeEventLike = { senderFrame: { url: 'https://example.com/' } };
    for (const channel of [IPC_CHANNELS.projectExport, IPC_CHANNELS.projectExportResult, IPC_CHANNELS.projectShowExport]) expect(expectFail(await h.ipc.invoke(channel, { kind: 'apps', title: 't' }, stranger)).code).toBe('UNTRUSTED_SENDER');
    const none = harness();
    expect(expectOk(await none.ipc.invoke(IPC_CHANNELS.projectExportResult))).toBeNull();
    expect(expectFail(await none.ipc.invoke(IPC_CHANNELS.projectExport, { kind: 'apps', title: 't' })).code).toBe('UNAVAILABLE');
    expect(expectFail(await none.ipc.invoke(IPC_CHANNELS.projectShowExport)).code).toBe('UNAVAILABLE');
  });

  it('carry Build and Share for the project’s page and for the app’s own, and nothing when there is no project', async () => {
    const INFO_SHARED = { name: 'Shop', port: 4712, addresses: [{ url: 'http://office.local:4712', via: null, best: true }], changedFrom: null, language: null, theme: 'system' as const };
    const sharing = {
      share: vi.fn(() => Promise.resolve({ status: 'shared' as const })),
      build: vi.fn(() => Promise.resolve(true)),
      info: vi.fn(() => INFO_SHARED),
      showShared: vi.fn(() => Promise.resolve()),
      openDashboard: vi.fn(() => Promise.resolve()),
    };
    const h = harness({ project: { info: () => INFO, close: () => Promise.resolve(true), sharing: () => sharing } });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectShare))).toEqual({ status: 'shared' });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectBuild))).toBe(true);
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectShareInfo))).toEqual(INFO_SHARED);
    expectOk(await h.ipc.invoke(IPC_CHANNELS.projectShowShared));
    expectOk(await h.ipc.invoke(IPC_CHANNELS.projectOpenDashboard));
    for (const call of Object.values(sharing)) expect(call).toHaveBeenCalledTimes(1);
    // The app's own page (the sharing details) may ask too.
    const own: IpcInvokeEventLike = { senderFrame: { url: 'file:///Applications/Adminium.app/Contents/Resources/app.asar/out/renderer/app/index.html#/shared' } };
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.projectBuild, undefined, own))).toBe(true);
    // No call takes anything: a page cannot say what is shared, or where.
    expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.projectShare, { host: '0.0.0.0' })).code).toBe('INVALID_PAYLOAD');
    const stranger: IpcInvokeEventLike = { senderFrame: { url: 'https://example.com/' } };
    for (const channel of SHARE_CHANNELS) expect(expectFail(await h.ipc.invoke(channel, undefined, stranger)).code).toBe('UNTRUSTED_SENDER');
    // No project, or a build that cannot share: "is it shared?" answers no, the rest are unavailable.
    for (const none of [harness(), harness({ project: { info: () => INFO, close: () => Promise.resolve(true), sharing: () => null } })]) {
      expect(expectOk(await none.ipc.invoke(IPC_CHANNELS.projectShareInfo))).toBeNull();
      for (const channel of [IPC_CHANNELS.projectShare, IPC_CHANNELS.projectBuild, IPC_CHANNELS.projectShowShared, IPC_CHANNELS.projectOpenDashboard]) expect(expectFail(await none.ipc.invoke(channel)).code).toBe('UNAVAILABLE');
    }
  });

  it('carry the versions offer of the project that is open, and nothing when there is none', async () => {
    const STATE = { on: false, declined: false, megabytes: 62, appleTools: true, download: { phase: 'idle' as const } };
    const offer = {
      state: vi.fn(() => STATE),
      download: vi.fn(() => ({ ...STATE, download: { phase: 'downloading' as const, received: 0, total: 62 } })),
      cancel: vi.fn(() => STATE),
      notNow: vi.fn(() => Promise.resolve({ ...STATE, declined: true })),
      lookAgain: vi.fn(() => Promise.resolve({ ...STATE, on: true })),
      appleTools: vi.fn(() => Promise.resolve(STATE)),
      dispose: vi.fn(),
    };
    const h = harness({ project: { info: () => INFO, close: () => Promise.resolve(true), versions: () => offer } });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.versionsState))).toEqual(STATE);
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.versionsDownload))).toMatchObject({ download: { phase: 'downloading' } });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.versionsCancel))).toEqual(STATE);
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.versionsNotNow))).toMatchObject({ declined: true });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.versionsLookAgain))).toMatchObject({ on: true });
    expect(expectOk(await h.ipc.invoke(IPC_CHANNELS.versionsAppleTools))).toEqual(STATE);
    for (const call of [offer.state, offer.download, offer.cancel, offer.notNow, offer.lookAgain, offer.appleTools]) expect(call).toHaveBeenCalledTimes(1);
    // A page cannot say what is fetched or from where: no call takes anything.
    expect(expectFail(await h.ipc.invoke(IPC_CHANNELS.versionsDownload, { url: 'https://example.com/git.tar.gz' })).code).toBe('INVALID_PAYLOAD');
    expect(offer.download).toHaveBeenCalledTimes(1);

    const stranger: IpcInvokeEventLike = { senderFrame: { url: 'https://example.com/' } };
    for (const channel of VERSIONS_CHANNELS) expect(expectFail(await h.ipc.invoke(channel, undefined, stranger)).code).toBe('UNTRUSTED_SENDER');
    // The classic workspace, a build with no offer, and a project whose offer is gone: unavailable, each.
    for (const none of [harness(), harness({ project: { info: () => INFO, close: () => Promise.resolve(true) } }), harness({ project: { info: () => INFO, close: () => Promise.resolve(true), versions: () => null } })]) {
      for (const channel of VERSIONS_CHANNELS) expect(expectFail(await none.ipc.invoke(channel)).code).toBe('UNAVAILABLE');
    }
  });

  it('are refused to a page that is not the app’s', async () => {
    const h = harness({ project: { info: () => INFO, close: () => Promise.resolve(true) } });
    const stranger: IpcInvokeEventLike = { senderFrame: { url: 'https://example.com/' } };
    for (const channel of [IPC_CHANNELS.projectInfo, IPC_CHANNELS.projectShowInFolder, IPC_CHANNELS.projectClose]) {
      expect(expectFail(await h.ipc.invoke(channel, undefined, stranger)).code).toBe('UNTRUSTED_SENDER');
    }
  });
});
