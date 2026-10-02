// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The link `adminium design` opens: `…/design#designToken=<64 hex>`.
 *
 * The token rides after `#`, so no request ever carries it and no log can
 * hold it. It is taken out of the address before anything else runs — before
 * the router can copy it into its state, before a link on the page could
 * send it on in a `Referer` — and only then exchanged for a session.
 *
 * Loaded only when the address has the token: `main.tsx` checks the hash and
 * imports this file, so a dashboard that is not running the Designer never
 * downloads it.
 */
export const DESIGN_TOKEN_HASH = '#designToken=';

export type DesignTokenOutcome = 'absent' | 'exchanged' | 'refused' | 'unreachable';

/** The token in the address, or null. Removes it from the address either way. */
export function takeDesignToken(win: Pick<Window, 'location' | 'history'> = window): string | null {
  const { hash, pathname, search } = win.location;
  if (!hash.startsWith(DESIGN_TOKEN_HASH)) return null;
  win.history.replaceState(null, '', pathname + search);
  const token = hash.slice(DESIGN_TOKEN_HASH.length);
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export async function exchangeDesignToken(deps: { fetch?: typeof fetch; win?: Pick<Window, 'location' | 'history'> } = {}): Promise<DesignTokenOutcome> {
  const token = takeDesignToken(deps.win);
  if (token === null) return 'absent';
  try {
    const response = await (deps.fetch ?? fetch)('/api/v1/auth/design-session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ designToken: token }),
      referrerPolicy: 'no-referrer',
    });
    return response.ok ? 'exchanged' : 'refused';
  } catch {
    return 'unreachable';
  }
}
