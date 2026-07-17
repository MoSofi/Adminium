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

// ─── Data directory (§6 step 1) ──────────────────────────────────────────────

/** The four providers §6 step 1 names. Mirrors `main/config.ts`'s union. */
export type DesktopCloudSyncProvider = 'dropbox' | 'icloud' | 'onedrive' | 'googleDrive';

/**
 * A cloud-sync folder the wizard must warn about, as `main/config.ts`'s
 * `detectCloudSyncFolder` reports it.
 *
 * The DETECTOR is the main process's and stays there — it is 11-T03's, it knows
 * the platform's mount shapes, and a second copy in the SPA is a second answer.
 * What crosses is its verdict. `providerLabel` is a brand name and deliberately
 * untranslated; `messageKey` is the i18n key the wizard resolves, so the
 * detector names the message and the wizard owns the 8 translations of it.
 */
export interface DesktopCloudSyncWarning {
  readonly provider: DesktopCloudSyncProvider;
  readonly providerLabel: string;
  /** The path segment that matched, e.g. `"Dropbox (Personal)"`. */
  readonly matchedSegment: string;
  readonly messageKey: string;
}

export interface SetDataDirOptions {
  /** Absolute path, as `chooseDirectory` returned it. */
  readonly dir: string;
  /**
   * §6 step 1's "require explicit confirmation". FALSE (or absent) means the
   * user has not seen the warning yet, and a path inside a sync folder is
   * REFUSED rather than written — see {@link SetDataDirResult}.
   */
  readonly acknowledgeCloudSync?: boolean | undefined;
}

/**
 * Why this is a RESULT and not a `Promise<void>` that rejects.
 *
 * §6 step 1's warning is blocking and needs the provider's name in its copy, and
 * a rejection cannot carry one: `main/ipc.ts` flattens a throw to
 * `{ code, message }` and nothing else survives (see
 * {@link DesktopBridgeErrorLike}). Encoding a brand name into a message for the
 * renderer to parse back out is what §8.3's `LAN_PORT_IN_USE` had to do, and
 * that was a concession to an existing error channel, not a pattern to copy.
 *
 * The refusal lives on the TRUSTED side on purpose. The renderer cannot reach
 * `detectCloudSyncFolder`, so a wizard that forgot to check — or a future caller
 * that never knew to — cannot write a data directory into Dropbox. The check is
 * not advice this method gives; it is a gate this method holds.
 */
export type SetDataDirResult =
  /**
   * Written. The app RELAUNCHES: `dataDir` decides how the server is forked
   * (§2.2 step 5), and the child froze its copy at boot — so there is no
   * in-place way to move it, and §6 step 1 is explicit that changing it later is
   * "a guarded operation (quit-and-move instructions)". The caller should expect
   * this promise's resolution to be the last thing that happens in this window.
   */
  | { readonly status: 'applied'; readonly dataDir: string }
  /**
   * Refused: the path is inside a sync folder and `acknowledgeCloudSync` was not
   * set. NOTHING was written. Show the warning; call again with the flag if the
   * user insists.
   */
  | { readonly status: 'cloud-sync-blocked'; readonly warning: DesktopCloudSyncWarning }
  /** Refused: the path is unusable (not a directory, not writable, …). */
  | { readonly status: 'unusable'; readonly reason: string };

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

// ─── About / diagnostics (§13) ───────────────────────────────────────────────

/**
 * §13's "Copy diagnostic info … dataDir size" — the one figure in that blob the
 * renderer cannot compute. The versions and platform are already on this object,
 * the locale is the SPA's, but the size of the data directory is a filesystem
 * walk only the main process can do (the renderer has no path access at all).
 * Kept to that one number: a diagnostics bundle is "NO user data" (§13), so this
 * carries a byte count and nothing that could name a file, a table, or a row.
 */
export interface DesktopDiagnostics {
  /** Total size on disk of `dataDir` (§2.3), in bytes. `0` if it cannot be read. */
  readonly dataDirBytes: number;
}

/**
 * §13's two in-app viewers: the bundled AGPL `LICENSE` and the generated
 * `resources/THIRD-PARTY-NOTICES.txt`. Both are files inside the packaged app,
 * which only the main process can locate (`process.resourcesPath` is not a
 * renderer concept) — so reading them is a native affordance, not a REST call.
 */
export type DesktopBundledTextKind = 'license' | 'third-party-notices';

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

// ─── Native menu labels (§14) ────────────────────────────────────────────────

/**
 * Every label the native menu shows that the shell OWNS (§14) — the top-level
 * titles and the File/Help commands. NOT the Edit/View/Window role items, whose
 * strings the OS already localizes into the user's language (`{ role: 'copy' }`
 * carries a platform-supplied label; giving it one of ours would replace eight
 * OS translations with one we then owe eight of).
 *
 * ─── Why this key set lives HERE, in the shared contract ─────────────────────
 *
 * Three files must agree on it and only api.d.ts is visible to all three:
 * `src/main/menu.ts` builds the menu from these keys, `src/main/ipc.ts` pins
 * this type against the menu's own `MenuLabelKey`, and `@adminium/dashboard`
 * resolves each key through `@adminium/i18n` and pushes the result over
 * {@link AdminiumDesktopApi.setMenuLabels}. The shell CANNOT import
 * `@adminium/i18n` (`.dependency-cruiser.cjs`'s `desktop-shell-only` rule: it
 * may import `@adminium/server` and nothing else), so the eight translations
 * live in the i18n package, the RENDERER resolves them, and they cross this
 * boundary as data — never as an import edge.
 *
 * The dotted spelling matches `menu.ts`'s `MenuLabelKey` exactly; a
 * compile-time assertion in `src/main/ipc.ts` fails the desktop typecheck if the
 * two ever diverge.
 */
