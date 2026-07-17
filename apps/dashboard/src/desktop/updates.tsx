/**
 * The SPA half of §11's auto-update, owned by 11-T16 ("notification-center
 * integration / SPA surfaces").
 *
 * ─── What was dead before this file ──────────────────────────────────────────
 *
 * The main process is fully wired: in `notify` mode `updates.ts` schedules a
 * launch check + a daily one, and its autoUpdater listeners `emit()` `available`
 * / `progress` / `downloaded` / `error` events that flow
 * `emit → ipc.emitUpdateEvent → windows.broadcast → preload.onUpdateEvent`. But
 * NOTHING in the SPA subscribed to `onUpdateEvent`, and nothing called
 * `downloadUpdate()` / `quitAndInstall()` — so a broadcast update event landed on
 * a channel with zero listeners and was dropped, and even a manually-discovered
 * update could not be downloaded or installed in-app. The whole pipeline was
 * green-but-broken: built and unit-tested in the main process, output falling off
 * the end because the renderer never consumed it (11-electron.md §11 acceptance:
 * "surfaces availability … downloads only on user action, and installs on
 * restart").
 *
 * ─── The two surfaces this file gives those events ───────────────────────────
 *
 *  - {@link useDesktopUpdateFlow} drives §13's About → Updates card: it subscribes
 *    to `onUpdateEvent`, tracks the available → downloading → downloaded lifecycle,
 *    and exposes the `download()` / `install()` actions the card's buttons call.
 *    This is where "downloads only on user action, and installs on restart" lives.
 *  - {@link DesktopUpdateToaster} is mounted app-wide by `AppShell` so a `notify`
 *    mode user who is NOT on the About page still learns a version shipped — the
 *    "surfaces availability" half. The real notification center is still the M7
 *    placeholder (09-T15), so a toast is the honest minimal surface; when that
 *    center lands it should consume `onUpdateEvent` here instead.
 *
 * ─── Why the bridge access is guarded ────────────────────────────────────────
 *
 * `onUpdateEvent` / `downloadUpdate` / `quitAndInstall` are §4 native affordances:
 * absent on self-host and Cloud (no bridge), and — in tests — absent on a partial
 * bridge stub. Every entry point here funnels through {@link getDesktopApi} and a
 * `typeof … === 'function'` check, so a browser tab, a self-host deploy, and a
 * settings-panel test that stubs only `getRuntimeInfo` all no-op rather than
 * throw.
 */
