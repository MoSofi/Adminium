// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Typed `ipcMain` handlers — the main-process half of the §4 preload bridge
 * (11-electron.md §4, §2.4).
 *
 * The contract is §4's `AdminiumDesktopApi`, one channel per method
 * (`src/preload/channels.ts`), and every inbound payload is EXTERNAL INPUT: it
 * arrives from a renderer over structured-clone as `unknown` and is parsed with
 * zod, never cast. That is not ceremony. `contextIsolation` + `sandbox` (§2.4)
 * exist because the renderer is the one process an attacker reaches first, and
 * these handlers are the only doors out of it that run with main-process
 * authority — native dialogs, `config.json` writes, `quitAndInstall`.
 *
 * ─── Two rules, and they are why this file is worth reviewing ────────────────
 *
 * 1. **A handler never throws; it returns.** Electron flattens an exception
 *    inside `ipcMain.handle` into a rejection reading
 *    `"Error invoking remote method '<channel>': <original>"`, dropping `name`,
 *    `code`, and every custom property. §12's typed rejections
 *    (`CAPABILITY_NOT_GRANTED`, which the SPA branches on) would not survive
 *    that, and an invalid payload would surface as a ZodError's prose. So every
 *    outcome — success, rejection, crash — leaves here as an {@link IpcResult}
 *    envelope, and `src/preload/index.ts` turns it back into a typed rejection.
 * 2. **This file holds no business logic.** §1 principle 1 (the shell contains
 *    none) and §4 ("Everything else the SPA needs comes from the server REST
 *    API"). Every handler is: parse → call an injected port → wrap. A handler
 *    that grew a decision would be invisible to self-host, where the same SPA
 *    runs against the same server with no bridge at all.
 *
 * ─── Ports, not implementations ──────────────────────────────────────────────
 *
 * The collaborators are injected as narrow interfaces because they belong to
 * other sections and other tracks: the native dialogs to the BackupCoordinator
 * and the window manager (§2.1 lists "BackupCoordinator (dialogs + shell
 * reveal)"; they own the parent window, the per-kind file filters and the
 * localization of the filter labels), the updater to §11, the CapabilityHost to
 * §12, the LAN URLs to §8.3. Routing is this file's whole job.
 *
 * WIRING REQUIREMENT: `registerIpcHandlers()` must run BEFORE the first
 * BrowserWindow is created. The preload reads §4's `platform`/`versions` with a
 * single `sendSync` at load time (`IPC_CHANNELS.bootstrap`) — the one call here
 * with no async escape hatch. See `readBootstrap` in `src/preload/index.ts`.
 */

import { isAbsolute } from 'node:path';

import { z } from 'zod';

import type {
  CapabilityDescriptor as BridgeCapabilityDescriptor,
  DesktopBundledTextKind,
  DesktopConfigPatch,
  DesktopDiagnostics,
  DesktopMenuLabels,
  DesktopRuntimeInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateEvent,
  SetDataDirOptions,
  SetDataDirResult,
} from '../preload/api.js';
import {
  INVOKE_CHANNELS,
  IPC_CHANNELS,
  ipcFail,
  ipcOk,
  type BridgeBootstrap,
  type IpcErrorPayload,
  type IpcResult,
} from '../preload/channels.js';
import {
  CAPABILITY_NOT_GRANTED,
  CAPABILITY_STUB,
  type CapabilityHost,
} from './capabilities/host.js';
import {
  autoBackupSchema,
  lanShareSchema,
  updatesSchema,
  type DesktopConfig,
  type SecretStorage,
} from './config.js';
import type { UpdateManager } from './updates.js';

// ─── Payload schemas (§4) ────────────────────────────────────────────────────

/**
 * The channels that take no argument. `z.undefined()` rather than `z.unknown()`
 * on purpose: a renderer that sends something to `relaunch()` is not a renderer
 * behaving normally, and a boundary should say so rather than shrug.
 */
const noPayloadSchema = z.undefined();

const openFileSchema = z.strictObject({
  kind: z.enum(['sqlite', 'schema', 'backup', 'any']),
});

