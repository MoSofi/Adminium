// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The preload bridge (11-electron.md §4).
 *
 * COMPILED TO CommonJS, deliberately (see electron.vite.config.ts's `preload`
 * block): §2.4 mandates `sandbox: true`, and a sandboxed preload is loaded by
 * Electron's own limited `require` shim rather than by Node's module loader — it
 * cannot be an ES module. The bundle is emitted as `out/preload/index.cjs`.
 *
 * ─── What may cross, and why the list is closed ──────────────────────────────
 *
 * §2.4 makes the renderer the untrusted side of this boundary
 * (`contextIsolation` on, `sandbox` on, `nodeIntegration` off), which makes this
 * file the only door out of it that runs with main-process authority. So what
 * `contextBridge` receives is an object literal of explicitly listed,
 * individually typed methods — never `ipcRenderer`, never a node primitive, and
 * never a `send(channel, …)`-shaped function, which is the same thing as
 * `ipcRenderer` wearing a hat: it would let a compromised renderer reach every
 * channel any part of this app ever registers, including ones added by a future
 * track that assumed nobody could call them.
 *
 * Each method below closes over ONE channel constant and does nothing else. That
 * is the property worth preserving in review: the bridge cannot be talked into
 * addressing a channel that is not in `IPC_CHANNELS`, so `src/main/ipc.ts`'s
 * handler list is the complete list of what a renderer can reach.
 *
 * ─── The detection contract is an ACT, not a value ───────────────────────────
 *
 * §4: the SPA treats `window.adminiumDesktop !== undefined` as "running in the
 * desktop shell", while the server independently reports `runtime: "desktop"` in
 * `GET /api/v1/system/info`, and "both must agree". Exposing this object is
 * therefore a claim about the runtime — it must happen exactly when this really
 * is the desktop shell, which is what {@link isElectronPreload} guards, and it
 * must not happen half-way (see {@link readBootstrap}). The key must not be
 * renamed without 08-server-api.md.
 */

import { contextBridge, ipcRenderer } from 'electron';

import type {
  AdminiumDesktopApi,
  CapabilityDescriptor,
  ChooseDirectoryOptions,
  DesktopBridgeErrorLike,
  DesktopBundledTextKind,
  DesktopConfigPatch,
  DesktopDiagnostics,
  DesktopErrorCode,
  DesktopMenuLabels,
  DesktopRuntimeInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateEvent,
  OpenFileOptions,
  SaveFileOptions,
  SetDataDirOptions,
  SetDataDirResult,
  Unsubscribe,
} from './api.js';
import {
  BRIDGE_KEY,
  IPC_CHANNELS,
  type BridgeBootstrap,
  type IpcErrorPayload,
  type IpcResult,
} from './channels.js';

export { BRIDGE_KEY } from './channels.js';

/**
 * What this file needs from `ipcRenderer`, and no more.
 *
 * A port rather than the real object because the desktop suites run in plain
 * Node (vitest.config.ts) — but also because writing the four members down is
 * the cheapest possible statement of how much of Electron reaches the renderer:
 * four functions, none of them exposed.
 */
export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  sendSync(channel: string, ...args: unknown[]): unknown;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}

export interface PreloadDeps {
  ipc: IpcRendererLike;
  /** §4's `platform` + `versions`, read once — see {@link readBootstrap}. */
  bootstrap: BridgeBootstrap;
  /** `contextBridge.exposeInMainWorld`, injectable so the expose is assertable. */
  expose: (key: string, api: AdminiumDesktopApi) => void;
}

/**
 * A bridge rejection (§4's error contract; `DesktopBridgeErrorLike` in api.d.ts).
 *
 * The code goes in the message as well as on the property, because
 * `contextBridge` copies errors between two V8 contexts with only the standard
 * fields guaranteed — a custom `code` may not survive the crossing, while the
 * message always does. §12 already relies on exactly this shape
 * (`printer-escpos.ts` rejects with `` `${CAPABILITY_STUB}: …` ``).
 */
export class DesktopBridgeError extends Error implements DesktopBridgeErrorLike {
  readonly code: DesktopErrorCode;

  constructor(code: DesktopErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'DesktopBridgeError';
    this.code = code;
  }
}

