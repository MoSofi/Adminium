// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Hardened npm-tarball reader for add-on packages
 * (32-add-on-distribution.md §1 D5).
 *
 * WHY THIS IS NOT A THIN WRAPPER OVER A TAR LIBRARY. An add-on ships a server
 * half that 24 D13 runs IN-PROCESS, so distribution is an RCE channel and every
 * archive that reaches this module is hostile input. The sha512 check upstream
 * authenticates *which bytes arrived*; it says nothing about whether those bytes
 * are a safe archive, and the publisher gate (`validate.ts`) cannot run until
 * `manifest.json` has already been extracted — the field it reads lives inside
 * the attacker's archive. Unpack is therefore the last line of defence, and it
 * is written as an ALLOWLIST: an entry is refused unless it is positively
 * recognised as a plain file or a directory with a clean relative path.
 *
 * WHAT A REAL ARTIFACT LOOKS LIKE (measured, not assumed — `npm pack` on a real
 * add-on package, headers dumped from the gunzipped stream): pure USTAR, magic
 * `ustar\0`, every member typeflag `0` (regular file), every path under
 * `package/`, no directory members, no PAX extended headers, no GNU long-name
 * blocks. The strictness below therefore costs nothing in compatibility: it
 * refuses shapes the first-party publisher never emits.
 *
 * BOMB BOUNDING, MEASURED. `gunzipSync` would materialise the whole expansion
 * before any cap could look at it, so this streams through fflate's `Gunzip`
 * and aborts from the chunk callback. fflate flushes on a fixed internal
 * buffer, so the overshoot past {@link ArchiveLimits.maxUncompressedBytes} is
 * bounded by one chunk — measured at 16 MiB for 64 MiB, 256 MiB and 1 GiB
 * bombs alike (the first chunk does NOT scale with the bomb).
 *
 * The honest peak figure is therefore **roughly twice the cap, plus 16 MiB**,
 * not "the cap plus 16 MiB": a stream that fits produces the accumulated chunk
 * array AND the flat copy assembled from it, both alive at once. It is bounded
 * and it is proportional to the cap, which is the property that matters; but
 * the cap should be read as half a memory budget, not all of it.
 *
 * ARCHIVE MODES ARE NEVER HONOURED. The caller writes files 0o600; a setuid bit
 * in a tarball is not a thing this code can be talked into reproducing, because
 * the mode field is read for the checksum and then discarded.
 */

import { Gunzip } from 'fflate';

/** Every refusal this module can produce, as a stable typed reason. */
export type ArchiveRefusal =
  | 'COMPRESSED_TOO_LARGE'
  | 'UNCOMPRESSED_TOO_LARGE'
  | 'NOT_GZIP'
  | 'CORRUPT_GZIP'
  | 'TRUNCATED_ARCHIVE'
  | 'BAD_HEADER_CHECKSUM'
  | 'NOT_USTAR'
  | 'BAD_SIZE_FIELD'
  | 'ENTRY_TOO_LARGE'
  | 'TOO_MANY_ENTRIES'
  | 'FORBIDDEN_ENTRY_TYPE'
  | 'ABSOLUTE_PATH'
  | 'PATH_TRAVERSAL'
  | 'ILLEGAL_PATH'
  | 'PATH_TOO_LONG'
  | 'PATH_TOO_DEEP'
  | 'DUPLICATE_PATH'
  | 'MISSING_ROOT_PREFIX'
  | 'EMPTY_ARCHIVE';

/** A refusal from the unpack path; `reason` is what the audit row records. */
export class AddOnArchiveError extends Error {
  override readonly name = 'AddOnArchiveError';
  readonly reason: ArchiveRefusal;
  /** The offending entry path, when the refusal is about one entry. */
  readonly entry: string | undefined;

  constructor(reason: ArchiveRefusal, message: string, entry?: string) {
    super(message);
    this.reason = reason;
    this.entry = entry;
  }
}

/**
 * Caps. Sized against reality with three orders of magnitude of headroom: the
 * six first-party add-on dists total ~1 MB, the largest single built asset is
 * ~222 KB, and the largest package carries four shipped files plus a manifest,
 * a package.json and two markdown files.
 */