/**
 * A FILENAME, not a path (§4: `defaultName`). Separators are rejected because
 * this string becomes the save dialog's pre-filled `defaultPath`: a renderer
 * that could put `../` in it would be choosing the directory the dialog opens
 * in. The user still has to confirm, so this is less a hole than a door that
 * should not be there at all.
 */
const saveFileSchema = z.strictObject({
  kind: z.enum(['backup', 'export']),
  defaultName: z
    .string()
    .min(1)
    .max(255)
    .refine((name) => !/[/\\]/.test(name) && name !== '.' && name !== '..', {
      message: 'must be a bare filename, not a path',
    }),
});

/**
 * §4 `showItemInFolder(path)`.
 *
 * Absolute-only, and NOT confined to `dataDir`: §13's About panel reveals the
 * data directory, §9 reveals a backup archive, and Help → "Show logs" reveals
 * `<userData>/logs` — three legitimate targets in three different trees. A
 * confinement would buy little (the operation opens a file-manager window; it
 * reads nothing and returns nothing to the renderer) and would cost a bridge
 * that quietly fails for two of its three callers.
 */
const revealPathSchema = z.string().min(1).refine(isAbsolute, {
  message: 'must be an absolute path',
});

const chooseDirectorySchema = z.strictObject({
  title: z.string().min(1).max(200),
  defaultPath: z.string().refine(isAbsolute, { message: 'must be an absolute path' }).optional(),
});

/**
 * §4 `setConfig`: `Partial<Pick<DesktopConfig, "singleUser" | "lanShare" |
 * "updates" | "telemetryOptIn" | "autoBackup">>`, reusing 11-T03's schemas so
 * the bounds (a valid port, `keep` within 1–365) are stated once.
 *
 * `strictObject` is the load-bearing word. The keys NOT here are `dataDir`,
 * `secretEncrypted`, `secretPlain`, `version` and `window` — the master secret,
 * the storage location, and the migration version. Under a loose object a
 * renderer could send `{ dataDir: "…" }` and have it either merged or silently
 * dropped, and both outcomes are worse than a rejection.
 */
const setConfigSchema = z.strictObject({
  singleUser: z.boolean().optional(),
  lanShare: lanShareSchema.optional(),
  updates: updatesSchema.optional(),
  telemetryOptIn: z.boolean().optional(),
  autoBackup: autoBackupSchema.optional(),
});

/**
 * §6 step 1 `setDataDir`. The one key `setConfigSchema` above exists to refuse,
 * on its own channel with its own gate (see {@link RegisterIpcHandlersOptions.setDataDir}).
 *
 * Absolute-only for `revealPathSchema`'s reason and one more: this path is
 * resolved against the main process's cwd otherwise, which in a packaged app is
 * `/` on macOS and the install directory on Windows — so a relative path would
 * not be wrong so much as meaningless.
 */
const setDataDirSchema = z.strictObject({
  dir: z
    .string()
    .min(1)
    .max(4096)
    .refine(isAbsolute, { message: 'must be an absolute path' }),
  acknowledgeCloudSync: z.boolean().optional(),
});

/**
 * §14 `setMenuLabels`: the native menu's localized strings, pushed by the
 * renderer (see `main/menu.ts`'s header for why the shell cannot resolve them
 * itself).
 *
 * A `strictObject` requiring all 14 keys, because {@link DesktopMenuLabels} is a
 * full `Record` and the dashboard's resolver is typed to send every one — a
 * partial arrival is a bug in the sender, not a supported shape, and this is the
 * untrusted boundary (§2.4). The keys are stated once here and pinned to the
 * contract by {@link _MenuLabelsMatchSchema}; drift becomes a desktop typecheck
 * failure rather than a menu the main process quietly leaves in English. The
 * `.max` is generous — a menu label is a few words in any locale — and exists
 * only to bound what a compromised renderer can push into a native widget.
 */
