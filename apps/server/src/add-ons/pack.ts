// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pack a staged package tree back into the npm-shaped tarball it arrived as.
 *
 * ─── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────
 * `stage()` verifies a tarball, unpacks it and DISCARDS it: what survives is
 * the tree plus a per-file pin. So by the time anything wants to keep a copy
 * of an installed package — for a host whose data directory is emptied on
 * every deploy — the bytes it arrived as are gone, for a package installed a
 * moment ago exactly as much as for one installed last year. Something has to
 * manufacture them, and this is it.
 *
 * ─── WHY A TARBALL AND NOT THE LOOSE FILES ────────────────────────────────
 * One object per package instead of one per file. An app ships a built
 * frontend, which is hundreds of files; restoring those one request at a time
 * on every boot is a different kind of system. It also means the restore path
 * is `stage()` itself, unchanged — the same hardened unpack, the same limits,
 * the same refusals — rather than a second way of writing into the store that
 * would have to be kept honest alongside it.
 *
 * ─── WHY WRITING TAR BY HAND IS ACCEPTABLE HERE ───────────────────────────
 * A tar writer is a bad thing to need and a worse thing to write against
 * hostile input. This one is not: it packs a tree THIS SERVER unpacked and
 * validated, whose paths `archive.ts` already bounded for depth, length and
 * traversal, so the inputs are ones we produced. It emits the single shape the
 * reader next door documents as what `npm pack` really produces — pure USTAR,
 * magic `ustar\0`, typeflag `0`, every path under `package/`, no directory
 * members, no PAX or GNU extensions — and nothing else. A path that will not
 * fit those fields is REFUSED rather than encoded some other way: the reader
 * rejects long-name blocks, so emitting one would produce an archive this
 * server cannot read back.
 *
 * ─── THE HASH IS OF WHAT WE STORED, NOT OF WHAT THE PUBLISHER SHIPPED ─────
 * A repack is not byte-identical to the publisher's tarball — different
 * ordering, different mtimes, different gzip settings — so its sha512 is NOT
 * the SRI on the catalog row or in the release ledger, and must never be
 * compared with one. It answers a narrower question, which is the only one the
 * restore asks: are these the bytes this instance put there? That is why the
 * fingerprint is recorded per install (0037) rather than looked up.
 *
 * `mtime` is fixed at 0 rather than "now" for the same reason a tarball built
 * twice should not hash apart: the stored fingerprint is written once, from
 * the bytes actually uploaded, but a stable packing makes a re-upload a no-op
 * instead of silent churn.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { gzipSync } from 'fflate';

const BLOCK = 512;

/** Every refusal this module can produce, as a stable typed reason. */
export type PackRefusal = 'PATH_TOO_LONG' | 'FILE_TOO_LARGE' | 'EMPTY_TREE';

export class PackError extends Error {
  override readonly name = 'PackError';
  constructor(
    readonly reason: PackRefusal,
    message: string,
  ) {
    super(message);
  }
}

/**
 * ustar splits a path across `prefix` (155) and `name` (100) at a `/`. The
 * reader joins them back, so the split point is free — but a component that
 * cannot be placed in either field has no representation this reader accepts.
 */
const MAX_NAME = 100;
const MAX_PREFIX = 155;

/** A single ustar header block. */
function header(path: string, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const write = (at: number, len: number, value: string): void => {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.byteLength > len) throw new PackError('PATH_TOO_LONG', `field overflow writing ${path}`);
    block.set(bytes.subarray(0, len), at);
  };

  let name = path;
  let prefix = '';
  if (Buffer.byteLength(path, 'utf8') > MAX_NAME) {
    // Split at the LAST separator that leaves a name field that fits, which is
    // what every tar implementation does and what keeps the join lossless.
    const cut = path.lastIndexOf('/', path.length - 1);
    for (let at = cut; at > 0; at = path.lastIndexOf('/', at - 1)) {
      const head = path.slice(0, at);
      const tail = path.slice(at + 1);
      if (
        Buffer.byteLength(tail, 'utf8') <= MAX_NAME &&
        Buffer.byteLength(head, 'utf8') <= MAX_PREFIX
      ) {
        prefix = head;
        name = tail;
        break;
      }
    }
    if (prefix === '') {
      throw new PackError(
        'PATH_TOO_LONG',
        `"${path}" does not fit a ustar header, and the reader refuses long-name blocks`,
      );
    }
  }

  write(0, 100, name);
  write(100, 8, '0000644\0'); // mode; the reader discards it (archive.ts header)
  write(108, 8, '0000000\0'); // uid
  write(116, 8, '0000000\0'); // gid
  write(124, 12, `${size.toString(8).padStart(11, '0')}\0`);
  write(136, 12, `${(0).toString(8).padStart(11, '0')}\0`); // mtime, fixed
  write(156, 1, '0'); // typeflag: regular file, the only kind emitted
  write(257, 6, 'ustar\0');
  write(263, 2, '00');
  write(345, 155, prefix);

  // Checksum LAST, over a block whose own checksum field reads as spaces.
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  write(148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return block;
}

/** Every file under `dir`, as `relative/path` → bytes, depth-first and sorted. */
async function walk(dir: string, prefix = ''): Promise<Array<[string, Buffer]>> {
  const out: Array<[string, Buffer]> = [];
  // Sorted so a tree packs the same way twice: the fingerprint is recorded
  // once, but a stable order makes a re-upload a no-op rather than churn.
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full, path)));
      continue;
    }
    // Plain files only, matching the reader's allowlist. A symlink in a staged
    // tree cannot happen — `stage()` refuses one — so this drops nothing real
    // and keeps the writer from following one if that ever changes.
    if (!entry.isFile()) continue;
    out.push([path, await readFile(full)]);
  }
  return out;
}

export interface PackedTree {
  /** gzipped ustar, ready for `stage()`. */
  tarball: Uint8Array;
  /** How many files went in, for the log line that records a copy. */
  fileCount: number;
}

/**
 * Pack a staged package directory into `package/`-prefixed tar.gz.
 *
 * @param dir the package version directory, i.e. `store.dirFor(key, version)`.
 */
export async function packStagedTree(
  dir: string,
  limits: { maxFileBytes?: number } = {},
): Promise<PackedTree> {
  const maxFileBytes = limits.maxFileBytes ?? 64 * 1024 * 1024;
  const files = await walk(dir);
  if (files.length === 0) {
    // An empty package is not a package, and packing one would produce an
    // archive `stage()` refuses — better to say so here, where the key is known.
    throw new PackError('EMPTY_TREE', `${dir} holds no files to pack`);
  }

  const parts: Uint8Array[] = [];
  for (const [path, bytes] of files) {
    if (bytes.byteLength > maxFileBytes) {
      throw new PackError('FILE_TOO_LARGE', `"${path}" is ${bytes.byteLength} bytes`);
    }
    parts.push(header(`package/${path}`, bytes.byteLength));
    parts.push(bytes);
    const padding = (BLOCK - (bytes.byteLength % BLOCK)) % BLOCK;
    if (padding > 0) parts.push(new Uint8Array(padding));
  }
  // Two zero blocks close a tar archive.
  parts.push(new Uint8Array(BLOCK * 2));

  const total = parts.reduce((n, part) => n + part.byteLength, 0);
  const tar = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    tar.set(part, at);
    at += part.byteLength;
  }
  // `mtime: 0` for the same reason the headers carry one: a stable packing.
  // fflate stamps the current second otherwise, so a tree packed twice would
  // hash apart and a re-upload would look like a change.
  return { tarball: gzipSync(tar, { mtime: 0 }), fileCount: files.length };
}
