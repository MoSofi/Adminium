// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `looksLikeEmail()` — the one email sanity check the auth screens share.
 *
 * SignInForm and ForgotPasswordForm each carried their own copy of
 * `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Two copies of a validator is how one gets
 * fixed and the other does not, so they now both import this.
 *
 * This is a form-level sanity check, not RFC 5322: the address is confirmed by
 * the mail that gets sent to it. The bar is "one @, something before it, a
 * dotted domain after it" — deliberately the same bar the old regex cleared.
 */

/**
 * True when `value` has the shape of an email address.
 *
 * Accepts exactly what `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` accepted — no whitespace
 * anywhere, exactly one `@` with a non-empty local part before it, and a domain
 * holding a `.` with at least one character on each side — but decides it with
 * index scans instead of a backtracking match.
 *
 * The regex was quadratic (CodeQL js/polynomial-redos): `.` is itself a member
 * of `[^\s@]`, so `[^\s@]+\.[^\s@]+` could split a dotted domain at every dot,
 * and a domain ending in `.` made the engine retry every one of those splits
 * before failing. `'!@' + '!.'.repeat(n)` drove that to n² work on a
 * pre-authentication screen, where the input is anonymous and unbounded.
 */
export function looksLikeEmail(value: string): boolean {
  // All three classes in the old pattern excluded `\s`, and it was anchored at
  // both ends — so any whitespace anywhere disqualified the whole string. A
  // bare character class with no quantifier scans once, in linear time.
  if (/\s/.test(value)) return false;

  const at = value.indexOf('@');
  // `at === 0` is an empty local part; `at === -1` is no `@` at all. A second
  // `@` cannot match either, since the old pattern excluded `@` from the local
  // part and the domain alike.
  if (at <= 0 || value.indexOf('@', at + 1) !== -1) return false;

  const domain = value.slice(at + 1);
  // The dot needs at least one character before it and one after it, but not
  // necessarily the FIRST dot: `.a.b` was accepted by the old pattern via its
  // second dot, so start the search at index 1 rather than 0.
  const dot = domain.indexOf('.', 1);
  return dot !== -1 && dot < domain.length - 1;
}
