// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Connect to another Adminium": an address a person typed, judged before
 * anything is asked of it, then asked one thing (is an Adminium there, and
 * which), then opened as a guest.
 *
 * A guest is somebody else's pages. It gets a window of its own with none of
 * the app's bridge, a cookie jar of its own per address, and it is held to the
 * address that was typed (`window.ts`). What is here is the judging and the
 * asking; ELECTRON-FREE.
 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export type GuestRefusal = 'not-an-address' | 'not-private';

export type GuestAddress =
  | { readonly ok: true; /** `http://office-pc.local:4600`: the origin, nothing after it. */ readonly origin: string; readonly encrypted: boolean }
  | { readonly ok: false; readonly reason: GuestRefusal };

/** An address on the person's own network, where plain `http` is what there is: a `.local` name, this computer, a private range. */
export function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.endsWith('.local') || name.endsWith('.localhost')) return true;
  if (isIP(name) === 4) {
    const [a = 0, b = 0] = name.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(name) === 6) return name === '::1' || /^f[cd]/.test(name) || /^fe[89ab]/.test(name);
  // A bare name with no dot is a computer on this network (`office-pc`), not a site.
  return !name.includes('.');
}

/**
 * What a person typed, as an address the app may open. With no scheme: `http`
 * on a private address (what a shared Adminium answers on), `https` anywhere
 * else. `http` to anything that is not private is refused: a password would
 * cross the internet readable.
 */
export function judgeGuestAddress(typed: string): GuestAddress {
  const text = typed.trim();
  if (text === '' || /\s/.test(text)) return { ok: false, reason: 'not-an-address' };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url: URL;
  try {
    url = new URL(hasScheme ? text : `x://${text}`);
  } catch {
    return { ok: false, reason: 'not-an-address' };
  }
  if (url.hostname === '' || url.username !== '' || url.password !== '') return { ok: false, reason: 'not-an-address' };
  // Read again as a web address, which is how the window will read it: a made-up scheme keeps a host as typed, so
  // `134744072` would pass for a computer's name here and open as 8.8.8.8, and `Office-PC.local:80` would never
  // equal the address its own pages come from.
  const asWeb = (scheme: string): URL | null => {
    try {
      return new URL(`${scheme}//${url.host}`);
    } catch {
      return null;
    }
  };
  if (hasScheme && url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'not-an-address' };
  const read = asWeb('http:');
  if (read === null || read.hostname === '') return { ok: false, reason: 'not-an-address' };
  const privateHost = isPrivateHost(read.hostname);
  const scheme = hasScheme ? url.protocol : privateHost ? 'http:' : 'https:';
  if (scheme === 'http:' && !privateHost) return { ok: false, reason: 'not-private' };
  const origin = asWeb(scheme)?.origin;
  if (origin === undefined || origin === 'null') return { ok: false, reason: 'not-an-address' };
  return { ok: true, origin, encrypted: scheme === 'https:' };
}

export type GuestCheck = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly reason: 'no-answer' | 'not-adminium' };

export const GUEST_CHECK_MS = 5_000;

/**
 * Ask the address the one thing every Adminium answers with no sign-in: its
 * health, which names its version. A redirect is not followed (it would be an
 * answer from somewhere that was not typed).
 */
export async function checkGuest(origin: string, fetcher: (url: string, init: { redirect: 'manual'; signal: AbortSignal }) => Promise<Response>, timeoutMs: number = GUEST_CHECK_MS): Promise<GuestCheck> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    const response = await fetcher(new URL('/api/v1/healthz', origin).toString(), { redirect: 'manual', signal: control.signal });
    if (!response.ok) return { ok: false, reason: 'not-adminium' };
    const body = (await response.json().catch(() => null)) as { ok?: unknown; version?: unknown } | null;
    if (body === null || body.ok !== true || typeof body.version !== 'string' || !/^\d+\.\d+\.\d+/.test(body.version)) return { ok: false, reason: 'not-adminium' };
    return { ok: true, version: body.version.slice(0, 40) };
  } catch {
    return { ok: false, reason: 'no-answer' };
  } finally {
    clearTimeout(timer);
  }
}

/** The cookie jar of a guest: its own per address, kept between visits. */
export function guestPartition(origin: string): string {
  return `persist:guest-${createHash('sha256').update(origin).digest('hex').slice(0, 24)}`;
}

/** Whether a guest's window may go to `target`: the address that was typed, and nowhere else. */
export function guestMayNavigate(target: string, origin: string): boolean {
  try {
    return new URL(target).origin === origin;
  } catch {
    return false;
  }
}

export interface GuestEntry {
  address: string;
  version: string;
  lastOpened: string;
}

export const MAX_GUESTS = 8;

/** The recent list with `address` at its head. */
export function rememberGuest(list: readonly GuestEntry[], address: string, version: string, now: Date): GuestEntry[] {
  return [{ address, version, lastOpened: now.toISOString() }, ...list.filter((entry) => entry.address !== address)].slice(0, MAX_GUESTS);
}
