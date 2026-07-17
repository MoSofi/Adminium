/**
 * The main-process half of the §4 bridge, driven through a fake `ipcMain`.
 *
 * These tests exist because of one asymmetry: everything the handlers do
 * correctly is visible the first time a feature is used, and everything they
 * fail to REFUSE is invisible until someone refuses it for us. So the weight is
 * on the refusals — a payload zod should have rejected, a key that must not be
 * settable, a sender that must not be served, an updater that must not exist —
 * and on the shape of a failure, since §12's typed codes are the SPA's control
 * flow and not decoration.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  INVOKE_CHANNELS,
  IPC_CHANNELS,
  type BridgeBootstrap,
  type IpcResult,
} from '../preload/channels.js';
import { CAPABILITY_NOT_GRANTED, CAPABILITY_STUB, type CapabilityHost } from './capabilities/host.js';
import { createDefaultConfig, type DesktopConfig } from './config.js';
import {
  isLoopbackHostname,
  loopbackSenderPolicy,
  registerIpcHandlers,
  toErrorPayload,
  type DesktopDialogs,
  type DesktopRuntimeSnapshot,
  type IpcInvokeEventLike,
  type IpcMainLike,
  type IpcSyncEventLike,
  type RegisterIpcHandlersOptions,
} from './ipc.js';
import type { SetDataDirResult } from '../preload/api.js';
import type { UpdateManager } from './updates.js';

// ─── Fakes ───────────────────────────────────────────────────────────────────

const BOOTSTRAP: BridgeBootstrap = {
  platform: 'linux',
  versions: { app: '1.2.3', electron: '43.1.1', chrome: '140.0.0', node: '22.19.0' },
};

const DATA_DIR = '/home/ava/.local/share/Adminium/data';

/** A frame at the loopback origin — what the SPA always is (§2.2 step 8). */
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
 * `updates` is the RESOLVED manager (or null), not the getter §11 wires — the
 * boot creates the manager after config load and `ipc.ts` reads it through a
 * `() => UpdateManager | null` port. The harness takes the value for readability
 * and wraps it in the getter below, so the disabled case is `{ updates: null }`.
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
    // §11: the resolved manager wrapped as the getter `ipc.ts` reads. Placed
    // AFTER the spread so it wins over `overrides.updates` (which carries the
    // VALUE the harness took for readability, not the getter the port wants).
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
  it('answers every §4 channel and nothing else', () => {
    const { ipc } = harness();
    // The registered `invoke` handlers are EXACTLY `INVOKE_CHANNELS` — the same
    // list `dispose()` tears down, so this pins the two together: a channel added
    // to `INVOKE_CHANNELS` without a `register()` call fails here, and one
    // registered but left off the list leaks a handler `dispose()` never removes.
    // Asserting against that source of truth (rather than a second hand-kept copy)
    // is also what lets parallel tracks add channels — §11 updates, §12
    // capabilities, §13 diagnostics, §14 `setMenuLabels` — without this test going
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

  it('answers the bootstrap synchronously with §4 platform + versions', () => {
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
   * §2.3's own words: `config.json` "is the source of truth for values the
   * server cannot own because they affect how the server itself is launched".
   * A renderer that could write `dataDir` would repoint the app's storage; one
   * that could write `secretEncrypted` would own every encrypted DSN in the
   * meta-store. §4 lists five settable keys, and `strictObject` is what makes
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

  it('accepts the five §4 keys', async () => {
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

// ─── Sender policy (§2.4) ────────────────────────────────────────────────────

describe('sender policy', () => {
  it.each([
    ['the loopback server on its random port', 'http://127.0.0.1:51234/', true],
    ['another loopback port (a restart, §2.2 step 9)', 'http://127.0.0.1:60001/studio', true],
    ['the §3 dev loop’s vite server', 'http://localhost:5173/', true],
    ['IPv6 loopback', 'http://[::1]:51234/', true],
    ['a 127.x.x.x address', 'http://127.1.2.3:80/', true],
    ['the bundled boot/crash pages (§2.2 steps 6 + 9)', 'file:///opt/app/out/renderer/crash.html', true],
    ['a remote origin', 'https://evil.example/', false],
    ['a lookalike host', 'http://127.0.0.1.evil.example/', false],
    ['a host merely containing localhost', 'http://localhost.evil.example/', false],
    ['a LAN address (§8.3 peers authenticate normally, they do not get the bridge)', 'http://192.168.1.9:4600/', false],
    ['a data: URL', 'data:text/html,<script>x</script>', false],
    ['garbage', 'not a url', false],
  ])('%s', (_name, url, allowed) => {
    expect(loopbackSenderPolicy(url)).toBe(allowed);
  });

  it('refuses a frame that is already gone', () => {
    expect(loopbackSenderPolicy(null)).toBe(false);
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

// ─── getRuntimeInfo (§4) ─────────────────────────────────────────────────────

describe('getRuntimeInfo', () => {
  it('reports the §4 shape from the runtime and the config', async () => {
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

  it('reports `disabled` when the env kill-switch forced it, even if config says notify (§11)', async () => {
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

  it('lists LAN URLs only while sharing is on (§8.3)', async () => {
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

// ─── Updates (§11) ───────────────────────────────────────────────────────────

describe('updates', () => {
  it('routes the three §4 methods to the manager', async () => {
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
   * §11's `disabled` mode means the updater is never INITIALIZED — "not
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

  it('pushes §4 onUpdateEvent payloads on the update channel', () => {
    const { handlers, broadcast } = harness();
    handlers.emitUpdateEvent({ type: 'progress', percent: 42 });
    expect(broadcast).toHaveBeenCalledWith(IPC_CHANNELS.updateEvent, {
      type: 'progress',
      percent: 42,
    });
  });
});

// ─── Capabilities (§12) ──────────────────────────────────────────────────────

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

  it('allows an absent payload — §12 lets a method take none', async () => {
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
   * §12's rejections are a contract the SPA branches on ("ungranted invokes
   * reject with CAPABILITY_NOT_GRANTED ... stub invokes reject with
   * CAPABILITY_STUB" is an acceptance criterion). They arrive as a code inside a
   * message; they must leave as a code.
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

  it('reveals a log path outside dataDir — §9/§13 have three legitimate trees', async () => {
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
