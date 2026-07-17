/**
 * The preload bridge contract (11-electron.md §4), verbatim.
 *
 * §4: "Typed contract lives in `apps/desktop/src/preload/api.d.ts` and is
 * re-exported to the dashboard as `@adminium/desktop/api` (types only) so
 * `@adminium/dashboard` compiles without Electron installed."
 *
 * ─── Why this file is hand-written `.d.ts` and imports NOTHING ───────────────
 *
 * It is compiled into TWO programs that share no dependencies:
 *
 *  - `@adminium/desktop`, where `src/preload/index.ts` implements it and
 *    `src/main/ipc.ts` serves it — Electron + Node + zod present;
 *  - `@adminium/dashboard`, a browser SPA with none of those installed, which
 *    imports it as `@adminium/desktop/api` to type `window.adminiumDesktop`.
 *
 * So a single `import type { DesktopConfig } from '../main/config.js'` here —
 * tempting, since §4 literally writes `Partial<Pick<DesktopConfig, …>>` — would
 * drag `main/config.ts` (zod, `node:fs`, `node:path`) into the dashboard's tsc
 * program and break the sentence this file exists to satisfy. The §4 subset is
 * therefore restated STRUCTURALLY below as {@link DesktopConfigPatch}, and
 * `src/main/ipc.ts` carries a compile-time assertion that the restatement still
 * equals `Partial<Pick<DesktopConfig, …>>`. Drift becomes a desktop typecheck
 * failure rather than a runtime shape mismatch nobody sees until the settings
 * panel silently writes a key the main process ignores.
 *
 * For the same reason there is no `zod` here: schemas live in `src/main/ipc.ts`,
 * on the trusted side of the boundary that validates. The types are the shared
 * artifact; the validation is not.
 *
 * ─── `?: T | undefined` rather than §4's `?: T` ──────────────────────────────
 *
 * The repo compiles with `exactOptionalPropertyTypes` (tsconfig.base.json), under
 * which `{ defaultPath?: string }` forbids passing an EXPLICIT `undefined` —
 * `chooseDirectory({ title, defaultPath: maybeUndefined })`, the exact call a SPA
 * makes, would not compile. The doc's `?:` means "optional", not "must be
 * absent", so the optional members below are widened with `| undefined`. This is
 * the same convention `src/main/config.ts` and `src/main/window.ts` already use.
 */

// ─── Static properties ───────────────────────────────────────────────────────

/** §4. Narrower than `NodeJS.Platform`: these are the three §10 build targets. */
export type DesktopPlatform = 'darwin' | 'win32' | 'linux';

/** §4 / §13 — the About screen renders all four. */
export interface DesktopVersions {
  /** `app.getVersion()`; the packaged app version, not the server's. */
  readonly app: string;
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
}

// ─── File dialogs ────────────────────────────────────────────────────────────

/**
 * §4 `openFile`. The kind picks the native filter list rather than letting the
 * renderer supply one: a caller-chosen filter is a caller-chosen file type, and
 * this is the untrusted side of the bridge (§2.4).
 *
 * `sqlite` is §6's "Open an existing SQLite file"; `schema` is the first-run
 * Prisma schema import; `backup` is a §9 archive.
 */
export type OpenFileKind = 'sqlite' | 'schema' | 'backup' | 'any';

/** §4 `saveFile`: a §9 backup archive, or a data export from the SPA. */
export type SaveFileKind = 'backup' | 'export';

export interface OpenFileOptions {
  readonly kind: OpenFileKind;
}

export interface SaveFileOptions {
  readonly kind: SaveFileKind;
  /** Pre-filled filename, e.g. `adminium-backup-2026-07-17.zip`. */
  readonly defaultName: string;
}

export interface ChooseDirectoryOptions {
  readonly title: string;
  readonly defaultPath?: string | undefined;
}

// ─── Runtime info & config ───────────────────────────────────────────────────

/** §2.3 `updates.mode`, §11. */
export type DesktopUpdateMode = 'notify' | 'manual' | 'disabled';

/** §2.2 step 3. `plain` makes the §13 About screen show its warning banner. */
export type DesktopSecretStorage = 'safeStorage' | 'plain';

