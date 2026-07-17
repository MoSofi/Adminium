/**
 * UpdateManager — `electron-updater` integration (11-electron.md §11).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STUB. **11-T16 owns this file.** 11-T01 created it so the §3 tree exists │
 * │ and the scaffold builds; nothing calls `createUpdateManager` yet.        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The one rule that is a CORRECTNESS requirement rather than a preference:
 * `mode: "disabled"` (and `ADMINIUM_DISABLE_UPDATES=1`) must mean the updater is
 * **never initialized** — not initialized-then-not-asked. §7 and the acceptance
 * criteria promise an air-gapped install makes zero non-loopback requests, and
 * the offline smoke test (11-T09/11-T18) asserts it. `autoUpdater` checks on
 * construction in some configurations; constructing it behind the flag is the
 * bug that would fail that test.
 */

import type { UpdateMode } from './config.js';

export interface CreateUpdateManagerOptions {
  /** §11: `notify` (default) | `manual` | `disabled`. */
  mode: UpdateMode;
  // 11-T16: the notification pipeline (§11 routes events to the SPA's
  // notification centre via `onUpdateEvent`, §4) and the feed configuration.
}

export interface UpdateManager {
  /** §4: `{ status: "available" | "none" | "error"; version?: string }`. */
  checkForUpdates(): Promise<{ status: 'available' | 'none' | 'error'; version?: string }>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): void;
  dispose(): void;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- 11-T16 scaffold stub: the
   parameter list is the contract 11-T01 wired against and must survive until
   11-T16 implements the body. */
export function createUpdateManager(_opts: CreateUpdateManagerOptions): UpdateManager {
  throw new Error('src/main/updates.ts is a scaffold stub — 11-T16 implements it.');
}