const menuLabelSchema = z.string().min(1).max(200);
const menuLabelsSchema = z.strictObject({
  file: menuLabelSchema,
  'file.newDatabase': menuLabelSchema,
  'file.openSqlite': menuLabelSchema,
  'file.backupNow': menuLabelSchema,
  'file.restore': menuLabelSchema,
  edit: menuLabelSchema,
  view: menuLabelSchema,
  window: menuLabelSchema,
  help: menuLabelSchema,
  'help.docs': menuLabelSchema,
  'help.shortcuts': menuLabelSchema,
  'help.logs': menuLabelSchema,
  'help.checkForUpdates': menuLabelSchema,
  'help.about': menuLabelSchema,
});

/**
 * §13 `readBundledText(kind)`. A closed enum, not a path: the renderer names
 * WHICH document (the AGPL licence or the third-party notices), never a file —
 * the two paths live on the trusted side (see
 * {@link RegisterIpcHandlersOptions.readBundledText}), so the untrusted side
 * cannot turn this into an arbitrary-file read.
 */
const bundledTextSchema = z.enum(['license', 'third-party-notices']);

const capabilityInvokeSchema = z.strictObject({
  capabilityId: z.string().min(1).max(120),
  method: z.string().min(1).max(120),
  /**
   * §12's payload is `unknown` by contract — the provider owns its shape, and a
   * schema here would be a second copy of it that drifts. Structured-clone has
   * already bounded what can physically arrive.
   *
   * `.optional()` because in zod v4 a bare `z.unknown()` accepts any VALUE but
   * still requires the KEY, which would make this handler depend on whether
   * `{ payload: undefined }` keeps its key across Electron's structured clone.
   * It does — but §12 has methods that take no payload at all (`listDevices`),
   * so "absent" is a legitimate call and not a serialization detail to bet on.
   */
  payload: z.unknown().optional(),
});

// ─── Contract assertions ─────────────────────────────────────────────────────
//
// `src/preload/api.d.ts` cannot import from this package's main process (it is
// compiled into @adminium/dashboard's tsc program, which has no zod, no
// `node:fs` and no Electron — see that file's header), so the §4 shapes it
// restates are pinned to their real definitions HERE, where both exist. Each
// alias below fails the desktop typecheck if the two diverge, which is the only
// thing standing between "the settings panel writes a key" and "the main
// process ignores it".

/**
 * Bidirectional assignability. Deliberately not a `readonly`-sensitive `Equal`:
 * `api.d.ts` marks read-only snapshots `readonly` as API hygiene, which is not
 * drift.
 */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/**
 * Every property required and never `undefined` — the shape questions with the
 * optionality question removed.
 *
 * `Required<T>` is NOT this, and the difference is the whole reason this alias
 * exists: `exactOptionalPropertyTypes` makes `{ k?: V }` and `{ k?: V | undefined }`
 * two different types, so `-?` strips the optional flag but keeps an EXPLICIT
 * `| undefined` — the very widening `api.d.ts` applies on purpose (see its
 * header). Excluding `undefined` as well normalises both sides, so the assertions
 * below compare keys and value types, which is what drift is, and leave
 * optionality to {@link _PatchMatchesSchema}, which pins it against the schema
 * that actually validates.
 */
type Settled<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };

/** §4's five settable keys. */
type PatchKey = 'singleUser' | 'lanShare' | 'updates' | 'telemetryOptIn' | 'autoBackup';

/**
 * The patch offers exactly §4's five keys, each carrying exactly the value type
 * `config.json` stores under it.
 */
export type _PatchKeysMatchContract = Assert<Mutual<keyof DesktopConfigPatch, PatchKey>>;
export type _PatchValuesMatchConfig = Assert<
  Mutual<Settled<DesktopConfigPatch>, Settled<Pick<DesktopConfig, PatchKey>>>
>;

/**
 * The contract and the schema accept the same thing.
 *
 * This is the one assertion nothing else can catch. `writeConfig(patch)` already
 * proves the schema's output is a valid `DesktopConfigPatch`; the REVERSE is
 * unguarded, and it is the direction that breaks silently — a key added to
 * `api.d.ts` and forgotten here would typecheck in the dashboard, ship, and then
 * be rejected at runtime by `strictObject` on a boundary the SPA cannot see.
 */
export type _PatchMatchesSchema = Assert<Mutual<DesktopConfigPatch, z.infer<typeof setConfigSchema>>>;

