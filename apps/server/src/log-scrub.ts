// SPDX-License-Identifier: AGPL-3.0-only
/**
 * URL scrubbing for the request log (redaction, for why it had to exist).
 *
 * ─── The leak this closes ────────────────────────────────────────────────────
 *
 * pino's `redact` works on OBJECT PATHS: `*.password` censors a field. It cannot
 * reach INSIDE a string, and `req.url` is a string. So a credential that travels
 * in a query string is invisible to every redaction rule this server has —
 * `redact: ['req.url']` would drop the whole URL, which is most of the value of
 * having a request log at all.
 *
 * The desktop window is navigated to
 * `http://127.0.0.1:<port>/?bootToken=<32 random bytes>`. That is a GET the
 * server answers with `index.html` and logs like any other — and the desktop
 * shell pipes those logs to a ROTATING FILE ON DISK, where the token would then
 * sit, in cleartext, long after the boot that minted it. The SPA stripping the
 * token from `window.location` fixes the browser's history; it does nothing
 * about the request that already happened.
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
import { NOTICE_SERVICES } from './email/notices/types.js';
import { scrubInboundPath } from './inbound/log.js';
import { SMS_PROVIDERS } from './sms/types.js';

/** The pino censor string used everywhere else (`app.ts` `REDACT_PATHS`). */
export const REDACTED = '[REDACTED]';

/**
 * Query parameters whose VALUE is a credential. Compared case-insensitively —
 * `bootToken` and `boottoken` are the same parameter to a careless caller, and a
 * scrubber that only catches the spelling we happen to emit is a scrubber that
 * fails exactly when someone gets it wrong.
 */
export const SENSITIVE_QUERY_PARAMS: readonly string[] = [
  // The desktop boot token.
  'bootToken',
  // Adminium Designer's sign-in link (it travels in the URL's fragment, which
  // no request carries — this is for the day a person pastes it into a query)
  // and the preview's one-use ticket, which does travel in a query.
  'designToken',
  'ticket',
  // Password-reset and 2FA-challenge tokens. They ride in bodies today; the
  // day one lands in a link's query, this is already here.
  'token',
  'challengeToken',
  'apiKey',
  // `ADMINIUM_STORAGE_URL` carries the bucket credential IN ITS
  // QUERY STRING (`s3://bucket?endpoint=…&accessKey=AK&secretKey=SK`), and the
  // docs' own per-host recipes tell operators to write exactly that. These are
  // the param names those recipes use, so a log line that echoes the seed URL
  // is scrubbed rather than printing the key that opens the bucket.
  'accessKey',
  'secretKey',
  // A code a guest typed (a ticket's, a gift card's): refused on a public list
  // with a 400, but the request is logged before the refusal. It travels in
  // the `x-adminium-code` header, which `REDACT_PATHS` covers.
  'code',
  // An OAuth sign-in coming back (`routes/connect-door`): the state opens the
  // flow for whoever also holds the browser's cookie, and is no one's to read in a log.
  'state',
  'session_state',
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
/** The pay paths whose next segment is a nonce or an attempt rather than a pay link's token. */
const PAY_WAYS: ReadonlySet<string> = new Set(['back', 'demo']);

/**
 * The mail door's links: `/m/u/<token>` unsubscribe, `/m/l/<token>` a counted
 * click, `/m/c/<token>` a sign-up's confirm, `/m/o/<token>` a found person's
 * objection, which erases them.
 */
const MAIL_DOORS: ReadonlySet<string> = new Set(['c', 'u', 'l', 'o']);

/**
 * Query parameters whose value is a credential only on the stranger pages
 * under `/x/`: a named survey's one-use token (`?t=`), which answers the
 * survey as its invitee. Elsewhere `t` is an ordinary name.
 */
const STRANGER_QUERY_PARAMS: ReadonlySet<string> = new Set(['t']);

/** The fixed segments of a mail service's notice address, `/api/v1/email/notices/<service>/<token>`. */
const NOTICE_PATH = ['', 'api', 'v1', 'email', 'notices'] as const;

/** An absolute-form request target (`POST http://host/path`), which `req.url` carries as sent. */
const ABSOLUTE_TARGET = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i;

/**
 * One path segment as the router reads it, in lower case; as sent when it does
 * not decode. Without any `;…`, which a proxy in front may strip before routing.
 */
function segmentName(raw: string): string {
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // Compared as sent.
  }
  return (name.split(';', 1)[0] ?? '').toLowerCase();
}

