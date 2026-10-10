// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The preload bridge contract, verbatim.
 *
 * "Typed contract lives in `apps/desktop/src/preload/api.d.ts` and is
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
 * So a single `import type { DesktopConfig } from './main/config.js'` here —
 * tempting, since literally writes `Partial<Pick<DesktopConfig, …>>` — would
 * drag `main/config.ts` (zod, `node:fs`, `node:path`) into the dashboard's tsc
 * program and break the sentence this file exists to satisfy. The subset is
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
 * ─── `?: T | undefined` rather than `?: T` ───────────────────────────────────
 *
 * The repo compiles with `exactOptionalPropertyTypes` (tsconfig.base.json), under
 * which `{ defaultPath?: string }` forbids passing an EXPLICIT `undefined` —
 * `chooseDirectory({ title, defaultPath: maybeUndefined })`, the exact call a SPA
 * makes, would not compile. The doc's `?:` means "optional", not "must be
 * absent", so the optional members below are widened with `| undefined`. This is
 * the same convention `src/main/config.ts` and `src/main/window.ts` already use.
 */

// ─── Static properties ───────────────────────────────────────────────────────

/** Narrower than `NodeJS.Platform`: these are the three build targets. */
export type DesktopPlatform = 'darwin' | 'win32' | 'linux';

/** The About screen renders all four. */
export interface DesktopVersions {
  /** `app.getVersion()`; the packaged app version, not the server's. */
  readonly app: string;
  readonly electron: string;
  readonly chrome: string;
  readonly node: string;
}

// ─── File dialogs ────────────────────────────────────────────────────────────

/**
 * `openFile`. The kind picks the native filter list rather than letting the
 * renderer supply one: a caller-chosen filter is a caller-chosen file type, and
 * this is the untrusted side of the bridge.
 *
 * `sqlite` is "Open an existing SQLite file"; `schema` is the first-run
 * Prisma schema import; `backup` is a archive.
 */
export type OpenFileKind = 'sqlite' | 'schema' | 'backup' | 'any';

/** `saveFile`: a backup archive, or a data export from the SPA. */
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

/** `updates.mode`. */
export type DesktopUpdateMode = 'notify' | 'manual' | 'disabled';

/** `plain` makes the About screen show its warning banner. */
export type DesktopSecretStorage = 'safeStorage' | 'plain';

/** `lanShare`, plus the panel's reachable URLs. */
export interface DesktopLanShareInfo {
  readonly enabled: boolean;
  readonly port: number;
  /**
   * `http://<LAN-IPv4>:<port>` per non-internal interface. Empty while
   * sharing is off — there is nothing reachable to list.
   */
  readonly urls: readonly string[];
}

/** `getRuntimeInfo()`. */
export interface DesktopRuntimeInfo {
  readonly dataDir: string;
  /** The resolved loopback port. The child listens on `:0`. */
  readonly serverPort: number;
  readonly singleUser: boolean;
  readonly lanShare: DesktopLanShareInfo;
  readonly updates: { readonly mode: DesktopUpdateMode };
  readonly secretStorage: DesktopSecretStorage;
}

/** `lanShare`. */
export interface DesktopLanShareConfig {
  readonly enabled: boolean;
  readonly port: number;
}

/** `updates`. */
export interface DesktopUpdatesConfig {
  readonly mode: DesktopUpdateMode;
}

/** `autoBackup`. */
export interface DesktopAutoBackupConfig {
  readonly enabled: boolean;
  /** Archives retained by the rotation. */
  readonly keep: number;
}

/**
 * `setConfig`: `Partial<Pick<DesktopConfig, "singleUser" | "lanShare" |
 * "updates" | "telemetryOptIn" | "autoBackup">>`.
 *
 * The five keys are exactly the user-facing ones ("Everything user-facing in
 * this file is also editable from the dashboard's desktop settings panel").
 * The absences are the security property: `dataDir` would repoint the app's
 * storage, `secretEncrypted`/`secretPlain` are the master secret, `version`
 * drives migration, and `window` is persisted by the window manager — none
 * may be written by a renderer, so none of them exists here, and
 * `src/main/ipc.ts` parses this with a `strictObject` so a smuggled key is a
 * rejection rather than a silent merge.
 */
