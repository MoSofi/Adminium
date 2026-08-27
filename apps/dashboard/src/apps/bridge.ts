// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host half of the surface bridge (29-app-surfaces.md D6).
 *
 * ── This file is a MIRROR, and knowingly so ────────────────────────────────
 * The child half lives in `embed.ts` inside each of the fifteen app repos,
 * synced byte-identically by `surface-build.sh`. Those repos are separate
 * published packages that cannot import from this monorepo, and this monorepo
 * cannot import from them, so the protocol is stated twice. {@link
 * BRIDGE_VERSION} is what makes the duplication safe: both ends check it, and a
 * mismatch degrades to the app rendering its own chrome with a loud console
 * line rather than to a blank frame. Change the shape ⇒ bump the version ⇒ old
 * bundles fall back instead of half-working.
 *
 * ── targetOrigin is ALWAYS `location.origin` ───────────────────────────────
 * Never `*`. The frame is same-origin by construction — Adminium serves both
 * documents — so a wildcard would buy nothing and would post the dashboard's
 * theme, locale and navigation into whatever a mistake had put in the frame.
 */

/** Bumped only for a BREAKING protocol change; both ends check it. */
export const BRIDGE_VERSION = 1;

export const HELLO = 'adminium:surface:hello';
export const INIT = 'adminium:host:init';
export const NAVIGATE = 'adminium:surface:navigate';
export const SET = 'adminium:host:set';

export interface SurfaceHello {
  type: typeof HELLO;
  v: number;
  appKey: string;
  side: 'staff' | 'customer';
  /** Where the surface currently is, so a deep-loaded frame can tell the host. */
  path: string;
}

export interface SurfaceNavigate {
  type: typeof NAVIGATE;
  v: number;
  path: string;
}

export interface HostInit {
  type: typeof INIT;
  v: number;
  path?: string;
  persona?: string;
  theme?: 'light' | 'dark';
  locale?: string;
}

export interface HostSet {
  type: typeof SET;
  path?: string;
  theme?: 'light' | 'dark';
  locale?: string;
}

/**
 * Narrow an untrusted `MessageEvent.data` to a bridge message.
 *
 * Everything else on this channel is ignored rather than parsed: Vite HMR,
 * React DevTools and a long tail of browser extensions all post here, and a
 * handler that assumed its own shape would throw on the first one.
 */
export function bridgeMessage(data: unknown): { type: string } & Record<string, unknown> {
  if (data === null || typeof data !== 'object') return { type: '' };
  const record = data as Record<string, unknown>;
  return { ...record, type: typeof record['type'] === 'string' ? record['type'] : '' };
}

/**
 * The dashboard's locale tag as the apps spell it.
 *
 * The dashboard's compiled locales are `en_US`; the fleet's are BCP-47
 * `en-US`. One underscore is the entire difference, and getting it wrong is
 * silent — `setHostLocale` rejects an unknown tag and the app keeps its own
 * default, which looks exactly like "the bridge did not fire".
 */
export function bcp47(locale: string): string {
  return locale.replace('_', '-');
}