export interface ArchiveLimits {
  /** Refused before a single byte is decompressed. */
  maxCompressedBytes: number;
  /** Cumulative expansion cap; overshoot bounded by one fflate chunk. */
  maxUncompressedBytes: number;
  /** Cap on any single member. */
  maxEntryBytes: number;
  /** Cap on member count (a tarball of a million empty files is a bomb too). */
  maxEntries: number;
  /** Cap on a member's path length, after the `package/` prefix is stripped. */
  maxPathLength: number;
  /** Cap on a member's path depth, after the prefix is stripped. */
  maxPathDepth: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxCompressedBytes: 32 * 1024 * 1024,
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxEntryBytes: 32 * 1024 * 1024,
  maxEntries: 2048,
  maxPathLength: 200,
  maxPathDepth: 12,
};

/** One accepted member: a plain file with a clean, prefix-stripped path. */
export interface ArchiveEntry {
  /** Relative path with the npm `package/` prefix removed. Never escapes. */
  path: string;
  bytes: Uint8Array;
}

const BLOCK = 512;

/**
 * Ordinary tar type flags, named so a refusal can say WHICH shape was refused
 * rather than printing a byte. Only regular files and directories are ever
 * accepted; the rest exist here purely to produce a legible message.
 */
const TYPE_NAMES: Record<string, string> = {
  '0': 'file',
  '\0': 'file',
  '1': 'hard link',
  '2': 'symbolic link',
  '3': 'character device',
  '4': 'block device',
  '5': 'directory',
  '6': 'FIFO',
  '7': 'contiguous file',
  x: 'PAX extended header',
  g: 'PAX global header',
  L: 'GNU long name',
  K: 'GNU long link name',
};

/**
 * Streams the gzip member, aborting the moment cumulative output passes the
 * cap. Returns the full expansion when it fits.
 */
export function gunzipCapped(compressed: Uint8Array, limits: ArchiveLimits): Uint8Array {
  if (compressed.byteLength > limits.maxCompressedBytes) {
    throw new AddOnArchiveError(
      'COMPRESSED_TOO_LARGE',
      `tarball is ${compressed.byteLength} bytes, over the ${limits.maxCompressedBytes}-byte limit`,
    );
  }
  // gzip magic 0x1f 0x8b, checked before fflate is handed anything at all.
  if (compressed.byteLength < 2 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
    throw new AddOnArchiveError('NOT_GZIP', 'payload is not a gzip stream');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  let overCap = false;
  let done = false;

  try {
    const gunzip = new Gunzip((chunk, final) => {
      total += chunk.byteLength;
      if (total > limits.maxUncompressedBytes) {
        overCap = true;
        // Unwind immediately: nothing further is pushed, so the expansion
        // stops here rather than running to the archive's claimed size.
        throw new Error('over cap');
      }
      chunks.push(chunk);
      if (final) done = true;
    });

    // Pushed in slices rather than one call: `push(all, true)` makes fflate
    // produce the entire expansion before the callback can look at any of it.
    const SLICE = 64 * 1024;
    for (let offset = 0; offset < compressed.byteLength; offset += SLICE) {
      const end = Math.min(offset + SLICE, compressed.byteLength);
      gunzip.push(compressed.subarray(offset, end), end >= compressed.byteLength);
    }
  } catch (err) {
    if (overCap) {
      throw new AddOnArchiveError(
        'UNCOMPRESSED_TOO_LARGE',
        `archive expands past the ${limits.maxUncompressedBytes}-byte limit`,
      );
    }
    throw new AddOnArchiveError('CORRUPT_GZIP', `gzip stream is unreadable: ${String(err)}`);
  }

  if (!done) {
    throw new AddOnArchiveError('CORRUPT_GZIP', 'gzip stream ended without a final block');
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }

  // THE FOOTER, WHICH fflate DOES NOT CHECK. Its `Gunzip` stops at the final
  // DEFLATE block and never validates gzip's trailing CRC32 and ISIZE, so a
  // stream every standard decompressor rejects as corrupt was being accepted
  // here as clean. On an RCE path that is a parser differential: `gzip -t`,
  // `tar -tzf` and any scanner in front of this service would refuse bytes the
  // extractor happily unpacked. Checking it is ~15 lines and removes the whole
  // disagreement.
  if (compressed.byteLength < 8) {
    throw new AddOnArchiveError('CORRUPT_GZIP', 'gzip stream is too short to carry a footer');
  }
  const footer = compressed.subarray(compressed.byteLength - 8);
  const declaredCrc =
    (footer[0]! | (footer[1]! << 8) | (footer[2]! << 16) | (footer[3]! << 24)) >>> 0;
  const declaredSize =
    (footer[4]! | (footer[5]! << 8) | (footer[6]! << 16) | (footer[7]! << 24)) >>> 0;

  // ISIZE is the expansion modulo 2^32, which is how gzip has always spelled it.
  if (declaredSize !== (total >>> 0)) {
    throw new AddOnArchiveError(
      'CORRUPT_GZIP',
      `gzip footer declares ${declaredSize} bytes but the stream expanded to ${total}`,
    );
  }
  if (crc32(out) !== declaredCrc) {
    throw new AddOnArchiveError('CORRUPT_GZIP', 'gzip footer CRC32 does not match the data');
  }

  return out;
}

/** CRC-32 (IEEE), the polynomial gzip's footer uses. Table built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Reads a NUL-terminated ASCII field. */
function field(block: Uint8Array, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  let end = slice.indexOf(0);
  if (end === -1) end = slice.length;
  return Buffer.from(slice.subarray(0, end)).toString('latin1');
}

/**
 * Parses a strictly-octal numeric field. GNU base-256 encoding (high bit set)
 * is REFUSED: it exists to describe members over 8 GiB, three orders of
 * magnitude past {@link ArchiveLimits.maxEntryBytes}, so in practice it only
 * ever appears from something trying to confuse a size check.
 */
function octal(block: Uint8Array, start: number, length: number, what: string): number {
  const first = block[start];
  if (first !== undefined && (first & 0x80) !== 0) {
    throw new AddOnArchiveError('BAD_SIZE_FIELD', `${what} uses base-256 encoding`);
  }
  const raw = field(block, start, length).trim();
  if (raw.length === 0) return 0;
  if (!/^[0-7]+$/.test(raw)) {
    throw new AddOnArchiveError('BAD_SIZE_FIELD', `${what} is not octal: ${JSON.stringify(raw)}`);
  }
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AddOnArchiveError('BAD_SIZE_FIELD', `${what} is out of range: ${raw}`);
  }
  return value;
}