export interface DesktopConfigPatch {
  /** The language of the app's own screens (a locale tag such as `de-DE`), or `null`: the system's. */
  readonly language?: string | null | undefined;
  /** Light, dark, or as the system is, for the app's own screens. */
  readonly theme?: 'system' | 'light' | 'dark' | undefined;
  readonly singleUser?: boolean | undefined;
  readonly lanShare?: DesktopLanShareConfig | undefined;
  readonly updates?: DesktopUpdatesConfig | undefined;
  readonly telemetryOptIn?: boolean | undefined;
  readonly autoBackup?: DesktopAutoBackupConfig | undefined;
}

// ─── Data directory ──────────────────────────────────────────────────────────

/** The four providers names. Mirrors `main/config.ts`'s union. */
export type DesktopCloudSyncProvider = 'dropbox' | 'icloud' | 'onedrive' | 'googleDrive';

/**
 * A cloud-sync folder the wizard must warn about, as `main/config.ts`'s
 * `detectCloudSyncFolder` reports it.
 *
 * The DETECTOR is the main process's and stays there — it is, it knows the
 * platform's mount shapes, and a second copy in the SPA is a second answer.
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
   * The "require explicit confirmation" rule. FALSE (or absent) means the
   * user has not seen the warning yet, and a path inside a sync folder is
   * REFUSED rather than written — see {@link SetDataDirResult}.
   */
  readonly acknowledgeCloudSync?: boolean | undefined;
}

/**
 * Why this is a RESULT and not a `Promise<void>` that rejects.
 *
 * The warning is blocking and needs the provider's name in its copy, and a
 * rejection cannot carry one: `main/ipc.ts` flattens a throw to `{ code, message
 * }` and nothing else survives (see {@link DesktopBridgeErrorLike}). Encoding a
 * brand name into a message for the renderer to parse back out is what
 * `LAN_PORT_IN_USE` had to do, and that was a concession to an existing error
 * channel, not a pattern to copy.
 *
 * The refusal lives on the TRUSTED side on purpose. The renderer cannot reach
 * `detectCloudSyncFolder`, so a wizard that forgot to check — or a future caller
 * that never knew to — cannot write a data directory into Dropbox. The check is
 * not advice this method gives; it is a gate this method holds.
 */
export type SetDataDirResult =
  /**
   * Written. The app RELAUNCHES: `dataDir` decides how the server is forked, and
   * the child froze its copy at boot — so there is no in-place way to move it,
   * is explicit that changing it later is "a guarded operation (quit-and-move
   * instructions)". The caller should expect this promise's resolution to be the
   * last thing that happens in this window.
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

// ─── Updates ─────────────────────────────────────────────────────────────────

export type DesktopUpdateStatus = 'available' | 'none' | 'error';

/** `checkForUpdates()`. */
export interface DesktopUpdateCheckResult {
  readonly status: DesktopUpdateStatus;
  readonly version?: string | undefined;
}

export type DesktopUpdateEventType = 'available' | 'progress' | 'downloaded' | 'error';

/** `onUpdateEvent`. */
export interface DesktopUpdateEvent {
  readonly type: DesktopUpdateEventType;
  readonly version?: string | undefined;
  /** 0–100, on `progress`. */
  readonly percent?: number | undefined;
  readonly message?: string | undefined;
}

/** `onUpdateEvent` returns its own unsubscriber. */
export type Unsubscribe = () => void;

// ─── About / diagnostics ─────────────────────────────────────────────────────

/**
 * The diagnostic blob's "dataDir size" — the one figure in it the
 * renderer cannot compute. The versions and platform are already on this object,
 * the locale is the SPA's, but the size of the data directory is a filesystem
 * walk only the main process can do (the renderer has no path access at all).
 * Kept to that one number: a diagnostics bundle is "NO user data", so this
 * carries a byte count and nothing that could name a file, a table, or a row.
 */