/**
 * A mail link with its token replaced, or null when the path is not one. The
 * token is the whole of what opens the page, so everything after the door's
 * letter goes.
 */
function scrubMailPath(segments: readonly string[]): string | null {
  if (segmentName(segments[1] ?? '') !== 'm' || !MAIL_DOORS.has(segmentName(segments[2] ?? ''))) return null;
  if (segments.slice(3).join('/') === '') return null;
  return `${segments.slice(0, 3).join('/')}/${REDACTED}`;
}

/**
 * A person's private calendar feed (`/x/cal/<token>.ics`) with its token
 * replaced, or null when the path is not one. A calendar service fetches it for
 * as long as it lives, and the token is all that opens it.
 */
function scrubCalendarFeedPath(segments: readonly string[]): string | null {
  if (segmentName(segments[1] ?? '') !== 'x' || segmentName(segments[2] ?? '') !== 'cal') return null;
  if (segments.slice(3).join('/') === '') return null;
  return `${segments.slice(0, 3).join('/')}/${REDACTED}`;
}

/**
 * A password or invitation link (`/reset/<token>`) with its token replaced, or
 * null when the path is not one. Until it is used, that token sets the
 * account's password for whoever reads it in a log.
 */
function scrubResetPath(segments: readonly string[]): string | null {
  if (segmentName(segments[1] ?? '') !== 'reset') return null;
  if (segments.slice(2).join('/') === '') return null;
  return `${segments.slice(0, 2).join('/')}/${REDACTED}`;
}

/**
 * A pay path with its token replaced, or null when it holds none: a pay link's
 * token, the nonce of a way back from a provider, a demo checkout's attempt.
 * Anyone who reads a log line with a live token holds a working pay link, so
 * the segment is replaced; the rest of the path (`/challenge`, `/checkout`)
 * stays. Only the exact spelling of `assets` is passed over: a spelling the
 * router would also read that way loses a file name from the log, nothing more.
 */
function scrubPayPath(segments: readonly string[]): string | null {
  if (segmentName(segments[1] ?? '') !== 'pay') return null;
  const hasNext = (index: number) => segments.length > index + 1;
  if (segments[2] === 'assets' && hasNext(2)) return null;
  let at = 2;
  if (segmentName(segments[at] ?? '') === 'api' && hasNext(at)) at += 1;
  if (PAY_WAYS.has(segmentName(segments[at] ?? '')) && hasNext(at)) at += 1;
  if ((segments[at] ?? '') === '') return null;
  return segments.map((segment, index) => (index === at ? REDACTED : segment)).join('/');
}

/**
 * A notice address with its token replaced, or null when the path is not one.
 * For the "other" service with no password that token is the only proof a call
 * is genuine, so whoever reads it in a log could add addresses to the
 * do-not-email list.
 *
 * The service stays readable when it is one of ours. Anything else in its place
 * may be a token pasted one segment early, and everything after the service is
 * replaced, so a stray slash cannot move the token out of reach.
 */
function scrubNoticePath(segments: readonly string[]): string | null {
  if (segments.length <= NOTICE_PATH.length) return null;
  if (!NOTICE_PATH.every((name, index) => segmentName(segments[index] ?? '') === name)) return null;
  const service = segments[NOTICE_PATH.length] ?? '';
  const known = (NOTICE_SERVICES as readonly string[]).includes(segmentName(service));
  if (segments.length === NOTICE_PATH.length + 1 && (known || service === '')) return null;
  return `${segments.slice(0, NOTICE_PATH.length + (known ? 1 : 0)).join('/')}/${REDACTED}`;
}

/**
 * The signed-in doors whose next segment is a one-use code: a database
 * hand-off, a print kept nowhere, an undo of a row's change or of an AI run's.
 * `*` is any one segment (the run's id, which stays readable).
 */