/** Narrow a reply to the {@link IpcResult} envelope without trusting it. */
function isEnvelope(raw: unknown): raw is IpcResult<unknown> {
  if (typeof raw !== 'object' || raw === null || !('ok' in raw)) return false;
  const candidate = raw as { ok: unknown; error?: unknown };
  if (candidate.ok === true) return true;
  if (candidate.ok !== false) return false;
  const error = candidate.error as IpcErrorPayload | undefined;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  );
}

/**
 * Turn a handler's envelope back into a value or a rejection.
 *
 * The cast on the success branch is the one this file cannot avoid: a reply
 * arrives from another process as `unknown`, and the type that says what it is
 * lives in `src/main/ipc.ts`, where the handler that produced it is checked
 * against this same `AdminiumDesktopApi`. Both ends are typed against one
 * contract; the wire between them is not typed at all, and re-validating here
 * would put a zod parser in the sandboxed preload to second-guess data the
 * trusted side just produced.
 */
async function unwrap<T>(pending: Promise<unknown>): Promise<T> {
  const raw = await pending;
  if (!isEnvelope(raw)) {
    throw new DesktopBridgeError(
      'INTERNAL',
      'The main process replied with something that is not a bridge result.',
    );
  }
  if (raw.ok) return raw.value as T;
  throw new DesktopBridgeError(raw.error.code, raw.error.message);
}

/**
 * Read §4's two synchronous properties before any page script runs.
 *
 * THROWS rather than degrading, and the reason is the detection contract: a
 * bridge exposed with a made-up app version would be a `window.adminiumDesktop`
 * that exists and lies — §13's About screen would render the lie, and §4's "both
 * must agree" would not catch it, because the bridge is present. A bridge that
 * fails to build instead surfaces as Electron's "Unable to load preload script"
 * in the main log, and the SPA correctly reports "not the desktop shell".
 * Reaching that state at all means `registerIpcHandlers()` did not run before
 * the window was created — a wiring bug in the boot sequence, not a condition a
 * user can produce.
 */