export interface DesktopDiagnostics {
  /** Total size on disk of `dataDir`, in bytes. `0` if it cannot be read. */
  readonly dataDirBytes: number;
}

/**
 * The two in-app viewers: the bundled AGPL `LICENSE` and the generated
 * `resources/THIRD-PARTY-NOTICES.txt`. Both are files inside the packaged app,
 * which only the main process can locate (`process.resourcesPath` is not a
 * renderer concept) — so reading them is a native affordance, not a REST call.
 */
export type DesktopBundledTextKind = 'license' | 'third-party-notices';

// ─── Capabilities ────────────────────────────────────────────────────────────

/**
 * VERBATIM — and frozen together with manifest `capabilities` field, so
 * changing it is a cross-document decision, not a refactor.
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

// ─── Native menu labels ──────────────────────────────────────────────────────

/**
 * Every label the native menu shows that the shell OWNS — the top-level titles
 * and the File/Help commands. NOT the Edit/View/Window role items, whose
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
 * - `INVALID_PAYLOAD` — zod rejected the renderer's arguments (the
 * renderer is the untrusted side).
 * - `UNTRUSTED_SENDER` — the message did not come from a frame allowed to use
 *   the bridge.
 * - `UNAVAILABLE` — the feature is not wired in this build/state: notably
 * `updates.mode: "disabled"`, where requires the updater to never be
 *   INITIALIZED, not merely never asked.
 * - `CAPABILITY_NOT_GRANTED` / `CAPABILITY_STUB` — typed rejections,
 * forwarded from the CapabilityHost so the SPA sees them unchanged.
 * - `LAN_PORT_IN_USE` — port collision, refused by `setConfig` BEFORE anything
 * is written or restarted. It is a code and not an `INTERNAL` message because
 * asks for "an inline error with a 'Try 4601' suggestion", and a settings form
 * can only render a suggestion for a failure it can identify; the suggested
 * port rides in the message (see `main/lan.ts`'s `suggestNextPort`).
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
 * `desktopErrorCode()` helper, which falls back to the prefix. (already sets
 * this precedent: `printer-escpos.ts` rejects with `` `${CAPABILITY_STUB}: …`
 * ``.)
 */
export interface DesktopBridgeErrorLike extends Error {
  readonly code: DesktopErrorCode;
}

// ─── The first screens ───────────────────────────────────────────────────────

/** A project in the recent list, as Start draws it. */
export interface DesktopRecentProject {
  /** The folder, by its real path: what is handed back to open, locate or remove it. */
  readonly path: string;
  /** The same path as a person reads it (`~/Adminium/shop` under the home folder). */
  readonly displayPath: string;
  readonly name: string;
  /** When it was last opened here (ISO 8601). */
  readonly lastOpened: string;
  readonly state: 'building' | 'shared';
  /** The folder is gone, or is no longer a project. */
  readonly missing: boolean;
}

export type DesktopThemeChoice = 'system' | 'light' | 'dark';

/** What Start needs to draw itself. */
export interface DesktopStartState {
  /** No recent project and no classic workspace: the welcome line is shown. */
  readonly firstLaunch: boolean;
  readonly recent: readonly DesktopRecentProject[];
  /** Where a new project is proposed (`~/Adminium`), real and as a person reads it. */
  readonly proposedParent: string;
  /** The same folder as a person reads it. */
  readonly proposedParentDisplay: string;
  /** The app's saved language (a locale tag), or `null`: the system's. */
  readonly language: string | null;
  readonly theme: DesktopThemeChoice;
}

/** Why a folder cannot hold a new project. */
export type DesktopFolderRefusal =
  | 'no-name'
  | 'bad-name'
  | 'home-folder'
  | 'system-folder'
  | 'inside-the-app'
  | 'inside-a-project'
  | 'exists-with-files'
  | 'not-absolute';

/** What a person is warned of and may still choose. */
export type DesktopFolderWarning = 'icloud' | 'onedrive' | 'dropbox' | 'googledrive' | 'no-links';

export interface DesktopNewFolderInput {
  /** The folder the project's own folder is made IN. */
  readonly parent: string;
  /** The project's name as the person typed it. */
  readonly name: string;
}