/** §2.3 `lanShare`, plus the §8.3 panel's reachable URLs. */
export interface DesktopLanShareInfo {
  readonly enabled: boolean;
  readonly port: number;
  /**
   * `http://<LAN-IPv4>:<port>` per non-internal interface (§8.3). Empty while
   * sharing is off — there is nothing reachable to list.
   */
  readonly urls: readonly string[];
}

/** §4 `getRuntimeInfo()`. */
export interface DesktopRuntimeInfo {
  readonly dataDir: string;
  /** The resolved loopback port (§2.2 step 7). The child listens on `:0`. */
  readonly serverPort: number;
  readonly singleUser: boolean;
  readonly lanShare: DesktopLanShareInfo;
  readonly updates: { readonly mode: DesktopUpdateMode };
  readonly secretStorage: DesktopSecretStorage;
}

/** §2.3 `lanShare`. */
export interface DesktopLanShareConfig {
  readonly enabled: boolean;
  readonly port: number;
}

/** §2.3 `updates`. */
export interface DesktopUpdatesConfig {
  readonly mode: DesktopUpdateMode;
}

/** §2.3 `autoBackup` (§9). */
export interface DesktopAutoBackupConfig {
  readonly enabled: boolean;
  /** Archives retained by the rotation. */
  readonly keep: number;
}

/**
 * §4 `setConfig`: `Partial<Pick<DesktopConfig, "singleUser" | "lanShare" |
 * "updates" | "telemetryOptIn" | "autoBackup">>`.
 *
 * The five keys are exactly the user-facing ones from §2.3 ("Everything
 * user-facing in this file is also editable from the dashboard's desktop
 * settings panel"). The absences are the security property: `dataDir` would
 * repoint the app's storage, `secretEncrypted`/`secretPlain` are the master
 * secret (§2.2 step 3), `version` drives migration (§2.3), and `window` is
 * persisted by the window manager (§14) — none may be written by a renderer,
 * so none of them exists here, and `src/main/ipc.ts` parses this with a
 * `strictObject` so a smuggled key is a rejection rather than a silent merge.
 */
export interface DesktopConfigPatch {
  readonly singleUser?: boolean | undefined;
  readonly lanShare?: DesktopLanShareConfig | undefined;
  readonly updates?: DesktopUpdatesConfig | undefined;
  readonly telemetryOptIn?: boolean | undefined;
  readonly autoBackup?: DesktopAutoBackupConfig | undefined;
}

// ─── Updates (§11) ───────────────────────────────────────────────────────────

export type DesktopUpdateStatus = 'available' | 'none' | 'error';

/** §4 `checkForUpdates()`. */
export interface DesktopUpdateCheckResult {
  readonly status: DesktopUpdateStatus;
  readonly version?: string | undefined;
}

export type DesktopUpdateEventType = 'available' | 'progress' | 'downloaded' | 'error';

/** §4 `onUpdateEvent`. */
export interface DesktopUpdateEvent {
  readonly type: DesktopUpdateEventType;
  readonly version?: string | undefined;
  /** 0–100, on `progress`. */
  readonly percent?: number | undefined;
  readonly message?: string | undefined;
}

/** §4 `onUpdateEvent` returns its own unsubscriber. */
export type Unsubscribe = () => void;

// ─── Capabilities (§12) ──────────────────────────────────────────────────────

/**
 * §12, VERBATIM — and frozen together with 13-marketplace.md's manifest
 * `capabilities` field, so changing it is a cross-document decision, not a
 * refactor.
 *
 * Restated here rather than imported from `src/main/capabilities/host.ts` for
 * the reason in the module header (that module is main-process code); `ipc.ts`
 * asserts the two stay identical. It is the one type in this file with no
 * `readonly` on it, precisely because "verbatim" beats house style for a shape
 * two documents have agreed to freeze — and because the assertion in `ipc.ts`
 * is exact only if both declarations are.
 */
export interface CapabilityDescriptor {
  /** `"printer.escpos"`; future: `"serial"`, `"hid"`, … */
  id: string;
  version: 1;
  status: 'available' | 'unavailable' | 'stub';
  /** e.g. `["listDevices", "print", "openDrawer"]`. */
  methods: string[];
}

