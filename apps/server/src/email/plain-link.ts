// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADDRESS DRAWN INTO AN `href` OR A `src` AS IT IS.
 *
 * A browser reads `https:/evil`, `https:\\evil`, `https:evil` and
 * `https://good@evil` as a link to `evil`. The renderer draws a link only
 * when it is written plainly, `scheme://host`, so what a person reads in the
 * template is where the link goes.
 */

/**
 * Whether an address may stand in an `href` or a `src` as it is: one of
 * `schemes`, and for a web address `scheme://host` written plainly, so no
 * reader takes `https:/evil`, `https:\\evil` or `https:evil` for a host the
 * writer did not see.
 */
export function plainLink(url: string, schemes: readonly ('http' | 'https' | 'mailto')[]): boolean {
  const trimmed = url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme === undefined || !(schemes as readonly string[]).includes(scheme)) return false;
  if (scheme === 'mailto') return true;
  // `scheme://host`, the host up to the first `/`, `?` or `#`: no backslash, space, control character, user or empty host a reader could take another way.
  const authority = new RegExp(`^${scheme}://([^/?#]*)`, 'i').exec(trimmed)?.[1];
  // eslint-disable-next-line no-control-regex -- a control character in the host is exactly what is refused
  if (authority === undefined || authority === '' || /[\\@\s\u0000-\u001f\u007f]/.test(authority)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === `${scheme}:` && parsed.hostname !== '' && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}
