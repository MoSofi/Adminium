/**
 * The desktop boot-token exchange (11-electron.md §5, §2.2 step 8).
 *
 * §2.2 step 8: "Main window navigates to `http://127.0.0.1:<port>/?bootToken=…`
 * — the SPA exchanges the token for a session (§5) and strips it from the URL."
 * This module is that sentence.
 *
 * ─── STRIP FIRST, THEN EXCHANGE ──────────────────────────────────────────────
 *
 * The order is the security content of this file, and the obvious order is the
 * wrong one. A credential in `window.location` is not just a history entry:
 * every request the page makes while it is there carries it in the `Referer`
 * header — INCLUDING the exchange POST itself, which would hand the token to the
 * server a second time, in a header nobody scrubs, on the one request guaranteed
 * to be logged. It also rides into any error report, any `location.href` read,
 * and any renderer crash dump.
 *
 * So: read it, erase it, and only then spend it. `replaceState` (not `pushState`)
 * — there must be no history entry to go Back to.
 *
 * ─── Why this runs before the router ─────────────────────────────────────────
 *
 * `main.tsx` awaits this before `createAppRouter`, so TanStack Router never sees
 * a URL with a token in it: it reads `window.location` at construction, and a
 * search param it parsed once would survive into router state and back out into
 * the address bar on the next navigation. Doing it first also means the app
 * route's `bootstrap` query — the thing that decides login vs. app — runs after
 * the cookie exists, so a successful exchange lands on the dashboard rather than
 * bouncing through /login.
 *
 * ─── Failure is not an error ─────────────────────────────────────────────────
 *
 * Every failure path (no token, wrong token, replayed token, "Require login on
 * this device" on, no super admin yet) resolves rather than throws, and the app
 * simply carries on to its normal guards — which send an unauthenticated user to
 * /login, which is exactly the right screen for every one of those cases (§5:
 * "the SPA shows the standard login"). Nothing here is worth a crash page.
 */

/** §2.2 step 8's query parameter. One constant — the server greps for it too. */
export const BOOT_TOKEN_PARAM = 'bootToken';

/** What the exchange did, for tests and for the caller's log line. */
export type BootTokenOutcome =
  /** No `?bootToken=` — a browser tab, a reload, or any non-desktop boot. */
  | 'absent'
  /** A session cookie is set; the app is signed in. */
  | 'exchanged'
  /** The server refused (used/stale token, auto-login disabled, no super admin). */
  | 'refused'
  /** The request never completed — server not up yet, or fetch threw. */
  | 'unreachable';

export interface ExchangeBootTokenDeps {
  /** Injected in tests; defaults to the real ones in {@link exchangeBootToken}. */
  location?: Pick<Location, 'search' | 'pathname' | 'hash'>;
  history?: Pick<History, 'replaceState'>;
  fetch?: typeof globalThis.fetch;
}

/**
 * Remove the boot token from a query string, preserving every other parameter
 * byte-for-byte and in order. Exported for the test that pins the strip alone.
 *
 * Rewritten by hand rather than through `URLSearchParams`, whose `toString()`
 * RE-ENCODES what it round-trips: `?returnTo=/p/orders` comes back out as
 * `?returnTo=%2Fp%2Forders`. Equivalent once decoded, and still wrong — this
 * function's whole job is to remove ONE parameter, and a URL that the user (or
 * the router, or a bug report) reads back differently from how it arrived is a
 * second, silent change nobody asked for. Same reasoning as the server's
 * `log-scrub.ts`.
 */
export function stripBootToken(search: string): string {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (query === '') return search;

  const kept = query.split('&').filter((pair) => {
    const eq = pair.indexOf('=');
    const name = eq === -1 ? pair : pair.slice(0, eq);
    return name !== BOOT_TOKEN_PARAM;
  });

  if (kept.length === query.split('&').length) return search;
  return kept.length === 0 ? '' : `?${kept.join('&')}`;
}

/**
 * Read the boot token out of the URL, erase it, and exchange it for a session.
 *
 * Returns `absent` immediately when there is no token, which is the common case
 * (every browser tab, every reload, every self-host deployment) and costs one
 * `URLSearchParams` parse.
 */
export async function exchangeBootToken(deps: ExchangeBootTokenDeps = {}): Promise<BootTokenOutcome> {
  const location = deps.location ?? window.location;
  const history = deps.history ?? window.history;
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);

  const token = new URLSearchParams(location.search).get(BOOT_TOKEN_PARAM);
  if (token === null || token === '') return 'absent';

  // ERASE FIRST. Everything below this line can fail; none of it may fail with
  // the credential still in the address bar. See the module header.
  const cleanSearch = stripBootToken(location.search);
  history.replaceState(null, '', `${location.pathname}${cleanSearch}${location.hash}`);

  try {
    const response = await doFetch('/api/v1/auth/desktop-session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ bootToken: token }),
      // The token is already gone from `location`, so no Referer can carry it —
      // but the server is loopback and the header buys nothing, so don't send one.
      referrerPolicy: 'no-referrer',
    });
    return response.ok ? 'exchanged' : 'refused';
  } catch {
    // A `TypeError` from fetch: the server died between the navigation and this
    // call. The shell's own crash handling (§2.2 step 9) owns that story.
    return 'unreachable';
  }
}
