// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deep, name-based secret redaction for the log (08-server-api.md §1.3).
 *
 * ─── WHY A FORMATTER AND NOT MORE `redact.paths` ────────────────────────────
 *
 * `REDACT_PATHS` in `app.ts` reads as though `*.password` covers "password at
 * any level". It does not. Measured against the installed pino 10.3.1:
 *
 *   {password}              depth 1  -> NOT redacted
 *   {a:{password}}          depth 2  -> redacted
 *   {a:{b:{password}}}      depth 3  -> NOT redacted
 *   {users:[{password}]}    array    -> NOT redacted
 *
 * pino's `*` is EXACTLY one level. So every `*.`-prefixed entry in that list
 * protects depth 2 and nothing else — a list of the shapes we happened to think
 * of, not a rule. `@pinojs/redact`'s own README says "redacts password at any
 * level", which is very likely how the list came to be written that way.
 *
 * And the obvious repair is a trap: `'**.pass'` is ACCEPTED by pino's path
 * validator and matches nothing at any depth. It would look applied, pass
 * review, and redact nothing.
 *
 * A `formatters.log` hook runs over the whole object before serialization, so
 * it can walk to any depth and through arrays. That is a rule rather than a
 * list, which is the actual fix.
 *
 * ─── WHAT WAS LEAKING ───────────────────────────────────────────────────────
 *
 * Covered by the old list at NO depth whatsoever: `pass` and `passEncrypted`
 * (the SMTP credential — while `email/config.ts` carried a comment asserting
 * pino redacted it), `otpauthUrl` (a STRING containing the full TOTP seed,
 * `otpauth://totp/…?secret=<base32>`), `recoveryCodes`, `challengeToken`,
 * `secretEncrypted`, and `lastError` (driver errors routinely quote the whole
 * connection string — `export/redaction.ts` already refuses to export it for
 * exactly that reason, while the log had no equivalent guard).
 *
 * ─── FIVE INVARIANTS, each one a place this would otherwise LOOK applied ────
 *
 * a. Only PLAIN objects and arrays are cloned; class instances — Error, the
 *    Fastify Request — are returned by reference. pino runs `formatters.log`
 *    BEFORE the per-key serializers, so flattening `req` would strip the
 *    prototype getters `serializeRequest` reads (`ip`, `host`, `socket`) and
 *    flattening an Error would leave the `err` serializer with no message and
 *    no stack.
 * b. A matched key's value is replaced WHOLESALE, whatever its type.
 *    `recoveryCodes` is an array; a scrubber that only censored strings would
 *    print it.
 * c. A revisited node returns the CIRCULAR MARKER, never the node itself —
 *    returning the node hands pino the original, unscrubbed object.
 * d. At the depth cap the subtree is REPLACED, not returned, for the same
 *    reason.
 * e. The walk is TOTAL. A throwing enumerable getter must not escape into
 *    `log.info()` and take the request down.
 *
 * The same reference is returned when nothing matched, so the common `{req}`
 * line allocates nothing.
 *
 * This layer is name-based and therefore complements, rather than replaces,
 * `log-scrub.ts` — that one reaches INSIDE a string (`?bootToken=…` in a URL),
 * which no key-name rule can do.
 */
import { REDACTED } from './log-scrub.js';

/**
 * Canonical spellings of every field that carries a credential.
 *
 * `authorization` and `cookie` are here even though `REDACT_PATHS` lists
 * `req.headers.*`: those are EXACT paths, so a hand-logged
 * `{upstream:{headers:{authorization}}}` is matched by nothing.
 *
 * Deliberately ABSENT: anything ending in `hash`. An argon2 or sha verifier is
 * not a credential, and censoring it blinds exactly the debugging someone is
 * doing when they log it.
 */
export const SECRET_FIELD_NAMES_CANONICAL: readonly string[] = [
  'pass',
  'passEncrypted',
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'bootToken',
  'challengeToken',
  'csrfToken',
  'secret',
  'secretEncrypted',
  'apiKey',
  'apiKeyEncrypted',
  // `adminium_add_on_credentials.payload` — the AES-256-GCM envelope holding a
  // connected add-on's API key or OAuth token pair (26 §4). The column is named
  // for what it IS rather than for what it holds, so none of the `*Encrypted` /
  // `*Key` / `*token` patterns above catch it, and a credential row logged
  // anywhere would print the whole envelope. Generic enough to be worth the
  // false positives it will cause on innocent `payload` fields: a redacted job
  // payload in a log line costs a debugging session, an un-redacted credential
  // costs the credential.
  'payload',
  'refreshToken',
  'accessToken',
  'dsn',
  'dsnEncrypted',
  'connectionString',
  'smtpUrl',
  'otpauthUrl',
  'recoveryCodes',
  'lastError',
  'authorization',
  'cookie',
  'ADMINIUM_SECRET',
  'ADMINIUM_BOOT_TOKEN',
];

/**
 * Matched case-INSENSITIVELY. pino's own paths are case-sensitive, which is a
 * second way the old list could miss (`passEncrypted` vs `passencrypted` off a
 * driver or a JSON column). Mirrors `log-scrub.ts`'s `SENSITIVE_LOWER`.
 */
export const SECRET_FIELD_NAMES: ReadonlySet<string> = new Set(
  SECRET_FIELD_NAMES_CANONICAL.map((name) => name.toLowerCase()),
);

const MAX_DEPTH = 12;
const CIRCULAR = '[REDACTED:CIRCULAR]';
const TOO_DEEP = '[REDACTED:DEPTH]';
const UNREADABLE = '[REDACTED:THREW]';

/** Plain object or null-prototype object — NOT a class instance. See invariant (a). */
function isPlainContainer(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function walk(node: object, depth: number, seen: WeakSet<object>): unknown {
  if (seen.has(node)) return CIRCULAR;
  seen.add(node);

  const isArray = Array.isArray(node);
  const out: Record<string, unknown> | unknown[] = isArray
    ? new Array<unknown>((node as unknown[]).length)
    : {};
  let changed = false;

  for (const key of Object.keys(node)) {
    let value: unknown;
    try {
      value = (node as Record<string, unknown>)[key];
    } catch {
      (out as Record<string, unknown>)[key] = UNREADABLE;
      changed = true;
      continue;
    }

    // Array INDICES are never secret names, so only object keys are matched.
    if (!isArray && SECRET_FIELD_NAMES.has(key.toLowerCase())) {
      (out as Record<string, unknown>)[key] = REDACTED;
      changed = true;
      continue;
    }

    if (isPlainContainer(value) || Array.isArray(value)) {
      if (depth >= MAX_DEPTH) {
        (out as Record<string, unknown>)[key] = TOO_DEEP;
        changed = true;
        continue;
      }
      const scrubbed = walk(value as object, depth + 1, seen);
      if (scrubbed !== value) changed = true;
      (out as Record<string, unknown>)[key] = scrubbed;
      continue;
    }

    (out as Record<string, unknown>)[key] = value;
  }

  return changed ? out : node;
}

/**
 * Replace every credential-named field, at any depth and through arrays, with
 * {@link REDACTED}. Returns the input unchanged when nothing matched.
 */
export function scrubSecretFields(obj: Record<string, unknown>): Record<string, unknown> {
  try {
    return isPlainContainer(obj) ? (walk(obj, 0, new WeakSet()) as Record<string, unknown>) : obj;
  } catch {
    // Invariant (e): a censored line beats a crashed request.
    return { msg: '[REDACTED:SCRUB-FAILED]' };
  }
}