/** Main's judgement of where a new project would go. */
export type DesktopNewFolderJudgement =
  | { readonly ok: true; readonly path: string; readonly displayPath: string; readonly warning: DesktopFolderWarning | null }
  | { readonly ok: false; readonly path: string | null; readonly displayPath: string | null; readonly refused: DesktopFolderRefusal };

export interface DesktopCreateProjectInput extends DesktopNewFolderInput {
  /** The person read the warning and chose "Use it anyway". */
  readonly acceptWarning?: boolean | undefined;
}

export type DesktopCreateProjectResult =
  | { readonly status: 'created'; readonly path: string }
  | { readonly status: 'refused'; readonly refused: DesktopFolderRefusal }
  | { readonly status: 'warned'; readonly warning: DesktopFolderWarning }
  | { readonly status: 'failed'; readonly detail: string };

/** A screen shown on the way into a folder, which the person has read ("Continue"). */
export type DesktopOpenStep = 'manager' | 'engine' | 'found' | 'accounts';

/** What was found in a folder, or made for it, one line each. */
export type DesktopFoundRow = 'data' | 'key' | 'no-data' | 'made-key-and-database' | 'made-database';

/** People, API keys and public keys a folder brought with it: how many, and the first names of each. */
export interface DesktopFolderAccounts {
  readonly people: { readonly count: number; readonly names: readonly string[] };
  readonly apiKeys: { readonly count: number; readonly names: readonly string[] };
  readonly publicKeys: { readonly count: number; readonly names: readonly string[] };
}

export interface DesktopOpenProjectInput {
  readonly path: string;
  /** The screens already shown and continued from, in this opening. */
  readonly seen?: readonly DesktopOpenStep[] | undefined;
  /** The person answered "Open" to the question about running this folder's code. */
  readonly agreed?: boolean | undefined;
  /** Where the window lands once the project is up: the Designer (the default), or the project's dashboard. */
  readonly land?: 'designer' | 'dashboard' | undefined;
}

export type DesktopOpenProjectResult =
  | { readonly status: 'opened' }
  /** Not agreed to yet on this computer, or its code changed since: ask, then call again with `agreed`. */
  | { readonly status: 'trust-needed'; readonly path: string; readonly displayPath: string; readonly changed: boolean }
  | { readonly status: 'missing' }
  | { readonly status: 'not-a-project' }
  /** Agreed to, and what it is built with is not on this computer: ask, then call `getPackages`. */
  | { readonly status: 'needs-packages'; readonly path: string; readonly displayPath: string }
  /** A server already has this folder (a terminal's, or another window's). */
  | { readonly status: 'running'; readonly path: string; readonly port: number; readonly by: 'cli' | 'desktop' }
  /** Its data was last changed by a newer Adminium than this one: nothing is started. */
  | { readonly status: 'needs-newer'; readonly path: string; readonly last: string | null; readonly here: string }
  /** Its data is there and the key it was written with is not: ask (three answers), then `resolveKey`. */
  | { readonly status: 'key-missing'; readonly path: string; readonly displayPath: string; readonly name: string; readonly dataBefore: string }
  /** It was made with another package manager: said once. Call again with `seen: ['manager']`. */
  | { readonly status: 'other-manager'; readonly path: string; readonly displayPath: string; readonly manager: string }
  /** Its own code imports an older Adminium than the one that serves it: offer `updateProject`, or go on. */
  | { readonly status: 'older-engine'; readonly path: string; readonly displayPath: string; readonly was: string; readonly here: string }
  /** What was found in the folder or made for it. Call again with `seen` including `'found'`. */
  | { readonly status: 'found'; readonly path: string; readonly displayPath: string; readonly name: string; readonly rows: readonly DesktopFoundRow[] }
  /** It came with accounts made on another computer. Call again with `seen` including `'accounts'`. */
  | { readonly status: 'accounts'; readonly path: string; readonly displayPath: string; readonly accounts: DesktopFolderAccounts };