/** §12's frozen descriptor: `api.d.ts`'s restatement ≡ the host's definition. */
export type _CapabilityDescriptorMatches = Assert<
  Mutual<BridgeCapabilityDescriptor, ReturnType<CapabilityHost['list']>[number]>
>;

/** §11's result ≡ §4's. {@link Settled} for the reason given there. */
export type _UpdateCheckMatches = Assert<
  Mutual<
    Settled<DesktopUpdateCheckResult>,
    Settled<Awaited<ReturnType<UpdateManager['checkForUpdates']>>>
  >
>;

/** §2.2 step 3's storage modes ≡ §4's. */
export type _SecretStorageMatches = Assert<Mutual<DesktopRuntimeInfo['secretStorage'], SecretStorage>>;

/**
 * §14: the `setMenuLabels` schema accepts exactly §4's `DesktopMenuLabels`.
 *
 * The one direction nothing else catches: a menu label key added to `api.d.ts`
 * (and to `menu.ts`, which aliases the same union) but forgotten in
 * {@link menuLabelsSchema} would typecheck in the dashboard, ship, and then be
 * rejected at runtime by `strictObject` — the whole localized push refused on a
 * boundary the SPA cannot see, leaving the native menu in English forever.
 */
export type _MenuLabelsMatchSchema = Assert<
  Mutual<DesktopMenuLabels, z.infer<typeof menuLabelsSchema>>
>;

// ─── Ports ───────────────────────────────────────────────────────────────────

/** The `senderFrame` of an inbound message, narrowed to the field a policy needs. */
export interface IpcSenderFrameLike {
  readonly url: string;
}

export interface IpcInvokeEventLike {
  readonly senderFrame: IpcSenderFrameLike | null;
}

export interface IpcSyncEventLike extends IpcInvokeEventLike {
  returnValue: unknown;
}

/** Electron's `ipcMain`, narrowed to what this file uses. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: IpcInvokeEventLike, ...args: unknown[]) => Promise<IpcResult<unknown>>,
  ): void;
  on(channel: string, listener: (event: IpcSyncEventLike, ...args: unknown[]) => void): unknown;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): unknown;
}

/**
 * §2.2's runtime facts, as `getRuntimeInfo` needs them.
 *
 * Structurally a subset of `main/index.ts`'s `DesktopRuntimeState`, restated
 * rather than imported: `index.ts` is what wires this module, so importing its
 * types back would be the one circular edge `.dependency-cruiser.cjs`'s
 * `no-circular` rule forbids everywhere. `null` is the honest pre-boot answer —
 * the SPA cannot ask before §2.2 step 8, but a crash page exists precisely when
 * the server does not.
 */
export interface DesktopRuntimeSnapshot {
  readonly dataDir: string;
  readonly secretStorage: SecretStorage;
  readonly serverPort: number;
  /**
   * §11: has the env kill-switch (`ADMINIUM_DISABLE_UPDATES=1`) forced updates
   * off for THIS launch? A boot-time fact, resolved by `main/index.ts` from
   * `process.env` — which this Electron-free module must not read — and carried
   * here so `getRuntimeInfo` reports the mode the updater ACTUALLY runs in.
   *
   * Without it the panel reads `config.updates.mode` alone, so a fleet admin who
   * air-gaps the install with the env var — while `config.json` keeps the default
   * `notify` — is shown "Notify me about new versions" and an enabled "Check for
   * updates" button, while `createUpdateManager` has already resolved `disabled`
   * and built no updater at all (§11). The panel would misrepresent the very
   * air-gap posture that admin set, and the button would fail closed to
   * UNAVAILABLE, contradicting its own header.
   */
  readonly updatesDisabledByEnv: boolean;
}

/**
 * The native dialogs of §4.
 *
 * Injected, not implemented here: §2.1 gives them to the BackupCoordinator
 * ("dialogs + shell reveal") and the window manager, which own the parent
 * window, the per-kind file filters, and the localization of the filter labels
 * (§14 / 10-i18n-theming.md). This module knows only that a dialog returns an
 * absolute path, or `null` when the user cancels.
 */
