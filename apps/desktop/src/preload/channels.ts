// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The renderer ↔ main wire contract for the §4 bridge: channel names and the
 * result envelope.
 *
 * Shared by BOTH ends — `src/preload/index.ts` (which invokes) and
 * `src/main/ipc.ts` (which handles) — for the reason `src/server/protocol.ts`
 * gives about the fork handshake: a contract declared twice is a contract that
 * eventually disagrees with itself. A channel name typo is worse here than
 * there, because `ipcRenderer.invoke` on an unhandled channel rejects with
 * Electron's own "No handler registered" prose, which looks exactly like a bug
 * in the feature rather than in the wiring.
 *
 * PURE. No zod, no `node:`, no `electron`. The preload bundle is CommonJS loaded
 * by Electron's sandbox `require` shim (§2.4 → electron.vite.config.ts), so
 * every byte reachable from it is bundled into it; keeping this file to strings
 * and types keeps the preload to what it should be — a wire, not a program.
 * Validation lives in `src/main/ipc.ts`, on the side that does not trust the
 * other one.
 */

import type { DesktopErrorCode, DesktopPlatform, DesktopVersions } from './api.js';

/**
 * §4's namespace on `window`, and the whole of the detection contract ("the SPA
 * treats `window.adminiumDesktop !== undefined` as running in the desktop
 * shell"). One constant because three files and the dashboard all name it.
 */
export const BRIDGE_KEY = 'adminiumDesktop';

/**
 * One channel per §4 method. Prefixed and hyphenated so a channel can never
 * collide with a channel some dependency registers on the same `ipcMain`.
 *
 * `bootstrap` is the exception that is not a §4 method: see
 * {@link BridgeBootstrap}.
 */
export const IPC_CHANNELS = {
  bootstrap: 'adminium-desktop:bootstrap',
  openFile: 'adminium-desktop:open-file',
  saveFile: 'adminium-desktop:save-file',
  showItemInFolder: 'adminium-desktop:show-item-in-folder',
  chooseDirectory: 'adminium-desktop:choose-directory',
  getRuntimeInfo: 'adminium-desktop:get-runtime-info',
  setConfig: 'adminium-desktop:set-config',
  setDataDir: 'adminium-desktop:set-data-dir',
  checkForUpdates: 'adminium-desktop:check-for-updates',
  downloadUpdate: 'adminium-desktop:download-update',
  quitAndInstall: 'adminium-desktop:quit-and-install',
  capabilitiesList: 'adminium-desktop:capabilities-list',
  capabilitiesInvoke: 'adminium-desktop:capabilities-invoke',
  setMenuLabels: 'adminium-desktop:set-menu-labels',
  getDiagnostics: 'adminium-desktop:get-diagnostics',
  readBundledText: 'adminium-desktop:read-bundled-text',
  relaunch: 'adminium-desktop:relaunch',
  showLogs: 'adminium-desktop:show-logs',
  /** main → renderer push, §4 `onUpdateEvent`. The only one-way channel. */
  updateEvent: 'adminium-desktop:update-event',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Every channel `registerIpcHandlers` answers with `ipcMain.handle`. */
export const INVOKE_CHANNELS = [
  IPC_CHANNELS.openFile,
  IPC_CHANNELS.saveFile,
  IPC_CHANNELS.showItemInFolder,
  IPC_CHANNELS.chooseDirectory,
  IPC_CHANNELS.getRuntimeInfo,
  IPC_CHANNELS.setConfig,
  IPC_CHANNELS.setDataDir,
  IPC_CHANNELS.checkForUpdates,
  IPC_CHANNELS.downloadUpdate,
  IPC_CHANNELS.quitAndInstall,
  IPC_CHANNELS.capabilitiesList,
  IPC_CHANNELS.capabilitiesInvoke,
  IPC_CHANNELS.setMenuLabels,
  IPC_CHANNELS.getDiagnostics,
  IPC_CHANNELS.readBundledText,
  IPC_CHANNELS.relaunch,
  IPC_CHANNELS.showLogs,
] as const;

/**
 * §4's two synchronous properties, `platform` and `versions`.
 *
 * They are properties, not promises — `contextBridge` copies values at expose
 * time, so there is no moment later at which an async answer could become one.
 * `versions.app` is `app.getVersion()`, which exists ONLY in the main process:
 * a sandboxed preload's polyfilled `process` carries `versions.electron`,
 * `.chrome` and `.node`, but nothing knows the app's own version. Hence one
 * `sendSync` at preload time — the single blocking IPC in this bridge, made once
 * per window before any page script runs, on a handler that does no I/O.
 */
export interface BridgeBootstrap {
  readonly platform: DesktopPlatform;
  readonly versions: DesktopVersions;
}

/**
 * Handler results. A handler RETURNS failures; it does not throw them.
 *
 * Electron turns an exception inside `ipcMain.handle` into a rejection whose
 * message is `"Error invoking remote method '<channel>': <original>"` and whose
 * every other property — `name`, `code`, anything custom — is gone. A typed
 * error contract (§12's `CAPABILITY_NOT_GRANTED` is one, and the SPA branches on
 * it) cannot survive that. So the code crosses as data, inside a plain object
 * that structured-clone reproduces exactly, and `src/preload/index.ts` is the
 * one place that turns it back into a rejection.
 */
export type IpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IpcErrorPayload };

export interface IpcErrorPayload {
  readonly code: DesktopErrorCode;
  /** User-facing prose or a developer detail — never a stack, never a secret. */
  readonly message: string;
}

export const ipcOk = <T>(value: T): IpcResult<T> => ({ ok: true, value });

export const ipcFail = (code: DesktopErrorCode, message: string): IpcResult<never> => ({
  ok: false,
  error: { code, message },
});
