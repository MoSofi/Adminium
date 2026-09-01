// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The egress decision itself — "may this add-on reach this URL?"
 * (24 D14, 26 §5.5).
 *
 * Split from `egress.ts` because it is a PURE predicate over a URL and a list,
 * and the thing most worth exhaustive adversarial testing in the whole add-on
 * layer. A guard tangled up with fetch, timeouts and stream metering is a guard
 * whose edge cases get tested through a mock; this one gets tested directly.
 */

/** Every way an outbound call can be refused. */
export type EgressRefusal =
  | 'NO_OUTBOUND_CAPABILITY'
  | 'MALFORMED_URL'
  | 'HOST_NOT_ALLOWED'
  | 'NOT_HTTPS'
  | 'NON_DEFAULT_PORT'
  | 'CREDENTIALS_IN_URL'
  | 'LITERAL_IP'
  | 'REDIRECTED'
  | 'RESPONSE_TOO_LARGE'
  | 'REQUEST_FAILED';

/**
 * A literal IP address in the host position, v4 or v6.
 *
 * D14's grammar bans bare IPs from the allow-list, so an IP can never MATCH
 * one — but it is refused by name rather than falling through to
 * `HOST_NOT_ALLOWED`, because the two say different things to an operator
 * reading an audit row. "Not in your list" invites adding it; "an allow-list
 * entry is a hostname" explains why that will not work.
 */
const LITERAL_IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Decides whether `url` is reachable under `allow`.
 *
 * Returns `'ok'` or the reason it is not. Every check is a refusal rather than
 * a normalization: a guard that "helpfully" rewrites what it was given is a
 * guard whose behaviour depends on the rewrite being right.
 */
export function hostnameAllowed(url: URL, allow: readonly string[]): 'ok' | EgressRefusal {
  // Credentials first: `https://evil.com@allowed.example/` parses with hostname
  // `allowed.example`, so a check that looked only at the hostname would pass
  // it — and anything that later logged or re-parsed the href could reach the
  // other host instead. Refused outright rather than stripped.
  if (url.username !== '' || url.password !== '') return 'CREDENTIALS_IN_URL';

  // D14 says "exact https hostname". `http:` is refused, and so is every other
  // scheme — `file:`, `data:` and `blob:` all parse, and none of them is a
  // network request an allow-list has any opinion about.
  if (url.protocol !== 'https:') return 'NOT_HTTPS';

  const host = url.hostname.toLowerCase();

  // A trailing dot is the DNS root and resolves identically, so
  // `api.example.com.` would otherwise be a free bypass of an exact match.
  const normalized = host.endsWith('.') ? host.slice(0, -1) : host;

  // v6 arrives bracketed from `URL`, which is enough to recognise it; v4 needs
  // the pattern. Both bypass hostname matching entirely if allowed through.
  if (normalized.startsWith('[') || LITERAL_IPV4.test(normalized)) return 'LITERAL_IP';

  // D14's grammar has no port, so there is no way to DECLARE one — which means
  // permitting a non-default port here would be inventing an authority the
  // manifest cannot express. An add-on that needs one needs the grammar
  // changed, deliberately, rather than a guard that quietly allows it.
  if (url.port !== '' && url.port !== '443') return 'NON_DEFAULT_PORT';

  // Exact, case-insensitive, after the same trailing-dot normalization on both
  // sides. No suffix matching: `evil-example.com` must not match
  // `example.com`, and `api.example.com.evil.com` must not match anything.
  const allowed = allow.some((entry) => {
    const candidate = entry.trim().toLowerCase();
    return (candidate.endsWith('.') ? candidate.slice(0, -1) : candidate) === normalized;
  });

  return allowed ? 'ok' : 'HOST_NOT_ALLOWED';
}