export function readBootstrap(ipc: IpcRendererLike): BridgeBootstrap {
  const raw = ipc.sendSync(IPC_CHANNELS.bootstrap);
  if (!isEnvelope(raw) || !raw.ok) {
    throw new Error(
      `The Adminium desktop bridge could not read its bootstrap over ${IPC_CHANNELS.bootstrap}. ` +
        'registerIpcHandlers() must run before any BrowserWindow is created.',
    );
  }
  const value = raw.value as Partial<BridgeBootstrap> | null;
  const platform = value?.platform;
  const versions = value?.versions;
  if (
    (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') ||
    typeof versions !== 'object' ||
    versions === null ||
    typeof versions.app !== 'string'
  ) {
    throw new Error('The Adminium desktop bridge received a malformed bootstrap payload.');
  }
  return { platform, versions };
}

/**
 * §4's `AdminiumDesktopApi`, over `ipcRenderer` — the whole bridge.
 *
 * The return type is the contract itself, so `api.d.ts` is what typechecks this
 * function: a method the SPA can see and this file lacks is a compile error, and
 * so is a payload that drifted. That is the entire reason the dashboard can be
 * typed against a package it does not import.
 */
export function createDesktopApi(deps: Pick<PreloadDeps, 'ipc' | 'bootstrap'>): AdminiumDesktopApi {
  const { ipc } = deps;

  return {
    platform: deps.bootstrap.platform,
    versions: deps.bootstrap.versions,

    openFile: (opts: OpenFileOptions): Promise<string | null> =>
      unwrap(ipc.invoke(IPC_CHANNELS.openFile, opts)),

    saveFile: (opts: SaveFileOptions): Promise<string | null> =>
      unwrap(ipc.invoke(IPC_CHANNELS.saveFile, opts)),

    showItemInFolder: (path: string): Promise<void> =>
      unwrap(ipc.invoke(IPC_CHANNELS.showItemInFolder, path)),

    chooseDirectory: (opts: ChooseDirectoryOptions): Promise<string | null> =>
      unwrap(ipc.invoke(IPC_CHANNELS.chooseDirectory, opts)),

    getRuntimeInfo: (): Promise<DesktopRuntimeInfo> =>
      unwrap(ipc.invoke(IPC_CHANNELS.getRuntimeInfo)),

    setConfig: (patch: DesktopConfigPatch): Promise<void> =>
      unwrap(ipc.invoke(IPC_CHANNELS.setConfig, patch)),

    setDataDir: (opts: SetDataDirOptions): Promise<SetDataDirResult> =>
      unwrap(ipc.invoke(IPC_CHANNELS.setDataDir, opts)),

    checkForUpdates: (): Promise<DesktopUpdateCheckResult> =>
      unwrap(ipc.invoke(IPC_CHANNELS.checkForUpdates)),

    downloadUpdate: (): Promise<void> => unwrap(ipc.invoke(IPC_CHANNELS.downloadUpdate)),

    quitAndInstall: (): Promise<void> => unwrap(ipc.invoke(IPC_CHANNELS.quitAndInstall)),

    /**
     * The only subscription in §4, and the only place a renderer function is
     * held by the preload. It is CALLED, never forwarded to `ipcMain` — the main
     * process pushes to a channel, it does not take a callback, so no renderer
     * function ever reaches the main process.
     */
    onUpdateEvent(cb: (e: DesktopUpdateEvent) => void): Unsubscribe {
      const listener = (_event: unknown, payload: unknown): void => {
        cb(payload as DesktopUpdateEvent);
      };
      ipc.on(IPC_CHANNELS.updateEvent, listener);
      return () => {
        ipc.removeListener(IPC_CHANNELS.updateEvent, listener);
      };
    },

    capabilities: {
      list: (): Promise<CapabilityDescriptor[]> => unwrap(ipc.invoke(IPC_CHANNELS.capabilitiesList)),
      /**
       * §12's payload is `unknown` by contract — the capability decides its own
       * shape. It stays `unknown` all the way to the provider: this bridge does
       * not know what a receipt printer's `print` takes, and a schema here would
       * be a second, and eventually wrong, copy of the provider's.
       */
      invoke: (capabilityId: string, method: string, payload: unknown): Promise<unknown> =>
        unwrap(ipc.invoke(IPC_CHANNELS.capabilitiesInvoke, { capabilityId, method, payload })),
    },

    setMenuLabels: (labels: DesktopMenuLabels): Promise<void> =>
      unwrap(ipc.invoke(IPC_CHANNELS.setMenuLabels, labels)),

    getDiagnostics: (): Promise<DesktopDiagnostics> =>
      unwrap(ipc.invoke(IPC_CHANNELS.getDiagnostics)),

    readBundledText: (kind: DesktopBundledTextKind): Promise<string | null> =>
      unwrap(ipc.invoke(IPC_CHANNELS.readBundledText, kind)),

    relaunch: (): Promise<void> => unwrap(ipc.invoke(IPC_CHANNELS.relaunch)),

    showLogs: (): Promise<void> => unwrap(ipc.invoke(IPC_CHANNELS.showLogs)),
  };
}

/** §4, the one exposure: one key, one object, nothing else. */
export function exposeBridge(deps: PreloadDeps): void {
  deps.expose(BRIDGE_KEY, createDesktopApi(deps));
}

/** The real ports. Never called under vitest — see {@link isElectronPreload}. */
export function electronPreloadDeps(): PreloadDeps {
  return {
    ipc: ipcRenderer,
    bootstrap: readBootstrap(ipcRenderer),
    expose: (key, api) => {
      contextBridge.exposeInMainWorld(key, api);
    },
  };
}

/**
 * True only in a real Electron renderer. Mirrors `main/index.ts`'s
 * `isElectronMain()`: `process.type` is set by Electron itself (`renderer` in a
 * window's processes, `browser` in main, `utility` in a utilityProcess) and is
 * undefined under plain Node — a fact about the runtime rather than an env-var
 * convention a test could get wrong. Without the guard, importing this module in
 * a unit test would try to expose a bridge into a window that does not exist.
 */
export function isElectronPreload(): boolean {
  return process.versions.electron !== undefined && process.type === 'renderer';
}

if (isElectronPreload()) {
  exposeBridge(electronPreloadDeps());
}
