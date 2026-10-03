// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's source, fetched at its release from where the app list says it is.
 *
 * "Make it yours" copies a published app's repository. The list gives the
 * repository (`links.repo`) and the version; the source is the archive GitHub
 * serves for the tag `v<version>`, and nothing else: no branch, no other
 * host, no address a person typed.
 *
 * The archive is input from the network. It is bounded before it is
 * expanded, and read as an allowlist: plain files and folders with clean
 * relative paths, under the one top folder GitHub wraps a repository in.
 * A link is left out (none of the apps has one), anything else is refused.
 * File modes are never honoured.
 */
import { AddOnArchiveError, gunzipCapped, type ArchiveLimits } from '../../add-ons/archive.js';

/** A repository is larger than a package: the largest of the six is 9 MB packed. */
const ARCHIVE_LIMITS_FOR_SOURCE: ArchiveLimits = {
  maxCompressedBytes: 80 * 1024 * 1024,
  maxUncompressedBytes: 400 * 1024 * 1024,
  maxEntryBytes: 30 * 1024 * 1024,
  maxEntries: 20_000,
  maxPathLength: 300,
  maxPathDepth: 16,
};

function gunzipForSource(compressed: Uint8Array): Uint8Array {
  try {
    return gunzipCapped(compressed, ARCHIVE_LIMITS_FOR_SOURCE);
  } catch (error) {
    throw new SourceArchiveError(error instanceof AddOnArchiveError ? `The app’s source does not read as an archive (${error.reason}).` : 'The app’s source does not read as an archive.');
  }
}

export class SourceArchiveError extends Error {
  override readonly name = 'SourceArchiveError';
}

/** `https://github.com/<owner>/<repo>` → the archive of its tag, or null when it is not such an address. */
/**
 * Whose repositories a copy is taken from. A copy's build runs the repository's own Vite config on this machine, so
 * the list's word for where an app's source is counts only for the publishers Adminium itself vouches for.
 */
export const SOURCE_OWNERS: readonly string[] = ['adminiumjs'];

export function sourceArchiveUrl(repo: string, version: string): string | null {
  const found = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(repo);
  if (found === null || !SOURCE_OWNERS.includes((found[1] as string).toLowerCase()) || /^\.+$/.test(found[2] as string) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) return null;
  return `https://codeload.github.com/${found[1] as string}/${found[2] as string}/tar.gz/refs/tags/v${version}`;
}

const BLOCK = 512;
const text = (bytes: Uint8Array, from: number, length: number): string => {
  let end = from;
  while (end < from + length && bytes[end] !== 0) end += 1;
  return Buffer.from(bytes.subarray(from, end)).toString('utf8');
};

/** A path as a tar member gives it, made safe or refused. Null for the top folder itself. */
function cleanPath(raw: string): string | null {
  if (raw.includes('\\') || raw.includes('\0')) throw new SourceArchiveError(`The archive has a path that is not plain: ${raw.slice(0, 80)}`);
  if (raw.startsWith('/')) throw new SourceArchiveError('The archive has an absolute path.');
  const parts = raw.split('/').filter((part) => part !== '');
  if (parts.some((part) => part === '..' || part === '.')) throw new SourceArchiveError('The archive has a path that leaves its folder.');
  // GitHub wraps a repository in one folder, `<repo>-<tag>/`.
  const inside = parts.slice(1);
  if (inside.length === 0) return null;
  if (inside.length > ARCHIVE_LIMITS_FOR_SOURCE.maxPathDepth) throw new SourceArchiveError('The archive has a path that is too deep.');
  const path = inside.join('/');
  if (path.length > ARCHIVE_LIMITS_FOR_SOURCE.maxPathLength) throw new SourceArchiveError('The archive has a path that is too long.');
  return path;
}

/** The files of a source archive, by path inside the repository. */
export function readSourceArchive(compressed: Uint8Array): Map<string, Buffer> {
  const bytes = gunzipForSource(compressed);
  const files = new Map<string, Buffer>();
  let longName: string | null = null;
  let total = 0;
  for (let at = 0; at + BLOCK <= bytes.byteLength; ) {
    const header = bytes.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(text(header, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new SourceArchiveError('The archive has a member with no readable size.');
    const type = String.fromCharCode(header[156] ?? 0);
    const body = bytes.subarray(at + BLOCK, at + BLOCK + size);
    if (body.byteLength !== size) throw new SourceArchiveError('The archive is cut short.');
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    // A long path arrives ahead of its member: a PAX record (`x`) or a GNU long name (`L`). `g` is GitHub's own comment.
    if (type === 'g') continue;
    if (type === 'x') {
      const record = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(Buffer.from(body).toString('utf8'));
      if (record !== null) longName = record[1] as string;
      continue;
    }
    if (type === 'L') {
      longName = text(body, 0, size);
      continue;
    }
    const prefix = text(header, 345, 155);
    const name: string = longName ?? (prefix === '' ? text(header, 0, 100) : `${prefix}/${text(header, 0, 100)}`);
    longName = null;
    if (type === '5') {
      cleanPath(name);
      continue;
    }
    // A link is not copied: it could point anywhere once it is on a disk.
    if (type === '1' || type === '2') continue;
    if (type !== '0' && type !== '\0') throw new SourceArchiveError(`The archive has a member that is not a file or a folder (${name.slice(0, 80)}).`);
    const path = cleanPath(name);
    if (path === null) continue;
    if (size > ARCHIVE_LIMITS_FOR_SOURCE.maxEntryBytes) throw new SourceArchiveError(`The archive has a file that is too large (${path}).`);
    total += 1;
    if (total > ARCHIVE_LIMITS_FOR_SOURCE.maxEntries) throw new SourceArchiveError('The archive has too many files.');
    files.set(path, Buffer.from(body));
  }
  if (files.size === 0) throw new SourceArchiveError('The archive has no files.');
  return files;
}

/** Fetch the archive, bounded as it arrives. Redirects are not followed: the address is the one built here. */
export async function fetchSourceArchive(url: string, opts: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<Uint8Array> {
  const response = await (opts.fetch ?? fetch)(url, { redirect: 'error', ...(opts.signal === undefined ? {} : { signal: opts.signal }), headers: { accept: 'application/gzip' } });
  if (response.status === 404) throw new SourceArchiveError('The app’s source for this version is not there (no such tag in its repository).');
  if (!response.ok || response.body === null) throw new SourceArchiveError(`The app’s source could not be fetched (HTTP ${String(response.status)}).`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > ARCHIVE_LIMITS_FOR_SOURCE.maxCompressedBytes) {
      await reader.cancel();
      throw new SourceArchiveError('The app’s source is larger than a copy may be.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
