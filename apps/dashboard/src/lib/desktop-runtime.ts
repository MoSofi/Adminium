/**
 * Detecting the Electron shell from the SPA (11-electron.md §4).
 *
 * §4's detection contract, in full:
 *
 * > the SPA treats `window.adminiumDesktop !== undefined` as "running in the
 * > desktop shell"; the server independently reports `runtime: "desktop"` in
 * > `GET /api/v1/system/info`. Both must agree; the SPA trusts the server for
 * > feature gating and the bridge only for native affordances.
 *
 * READ THAT SECOND SENTENCE BEFORE USING THIS FILE. It divides the work:
 *
 *  - **Feature gating is not this file's job.** Whether to show billing, whether
 *    email can send, which runtime chip the topbar renders (§8.1, §8.2) — all of
 *    that comes from `GET /api/v1/system/info`'s `runtime`, `smtpConfigured` and
 *    `networkFeaturesAllowed` flags. Gating on the bridge instead would put the
 *    decision in the one place a compromised renderer can see and the server
 *    cannot check.
 *  - **This file is for native affordances only**: "Reveal in Finder" next to a
 *    path, a native save dialog instead of a browser download, the About panel's
 *    Electron version (§13). Those are things that exist or do not exist, and
 *    `getDesktopApi()` returning `null` is the honest answer for the same bundle
 *    running on self-host and Cloud — where there is no bridge at all.
 *
 * The types come from `@adminium/desktop/api` and nothing else does: the mapping
 * is `paths`-only (see tsconfig.json), the import is `import type`, and the
 * emitted bundle contains no reference to the desktop app. That is what lets
 * this SPA be ONE artifact that the shell serves unmodified (§2.1).
 */

import type { AdminiumDesktopApi, DesktopErrorCode } from '@adminium/desktop/api';

/** Every code §4's bridge can reject with, for {@link desktopErrorCode}. */
const DESKTOP_ERROR_CODES: readonly DesktopErrorCode[] = [
  'INVALID_PAYLOAD',
  'UNTRUSTED_SENDER',
  'UNAVAILABLE',
  'CAPABILITY_NOT_GRANTED',
  'CAPABILITY_STUB',
  'INTERNAL',
];

/**
 * §4's detection contract, and the only correct spelling of it.
 *
 * `typeof window !== 'undefined'` guards the SSR-less-but-not-DOM-less cases the
 * suite runs in; `window.adminiumDesktop !== undefined` is the contract itself.
 */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && window.adminiumDesktop !== undefined;
}

/**
 * The bridge, or `null` on self-host and Cloud.
 *
 * Prefer this over reaching for `window.adminiumDesktop` directly: the return
 * type makes the absent case unignorable at the call site, which is what keeps
 * a desktop-only affordance from becoming a `TypeError` in a browser tab.
 */
export function getDesktopApi(): AdminiumDesktopApi | null {
  if (typeof window === 'undefined') return null;
  return window.adminiumDesktop ?? null;
}

/**
 * The §4 error code behind a bridge rejection, or `null` if it is not one.
 *
 * Reads `code` when it survived and falls back to parsing the `"<CODE>: …"`
 * message prefix when it did not — `contextBridge` copies errors between two V8
 * contexts and guarantees only the standard fields, so the prefix is the half of
 * the contract that always holds (see `DesktopBridgeError` in the preload). The
 * codes this matters most for are §12's `CAPABILITY_NOT_GRANTED` and
 * `CAPABILITY_STUB`, which manifest pages branch on to render consent or a
 * "no driver in this build" state rather than an error toast.
 */
export function desktopErrorCode(error: unknown): DesktopErrorCode | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && isDesktopErrorCode(code)) return code;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return null;
  const prefix = message.slice(0, message.indexOf(': '));
  return isDesktopErrorCode(prefix) ? prefix : null;
}

function isDesktopErrorCode(value: string): value is DesktopErrorCode {
  return (DESKTOP_ERROR_CODES as readonly string[]).includes(value);
}