/** The answer to a missing key: the person's `.env` file (picked now), the data moved aside, or a new key over it. */
export type DesktopResolveKeyResult =
  | { readonly status: 'done' }
  | { readonly status: 'cancelled' }
  /** The picked file holds no key. */
  | { readonly status: 'not-a-key-file' }
  | { readonly status: 'trust-needed' }
  | { readonly status: 'failed'; readonly detail: string };

export type DesktopUpdateProjectResult = { readonly status: 'updated' } | { readonly status: 'trust-needed' } | { readonly status: 'failed'; readonly detail: string };

/** `getPackages`: the packages were fetched and the project is opening, or why not. */
export type DesktopGetPackagesResult =
  | { readonly status: 'opened' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'missing' }
  | { readonly status: 'not-a-project' }
  /** Not a folder the person agreed to open, or its code changed since: `openProject` asks first. */
  | { readonly status: 'trust-needed' };

export type DesktopLocateProjectResult =
  | { readonly status: 'located'; readonly recent: readonly DesktopRecentProject[] }
  | { readonly status: 'cancelled' }
  | { readonly status: 'not-a-project' }
  | { readonly status: 'already-listed' };

/**
 * Where the making of a new project is, in the order it goes: the files are
 * laid, the packages are fetched (the long one), the database is made, and the
 * project is opened.
 */
export type DesktopMakeStep = 'files' | 'packages' | 'database' | 'opening';

/** `step` is `null` when nothing is being made. `since` is when that step began (milliseconds, the app's clock). */
export interface DesktopMakeProgress {
  readonly step: DesktopMakeStep | null;
  readonly since: number;
}

/**
 * What the app's own first screens ask of main. Answered ONLY for the app's own
 * pages: a project's dashboard, which holds the rest of this bridge, is refused
 * (a page a project's code can draw into must not be able to open another folder).
 */
export interface DesktopStartApi {
  state(): Promise<DesktopStartState>;
  judgeNewFolder(input: DesktopNewFolderInput): Promise<DesktopNewFolderJudgement>;
  /** The system's folder picker, for "Change…". `null` on cancel. */
  chooseParent(input: { readonly from: string; readonly title: string }): Promise<string | null>;
  createProject(input: DesktopCreateProjectInput): Promise<DesktopCreateProjectResult>;
  /** Where `createProject` is, asked while it runs: the page shows the step so a long wait is not a silent one. */
  makeProgress(): Promise<DesktopMakeProgress>;
  /** The system's folder picker, for "Open a folder". `null` on cancel. */
  chooseFolder(input: { readonly title: string }): Promise<{ readonly path: string; readonly displayPath: string } | null>;
  openProject(input: DesktopOpenProjectInput): Promise<DesktopOpenProjectResult>;
  /** After `needs-packages` and a yes: fetch what the project is built with, then open it. Takes minutes on a slow line. */
  getPackages(input: { readonly path: string; readonly land?: 'designer' | 'dashboard' | undefined }): Promise<DesktopGetPackagesResult>;
  /** After `key-missing`. `env` opens the system's file picker (`title` is its title). */
  resolveKey(input: { readonly path: string; readonly answer: 'env' | 'fresh' | 'new'; readonly title?: string | undefined }): Promise<DesktopResolveKeyResult>;
  /** After `older-engine` and a yes: the project's own Adminium is set to this app's and its packages fetched again. */
  updateProject(input: { readonly path: string }): Promise<DesktopUpdateProjectResult>;
  /** After `needs-newer`: look for a newer Adminium now. `false` in a build that does not update itself. */
  updateApp(): Promise<boolean>;
  forgetProject(path: string): Promise<readonly DesktopRecentProject[]>;
  /** "Locate…": the system's folder picker, then the entry moves there. */
  locateProject(input: { readonly path: string; readonly title: string }): Promise<DesktopLocateProjectResult>;
  /** "Use my own database": the classic workspace. */
  useClassic(): Promise<void>;
}

// ─── A project the window holds ──────────────────────────────────────────────