export type DesktopMenuLabelKey =
  | 'file'
  | 'file.newDatabase'
  | 'file.openSqlite'
  | 'file.backupNow'
  | 'file.restore'
  | 'edit'
  | 'view'
  | 'window'
  | 'help'
  | 'help.docs'
  | 'help.shortcuts'
  | 'help.logs'
  | 'help.checkForUpdates'
  | 'help.about';

/**
 * The full label set for one locale. A `Record` (not a `Partial`) so the
 * dashboard's resolver cannot forget a key: a missing entry is a desktop
 * typecheck error at the push site, not a menu item that silently falls back to
 * en-US at runtime.
 */
export type DesktopMenuLabels = Record<DesktopMenuLabelKey, string>;

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
 * - `LAN_PORT_IN_USE` — §8.3's port collision, refused by `setConfig` BEFORE
 *   anything is written or restarted. It is a code and not an `INTERNAL`
 *   message because §8.3 asks for "an inline error with a 'Try 4601'
 *   suggestion", and a settings form can only render a suggestion for a failure
 *   it can identify; the suggested port rides in the message (see
 *   `main/lan.ts`'s `suggestNextPort`).
 * - `INTERNAL` — anything else the handler threw; the message is carried, the
 *   stack is not.
 */
export type DesktopErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNTRUSTED_SENDER'
  | 'UNAVAILABLE'
  | 'CAPABILITY_NOT_GRANTED'
  | 'CAPABILITY_STUB'
  | 'LAN_PORT_IN_USE'
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
  /**
   * Merge a patch into `config.json` (§2.3) and apply whatever it implies.
   *
   * NOT a pure write, and the one key where that matters is `lanShare`: §8.3
   * makes the toggle and the rebind a single act ("flipping the toggle updates
   * `config.lanShare` … *and* gracefully restarts the utilityProcess"), so this
   * call resolves only once the server is listening on the new bind. A caller
   * that awaited it has a running server; a rejection means nothing changed —
   * `LAN_PORT_IN_USE` is refused before the write, and any later failure reverts
   * the file and rebinds to loopback rather than leaving the app with a config
   * that cannot boot.
   *
   * The window RELOADS on a successful `lanShare` change: the port moves, so the
   * origin does, and `main/index.ts` re-navigates to the new one.
   */
  setConfig(patch: DesktopConfigPatch): Promise<void>;

  /**
   * §6 step 1's "Change…", committed.
   *
   * Deliberately NOT a `setConfig` key, and the split is the security property
   * {@link DesktopConfigPatch} describes: that patch is a merge of five
   * user-facing values, while this one repoints the app's entire storage and
   * ends the process. Folding it in would put `dataDir` inside a `strictObject`
   * whose whole job is to reject it.
   *
   * The two-call shape the wizard uses — `chooseDirectory` for the dialog, then
   * this to commit — is why the sync-folder gate is HERE and not in the picker:
   * a caller can arrive with a path from anywhere, and only the write is a
   * chokepoint every path goes through.
   */
  setDataDir(opts: SetDataDirOptions): Promise<SetDataDirResult>;

  // updates (§11)
  checkForUpdates(): Promise<DesktopUpdateCheckResult>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): Promise<void>;
  onUpdateEvent(cb: (e: DesktopUpdateEvent) => void): Unsubscribe;

  // capabilities (§12)
  readonly capabilities: DesktopCapabilitiesApi;

  /**
   * §14: the native menu's labels, localized. The renderer resolves them from
   * `@adminium/i18n` and calls this on first paint AND whenever the locale
   * changes ("the menu rebuilds on locale change"); the main process rebuilds
   * the native menu from them.
   *
   * A native affordance requiring main-process authority, which is what earns it
   * a place on this deliberately minimal object: the OS menu bar is a
   * main-process object the server cannot own, so this is not a REST call that
   * would work on self-host — there is no native menu there. It is one named
   * method over one channel, not a generic `send`; a renderer cannot reach any
   * other channel through it.
   */
  setMenuLabels(labels: DesktopMenuLabels): Promise<void>;

  // about / diagnostics (§13)
  /**
   * §13's diagnostics figure the renderer cannot get on its own — the size of
   * the data directory. A filesystem walk, so it is async and belongs to the
   * process that has filesystem access.
   */
  getDiagnostics(): Promise<DesktopDiagnostics>;
  /**
   * §13's in-app licence viewers: the bundled `LICENSE` (the AGPL text) and the
   * generated `THIRD-PARTY-NOTICES.txt`. `null` when the file is absent — the
   * notices exist only in a packaged build (they are generated by
   * `scripts/generate-notices.mjs` at build), so a dev run legitimately has
   * none, and the viewer says so rather than showing an error.
   */
  readBundledText(kind: DesktopBundledTextKind): Promise<string | null>;

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