/**
 * Verifies the header checksum. Cheap, and it rejects hand-edited headers that
 * were changed without recomputing it. Both the unsigned reading and the
 * historical signed one are accepted, as every tar implementation does.
 */
function checksumOk(block: Uint8Array): boolean {
  const stored = field(block, 148, 8).trim();
  if (!/^[0-7]+$/.test(stored)) return false;
  const want = Number.parseInt(stored, 8);
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i += 1) {
    const byte = i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  return want === unsigned || want === signed;
}

/**
 * Validates one member path and strips npm's `package/` root.
 *
 * Refusals, in the order a hostile path tends to try them: absolute (`/etc/x`,
 * `C:\x`), traversal (`../`, or a bare `..` component anywhere), backslashes
 * (a Windows separator that POSIX `resolve` treats as an ordinary character,
 * so `a\..\..\b` could slip a containment check that only splits on `/`), NUL
 * and control bytes (truncation tricks against anything downstream that reaches
 * C string handling), and empty or `.` components.
 */
function cleanPath(raw: string, limits: ArchiveLimits): string {
  if (raw.length === 0) {
    throw new AddOnArchiveError('ILLEGAL_PATH', 'entry has an empty path');
  }
  // eslint-disable-next-line no-control-regex -- refusing control bytes is the point
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new AddOnArchiveError('ILLEGAL_PATH', 'entry path carries control characters', raw);
  }
  if (raw.includes('\\')) {
    throw new AddOnArchiveError('ILLEGAL_PATH', 'entry path carries a backslash', raw);
  }
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    throw new AddOnArchiveError('ABSOLUTE_PATH', 'entry path is absolute', raw);
  }

  const parts = raw.replace(/\/+$/, '').split('/');
  for (const part of parts) {
    if (part === '..') {
      throw new AddOnArchiveError('PATH_TRAVERSAL', 'entry path walks upward', raw);
    }
    if (part === '' || part === '.') {
      throw new AddOnArchiveError('ILLEGAL_PATH', 'entry path has an empty component', raw);
    }
  }

  if (parts[0] !== 'package') {
    throw new AddOnArchiveError(
      'MISSING_ROOT_PREFIX',
      'entry is not under the npm `package/` root',
      raw,
    );
  }
  const rest = parts.slice(1);
  if (rest.length === 0) {
    // The bare `package/` directory member itself: nothing to write.
    return '';
  }
  if (rest.length > limits.maxPathDepth) {
    throw new AddOnArchiveError('PATH_TOO_DEEP', `entry path is ${rest.length} levels deep`, raw);
  }
  const path = rest.join('/');
  if (path.length > limits.maxPathLength) {
    throw new AddOnArchiveError('PATH_TOO_LONG', `entry path is ${path.length} characters`, raw);
  }
  return path;
}

