// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading a string literal out of source text, for the namespace tests.
 *
 * Each `<ns>Namespace.test.ts` scans components for `t('ns:key', 'fallback')`
 * pairs and compares the fallback to the catalogue character for character. The
 * regex hands back the literal as it appears in the file — quotes included,
 * escapes unresolved — so the comparison needs the value that literal denotes.
 *
 * WHY ONE PASS. The obvious shape is to unescape the quotes and hand the rest
 * to `JSON.parse`, and eight copies of this file did exactly that. It is wrong
 * in a way that stays hidden: `.replace(/\\'/g, "'")` runs blind, so in `\\'`
 * it eats the backslash that was itself escaped and leaves JSON a dangling
 * escape. The parse then THROWS rather than returning something wrong, which is
 * why no test ever caught it — no fallback in the tree yet puts a backslash
 * next to a quote. `\x41` and `\u{1f600}` throw too; JSON has no syntax for
 * either. CodeQL flagged the two-step form as incomplete string escaping on
 * `projectNamespace.test.ts`, and it was right.
 *
 * Consuming each `\X` whole removes the class of bug rather than the instance:
 * a backslash is always spent by the escape it opens, so it can never leak into
 * the next match. Checked against 8704 literals — every combination of
 * backslash, quote, `\n`, `\x41` and `\u{1f600}` — against the value JavaScript
 * itself assigns.
 *
 * `apps/server/test/email-fallbacks.test.ts` needs the same thing and cannot
 * import it: apps/server does not depend on apps/dashboard, and must not start
 * for a test helper. It carries its own copy, which says so.
 */

const ESCAPE = /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g;

const SHORT_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
});

/** The value a source string literal denotes: quotes stripped, escapes resolved. */
export function literalText(raw: string): string {
  return raw.slice(1, -1).replace(ESCAPE, (_match, escape: string) => {
    if (escape.startsWith('u{')) {
      return String.fromCodePoint(Number.parseInt(escape.slice(2, -1), 16));
    }
    if (escape[0] === 'u' || escape[0] === 'x') {
      return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    }
    return SHORT_ESCAPES[escape] ?? escape;
  });
}
