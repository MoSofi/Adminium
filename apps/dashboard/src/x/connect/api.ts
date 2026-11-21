// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calls the connect page makes to its own host (`/x/connect/api/*`).
 *
 * The link's token lives in the address's fragment, so no server, proxy or
 * referrer holds it. The page moves it into this tab's session store and takes
 * it out of the address at once: the browser leaves for the provider and comes
 * back to another address, and "Try again" needs it.
 */

export interface ConnectOpened {
  business: string;
  contact: string | null;
  person: string | null;
  address: string | null;
  sentBy: string | null;
  purpose: 'connect' | 'reconnect';
  providers: { key: string; name: string }[];
}

export type ConnectOutcome =
  | { outcome: 'connected'; address: string | null; addressDiffers: boolean; testing: boolean }
  | { outcome: 'partial'; missing: string[] }
  | { outcome: 'different-account' | 'other-provider' | 'denied' | 'needs-admin' | 'setup' | 'nothing' };

const STORE_KEY = 'adminium-connect-link';

/** The link's token: from the address on the way in, from this tab's store on the way back. */
export function takeToken(location: Pick<Location, 'pathname' | 'hash'>, history: Pick<History, 'replaceState'>, store: Pick<Storage, 'getItem' | 'setItem'> | null): string | null {
  const fragment = location.hash.replace(/^#/, '');
  if (location.pathname === '/x/connect' && /^[A-Za-z0-9_-]{32,128}$/.test(fragment)) {
    try {
      store?.setItem(STORE_KEY, fragment);
    } catch {
      // A browser with storage off still connects; only "Try again" after coming back is lost.
    }
    history.replaceState(null, '', '/x/connect');
    return fragment;
  }
  try {
    return store?.getItem(STORE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function forgetToken(store: Pick<Storage, 'removeItem'> | null): void {
  try {
    store?.removeItem(STORE_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** What the provider sent back, read from the fragment and taken out of the address. */
export function takeReturn(location: Pick<Location, 'pathname' | 'hash'>, history: Pick<History, 'replaceState'>): { state: string; code?: string; error?: string } | null {
  if (location.pathname !== '/x/connect/back') return null;
  const carried = new URLSearchParams(location.hash.replace(/^#/, ''));
  history.replaceState(null, '', '/x/connect/back');
  const state = carried.get('state');
  if (state === null || state.length < 16) return null;
  const code = carried.get('code');
  const error = carried.get('error');
  return { state, ...(code === null ? {} : { code }), ...(error === null ? {} : { error: error.slice(0, 64) }) };
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`/x/connect/api/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
}

/** What a link is for. Null: it does not work any more, whichever the reason. */
export async function openLink(token: string): Promise<ConnectOpened | null> {
  const response = await post('open', { token });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('offline');
  return (await response.json()) as ConnectOpened;
}

export type Started = { url: string } | { refused: 'dead' | 'setup' | 'cannot-connect' };

export async function startSignIn(token: string, provider: string): Promise<Started> {
  const response = await post('start', { token, provider });
  if (response.status === 404) return { refused: 'dead' };
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { refused: body?.error === 'CANNOT_CONNECT_HERE' ? 'cannot-connect' : 'setup' };
  }
  if (!response.ok) throw new Error('offline');
  const { authorizeUrl } = (await response.json()) as { authorizeUrl: string };
  // Only ever on to a provider's https page.
  if (new URL(authorizeUrl).protocol !== 'https:') throw new Error('offline');
  return { url: authorizeUrl };
}

export async function completeSignIn(input: { state: string; code?: string; error?: string }): Promise<ConnectOutcome> {
  const response = await post('complete', input);
  if (response.status === 404) return { outcome: 'nothing' };
  if (!response.ok) throw new Error('offline');
  return (await response.json()) as ConnectOutcome;
}