/** The project folder this window serves. */
export interface DesktopProjectInfo {
  readonly name: string;
  /** The folder, as a person reads it (`~/Adminium/shop`). */
  readonly displayPath: string;
  /** `design`: being built, on this computer only. `serve`: shared. */
  readonly mode: 'design' | 'serve';
}

/**
 * The words of the one question the app asks in a native dialog while a project
 * is open: "stop what is running?", before a quit or "Close project". The app
 * has no translations of its own (as with the menu), so the page that has them
 * hands them over; until it has, the question is asked in English.
 */
export interface DesktopStopWords {
  /** What is running, by the kind the server names. */
  readonly turn: string;
  readonly start: string;
  readonly save: string;
  readonly restore: string;
  readonly style: string;
  /** A kind this page does not know. */
  readonly other: string;
  readonly quitDetail: string;
  readonly closeDetail: string;
  readonly quitAnyway: string;
  readonly closeAnyway: string;
  readonly keepWorking: string;
  /** Before a project being built is shared instead. */
  readonly shareDetail: string;
  readonly shareAnyway: string;
}

/** How far a download of git is, or why it did not finish. */
export type DesktopVersionsDownload =
  | { readonly phase: 'idle' }
  | { readonly phase: 'downloading'; readonly received: number; readonly total: number }
  | { readonly phase: 'failed'; readonly reason: 'no-connection' | 'wrong-file' | 'failed' };

/** Versions of a project's work need git. What the app knows of it on this computer. */
export interface DesktopVersionsState {
  /** A git that works is known: versions are on. */
  readonly on: boolean;
  /** The person said "Not now" to the offer on this computer. */
  readonly declined: boolean;
  /** The download's size in megabytes, or `null`: there is none for this kind of computer. */
  readonly megabytes: number | null;
  /** A Mac: Apple's own developer tools are the other road. */
  readonly appleTools: boolean;
  readonly download: DesktopVersionsDownload;
}

/**
 * The offer to keep versions, on a computer with no git. Nothing is fetched
 * before `download()`, which only the person's own click calls.
 */
export interface DesktopVersionsApi {
  state(): Promise<DesktopVersionsState>;
  /** Starts the download and answers at once: ask `state()` for how far it is. */
  download(): Promise<DesktopVersionsState>;
  cancel(): Promise<DesktopVersionsState>;
  notNow(): Promise<DesktopVersionsState>;
  /** A git installed since the project was opened is found without a restart. */
  lookAgain(): Promise<DesktopVersionsState>;
  /** macOS: start Apple's own installer of its developer tools. */
  appleTools(): Promise<DesktopVersionsState>;
}

/** What an export holds: everything (the apps, the data, the key), or the apps only. */
export type DesktopExportKind = 'everything' | 'apps';

export type DesktopExportResult =
  /** Saved. `megabytes` is the file's size, rounded up to one decimal. */
  | { readonly status: 'saved'; readonly file: string; readonly megabytes: number }
  | { readonly status: 'cancelled' }
  /** Something is in the middle of running: export when it is done. */
  | { readonly status: 'busy' }
  | { readonly status: 'failed'; readonly detail: string };

/** One address another device can use for a shared project. */
export interface DesktopShareAddress {
  readonly url: string;
  /** The network it is on (`en0`, `Wi-Fi`); `null` for the computer's own name. */
  readonly via: string | null;
  /** The one to give out first. */
  readonly best: boolean;
}

/** A project that is shared on the network now. */
export interface DesktopShareInfo {
  readonly name: string;
  readonly port: number;
  /** Empty when this computer is on no network. */
  readonly addresses: readonly DesktopShareAddress[];
  /** The port this project was shared on before, when it could not be had again: the address changed. */
  readonly changedFrom: number | null;
  /** The app's saved language and theme, for the app's own page that shows this. */
  readonly language: string | null;
  readonly theme: DesktopThemeChoice;
}

export type DesktopShareResult =
  | { readonly status: 'shared' }
  /** The owner has no password yet: other devices could not sign in. Set one, then ask again. */
  | { readonly status: 'needs-password' }
  /** Something was running and the person chose to keep working. */
  | { readonly status: 'kept-working' }
  | { readonly status: 'failed'; readonly detail: string };

