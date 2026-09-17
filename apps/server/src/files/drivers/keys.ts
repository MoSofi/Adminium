// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Remote key layout.
 *
 * `<prefix>/<kind>/<yyyy>/<mm>/<file_id>-<safe-name>`
 *
 * WHY A HUMAN-READABLE LAYOUT ON REMOTE DRIVERS AND A FLAT ID LOCALLY. On the
 * local disk the flat `file_<ULID>` grammar IS the traversal guard: the key is
 * validated as a prefixed ULID and can therefore contain no separator, no dot
 * and no `..` by construction (files/storage.ts's fail-closed handling since
 * M4). A bucket has no such filesystem to escape, and an operator opening
 * their Spaces console to "find last month's invoices" is a real thing people
 * do — so remote keys are dated and carry the original name.
 *
 * The id stays in the key on BOTH sides: it is what makes a key unique without
 * consulting anything, so two uploads of `invoice.pdf` in the same month never
 * collide, and it is what lets an operator work back from an object in a
 * bucket to the row that describes it.
 */

/**
 * The original filename reduced to characters that are safe in a URL path, an
 * S3 key, a WebDAV collection and a shell listing — deliberately narrower than
 * any one of those allows, because the safe intersection is what a key that
 * travels through all of them needs.
 */
export function safeNamePart(filename: string, maxLength = 80): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1).replace(/\\/g, '');
  const cleaned = base
    .normalize('NFKD')
    // Everything outside the allowlist collapses to a single dash, so
    // `Rechnung Müller (final).pdf` keeps its word boundaries instead of
    // losing them.
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    // A leading dot would make a hidden file locally, and a leading dash reads
    // as a flag in every CLI that lists a bucket.
    .replace(/^[.-]+/, '')
    .replace(/-+/g, '-')
    // `Rechnung (final).pdf` would otherwise land as `…-final-.pdf`: the
    // punctuation before the extension collapses to a dash that reads as a
    // typo in every bucket listing.
    .replace(/-+\./g, '.');
  const trimmed = cleaned.slice(0, maxLength).replace(/[.-]+$/, '');
  return trimmed.length === 0 ? 'file' : trimmed;
}

/** `<prefix>/<kind>/<yyyy>/<mm>/<id>-<safe-name>`, with no leading separator. */
export function datedKey(input: {
  prefix?: string | undefined;
  id: string;
  kind: string;
  filename: string;
  createdAt: number;
}): string {
  const when = new Date(input.createdAt);
  const year = String(when.getUTCFullYear());
  const month = String(when.getUTCMonth() + 1).padStart(2, '0');
  const parts = [
    ...(input.prefix === undefined || input.prefix === '' ? [] : [input.prefix.replace(/^\/+|\/+$/g, '')]),
    input.kind,
    year,
    month,
    `${input.id}-${safeNamePart(input.filename)}`,
  ];
  return parts.join('/');
}

/**
 * Control characters and DEL — never legal in a key this server will request.
 * The rule is disabled BECAUSE control characters are precisely what this
 * matches: they are the payload, not an accident of escaping.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * The one guard every REMOTE driver runs before it touches a key, including
 * keys read back from rows: no traversal, no empty segments, no control
 * characters, no leading or trailing separator.
 *
 * Remote drivers cannot lean on the local grammar check — their keys are paths
 * by design — so this is where "a database row cannot make the server ask for
 * something outside its own namespace" is enforced for them. It is applied on
 * the way OUT as well as the way in, because a row written by an earlier
 * version, a restored backup or a hand-edited store is exactly the input this
 * exists to distrust.
 */
export function isSafeRemoteKey(key: string): boolean {
  if (key.length === 0 || key.length > 300) return false;
  if (key.startsWith('/') || key.endsWith('/')) return false;
  if (CONTROL_CHARACTERS.test(key)) return false;
  if (key.includes('//')) return false;
  return key.split('/').every((segment) => segment !== '.' && segment !== '..' && segment.length > 0);
}
