// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The offer to keep versions, for a project opened on a computer with no git
 * (plan 66, spec 07 §3): what the page is told, and what its buttons do.
 *
 * Nothing here downloads or looks for anything by itself. A download starts on
 * the person's yes and on nothing else; "Not now" is remembered for this
 * computer and is not for ever (the button that turns versions on stays).
 *
 * Electron-free: the finding, the fetching and the remembering are handed in.
 */
import { GitFetchError, type GitFetchFailure } from './git.js';

/** Why a download did not end in a git, as the page words it. */
export type VersionsOfferFailure = 'no-connection' | 'wrong-file' | 'failed';

export type VersionsOfferDownload =
  | { readonly phase: 'idle' }
  | { readonly phase: 'downloading'; readonly received: number; readonly total: number }
  | { readonly phase: 'failed'; readonly reason: VersionsOfferFailure };

export interface VersionsOfferState {
  /** A git that works is known: versions are on, and there is nothing to offer. */
  readonly on: boolean;
  /** The person said "Not now" on this computer. */
  readonly declined: boolean;
  /** The download's size in megabytes, or `null`: there is none for this kind of computer. */
  readonly megabytes: number | null;
  /** A Mac: Apple's own tools are the other road. */
  readonly appleTools: boolean;
  readonly download: VersionsOfferDownload;
}

export interface VersionsOfferDeps {
  /** Whether the project was started with a git. */
  readonly found: boolean;
  /** The file for this computer, in bytes, or `null`. */
  readonly bytes: number | null;
  readonly platform: string;
  readonly declined: () => boolean;
  readonly setDeclined: (declined: boolean) => Promise<void>;
  /** Fetch, check and unpack git. Rejects with a `GitFetchError`. */
  readonly fetch: (opts: { signal: AbortSignal; onProgress: (received: number, total: number) => void }) => Promise<string>;
  /**
   * Look for git again and tell the project's server what was found. True when
   * there is one now.
   */
  readonly refresh: () => Promise<boolean>;
  /** Start Apple's own installer of its developer tools (its dialog, not ours). */
  readonly installAppleTools?: (() => Promise<void>) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

export interface VersionsOffer {
  state(): VersionsOfferState;
  /** Start the download. Answers at once; `state()` says how far it is. A second call while one runs changes nothing. */
  download(): VersionsOfferState;
  cancel(): VersionsOfferState;
  notNow(): Promise<VersionsOfferState>;
  /** "Look again": a git installed meanwhile (Apple's tools, Homebrew) is found without a restart. */
  lookAgain(): Promise<VersionsOfferState>;
  appleTools(): Promise<VersionsOfferState>;
  /** The project is closing: a download under way is stopped. */
  dispose(): void;
}

const MEGABYTE = 1_000_000;

function failureOf(reason: GitFetchFailure): VersionsOfferFailure {
  if (reason === 'no-connection') return 'no-connection';
  if (reason === 'wrong-file' || reason === 'refused-address') return 'wrong-file';
  return 'failed';
}

export function createVersionsOffer(deps: VersionsOfferDeps): VersionsOffer {
  let on = deps.found;
  let download: VersionsOfferDownload = { phase: 'idle' };
  let running: AbortController | null = null;

  const state = (): VersionsOfferState => ({
    on,
    declined: deps.declined(),
    megabytes: deps.bytes === null ? null : Math.round(deps.bytes / MEGABYTE),
    appleTools: deps.platform === 'darwin',
    download,
  });

  const refresh = async (): Promise<void> => {
    on = await deps.refresh().catch(() => on);
  };

  return {
    state,
    download() {
      if (on || running !== null || deps.bytes === null) return state();
      const control = new AbortController();
      running = control;
      download = { phase: 'downloading', received: 0, total: deps.bytes };
      void deps
        .fetch({
          signal: control.signal,
          onProgress: (received, total) => {
            if (running === control) download = { phase: 'downloading', received, total };
          },
        })
        .then(
          async (path) => {
            deps.log?.(`[git] fetched: ${path}`);
            if (running !== control) return;
            await refresh();
            // Asked for, so no longer declined: the next computer-wide "no git" is offered again.
            await deps.setDeclined(false).catch(() => undefined);
            download = on ? { phase: 'idle' } : { phase: 'failed', reason: 'failed' };
          },
          (error: unknown) => {
            if (running !== control) return;
            const reason = error instanceof GitFetchError ? error.reason : null;
            deps.log?.(`[git] the download did not finish: ${error instanceof Error ? error.message : String(error)}`);
            download = reason === 'stopped' ? { phase: 'idle' } : { phase: 'failed', reason: reason === null ? 'failed' : failureOf(reason) };
          },
        )
        .finally(() => {
          if (running === control) running = null;
        });
      return state();
    },
    cancel() {
      const control = running;
      if (control !== null) {
        running = null;
        download = { phase: 'idle' };
        control.abort();
      }
      return state();
    },
    async notNow() {
      await deps.setDeclined(true);
      return state();
    },
    async lookAgain() {
      if (running === null) await refresh();
      return state();
    },
    async appleTools() {
      if (deps.platform === 'darwin') await deps.installAppleTools?.().catch(() => undefined);
      return state();
    },
    dispose() {
      running?.abort();
      running = null;
    },
  };
}