export interface DesktopDialogs {
  openFile(opts: { kind: 'sqlite' | 'schema' | 'backup' | 'any' }): Promise<string | null>;
  saveFile(opts: { kind: 'backup' | 'export'; defaultName: string }): Promise<string | null>;
  chooseDirectory(opts: { title: string; defaultPath?: string | undefined }): Promise<string | null>;
  showItemInFolder(path: string): Promise<void>;
}

/**
 * Whether a frame may use the bridge, given its URL (`null` when the frame is
 * already gone). See {@link loopbackSenderPolicy} for the default.
 */
export type SenderPolicy = (senderUrl: string | null) => boolean;

export interface RegisterIpcHandlersOptions {
  /** Electron's `ipcMain` in production; a fake in tests. */
  ipc: IpcMainLike;
  /** §4's `platform` + `versions`, answered synchronously at preload time. */
  bootstrap: BridgeBootstrap;
  /** Push to the window's `webContents` — §4's `onUpdateEvent` (§11). */
  broadcast: (channel: string, payload: unknown) => void;
  runtime: () => DesktopRuntimeSnapshot | null;
  /** The live `config.json` (§2.3). */
  readConfig: () => DesktopConfig;
  /** Merge + persist a §4 patch. The atomic write is 11-T03's `saveConfig`. */
  writeConfig: (patch: DesktopConfigPatch) => Promise<void>;
  /**
   * §6 step 1's data-directory change, gate included.
   *
   * A port rather than logic here, because every part of the act belongs to
   * `main/index.ts`: 11-T03's `detectCloudSyncFolder` is the gate, `config.save`
   * is the write, and `app.relaunch()` is what makes the new directory the one
   * the server is forked against (§2.2 step 5). This module's job is the same as
   * for every other channel — parse the payload, hand it over, wrap the answer.
   */
  setDataDir: (opts: SetDataDirOptions) => Promise<SetDataDirResult>;
  dialogs: DesktopDialogs;
  /**
   * §11: a GETTER for the live updater, `null` when `updates.mode: "disabled"`
   * or `ADMINIUM_DISABLE_UPDATES=1`. Nullable rather than a no-op manager because
   * §11 requires the updater to never be INITIALIZED in that mode — "not
   * initialized-then-not-asked" — and a port that was never constructed is the
   * only shape that cannot get that wrong. The three update channels then answer
   * `UNAVAILABLE`.
   *
   * A GETTER, not a value, because of the boot ORDER: `registerIpcHandlers` runs
   * before `config.json` is loaded (`main/index.ts` registers the bridge before
   * the first window, which a config error at step 2 would open), so the mode —
   * and therefore whether an updater exists at all — is not known yet. The boot
   * creates the manager at step 5 and this getter reads it thereafter; it is read
   * per call, never cached, so a `disabled` boot returns `null` forever and a
   * `notify`/`manual` boot returns the one manager the moment it exists.
   */
  updates: () => UpdateManager | null;
  capabilities: CapabilityHost;
  /**
   * §14: apply the renderer's localized menu labels — rebuild the native menu.
   *
   * A port because the menu is `main/index.ts`'s to (re)install: it owns the
   * `MenuHandlers` (§9's backup, Help's logs) and the platform/dev flags, and it
   * holds the labels between pushes so a later `MenuHandlers` change rebuilds
   * with the locale already chosen. This file's job is unchanged — parse the
   * push, hand it over, wrap the answer.
   */
  setMenuLabels: (labels: DesktopMenuLabels) => void;
  /**
   * §13's "Copy diagnostic info … dataDir size". A port because only the main
   * process can walk the data directory — the renderer has no filesystem access
   * (§2.4), and the server owns the data but not its on-disk footprint. `main/
   * index.ts` supplies the walk; this file parses, calls, and wraps.
   */
  getDiagnostics: () => Promise<DesktopDiagnostics>;
  /**
   * §13's in-app licence viewers. A port because the two files live inside the
   * packaged app and only the main process can locate them (`process.
   * resourcesPath`). `null` is the honest answer for a dev run where the
   * generated notices do not exist yet — the viewer says so.
   */
  readBundledText: (kind: DesktopBundledTextKind) => Promise<string | null>;
  /** §8.3's reachable `http://<LAN-IPv4>:<port>` list. Defaults to none. */
  lanShareUrls?: (() => readonly string[]) | undefined;
  /** Help → "Show logs" (§9): reveal `<userData>/logs`. */
  showLogs: () => Promise<void>;
  /** §14: relaunch the app (e.g. after a data-dir change). */
  relaunch: () => void;
  /** §2.4 override. Defaults to {@link loopbackSenderPolicy}. */
  senderPolicy?: SenderPolicy | undefined;
  /** §9's main log. Handler failures are recorded, never swallowed. */
  log?: ((line: string) => void) | undefined;
}

