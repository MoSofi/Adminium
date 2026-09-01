// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Hostile-fixture suite for the add-on unpack path
 * (32-add-on-distribution.md §7 acceptance #3, D5).
 *
 * The fixtures are BUILT HERE rather than checked in as binaries: a tar-slip
 * archive committed to the repo is a thing every scanner in CI has an opinion
 * about, and hand-building the header is also the only way to assert that a
 * refusal fires on the exact field being attacked. Every archive below is a
 * real gzip of a real 512-byte-blocked tar stream — the parser under test is
 * never handed a shortcut.
 */

import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  AddOnArchiveError,
  DEFAULT_ARCHIVE_LIMITS,
  gunzipCapped,
  readAddOnTarball,
  readTarEntries,
  type ArchiveLimits,
} from '../src/add-ons/archive.js';

const BLOCK = 512;

/** Writes an ASCII field into a header block. */
function put(block: Uint8Array, at: number, length: number, value: string): void {
  block.set(Buffer.from(value, 'latin1').subarray(0, length), at);
}

/** Recomputes the header checksum in place (after any hand edit). */
function seal(header: Uint8Array, offBy = 0): void {
  header.set(Buffer.from('        ', 'latin1'), 148);
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += header[i] ?? 0;
  put(header, 148, 8, `${(sum + offBy).toString(8).padStart(6, '0')}\0 `);
}

interface FixtureEntry {
  name: string;
  body?: string;
  typeflag?: string;
  prefix?: string;
  /** Leave the checksum wrong on purpose. */
  breakChecksum?: boolean;
}

/** Builds one 512-byte USTAR header plus its padded body. */
function member_(entry: FixtureEntry): Uint8Array {
  const body = Buffer.from(entry.body ?? '', 'utf8');
  const header = new Uint8Array(BLOCK);
  put(header, 0, 100, entry.name);
  put(header, 100, 8, '0000644\0');
  put(header, 108, 8, '0000000\0');
  put(header, 116, 8, '0000000\0');
  put(header, 124, 12, `${body.length.toString(8).padStart(11, '0')}\0`);
  put(header, 136, 12, '00000000000\0');
  put(header, 156, 1, entry.typeflag ?? '0');
  put(header, 257, 6, 'ustar\0');
  put(header, 263, 2, '00');
  if (entry.prefix) put(header, 345, 155, entry.prefix);
  seal(header, entry.breakChecksum ? 1 : 0);

  const padding = (BLOCK - (body.length % BLOCK)) % BLOCK;
  const out = new Uint8Array(BLOCK + body.length + padding);
  out.set(header, 0);
  out.set(body, BLOCK);
  return out;
}

/** Concatenates members and closes the archive with two zero blocks. */
function tar(entries: FixtureEntry[]): Uint8Array {
  const blocks = entries.map(member_);
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.byteLength, 0) + BLOCK * 2);
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.byteLength;
  }
  return out;
}

const tarball = (entries: FixtureEntry[]): Uint8Array => gzipSync(tar(entries));

/** Wraps one hand-edited member into a closed archive. */
function streamOf(header: Uint8Array): Uint8Array {
  const out = new Uint8Array(header.byteLength + BLOCK * 2);
  out.set(header, 0);
  return out;
}

/** A well-formed package: what every refusal below is a deviation from. */
const GOOD: FixtureEntry[] = [
  { name: 'package/manifest.json', body: '{"key":"design-studio"}' },
  { name: 'package/package.json', body: '{"name":"@adminiumjs/add-on-design-studio"}' },
  { name: 'package/dist/client.js', body: 'export const mount = () => {};' },
];