import { useCallback, useEffect, useReducer, useRef, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { DesktopUpdateEvent } from '@adminium/desktop/api';

import { t } from '../i18n/t.js';
import { getDesktopApi } from '../lib/desktop-runtime.js';
import { useAppToasts } from '../pages/toasts.js';

// ─── Guarded bridge access (§4) ──────────────────────────────────────────────

/**
 * Subscribe to §11's `onUpdateEvent` broadcasts. Returns an unsubscriber that is
 * safe to call even when there is no bridge (self-host / Cloud) or the bridge is
 * a partial stub without the channel — in which case NOTHING is subscribed and
 * the returned function is a no-op. This is the single reader §11's main-process
 * emitter was missing.
 */
export function subscribeDesktopUpdateEvents(cb: (event: DesktopUpdateEvent) => void): () => void {
  const desktop = getDesktopApi();
  if (desktop === null || typeof desktop.onUpdateEvent !== 'function') return () => {};
  return desktop.onUpdateEvent(cb);
}

/** §4 `downloadUpdate()` — the caller §11's download action never had. No-op with no bridge. */
async function downloadDesktopUpdate(): Promise<void> {
  await getDesktopApi()?.downloadUpdate();
}

/** §4 `quitAndInstall()` — the caller §11's "Restart to update" never had. No-op with no bridge. */
export async function installDesktopUpdate(): Promise<void> {
  await getDesktopApi()?.quitAndInstall();
}

// ─── The About-card flow (§13) ───────────────────────────────────────────────

/** §11's update lifecycle as the About card renders it. */
export type DesktopUpdatePhase = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface DesktopUpdateFlowState {
  phase: DesktopUpdatePhase;
  /** The version an `available`/`downloaded` event named, or `null`. */
  version: string | null;
  /** 0–100 while downloading. */
  percent: number;
  /** A download error's message (§11 only emits `error` for a download the user started). */
  errorMessage: string | null;
}

type FlowAction =
  | { kind: 'event'; event: DesktopUpdateEvent }
  | { kind: 'available'; version: string | null }
  | { kind: 'download-start' }
  | { kind: 'download-fail'; message: string };

const initialFlowState: DesktopUpdateFlowState = {
  phase: 'idle',
  version: null,
  percent: 0,
  errorMessage: null,
};

/**
 * Fold §11's events (and the two user actions) into the card's phase. A pure
 * reducer so the transitions are assertable without a bridge — the same testing
 * seam `updates.ts` uses on the main side.
 */
export function desktopUpdateFlowReducer(
  state: DesktopUpdateFlowState,
  action: FlowAction,
): DesktopUpdateFlowState {
  switch (action.kind) {
    case 'available':
      return { ...initialFlowState, phase: 'available', version: action.version };
    case 'download-start':
      // Optimistic: the first `progress` event replaces this, but a slow first
      // chunk should not leave the button looking un-clicked.
      return { ...state, phase: 'downloading', percent: 0, errorMessage: null };
    case 'download-fail':
      return { ...state, phase: 'error', errorMessage: action.message };
    case 'event': {
      const event = action.event;
      switch (event.type) {
        case 'available':
          return { ...initialFlowState, phase: 'available', version: event.version ?? null };
        case 'progress':
          return {
            ...state,
            phase: 'downloading',
            percent: clampPercent(event.percent),
            errorMessage: null,
          };
        case 'downloaded':
          return {
            ...state,
            phase: 'downloaded',
            version: event.version ?? state.version,
            errorMessage: null,
          };
        case 'error':
          // §11 emits `error` only for a download the user STARTED (a failed
          // CHECK stays silent), so treating it as a download failure is exact.
          return { ...state, phase: 'error', errorMessage: event.message ?? null };
      }
    }
  }
}

function clampPercent(percent: number | undefined): number {
  if (percent === undefined || !Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export interface DesktopUpdateFlow extends DesktopUpdateFlowState {
  /** §11 "downloads only on user action" — the About card's Download button. */
  download: () => void;
  /** §11 "installs on restart" — the About card's Restart-to-install button. */
  install: () => void;
  /** Seed the flow from a manual `checkForUpdates()` that returned `available`. */
  markAvailable: (version: string | undefined) => void;
}

/**
 * The About → Updates card's controller: subscribes to §11's events and exposes
 * the download/install actions. Idle and inert off the desktop shell (the guard
 * in {@link subscribeDesktopUpdateEvents}), so the card renders the same on
 * self-host — it simply never leaves `idle`.
 */
export function useDesktopUpdateFlow(): DesktopUpdateFlow {
  const [state, dispatch] = useReducer(desktopUpdateFlowReducer, initialFlowState);

  useEffect(
    () => subscribeDesktopUpdateEvents((event) => dispatch({ kind: 'event', event })),
    [],
  );

  const download = useCallback(() => {
    dispatch({ kind: 'download-start' });
    downloadDesktopUpdate().catch((error: unknown) => {
      // A self-replaceable target that stalled ALSO emits an `error` event (so
      // this is idempotent); a deb/rpm target rejects here WITHOUT an event,
      // carrying §11's "download from GitHub" message — the user's only signal.
      dispatch({
        kind: 'download-fail',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, []);

  const install = useCallback(() => {
    // `quitAndInstall` ends the app, so there is no post-state to set; a reject
    // (a package type that cannot self-replace) is logged by the bridge.
    void installDesktopUpdate();
  }, []);

  const markAvailable = useCallback(
    (version: string | undefined) => dispatch({ kind: 'available', version: version ?? null }),
    [],
  );

  return { ...state, download, install, markAvailable };
}

// ─── The app-wide notify surface (§11) ───────────────────────────────────────

/**
 * Mounted once by `AppShell` (inside the toast provider): the app-global surface
 * that keeps `notify` mode from being silently dead. When the scheduled check
 * finds a version, §11 broadcasts `available`; this raises a toast with a "View"
 * action to the About panel, so the user hears about it wherever they are — not
 * only if they happen to open About. On `downloaded` it offers "Restart now".
 *
 * Renders nothing and does nothing off the desktop shell (the subscribe guard),
 * so it is inert in a browser tab, on self-host, and in any test whose bridge
 * stub omits `onUpdateEvent`.
 *
 * Deduped by version: the 24 h re-check re-emits `available` for a version still
 * pending, and one toast per version is a notice, not nagging.
 */
export function DesktopUpdateToaster(): ReactNode {
  const toasts = useAppToasts();
  const navigate = useNavigate();
  const notified = useRef<Set<string>>(new Set());

  useEffect(
    () =>
      subscribeDesktopUpdateEvents((event) => {
        if (event.type === 'available') {
          const key = event.version ?? 'unknown';
          if (notified.current.has(key)) return;
          notified.current.add(key);
          toasts.push({
            variant: 'info',
            title: t('about.desktop.updates.toast.available', 'A new version of Adminium is available'),
            ...(event.version === undefined
              ? {}
              : {
                  description: t('about.desktop.updates.available', 'Version {version} is available', {
                    version: event.version,
                  }),
                }),
            action: {
              label: t('about.desktop.updates.toast.view', 'View'),
              onAction: () => void navigate({ to: '/about' }),
            },
          });
        } else if (event.type === 'downloaded') {
          toasts.push({
            variant: 'success',
            title: t('about.desktop.updates.toast.downloaded', 'Update ready to install'),
            action: {
              label: t('about.desktop.updates.toast.restart', 'Restart now'),
              onAction: () => void installDesktopUpdate(),
            },
          });
        }
      }),
    [toasts, navigate],
  );

  return null;
}