const SESSION_CODE_PATHS: readonly (readonly string[])[] = [
  ['', 'api', 'v1', 'bridge', 'seed'],
  ['', 'api', 'v1', 'documents', 'print-once'],
  ['', 'api', 'v1', 'data', 'undo'],
  ['', 'api', 'v1', 'llm', 'runs', '*', 'undo'],
  // The link that confirms a new sign-in address, a page the dashboard serves.
  ['', 'account', 'confirm-email'],
];

/** A signed-in door's path with its code, and whatever follows it, replaced; null when the path is not one. */
function scrubSessionCodePath(segments: readonly string[]): string | null {
  for (const route of SESSION_CODE_PATHS) {
    if (segments.length <= route.length) continue;
    if (!route.every((name, index) => name === '*' || segmentName(segments[index] ?? '') === name)) continue;
    if (segments.slice(route.length).join('/') === '') return null;
    return `${segments.slice(0, route.length).join('/')}/${REDACTED}`;
  }
  return null;
}

/** The channels of the inbound door, each with the sources that stay readable in a logged path. */
const INBOUND_DOORS: Readonly<Record<string, readonly string[]>> = { sms: SMS_PROVIDERS };

/**
 * The path with a door's token replaced by {@link REDACTED}: a mail link's, a
 * calendar feed's, a password or invitation link's, a pay link's (or a way
 * back's nonce), a notice address's, an inbound door's, or a signed-in door's
 * one-use code.
 *
 * Compared segment by segment, decoded, because the router also accepts
 * `/p%61y/…` and `/m/%6F/…`. What is kept is kept as it was sent.
 */
export function scrubPathForLog(path: string): string {
  const { origin, extra, rest } = targetParts(path);
  if (!rest.startsWith('/')) return path;
  const segments = rest.split('/');
  const scrubbed =
    scrubMailPath(segments) ??
    scrubCalendarFeedPath(segments) ??
    scrubResetPath(segments) ??
    scrubPayPath(segments) ??
    scrubNoticePath(segments) ??
    scrubInboundPath(segments, INBOUND_DOORS) ??
    scrubSessionCodePath(segments);
  return scrubbed === null ? path : `${origin}${extra}${scrubbed}`;
}

/** A target's origin, any extra leading slashes (a proxy may fold them), and the path from its last leading slash. */
function targetParts(target: string): { origin: string; extra: string; rest: string } {
  const origin = ABSOLUTE_TARGET.exec(target)?.[0] ?? '';
  const after = target.slice(origin.length);
  const slashes = /^\/+/.exec(after)?.[0].length ?? 0;
  const extra = after.slice(0, Math.max(0, slashes - 1));
  return { origin, extra, rest: after.slice(extra.length) };
}

/** A way back (`returnTo`) that carries a door's token, once decoded. */
function wayBackHoldsToken(value: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  return scrubUrlForLog(decoded) !== decoded;
}

export function scrubUrlForLog(url: string): string {
  const mark = url.indexOf('?');
  if (mark === -1) return scrubPathForLog(url);

  const path = scrubPathForLog(url.slice(0, mark));
  const query = url.slice(mark + 1);
  const stranger = segmentName(targetParts(url).rest.split('/')[1] ?? '') === 'x';
  let touched = false;

  const scrubbed = query
    .split('&')
    .map((pair) => {
      if (pair === '') return pair;
      const eq = pair.indexOf('=');
      // `?bootToken` with no `=` carries no value to leak; leave it alone.
      if (eq === -1) return pair;
      const rawName = pair.slice(0, eq);
      const name = decodeParamName(rawName).toLowerCase();
      const carried = name === 'returnto' && wayBackHoldsToken(pair.slice(eq + 1));
      if (!carried && !SENSITIVE_LOWER.has(name) && !(stranger && STRANGER_QUERY_PARAMS.has(name))) return pair;
      touched = true;
      return `${rawName}=${REDACTED}`;
    })
    .join('&');

  return touched ? `${path}?${scrubbed}` : `${path}?${query}`;
}