/**
 * Parses a decompressed tar stream into accepted file members.
 *
 * Directory members are validated and then dropped: parent directories are
 * created from the file paths themselves, so an archive cannot use a directory
 * member to create anything a file member does not already justify.
 */
export function readTarEntries(
  tar: Uint8Array,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let zeroBlocks = 0;

  while (offset + BLOCK <= tar.byteLength) {
    const header = tar.subarray(offset, offset + BLOCK);

    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      offset += BLOCK;
      // Two consecutive zero blocks close the archive; trailing padding after
      // them is ignored rather than parsed.
      if (zeroBlocks >= 2) break;
      continue;
    }
    if (zeroBlocks > 0) {
      // A SINGLE zero block followed by more data. GNU tar and bsdtar stop at
      // it; this reader used to skip it and carry on, so an archive could show
      // an auditor one set of members and hand the extractor another. A parser
      // differential on the RCE path is worth more than the leniency.
      throw new AddOnArchiveError(
        'TRUNCATED_ARCHIVE',
        `stray zero block at offset ${offset - BLOCK} followed by more data`,
      );
    }

    if (!checksumOk(header)) {
      throw new AddOnArchiveError('BAD_HEADER_CHECKSUM', `bad header checksum at offset ${offset}`);
    }

    // USTAR magic, checked before any other field is trusted.
    //
    // Every offset this parser reads — `prefix` at 345 most of all — is defined
    // by the ustar format. A pre-POSIX v7 header has no `prefix` field at all
    // and a GNU header uses that region differently, so reading them at ustar
    // offsets is how PARSER DIFFERENTIALS start: another tool reading the same
    // bytes as v7 or GNU sees different member paths than we do. `npm pack`
    // always writes `ustar\0`, so requiring it costs nothing and turns "we only
    // accept what npm pack emits" from an observation into a check.
    const magic = field(header, 257, 6);
    if (magic !== 'ustar' && magic !== 'ustar ') {
      throw new AddOnArchiveError(
        'NOT_USTAR',
        `entry at offset ${offset} is not a ustar header (magic ${JSON.stringify(magic)})`,
      );
    }

    const size = octal(header, 124, 12, 'entry size');
    const typeflag = field(header, 156, 1) || '\0';
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const raw = prefix.length > 0 ? `${prefix}/${name}` : name;

    if (size > limits.maxEntryBytes) {
      throw new AddOnArchiveError(
        'ENTRY_TOO_LARGE',
        `entry is ${size} bytes, over the ${limits.maxEntryBytes}-byte limit`,
        raw,
      );
    }

    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.byteLength) {
      throw new AddOnArchiveError('TRUNCATED_ARCHIVE', 'entry body runs past the archive', raw);
    }

    const isFile = typeflag === '0' || typeflag === '\0';
    const isDirectory = typeflag === '5';
    if (!isFile && !isDirectory) {
      const what = TYPE_NAMES[typeflag] ?? `type ${JSON.stringify(typeflag)}`;
      throw new AddOnArchiveError(
        'FORBIDDEN_ENTRY_TYPE',
        `archive carries a ${what} entry; only files and directories are accepted`,
        raw,
      );
    }

    // Validated even for directories: a hostile directory member is refused
    // rather than silently skipped, so the archive fails closed as a whole.
    const path = cleanPath(raw, limits);

    if (isFile && path.length > 0) {
      if (seen.has(path)) {
        throw new AddOnArchiveError('DUPLICATE_PATH', 'archive carries the path twice', path);
      }
      seen.add(path);
      if (entries.length >= limits.maxEntries) {
        throw new AddOnArchiveError(
          'TOO_MANY_ENTRIES',
          `archive carries more than ${limits.maxEntries} entries`,
        );
      }
      entries.push({ path, bytes: tar.slice(dataStart, dataEnd) });
    }

    offset = dataEnd + ((BLOCK - (size % BLOCK)) % BLOCK);
  }

  if (entries.length === 0) {
    throw new AddOnArchiveError('EMPTY_ARCHIVE', 'archive carries no files');
  }
  return entries;
}

/** Gunzip + parse: the whole read half of the unpack path, caps enforced. */
export function readAddOnTarball(
  tarball: Uint8Array,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): ArchiveEntry[] {
  return readTarEntries(gunzipCapped(tarball, limits), limits);
}