/** Asserts a refusal of exactly `reason`, never a generic throw. */
function refusal(run: () => unknown, reason: string): AddOnArchiveError {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected ${reason}, nothing was thrown`).toBeInstanceOf(AddOnArchiveError);
  const error = caught as AddOnArchiveError;
  expect(error.reason).toBe(reason);
  return error;
}

describe('add-on archive: the happy path', () => {
  it('reads a well-formed npm tarball and strips the package/ root', () => {
    const entries = readAddOnTarball(tarball(GOOD));
    expect(entries.map((e) => e.path)).toEqual(['manifest.json', 'package.json', 'dist/client.js']);
    expect(Buffer.from(entries[2]!.bytes).toString('utf8')).toBe('export const mount = () => {};');
  });

  it('accepts a directory member without emitting a file for it', () => {
    const entries = readAddOnTarball(tarball([{ name: 'package/dist/', typeflag: '5' }, ...GOOD]));
    expect(entries.map((e) => e.path)).not.toContain('dist');
    expect(entries).toHaveLength(3);
  });

  it('reads a long path carried in the ustar prefix field', () => {
    const entries = readAddOnTarball(
      tarball([...GOOD, { name: 'client.js', prefix: 'package/dist/nested/deeper', body: 'ok' }]),
    );
    expect(entries.map((e) => e.path)).toContain('dist/nested/deeper/client.js');
  });
});

describe('add-on archive: path attacks fail closed', () => {
  it('refuses a tar-slip entry that walks out of the package root', () => {
    const error = refusal(
      () => readAddOnTarball(tarball([{ name: 'package/../../../etc/passwd', body: 'pwned' }])),
      'PATH_TRAVERSAL',
    );
    expect(error.entry).toBe('package/../../../etc/passwd');
  });

  it('refuses traversal hidden in the middle of a path', () => {
    refusal(
      () => readAddOnTarball(tarball([{ name: 'package/dist/../../../evil.js', body: 'x' }])),
      'PATH_TRAVERSAL',
    );
  });

  it('refuses traversal smuggled through the ustar prefix field', () => {
    refusal(
      () => readAddOnTarball(tarball([{ name: 'passwd', prefix: 'package/../../etc', body: 'x' }])),
      'PATH_TRAVERSAL',
    );
  });

  it('refuses an absolute POSIX path', () => {
    refusal(
      () => readAddOnTarball(tarball([{ name: '/etc/cron.d/evil', body: 'x' }])),
      'ABSOLUTE_PATH',
    );
  });

  it('refuses a Windows drive-letter path', () => {
    refusal(
      () => readAddOnTarball(tarball([{ name: 'C:/Windows/System32/evil.dll', body: 'x' }])),
      'ABSOLUTE_PATH',
    );
  });

  it('refuses a backslash separator that a POSIX containment check would miss', () => {
    refusal(
      () => readAddOnTarball(tarball([{ name: 'package/dist\\..\\..\\evil.js', body: 'x' }])),
      'ILLEGAL_PATH',
    );
  });

  it('refuses a control byte used to truncate the path downstream', () => {
    const header = member_({ name: 'package/ok.js', body: 'x' });
    put(header, 0, 100, 'package/a\u0001b.js');
    seal(header);
    refusal(() => readTarEntries(streamOf(header)), 'ILLEGAL_PATH');
  });

  it('refuses an entry outside the npm package/ root', () => {
    refusal(
      () => readAddOnTarball(tarball([{ name: 'notpackage/x.js', body: 'x' }])),
      'MISSING_ROOT_PREFIX',
    );
  });

  it('refuses the same path twice, so a scanner cannot be shown only one copy', () => {
    refusal(
      () =>
        readAddOnTarball(
          tarball([
            { name: 'package/dist/client.js', body: 'harmless' },
            { name: 'package/dist/client.js', body: 'hostile' },
          ]),
        ),
      'DUPLICATE_PATH',
    );
  });
});

describe('add-on archive: non-file entry types are refused outright', () => {
  const cases: Array<[string, string]> = [
    ['2', 'symbolic link'],
    ['1', 'hard link'],
    ['3', 'character device'],
    ['4', 'block device'],
    ['6', 'FIFO'],
    ['x', 'PAX extended header'],
    ['L', 'GNU long name'],
  ];

  for (const [typeflag, what] of cases) {
    it(`refuses a ${what} entry`, () => {
      const error = refusal(
        () => readAddOnTarball(tarball([{ name: 'package/evil', typeflag, body: '' }])),
        'FORBIDDEN_ENTRY_TYPE',
      );
      expect(error.message).toContain(what);
    });
  }

  it('refuses a symlink escape even when the link path itself looks clean', () => {
    // The classic two-step: a clean-looking symlink to /etc, then a write
    // "into" it. Refusing the link itself means step two never has a target.
    refusal(
      () =>
        readAddOnTarball(
          tarball([
            { name: 'package/dist', typeflag: '2', body: '' },
            { name: 'package/dist/client.js', body: 'pwned' },
          ]),
        ),
      'FORBIDDEN_ENTRY_TYPE',
    );
  });
});

describe('add-on archive: size and shape limits', () => {
  it('refuses a decompression bomb with bounded allocation', { timeout: 120_000 }, () => {
    // 96 MiB of zeros in well under 1 MB of gzip — 1.5× the 64 MiB cap. The
    // cap must fire from inside the stream, not after the expansion is
    // materialised, and the overshoot is one slice regardless of bomb size
    // (the 2026-08-29 review measured 200 MiB/1 GiB bombs identically), so a
    // bigger bomb proves nothing extra. What it DID do was gzip 200 MiB of
    // zeros in test setup — which blew the 30s default timeout on a starved
    // CI runner (run 33493917464) while the refusal itself stayed instant.
    // Hence the smaller bomb AND the explicit timeout.
    const bomb = gzipSync(new Uint8Array(96 * 1024 * 1024));
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    refusal(() => readAddOnTarball(bomb), 'UNCOMPRESSED_TOO_LARGE');
  });

  it('refuses an oversized tarball before decompressing anything', () => {
    const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxCompressedBytes: 16 };
    refusal(() => readAddOnTarball(tarball(GOOD), limits), 'COMPRESSED_TOO_LARGE');
  });

  it('refuses an entry over the per-entry cap', () => {
    const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxEntryBytes: 8 };
    refusal(
      () => readAddOnTarball(tarball([{ name: 'package/big.js', body: 'x'.repeat(64) }]), limits),
      'ENTRY_TOO_LARGE',
    );
  });

  it('refuses an archive with too many members', () => {
    const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxEntries: 2 };
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `package/f${i}.js`, body: 'x' }));
    refusal(() => readAddOnTarball(tarball(many), limits), 'TOO_MANY_ENTRIES');
  });

  it('refuses a path deeper than the depth cap', () => {
    const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxPathDepth: 2 };
    refusal(
      () => readAddOnTarball(tarball([{ name: 'package/a/b/c/d.js', body: 'x' }]), limits),
      'PATH_TOO_DEEP',
    );
  });

  it('refuses a path longer than the length cap', () => {
    const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, maxPathLength: 10 };
    refusal(
      () => readAddOnTarball(tarball([{ name: `package/${'a'.repeat(64)}.js`, body: 'x' }]), limits),
      'PATH_TOO_LONG',
    );
  });
});

describe('add-on archive: malformed streams', () => {
  it('refuses a payload that is not gzip at all', () => {
    refusal(() => readAddOnTarball(Buffer.from('not a tarball at all')), 'NOT_GZIP');
  });

  it('refuses a gzip stream with a corrupt body', () => {
    const broken = Uint8Array.from(tarball(GOOD));
    broken.set([0xff, 0xff, 0xff, 0xff], 12);
    const caught = refusal(() => readAddOnTarball(broken), 'CORRUPT_GZIP');
    expect(caught.message).toContain('unreadable');
  });

  it('refuses a header whose checksum was not recomputed after editing', () => {
    refusal(
      () => readAddOnTarball(tarball([{ name: 'package/x.js', body: 'x', breakChecksum: true }])),
      'BAD_HEADER_CHECKSUM',
    );
  });

  it('refuses a base-256 size field used to dodge the size check', () => {
    const header = member_({ name: 'package/x.js', body: 'x' });
    header[124] = 0x80; // GNU base-256 marker
    seal(header);
    refusal(() => readTarEntries(streamOf(header)), 'BAD_SIZE_FIELD');
  });

  it('refuses a non-octal size field', () => {
    const header = member_({ name: 'package/x.js', body: 'x' });
    put(header, 124, 12, '0000000009z\0');
    seal(header);
    refusal(() => readTarEntries(streamOf(header)), 'BAD_SIZE_FIELD');
  });

  it('refuses an entry body that runs past the end of the archive', () => {
    const header = member_({ name: 'package/x.js', body: 'x' });
    put(header, 124, 12, `${(4096).toString(8).padStart(11, '0')}\0`);
    seal(header);
    refusal(() => readTarEntries(header.subarray(0, BLOCK * 2)), 'TRUNCATED_ARCHIVE');
  });

  it('refuses a header that is not ustar, whatever else is well-formed', () => {
    // Every offset this parser reads — `prefix` at 345 above all — is a ustar
    // field. A v7 or GNU header read at ustar offsets is where a parser
    // differential starts: another tool reading the same bytes sees different
    // member paths. `npm pack` always writes `ustar\0`, so requiring it is free.
    const header = member_({ name: 'package/x.js', body: 'x' });
    put(header, 257, 6, '\0\0\0\0\0\0'); // a pre-POSIX v7 header has no magic
    seal(header);
    refusal(() => readTarEntries(streamOf(header)), 'NOT_USTAR');
  });

  it('accepts the GNU-style "ustar " spelling of the magic', () => {
    const header = member_({ name: 'package/x.js', body: 'x' });
    put(header, 257, 6, 'ustar ');
    seal(header);
    expect(readTarEntries(streamOf(header)).map((e) => e.path)).toEqual(['x.js']);
  });

  it('refuses an archive that carries no files', () => {
    refusal(() => readAddOnTarball(gzipSync(new Uint8Array(BLOCK * 2))), 'EMPTY_ARCHIVE');
  });
});

describe('add-on archive: no parser differentials', () => {
  // Every case here is a stream that some OTHER tar/gzip implementation reads
  // differently from this one. A disagreement about "which files are in this
  // archive" between the extractor and whatever scanned it beforehand is worth
  // more to an attacker than any single malformed field.

  it('refuses a gzip whose footer CRC32 does not match the data', () => {
    // fflate's Gunzip stops at the final DEFLATE block and never looks at the
    // footer, so this stream used to unpack cleanly here while `gzip -t` and
    // `tar -tzf` both rejected it.
    const good = tarball(GOOD);
    const corrupt = Uint8Array.from(good);
    corrupt[corrupt.length - 8] = corrupt[corrupt.length - 8]! ^ 0xff; // first CRC byte
    refusal(() => readAddOnTarball(corrupt), 'CORRUPT_GZIP');
  });

  it('refuses a gzip whose footer ISIZE does not match the expansion', () => {
    const good = tarball(GOOD);
    const corrupt = Uint8Array.from(good);
    corrupt[corrupt.length - 4] = corrupt[corrupt.length - 4]! ^ 0xff; // first ISIZE byte
    const error = refusal(() => readAddOnTarball(corrupt), 'CORRUPT_GZIP');
    expect(error.message).toMatch(/declares \d+ bytes/);
  });

  it('accepts a well-formed footer', () => {
    expect(readAddOnTarball(tarball(GOOD))).toHaveLength(3);
  });

  it('ignores members appended after a proper two-block terminator, as tar does', () => {
    // Not a refusal, and that is the point: two zero blocks END an archive, so
    // GNU tar and bsdtar both stop there too. Agreeing with them is what keeps
    // "what the scanner saw" equal to "what the extractor wrote".
    const visible = tar([{ name: 'package/manifest.json', body: '{}' }]);
    const appended = tar([{ name: 'package/dist/backdoor.js', body: 'pwned' }]);
    const spliced = new Uint8Array(visible.byteLength + appended.byteLength);
    spliced.set(visible, 0);
    spliced.set(appended, visible.byteLength);

    const entries = readTarEntries(spliced);
    expect(entries.map((e) => e.path)).toEqual(['manifest.json']);
    expect(entries.map((e) => e.path)).not.toContain('dist/backdoor.js');
  });

  it('refuses a single zero block used to hide a following member', () => {
    const member = member_({ name: 'package/manifest.json', body: '{}' });
    const hidden = member_({ name: 'package/dist/backdoor.js', body: 'pwned' });
    const stream = new Uint8Array(member.byteLength + BLOCK + hidden.byteLength + BLOCK * 2);
    stream.set(member, 0);
    // one zero block, then another real member
    stream.set(hidden, member.byteLength + BLOCK);
    const error = refusal(() => readTarEntries(stream), 'TRUNCATED_ARCHIVE');
    expect(error.message).toContain('stray zero block');
  });
});

describe('gunzipCapped', () => {
  it('returns the whole expansion when it fits', () => {
    const payload = Buffer.from('a'.repeat(5000));
    expect(Buffer.from(gunzipCapped(gzipSync(payload), DEFAULT_ARCHIVE_LIMITS)).toString()).toBe(
      payload.toString(),
    );
  });
});