/**
 * What a project's own page asks of the app. Each call names nothing: it acts
 * on the project this window holds, so a page cannot point it at another folder.
 */
export interface DesktopProjectApi {
  /** `null` in the classic workspace: the window holds no project. */
  info(): Promise<DesktopProjectInfo | null>;
  /** "Show in Finder" / "Show in File Explorer": the project's folder. */
  showInFolder(): Promise<void>;
  /**
   * "Close project": back to the app's first screen. `false` when the person
   * chose to keep working (something was in the middle of running).
   */
  close(): Promise<boolean>;
  /**
   * "Export this project…": the system's save dialog (`title` is its title),
   * then one ZIP. The project stops for the moment the file is made, so the
   * page that asked is gone when it is done: the outcome is read with
   * `exportResult()` by the page that comes back. Absent in an older app.
   */
  export?(input: { readonly kind: DesktopExportKind; readonly title: string; /** The page to come back to (a path of the project's own server). */ readonly from?: string | undefined }): Promise<DesktopExportResult>;
  /** The outcome of the last export, once: `null` when there is none to tell. */
  exportResult?(): Promise<DesktopExportResult | null>;
  /** Show the file the last export saved, in the system's file manager. */
  showExport?(): Promise<void>;
  /**
   * Build → Share: the project is served on the network, with the Designer
   * off. Absent in an app older than sharing.
   */
  share?(): Promise<DesktopShareResult>;
  /** Share → Build: back to this computer only. `false` when the person kept sharing. */
  build?(): Promise<boolean>;
  /** `null` while the project is being built. */
  shareInfo?(): Promise<DesktopShareInfo | null>;
  /** While shared: the window shows the sharing details (the app's own page). */
  showShared?(): Promise<void>;
  /** While shared, from the sharing details: the window shows the project's dashboard. */
  openDashboard?(): Promise<void>;
  /** The quit and close questions in the page's language. Absent in an app older than the call. */
  setStopWords?(words: DesktopStopWords): Promise<void>;
  /** Absent in an app older than the offer. */
  readonly versions?: DesktopVersionsApi | undefined;
}

// ─── The API ─────────────────────────────────────────────────────────────────

/**
 * `AdminiumDesktopApi` — deliberately minimal. Everything else the SPA
 * needs comes from the server REST API."
 *
 * That sentence is the review criterion for anything added here: this object is
 * the shell's entire attack surface and the one part of the SPA that cannot
 * exist on self-host or Cloud. A method belongs on it only if it needs
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
   * Merge a patch into `config.json` and apply whatever it implies.
   *
   * NOT a pure write, and the one key where that matters is `lanShare`: the toggle
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
   * The wizard's "Change…", committed.
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

  // updates
  checkForUpdates(): Promise<DesktopUpdateCheckResult>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): Promise<void>;
  onUpdateEvent(cb: (e: DesktopUpdateEvent) => void): Unsubscribe;

  // capabilities
  readonly capabilities: DesktopCapabilitiesApi;

  /**
   * The native menu's labels, localized. The renderer resolves them from
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

  // about / diagnostics
  /**
   * The diagnostics figure the renderer cannot get on its own — the size of
   * the data directory. A filesystem walk, so it is async and belongs to the
   * process that has filesystem access.
   */
  getDiagnostics(): Promise<DesktopDiagnostics>;
  /**
   * The in-app licence viewers: the bundled `LICENSE` (the AGPL text) and the
   * generated `THIRD-PARTY-NOTICES.txt`. `null` when the file is absent — the
   * notices exist only in a packaged build (they are generated by
   * `scripts/generate-notices.mjs` at build), so a dev run legitimately has
   * none, and the viewer says so rather than showing an error.
   */
  readBundledText(kind: DesktopBundledTextKind): Promise<string | null>;

  relaunch(): Promise<void>;
  showLogs(): Promise<void>;

  // the first screens (the app's own pages only)
  readonly start: DesktopStartApi;

  // the project this window holds
  readonly project: DesktopProjectApi;
}

/**
 * The detection contract, and it is load-bearing in both directions:
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
