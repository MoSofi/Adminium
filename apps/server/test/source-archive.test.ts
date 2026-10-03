// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's source archive: where it may come from, and what of it is taken.
 */
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { SourceArchiveError, fetchSourceArchive, readSourceArchive, sourceArchiveUrl } from '../src/project/apps/source-archive.js';

/** One tar member: a header block and its body, padded. */
function member(name: string, body: string | Buffer, type = '0', linkOrPrefix = ''): Buffer {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write('0000644\0', 100);
  header.write(`${data.byteLength.toString(8).padStart(11, '0')}\0`, 124);
  header.write(type, 156);
  header.write('ustar\0', 257);
  if (linkOrPrefix !== '') header.write(linkOrPrefix, 345, 'utf8');
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.byteLength % 512)) % 512)]);
}
const archive = (...members: Buffer[]): Buffer => gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));

describe('where an app’s source comes from', () => {
  it('is the tag of its version in its GitHub repository, and nowhere else', () => {
    expect(sourceArchiveUrl('https://github.com/Adminiumjs/point-of-sale', '0.2.3')).toBe('https://codeload.github.com/Adminiumjs/point-of-sale/tar.gz/refs/tags/v0.2.3');
    expect(sourceArchiveUrl('https://github.com/Adminiumjs/point-of-sale.git', '0.2.3')).toContain('/point-of-sale/tar.gz/');
    for (const repo of ['http://github.com/a/b', 'https://github.com.evil.test/a/b', 'https://gitlab.com/a/b', 'https://github.com/a/b/tree/x', 'https://github.com/a', 'https://user@github.com/a/b', 'https://github.com/a/b?x=1']) {
      expect(sourceArchiveUrl(repo, '0.2.3'), repo).toBeNull();
    }
    for (const version of ['main', '0.2', 'v0.2.3', '0.2.3/../../x', '']) expect(sourceArchiveUrl('https://github.com/a/b', version), version).toBeNull();
  });
});

describe('what is taken from the archive', () => {
  it('reads plain files under the one top folder, with a long path from its PAX record', () => {
    const long = `app-0.2.3/src/${'a-long-folder-name-'.repeat(6)}/file.ts`;
    const files = readSourceArchive(
      archive(
        member('pax_global_header', '52 comment=0123456789abcdef0123456789abcdef01234567\n', 'g'),
        member('app-0.2.3/', '', '5'),
        member('app-0.2.3/manifest.json', '{"key":"pos"}'),
        member('app-0.2.3/src/App.tsx', 'export {};'),
        member('PaxHeader', `${String(`00 path=${long}\n`.length + 1)} path=${long}\n`.replace(/^\d+/, (n) => n), 'x'),
        member('app-0.2.3/src/short', 'long one'),
      ),
    );
    expect([...files.keys()].slice(0, 2)).toEqual(['manifest.json', 'src/App.tsx']);
    expect(files.get('manifest.json')?.toString()).toBe('{"key":"pos"}');
    expect(files.get(`src/${'a-long-folder-name-'.repeat(6)}/file.ts`)?.toString()).toBe('long one');
  });

  it('leaves a link out, and refuses a path that leaves the folder or a member that is neither file nor folder', () => {
    const withLink = readSourceArchive(archive(member('app/a.txt', 'a'), member('app/link', '', '2')));
    expect([...withLink.keys()]).toEqual(['a.txt']);
    expect(() => readSourceArchive(archive(member('app/../../etc/passwd', 'x')))).toThrow(SourceArchiveError);
    expect(() => readSourceArchive(archive(member('/etc/passwd', 'x')))).toThrow(SourceArchiveError);
    expect(() => readSourceArchive(archive(member('app/device', '', '3')))).toThrow(/not a file or a folder/);
    expect(() => readSourceArchive(archive(member('app/', '', '5')))).toThrow(/no files/);
    expect(() => readSourceArchive(Buffer.from('not gzip at all'))).toThrow(SourceArchiveError);
  });
});

describe('fetching it', () => {
  it('says a missing tag in plain words, follows no redirect, and stops at the size limit', async () => {
    const answer = (status: number, body: BodyInit | null = null): typeof fetch => (async (_url: unknown, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      return new Response(body, { status });
    }) as never;
    await expect(fetchSourceArchive('https://codeload.github.com/a/b/tar.gz/refs/tags/v1.0.0', { fetch: answer(404) })).rejects.toThrow(/no such tag/);
    await expect(fetchSourceArchive('https://codeload.github.com/a/b/tar.gz/refs/tags/v1.0.0', { fetch: answer(500, 'x') })).rejects.toThrow(/HTTP 500/);
    const small = archive(member('app/a.txt', 'a'));
    expect(Buffer.from(await fetchSourceArchive('https://x', { fetch: answer(200, new Uint8Array(small)) })).equals(small)).toBe(true);
  });
});
