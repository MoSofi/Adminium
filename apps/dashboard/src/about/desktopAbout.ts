/**
 * The desktop-only half of the About screen (11-electron.md §13), as the SPA
 * sees it — the bridge reads and the one server write the §13 panel needs.
 *
 * ─── Why this is a SEPARATE module from `aboutApi.ts` ─────────────────────────
 *
 * `aboutApi.ts` is the About page every runtime shows: version, licence, the
 * AGPL source offer. This file is the extra §13 fields that exist ONLY in the
 * desktop shell — the Electron/Chromium versions, the data directory, the
 * secret-storage mode, the in-app licence viewers, the diagnostics blob. They
 * come from the §4 preload bridge (a native affordance, per
 * `lib/desktop-runtime.ts`'s rule), which is absent on self-host and Cloud — so
 * keeping them here keeps `aboutApi.ts` free of any `window.adminiumDesktop`
 * reference and the shared About surface working in all three runtimes.
 *
 * Feature gating still is not this file's job (that is `system/info`'s, per the
 * detection contract); this is only the data plumbing for affordances the shell
 * has and a browser does not.
 */
import { queryOptions } from '@tanstack/react-query';
import type {
  DesktopBundledTextKind,
  DesktopPlatform,
  DesktopRuntimeInfo,
  DesktopVersions,
} from '@adminium/desktop/api';

import { api } from '../app/api.js';
import { getDesktopApi } from '../lib/desktop-runtime.js';

export type { DesktopPlatform, DesktopRuntimeInfo, DesktopVersions } from '@adminium/desktop/api';

export const DESKTOP_ABOUT_QUERY_KEY = ['about', 'desktop-runtime'] as const;

/**
 * §2.2's runtime facts the §13 panel renders: `dataDir`, `secretStorage`,
 * `updates.mode`. `null` when there is no bridge — the panel then renders
 * nothing desktop-specific, which is the honest state in a browser tab.
 */
export function desktopRuntimeQuery() {
  return queryOptions({
    queryKey: DESKTOP_ABOUT_QUERY_KEY,
    queryFn: async (): Promise<DesktopRuntimeInfo | null> => {
      const desktop = getDesktopApi();
      if (desktop === null) return null;
      return desktop.getRuntimeInfo();
    },
    // `config.json` only changes through the settings panel or a relaunch; the
    // versions and dataDir never change for a boot. No polling.
    staleTime: Infinity,
  });
}

/** §4's static `versions`, or `null` off the desktop shell. */
export function desktopVersions(): DesktopVersions | null {
  return getDesktopApi()?.versions ?? null;
}

/** §4's static `platform`, or `null` off the desktop shell. */
export function desktopPlatform(): DesktopPlatform | null {
  return getDesktopApi()?.platform ?? null;
}

/** §13: reveal the data directory in the OS file manager. No-op with no bridge. */
export async function revealPath(path: string): Promise<void> {
  await getDesktopApi()?.showItemInFolder(path);
}

/** §13's "Show logs". No-op with no bridge. */
export async function showLogs(): Promise<void> {
  await getDesktopApi()?.showLogs();
}

/**
 * §13's in-app licence viewers. `null` when there is no bridge OR the bundled
 * file is absent (a dev build has no generated notices — see the bridge method).
 */
export async function readBundledText(kind: DesktopBundledTextKind): Promise<string | null> {
  const desktop = getDesktopApi();
  if (desktop === null) return null;
  return desktop.readBundledText(kind);
}

/**
 * §11's "Check for updates" button (§13). Rejects with `UNAVAILABLE` in
 * `disabled` mode (the updater is never constructed, §11) — the caller renders
 * that as "updates are off" rather than an error.
 */
export type DesktopUpdateOutcome =
  | { status: 'available'; version?: string | undefined }
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'unavailable' };

export async function checkForUpdates(): Promise<DesktopUpdateOutcome> {
  const desktop = getDesktopApi();
  if (desktop === null) return { status: 'unavailable' };
  try {
    const result = await desktop.checkForUpdates();
    if (result.status === 'available') return { status: 'available', version: result.version };
    return { status: result.status };
  } catch {
    // §4 `UNAVAILABLE` (disabled mode) and any transient failure land here; the
    // §13 panel already shows the mode, so "unavailable" is the honest umbrella.
    return { status: 'unavailable' };
  }
}

// ─── Telemetry toggle (§13) ──────────────────────────────────────────────────

/** `GET`/`PUT /api/v1/settings/telemetry` — mirrors `routes/settings/schema.ts`. */
export interface TelemetrySettings {
  telemetry: boolean;
  updateCheck: boolean;
}

interface TelemetryEnvelope {
  data: TelemetrySettings;
}

/**
 * Write the telemetry opt-in (§13's toggle). The route is a FULL write of both
 * consents, so the current `updateCheck` rides along unchanged — sending only
 * `telemetry` would silently flip the update-check preference off. Both come
 * from `aboutQuery` at the call site.
 */
export async function setTelemetry(next: TelemetrySettings): Promise<TelemetrySettings> {
  return (await api.put<TelemetryEnvelope>('/api/v1/settings/telemetry', next)).data;
}

// ─── Diagnostics (§13) ───────────────────────────────────────────────────────

/**
 * Human-readable byte size for the diagnostics blob and the panel. Base-1024
 * with one decimal above KB, matching what a file manager shows.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'KB'}`;
}

/** Everything §13's "Copy diagnostic info" is allowed to carry — NO user data. */
export interface DiagnosticsInput {
  appVersion: string | undefined;
  serverVersion: string;
  metaMigrationVersion: string | null;
  electron: string | undefined;
  chromium: string | undefined;
  node: string | undefined;
  platform: DesktopPlatform | null;
  dataDirBytes: number | null;
  secretStorage: string | undefined;
  updateMode: string | undefined;
  locale: string;
}

/**
 * The plain-text blob §13's "Copy diagnostic info" copies to the clipboard.
 *
 * Deliberately assembled here, not on the bridge: the rule is "NO user data",
 * and the only way to keep that a reviewable property is to build the string
 * from a closed, named set of fields the reader can see — versions, platform, a
 * byte COUNT, the locale. Nothing here can name a table, a row, a path inside
 * the data directory, or a person.
 */
export function buildDiagnostics(input: DiagnosticsInput): string {
  const lines = [
    'Adminium desktop diagnostics',
    `App version: ${input.appVersion ?? 'unknown'}`,
    `Server version: ${input.serverVersion}`,
    `Meta-store migration: ${input.metaMigrationVersion ?? 'unknown'}`,
    `Electron: ${input.electron ?? 'unknown'}`,
    `Chromium: ${input.chromium ?? 'unknown'}`,
    `Node: ${input.node ?? 'unknown'}`,
    `Platform: ${input.platform ?? 'unknown'}`,
    `Data size: ${input.dataDirBytes === null ? 'unknown' : formatBytes(input.dataDirBytes)}`,
    `Secret storage: ${input.secretStorage ?? 'unknown'}`,
    `Update mode: ${input.updateMode ?? 'unknown'}`,
    `Locale: ${input.locale}`,
  ];
  return lines.join('\n');
}

/** The data directory's size in bytes, or `null` with no bridge (§13 diagnostics). */
export async function dataDirBytes(): Promise<number | null> {
  const desktop = getDesktopApi();
  if (desktop === null) return null;
  return (await desktop.getDiagnostics()).dataDirBytes;
}