export interface DesktopCapabilitiesApi {
  list(): Promise<CapabilityDescriptor[]>;
  invoke(capabilityId: string, method: string, payload: unknown): Promise<unknown>;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Every rejection the bridge can produce, as a closed union the SPA can branch
 * on. `src/main/ipc.ts` returns these in a result envelope and the preload turns
 * the envelope back into a rejection — a handler never throws across IPC,
 * because Electron flattens a thrown error into
 * `"Error invoking remote method 'x': …"` and the code inside it stops being a
 * code and starts being prose.
 *
 * - `INVALID_PAYLOAD` — zod rejected the renderer's arguments (§2.4: the
 *   renderer is the untrusted side).
 * - `UNTRUSTED_SENDER` — the message did not come from a frame allowed to use
 *   the bridge.
 * - `UNAVAILABLE` — the feature is not wired in this build/state: notably
 *   `updates.mode: "disabled"`, where §11 requires the updater to never be
 *   INITIALIZED, not merely never asked.
 * - `CAPABILITY_NOT_GRANTED` / `CAPABILITY_STUB` — §12's typed rejections,
 *   forwarded from the CapabilityHost so the SPA sees them unchanged.
 * - `INTERNAL` — anything else the handler threw; the message is carried, the
 *   stack is not.
 */
export type DesktopErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNTRUSTED_SENDER'
  | 'UNAVAILABLE'
  | 'CAPABILITY_NOT_GRANTED'
  | 'CAPABILITY_STUB'
  | 'INTERNAL';

/**
 * What a bridge rejection looks like to the SPA.
 *
 * `code` is duplicated into `message` as a `"<CODE>: <detail>"` prefix on
 * purpose. `contextBridge` copies values between two V8 contexts, and its
 * handling of `Error` is limited to the standard fields — custom own properties
 * are not guaranteed to survive the crossing. So the prefix is the contract that
 * always holds and `code` is the ergonomic form; read it via the dashboard's
 * `desktopErrorCode()` helper, which falls back to the prefix. (§12 already sets
 * this precedent: `printer-escpos.ts` rejects with
 * `` `${CAPABILITY_STUB}: …` ``.)
 */
export interface DesktopBridgeErrorLike extends Error {
  readonly code: DesktopErrorCode;
}

// ─── The API ─────────────────────────────────────────────────────────────────

/**
 * §4's `AdminiumDesktopApi` — "Deliberately minimal. Everything else the SPA
 * needs comes from the server REST API."
 *
 * That sentence is the review criterion for anything added here: this object is
 * the shell's entire attack surface (§2.4) and the one part of the SPA that
 * cannot exist on self-host or Cloud. A method belongs on it only if it needs
 * main-process authority — native dialogs, `config.json` (which decides how the
 * server is LAUNCHED, so the server cannot own it), the updater, hardware
 * capabilities, app lifecycle. Everything else is a REST call that works in all
 * three runtimes.
 */
export interface AdminiumDesktopApi {
  readonly platform: DesktopPlatform;
  readonly versions: DesktopVersions;

  // file dialogs (native; return absolute paths or null on cancel)
  openFile(opts: OpenFileOptions): Promise<string | null>;
  saveFile(opts: SaveFileOptions): Promise<string | null>;
  showItemInFolder(path: string): Promise<void>;
  chooseDirectory(opts: ChooseDirectoryOptions): Promise<string | null>;

  // runtime info & config
  getRuntimeInfo(): Promise<DesktopRuntimeInfo>;
  setConfig(patch: DesktopConfigPatch): Promise<void>;

  // updates (§11)
  checkForUpdates(): Promise<DesktopUpdateCheckResult>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): Promise<void>;
  onUpdateEvent(cb: (e: DesktopUpdateEvent) => void): Unsubscribe;

  // capabilities (§12)
  readonly capabilities: DesktopCapabilitiesApi;

  relaunch(): Promise<void>;
  showLogs(): Promise<void>;
}

/**
 * §4's detection contract, and it is load-bearing in both directions:
 *
 * > the SPA treats `window.adminiumDesktop !== undefined` as "running in the
 * > desktop shell"; the server independently reports `runtime: "desktop"` in
 * > `GET /api/v1/system/info`. Both must agree; the SPA trusts the server for
 * > feature gating and the bridge only for native affordances.
 *
 * Optional, because in self-host and Cloud the SPA is the same bundle and the
 * property is genuinely absent — which is why the type is `?:` rather than a
 * lie that compiles everywhere and crashes in a browser.
 */
declare global {
  interface Window {
    readonly adminiumDesktop?: AdminiumDesktopApi;
  }
}
