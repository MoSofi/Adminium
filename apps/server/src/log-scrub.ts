/**
 * URL scrubbing for the request log (08-server-api.md §1.3 redaction, and
 * 11-electron.md §2.2 step 8 for why it had to exist).
 *
 * ─── The leak this closes ────────────────────────────────────────────────────
 *
 * pino's `redact` works on OBJECT PATHS: `*.password` censors a field. It cannot
 * reach INSIDE a string, and `req.url` is a string. So a credential that travels
 * in a query string is invisible to every redaction rule this server has —
 * `redact: ['req.url']` would drop the whole URL, which is most of the value of
 * having a request log at all.
 *
 * §2.2 step 8 navigates the desktop window to
 * `http://127.0.0.1:<port>/?bootToken=<32 random bytes>`. That is a GET the
 * server answers with `index.html` and logs like any other — and the desktop
 * shell pipes those logs to a ROTATING FILE ON DISK (§9), where the token would
 * then sit, in cleartext, long after the boot that minted it. The SPA stripping
 * the token from `window.location` (§5) fixes the browser's history; it does
 * nothing about the request that already happened.
 *
 * So: scrub the value, keep the URL. `/?bootToken=[REDACTED]` still tells you
 * which request this was, that a token was presented, and nothing usable.
 *
 * ─── Why an allow-list of names, not a pattern ───────────────────────────────
 *
 * Guessing at "things that look secret" in arbitrary query strings would both
 * miss (a token named `t`) and over-redact (`?filter=token`). The named set is
 * small, and every entry is a parameter THIS product defines and can therefore
 * be sure about.
 */

/** The pino censor string used everywhere else (`app.ts` `REDACT_PATHS`). */
export const REDACTED = '[REDACTED]';

/**
 * Query parameters whose VALUE is a credential. Compared case-insensitively —
 * `bootToken` and `boottoken` are the same parameter to a careless caller, and a
 * scrubber that only catches the spelling we happen to emit is a scrubber that
 * fails exactly when someone gets it wrong.
 */
export const SENSITIVE_QUERY_PARAMS: readonly string[] = [
  // 11-electron.md §2.2 step 8 / §5 — the desktop boot token.
  'bootToken',
  // 08-server-api.md §2.1 — password-reset and 2FA-challenge tokens. They ride
  // in bodies today; the day one lands in a link's query, this is already here.
  'token',
  'challengeToken',
  'apiKey',
];

const SENSITIVE_LOWER = new Set(SENSITIVE_QUERY_PARAMS.map((name) => name.toLowerCase()));

/** `%2A` → `*`, tolerating the malformed escapes a hostile query can contain. */
function decodeParamName(raw: string): string {
  try {
    return decodeURIComponent(raw.replaceAll('+', ' '));
  } catch {
    // `decodeURIComponent('%')` throws. A name we cannot decode is a name we
    // cannot match against the list, so compare the raw bytes instead — the
    // spellings we care about have no escapes anyway.
    return raw;
  }
}

/**
 * Replace the value of every sensitive query parameter in `url` with
 * {@link REDACTED}, leaving the path, the parameter order, and every other
 * parameter byte-for-byte intact.
 *
 * Takes and returns the RAW origin-relative string, exactly as `req.url` carries
 * it (`/p/x?a=1`), and rewrites it by hand rather than through `new URL(...)` +
 * `searchParams`. That is not squeamishness about the parser — it is that the
 * round trip does not preserve its input: `searchParams` re-encodes on
 * serialization (`[REDACTED]` comes back out as `%5BREDACTED%5D`, so the censor
 * would not even be greppable), `+` becomes `%20`, and the path gets normalized.
 * A request log whose URLs silently differ from the URLs that were requested is
 * worse than no scrubbing, because you would not know to distrust it.
 *
 * Fast path: no `?`, nothing to do — which is every request in the product but
 * the handful that carry a query.
 */
export function scrubUrlForLog(url: string): string {
  const mark = url.indexOf('?');
  if (mark === -1) return url;

  const path = url.slice(0, mark);
  const query = url.slice(mark + 1);
  let touched = false;

  const scrubbed = query
    .split('&')
    .map((pair) => {
      if (pair === '') return pair;
      const eq = pair.indexOf('=');
      // `?bootToken` with no `=` carries no value to leak; leave it alone.
      if (eq === -1) return pair;
      const rawName = pair.slice(0, eq);
      if (!SENSITIVE_LOWER.has(decodeParamName(rawName).toLowerCase())) return pair;
      touched = true;
      return `${rawName}=${REDACTED}`;
    })
    .join('&');

  return touched ? `${path}?${scrubbed}` : url;
}