export interface IpcHandlers {
  /** §11 → §4's `onUpdateEvent`. The updater calls this; nothing else does. */
  emitUpdateEvent(event: DesktopUpdateEvent): void;
  dispose(): void;
}

// ─── Sender policy (§2.4) ────────────────────────────────────────────────────

const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1', '[::1]']);

/** 127.0.0.0/8, ::1, localhost — the same peers §5's boot-token route accepts. */
export function isLoopbackHostname(hostname: string): boolean {
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  return /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * The default answer to Electron's "validate the sender of every IPC message".
 *
 * Allows exactly the two kinds of frame this shell ever loads:
 *
 *  - `file:` — the bundled splash and crash pages (§2.2 steps 6 and 9). The
 *    crash page must reach `showLogs()` at the precise moment there is no server
 *    and therefore no loopback origin to compare against.
 *  - any loopback `http:`/`https:` origin — the server on its random `:0` port
 *    (§2.1), and the dashboard's Vite dev server in the §3 dev loop. Pinning to
 *    `127.0.0.1:<serverPort>` would be tighter by nothing: §2.4's navigation
 *    lockdown already decides what may LOAD, this only decides what a loaded
 *    frame may CALL, and pinning would break the dev loop and would race every
 *    restart-on-a-new-port (§2.2 step 9).
 *
 * What it rejects is what matters: any remote origin. Defence in depth — the
 * primary control is the navigation lockdown in `window.ts`; this is the second
 * one, for the frame that gets past it.
 */
export const loopbackSenderPolicy: SenderPolicy = (senderUrl) => {
  if (senderUrl === null) return false;
  if (senderUrl.startsWith('file://')) return true;
  try {
    const url = new URL(senderUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
};

/**
 * `senderFrame` is a getter over a live frame: it is `null` once the frame is
 * gone, and reading it can throw outright if the frame was destroyed mid-call.
 * Both mean "no trustworthy sender", not "crash inside the handler".
 */
function senderUrlOf(event: IpcInvokeEventLike): string | null {
  try {
    return event.senderFrame?.url ?? null;
  } catch {
    return null;
  }
}

// ─── Error mapping ───────────────────────────────────────────────────────────

/** §11's `disabled` mode, as seen from the bridge: the port does not exist. */
class UnavailableError extends Error {}

/**
 * §8.3's port collision, as a code the settings form can branch on.
 *
 * Spelled as a MESSAGE PREFIX rather than a custom error class, because that is
 * the only shape that survives: {@link toErrorPayload} is what maps a throw onto
 * §4's closed union, and it recognises prefixes — the same convention §12's
 * providers use (`printer-escpos.ts` rejects with `` `${CAPABILITY_STUB}: …` ``).
 * A class would work here and nowhere else, since the thrower is
 * `RegisterIpcHandlersOptions.writeConfig` — an injected port that belongs to
 * `main/index.ts` and cannot import this module without the circular edge
 * `.dependency-cruiser.cjs` forbids.
 */
export const LAN_PORT_IN_USE = 'LAN_PORT_IN_USE';

function requireUpdates(updates: UpdateManager | null): UpdateManager {
  if (updates === null) {
    throw new UnavailableError('Updates are disabled in this installation.');
  }
  return updates;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Map a thrown error onto §4's closed code union.
 *
 * §12's providers reject with `` `${CAPABILITY_NOT_GRANTED}: …` `` — a code
 * inside a message, which is how that section specifies it and how
 * `printer-escpos.ts` implements it. §8.3's `LAN_PORT_IN_USE` joins them on the
 * same convention. Recognising the prefix is what keeps it a CODE across the
 * bridge instead of decaying into prose; the prefix is then stripped, because
 * the preload puts it back (`DesktopBridgeError`) and a doubled
 * `CAPABILITY_STUB: CAPABILITY_STUB: …` is nobody's idea of a typed error.
 *
 * Everything else is `INTERNAL`, with its message carried and its stack dropped:
 * a stack in the renderer is an information leak, and the §9 log has the real
 * one.
 */
export function toErrorPayload(error: unknown): IpcErrorPayload {
  if (error instanceof UnavailableError) return { code: 'UNAVAILABLE', message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  for (const code of [CAPABILITY_NOT_GRANTED, CAPABILITY_STUB, LAN_PORT_IN_USE] as const) {
    const prefix = `${code}: `;
    if (message.startsWith(prefix)) return { code, message: message.slice(prefix.length) };
  }
  return { code: 'INTERNAL', message };
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Wire every §4 channel. `ipcMain.handle` throws on a duplicate channel, so a
 * second call needs {@link IpcHandlers.dispose} between.
 */
export function registerIpcHandlers(opts: RegisterIpcHandlersOptions): IpcHandlers {
  const { ipc } = opts;
  const senderPolicy = opts.senderPolicy ?? loopbackSenderPolicy;
  const lanShareUrls = opts.lanShareUrls ?? ((): readonly string[] => []);
  const log = opts.log ?? ((): void => {});

  const untrusted = ipcFail(
    'UNTRUSTED_SENDER',
    'This frame may not use the Adminium desktop bridge.',
  );

  const trusted = (event: IpcInvokeEventLike, channel: string): boolean => {
    const url = senderUrlOf(event);
    if (senderPolicy(url)) return true;
    log(`ipc: refused ${channel} from untrusted sender ${url ?? '(no frame)'}`);
    return false;
  };

  /**
   * parse → run → wrap, for every channel. The uniformity is the point: there is
   * no handler where a payload reaches a port unparsed, and none where a throw
   * escapes as an Electron rejection, because one place decides both questions.
   */
  function register<S extends z.ZodType, T>(
    channel: string,
    schema: S,
    run: (input: z.output<S>) => Promise<T>,
  ): void {
    ipc.handle(channel, async (event, ...args): Promise<IpcResult<T>> => {
      if (!trusted(event, channel)) return untrusted;
      const parsed = schema.safeParse(args[0]);
      if (!parsed.success) {
        const detail = formatIssues(parsed.error);
        log(`ipc: rejected ${channel} payload — ${detail}`);
        return ipcFail('INVALID_PAYLOAD', detail);
      }
      try {
        return ipcOk(await run(parsed.data as z.output<S>));
      } catch (error) {
        const payload = toErrorPayload(error);
        log(`ipc: ${channel} failed — ${payload.code}: ${payload.message}`);
        return { ok: false, error: payload };
      }
    });
  }

  // §4's two synchronous properties. `sendSync` because `contextBridge` copies
  // values at expose time, so there is no later moment at which an async answer
  // could become a property (see channels.ts's BridgeBootstrap). It answers from
  // memory and touches no I/O — the renderer blocks for a structured-clone.
  ipc.on(IPC_CHANNELS.bootstrap, (event) => {
    event.returnValue = trusted(event, IPC_CHANNELS.bootstrap) ? ipcOk(opts.bootstrap) : untrusted;
  });

  // ─── file dialogs ──────────────────────────────────────────────────────────

  register(IPC_CHANNELS.openFile, openFileSchema, (input) => opts.dialogs.openFile(input));
  register(IPC_CHANNELS.saveFile, saveFileSchema, (input) => opts.dialogs.saveFile(input));
  register(IPC_CHANNELS.showItemInFolder, revealPathSchema, (path) =>
    opts.dialogs.showItemInFolder(path),
  );
  register(IPC_CHANNELS.chooseDirectory, chooseDirectorySchema, (input) =>
    opts.dialogs.chooseDirectory(input),
  );

  // ─── runtime info & config ─────────────────────────────────────────────────

  register(IPC_CHANNELS.getRuntimeInfo, noPayloadSchema, (): Promise<DesktopRuntimeInfo> => {
    const runtime = opts.runtime();
    if (runtime === null) throw new UnavailableError('The desktop runtime is not ready yet.');
    const config = opts.readConfig();
    return Promise.resolve({
      dataDir: runtime.dataDir,
      serverPort: runtime.serverPort,
      singleUser: config.singleUser,
      lanShare: {
        enabled: config.lanShare.enabled,
        port: config.lanShare.port,
        // Nothing is reachable while sharing is off, so there is nothing to
        // list — and enumerating this machine's LAN addresses into a renderer
        // that did not ask to share them is not a neutral act (§8.3).
        urls: config.lanShare.enabled ? [...lanShareUrls()] : [],
      },
      // §11: the mode the updater ACTUALLY runs in. `config.updates.mode` is the
      // live value the settings panel writes (so notify↔manual stay honest as the
      // user toggles them), but the env kill-switch overrides it to `disabled`
      // without touching the file — `createUpdateManager` resolved the same
      // override and built no updater, so reporting the raw config here would
      // paint "Notify" over an install that makes zero update traffic.
      updates: { mode: runtime.updatesDisabledByEnv ? 'disabled' : config.updates.mode },
      secretStorage: runtime.secretStorage,
    });
  });

  register(IPC_CHANNELS.setConfig, setConfigSchema, async (patch) => {
    await opts.writeConfig(patch);
  });

  register(IPC_CHANNELS.setDataDir, setDataDirSchema, (input): Promise<SetDataDirResult> =>
    opts.setDataDir(input),
  );

  // ─── updates (§11) ─────────────────────────────────────────────────────────

  register(
    IPC_CHANNELS.checkForUpdates,
    noPayloadSchema,
    (): Promise<DesktopUpdateCheckResult> => requireUpdates(opts.updates()).checkForUpdates(),
  );
  register(IPC_CHANNELS.downloadUpdate, noPayloadSchema, () =>
    requireUpdates(opts.updates()).downloadUpdate(),
  );
  register(IPC_CHANNELS.quitAndInstall, noPayloadSchema, () => {
    requireUpdates(opts.updates()).quitAndInstall();
    return Promise.resolve();
  });

  // ─── capabilities (§12) ────────────────────────────────────────────────────

  register(
    IPC_CHANNELS.capabilitiesList,
    noPayloadSchema,
    (): Promise<BridgeCapabilityDescriptor[]> => Promise.resolve(opts.capabilities.list()),
  );
  register(IPC_CHANNELS.capabilitiesInvoke, capabilityInvokeSchema, (input) =>
    opts.capabilities.invoke(input.capabilityId, input.method, input.payload),
  );

  // ─── native menu (§14) ─────────────────────────────────────────────────────

  register(IPC_CHANNELS.setMenuLabels, menuLabelsSchema, (labels) => {
    opts.setMenuLabels(labels);
    return Promise.resolve();
  });

  // ─── about / diagnostics (§13) ─────────────────────────────────────────────

  register(
    IPC_CHANNELS.getDiagnostics,
    noPayloadSchema,
    (): Promise<DesktopDiagnostics> => opts.getDiagnostics(),
  );
  register(IPC_CHANNELS.readBundledText, bundledTextSchema, (kind): Promise<string | null> =>
    opts.readBundledText(kind),
  );

  // ─── lifecycle ─────────────────────────────────────────────────────────────

  register(IPC_CHANNELS.relaunch, noPayloadSchema, () => {
    opts.relaunch();
    return Promise.resolve();
  });
  register(IPC_CHANNELS.showLogs, noPayloadSchema, () => opts.showLogs());

  return {
    emitUpdateEvent(event: DesktopUpdateEvent): void {
      opts.broadcast(IPC_CHANNELS.updateEvent, event);
    },
    dispose(): void {
      for (const channel of INVOKE_CHANNELS) ipc.removeHandler(channel);
      ipc.removeAllListeners(IPC_CHANNELS.bootstrap);
    },
  };
}
