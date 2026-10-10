// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  fetchGit,
  findGit,
  GIT_DOWNLOADS,
  GIT_RECORD_FILE,
  GIT_TAG,
  GitFetchError,
  gitDownloadFor,
  gitDownloadUrl,
  gitHome,
  gitProgramIn,
  isGitDownloadHost,
  ownGit,
  removeUnfinishedGit,
  unpackTarGz,
  type FindGitDeps,
  type GitDownload,
  type RunResult,
} from './git.js';

// ─── a tar, made by hand: the entries are the test ──────────────────────────

interface Entry {
  name: string;
  kind?: '0' | '1' | '2' | '5' | '3' | 'L' | 'x';
  data?: string | Buffer;
  linkTo?: string;
  mode?: number;
  prefix?: string;
}

function tarOf(entries: Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.data === undefined ? Buffer.alloc(0) : Buffer.from(entry.data);
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    header.write((entry.mode ?? 0o644).toString(8).padStart(7, '0'), 100, 8, 'ascii');
    header.write('0000000', 108, 8, 'ascii');
    header.write('0000000', 116, 8, 'ascii');
    header.write(data.length.toString(8).padStart(11, '0'), 124, 12, 'ascii');
    header.write('00000000000', 136, 12, 'ascii');
    header.write(entry.kind ?? '0', 156, 1, 'ascii');
    if (entry.linkTo !== undefined) header.write(entry.linkTo, 157, 100, 'utf8');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    if (entry.prefix !== undefined) header.write(entry.prefix, 345, 155, 'utf8');
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const GIT_SCRIPT = '#!/bin/sh\necho "git version 2.53.0"\n';
const A_GIT: Entry[] = [
  { name: 'bin/', kind: '5' },
  { name: 'bin/git', data: GIT_SCRIPT, mode: 0o755 },
  { name: 'libexec/git-core/git-remote-http', kind: '2', linkTo: '../../bin/git' },
  { name: 'libexec/git-core/git', kind: '1', linkTo: 'bin/git' },
  { name: 'share/README', data: 'read me' },
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'adminium-git-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const archive = (entries: Entry[], name = 'a.tar.gz'): string => {
  const file = join(dir, name);
  writeFileSync(file, gzipSync(tarOf(entries)));
  return file;
};

// ─── unpacking ───────────────────────────────────────────────────────────────

describe('unpackTarGz', () => {
  it('writes files, folders and both kinds of link, and counts what it wrote', async () => {
    const out = join(dir, 'out');
    expect(await unpackTarGz(archive(A_GIT), out)).toBe(4);
    expect(readFileSync(join(out, 'bin', 'git'), 'utf8')).toBe(GIT_SCRIPT);
    expect(statSync(join(out, 'bin', 'git')).mode & 0o111).not.toBe(0);
    expect(statSync(join(out, 'share', 'README')).mode & 0o111).toBe(0);
    expect(lstatSync(join(out, 'libexec', 'git-core', 'git-remote-http')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(out, 'libexec', 'git-core', 'git-remote-http'))).toBe('../../bin/git');
    expect(statSync(join(out, 'libexec', 'git-core', 'git')).ino).toBe(statSync(join(out, 'bin', 'git')).ino);
  });

  it('reads a long name from the entry before it, and a path split across the two name fields', async () => {
    const long = `share/${'a-long-folder-name/'.repeat(8)}file.txt`;
    const out = join(dir, 'out');
    await unpackTarGz(
      archive([
        { name: '././@LongLink', kind: 'L', data: `${long}\0` },
        { name: 'share/truncated', data: 'long' },
        { name: 'name.txt', prefix: 'deep/prefix', data: 'split' },
      ]),
      out,
    );
    expect(readFileSync(join(out, long), 'utf8')).toBe('long');
    expect(readFileSync(join(out, 'deep', 'prefix', 'name.txt'), 'utf8')).toBe('split');
  });

  it.each([
    ['a name that climbs out', [{ name: '../outside.txt', data: 'x' }]],
    ['a name that climbs out from inside', [{ name: 'bin/../../outside.txt', data: 'x' }]],
    ['an absolute name', [{ name: '/etc/outside.txt', data: 'x' }]],
    ['a Windows drive name', [{ name: 'C:/outside.txt', data: 'x' }]],
    ['a link to an absolute path', [{ name: 'bin/git', kind: '2', linkTo: '/bin/sh' }]],
    ['a link that climbs out from where it stands', [{ name: 'bin/git', kind: '2', linkTo: '../../outside' }]],
    ['a hard link to a file outside', [{ name: 'bin/git', kind: '1', linkTo: '../outside' }]],
    ['a device', [{ name: 'dev/null', kind: '3' }]],
  ] as Array<[string, Entry[]]>)('refuses %s, and writes nothing outside', async (_label, entries) => {
    const out = join(dir, 'nested', 'out');
    mkdirSync(join(dir, 'nested'));
    await expect(unpackTarGz(archive(entries), out)).rejects.toThrow(/leaves the folder|points outside|not unpacked/);
    expect(existsSync(join(dir, 'nested', 'outside.txt'))).toBe(false);
    expect(existsSync(join(dir, 'outside.txt'))).toBe(false);
  });

  it('refuses an archive that stops in the middle of a file, and a folder that is already there', async () => {
    const whole = tarOf([{ name: 'bin/git', data: 'x'.repeat(2000) }]);
    const cut = join(dir, 'cut.tar.gz');
    writeFileSync(cut, gzipSync(whole.subarray(0, 512 + 700)));
    await expect(unpackTarGz(cut, join(dir, 'out'))).rejects.toThrow(/ends in the middle/);
    mkdirSync(join(dir, 'there'));
    await expect(unpackTarGz(archive(A_GIT), join(dir, 'there'))).rejects.toThrow(/already exists/);
  });
});

// ─── the download ────────────────────────────────────────────────────────────

describe('what is fetched', () => {
  it('names one file per system, each with its size and a full SHA-256', () => {
    expect(Object.keys(GIT_DOWNLOADS).sort()).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
    for (const [system, download] of Object.entries(GIT_DOWNLOADS)) {
      expect(download.sha256, system).toMatch(/^[0-9a-f]{64}$/);
      expect(download.bytes, system).toBeGreaterThan(20_000_000);
      expect(download.file, system).toMatch(/^dugite-native-v2\.53\.0-[0-9a-f]+-(macOS|ubuntu|windows)-(arm64|x64)\.tar\.gz$/);
    }
    expect(gitDownloadFor('freebsd', 'x64')).toBeNull();
    expect(gitDownloadUrl(GIT_DOWNLOADS['darwin-arm64'] as GitDownload)).toBe(`https://github.com/desktop/dugite-native/releases/download/${GIT_TAG}/dugite-native-v2.53.0-4098283-macOS-arm64.tar.gz`);
  });

  it.each([
    ['https://github.com/desktop/dugite-native/releases/download/x/y.tar.gz', true],
    ['https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sig=3', true],
    ['https://objects.githubusercontent.com/x', true],
    ['http://github.com/desktop/dugite-native/x', false],
    ['https://github.com.evil.io/x', false],
    ['https://evil.io/github.com/x', false],
    ['https://user@github.com/x', false],
    ['https://github.com:8443/x', false],
    ['not a url', false],
  ])('%s may answer the download: %s', (url, allowed) => {
    expect(isGitDownloadHost(url)).toBe(allowed);
  });
});

describe('fetchGit', () => {
  let server: Server;
  let routes: Record<string, (res: import('node:http').ServerResponse) => void>;
  let base: string;
  beforeEach(async () => {
    routes = {};
    server = createServer((req, res) => {
      const route = routes[req.url ?? ''];
      if (route === undefined) {
        res.statusCode = 404;
        res.end();
      } else route(res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const packed = gzipSync(tarOf(A_GIT));
  const good: GitDownload = { file: 'git.tar.gz', bytes: packed.length, sha256: createHash('sha256').update(packed).digest('hex') };
  const local = (url: string): boolean => url.startsWith(base);
  const options = (over: Partial<Parameters<typeof fetchGit>[0]> = {}): Parameters<typeof fetchGit>[0] => ({
    userDataDir: dir,
    platform: 'darwin',
    arch: 'arm64',
    fetch: (url, init) => fetch(url, init),
    download: good,
    url: `${base}/git.tar.gz`,
    allowHost: local,
    ...over,
  });
  const serve = (path: string, body: Buffer): void => {
    routes[path] = (res) => res.end(body);
  };

  it('fetches, checks, unpacks, writes the record last, and says where the program is', async () => {
    serve('/git.tar.gz', packed);
    const progress: number[] = [];
    const program = await fetchGit(options({ onProgress: (received) => progress.push(received) }));
    expect(program).toBe(join(gitHome(dir), 'bin', 'git'));
    expect(readFileSync(program, 'utf8')).toBe(GIT_SCRIPT);
    expect(JSON.parse(readFileSync(join(gitHome(dir), GIT_RECORD_FILE), 'utf8'))).toEqual({ tag: GIT_TAG, sha256: good.sha256, entries: 4 });
    expect(progress.at(-1)).toBe(packed.length);
    // Nothing of the work is left beside it.
    expect(existsSync(`${gitHome(dir)}.partial`)).toBe(false);
    expect(existsSync(`${gitHome(dir)}.download`)).toBe(false);
  });

  it('follows a redirect only to a host a release’s file is served from', async () => {
    serve('/real', packed);
    routes['/git.tar.gz'] = (res) => {
      res.statusCode = 302;
      res.setHeader('location', '/real');
      res.end();
    };
    await expect(fetchGit(options())).resolves.toContain('bin');

    rmSync(join(dir, 'git'), { recursive: true, force: true });
    routes['/git.tar.gz'] = (res) => {
      res.statusCode = 302;
      res.setHeader('location', 'https://mirror.somewhere-else.io/git.tar.gz');
      res.end();
    };
    await expect(fetchGit(options())).rejects.toMatchObject({ reason: 'refused-address' });
    expect(existsSync(gitHome(dir))).toBe(false);
  });

  it('a file with another hash is deleted, unpacked nowhere, and said to be the wrong file', async () => {
    const other = gzipSync(tarOf([{ name: 'bin/git', data: '#!/bin/sh\nrm -rf ~\n', mode: 0o755 }]));
    serve('/git.tar.gz', other);
    const failed = await fetchGit(options({ download: { ...good, bytes: other.length } })).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(GitFetchError);
    expect((failed as GitFetchError).reason).toBe('wrong-file');
    expect(existsSync(gitHome(dir))).toBe(false);
    expect(existsSync(`${gitHome(dir)}.download`)).toBe(false);
    expect(ownGit(dir, 'darwin', 'arm64')).toBeNull();
  });

  it('a file that grows past its promised size is stopped as it arrives', async () => {
    serve('/git.tar.gz', Buffer.concat([packed, Buffer.alloc(4096, 1)]));
    await expect(fetchGit(options())).rejects.toMatchObject({ reason: 'wrong-file' });
  });

  it('says so when nothing answers, when GitHub answers an error, and when the person stops it', async () => {
    await expect(fetchGit(options({ url: `${base}/missing` }))).rejects.toMatchObject({ reason: 'no-connection' });
    await expect(fetchGit(options({ fetch: () => Promise.reject(new Error('getaddrinfo ENOTFOUND github.com')) }))).rejects.toMatchObject({ reason: 'no-connection' });
    const stop = new AbortController();
    serve('/git.tar.gz', packed);
    stop.abort();
    await expect(fetchGit(options({ signal: stop.signal }))).rejects.toMatchObject({ reason: 'stopped' });
    expect(existsSync(gitHome(dir))).toBe(false);
  });

  it('a kind of computer with no download is told so, and nothing is asked of the network', async () => {
    let asked = 0;
    await expect(
      fetchGit({ userDataDir: dir, platform: 'freebsd', arch: 'x64', fetch: () => ((asked += 1), Promise.reject(new Error('never'))) }),
    ).rejects.toMatchObject({ reason: 'no-download' });
    expect(asked).toBe(0);
  });

  it('without the test’s own seams it asks GitHub and nobody else', async () => {
    const asked: string[] = [];
    await fetchGit({
      userDataDir: dir,
      platform: 'darwin',
      arch: 'arm64',
      fetch: (url) => {
        asked.push(url);
        return Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://downloads.somewhere-else.io/x' } }));
      },
    }).catch(() => undefined);
    expect(asked).toEqual([`https://github.com/desktop/dugite-native/releases/download/${GIT_TAG}/dugite-native-v2.53.0-4098283-macOS-arm64.tar.gz`]);
  });
});

// ─── the app's own git, and unfinished ones ─────────────────────────────────

describe('ownGit and removeUnfinishedGit', () => {
  const place = (tag: string, record: unknown): string => {
    const home = gitHome(dir, tag);
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(join(home, 'bin', 'git'), GIT_SCRIPT, { mode: 0o755 });
    if (record !== undefined) writeFileSync(join(home, GIT_RECORD_FILE), JSON.stringify(record));
    return home;
  };
  const pinned = (GIT_DOWNLOADS['darwin-arm64'] as GitDownload).sha256;

  it('is there when its record is, with the hash this app pins', () => {
    expect(ownGit(dir, 'darwin', 'arm64')).toBeNull();
    const home = place(GIT_TAG, { tag: GIT_TAG, sha256: pinned, entries: 4 });
    expect(ownGit(dir, 'darwin', 'arm64')).toBe(gitProgramIn(home, 'darwin'));
    expect(gitProgramIn('C:\\git', 'win32')).toBe(join('C:\\git', 'cmd', 'git.exe'));
  });

  it('is not there with no record, another hash, a record for another tag, or no program', () => {
    place(GIT_TAG, undefined);
    expect(ownGit(dir, 'darwin', 'arm64')).toBeNull();
    place(GIT_TAG, { tag: GIT_TAG, sha256: 'f'.repeat(64), entries: 4 });
    expect(ownGit(dir, 'darwin', 'arm64')).toBeNull();
    place(GIT_TAG, { tag: 'v0.0.0', sha256: pinned, entries: 4 });
    expect(ownGit(dir, 'darwin', 'arm64')).toBeNull();
    const home = place(GIT_TAG, { tag: GIT_TAG, sha256: pinned, entries: 4 });
    rmSync(join(home, 'bin', 'git'));
    expect(ownGit(dir, 'darwin', 'arm64')).toBeNull();
  });

  it('an older one a person already has keeps working under a newer app', () => {
    const home = place('v2.47.0-1', { tag: 'v2.47.0-1', sha256: 'a'.repeat(64), entries: 9 });
    expect(ownGit(dir, 'darwin', 'arm64')).toBe(gitProgramIn(home, 'darwin'));
  });

  it('a folder with no record is a download that was cut short: it goes at the next launch', () => {
    place(GIT_TAG, { tag: GIT_TAG, sha256: pinned, entries: 4 });
    place('v9.9.9-1', undefined);
    mkdirSync(`${gitHome(dir)}.partial`);
    expect(removeUnfinishedGit(dir).sort()).toEqual([`${GIT_TAG}.partial`, 'v9.9.9-1']);
    expect(existsSync(gitHome(dir))).toBe(true);
    expect(removeUnfinishedGit(join(dir, 'nothing-here'))).toEqual([]);
  });
});

// ─── finding ─────────────────────────────────────────────────────────────────

describe('findGit', () => {
  type Answer = RunResult | ((args: readonly string[], env: Record<string, string>) => RunResult);
  function world(platform: NodeJS.Platform, files: string[], answers: Record<string, Answer>, env: NodeJS.ProcessEnv = { HOME: '/Users/ava', USER: 'ava', SHELL: '/bin/zsh', PATH: '/should/not/leak', SECRET_TOKEN: 'x' }) {
    const started: string[] = [];
    const deps: FindGitDeps = {
      platform,
      arch: 'arm64',
      env,
      userDataDir: dir,
      exists: (path) => files.includes(path),
      run: (command, args, opts) => {
        started.push(`${command} ${args.join(' ')}`.trim());
        // Only where the person's files are: no PATH, nothing of the app's own.
        expect(Object.keys(opts.env).sort().join(',')).not.toMatch(/PATH\b|SECRET/);
        expect(opts.timeoutMs).toBe(5000);
        const answer = answers[command] ?? { ok: false, stdout: '' };
        return Promise.resolve(typeof answer === 'function' ? answer(args, opts.env) : answer);
      },
    };
    return { deps, started };
  }
  const VERSION: RunResult = { ok: true, stdout: 'git version 2.45.2\n' };

  it('with the test seam: this computer has no git but the app’s own, checked against the test’s file', async () => {
    const { deps, started } = world('darwin', ['/opt/homebrew/bin/git'], { '/bin/zsh': { ok: true, stdout: '/opt/homebrew/bin/git\n' }, '/opt/homebrew/bin/git': VERSION });
    const download = { file: 'git.tar.gz', bytes: 512, sha256: 'b'.repeat(64) };
    expect(await findGit({ ...deps, onlyOwn: true, download })).toBeNull();
    // Nothing of the person's own was looked for, let alone started.
    expect(started).toEqual([]);

    const home = gitHome(dir);
    mkdirSync(join(home, 'bin'), { recursive: true });
    writeFileSync(join(home, 'bin', 'git'), GIT_SCRIPT, { mode: 0o755 });
    writeFileSync(join(home, GIT_RECORD_FILE), JSON.stringify({ tag: GIT_TAG, sha256: download.sha256, entries: 1 }));
    const program = gitProgramIn(home, 'darwin');
    const own = world('darwin', [], { [program]: VERSION });
    expect(await findGit({ ...own.deps, onlyOwn: true, download })).toEqual({ path: program, from: 'app' });
    // Without the seam's file that record names a hash this app does not pin: not the app's own.
    expect(await findGit({ ...own.deps, onlyOwn: true })).toBeNull();
  });

  it('on a Mac with Homebrew: the one the login shell knows, greeting and all', async () => {
    const { deps, started } = world('darwin', ['/opt/homebrew/bin/git', '/usr/bin/git'], {
      '/bin/zsh': { ok: true, stdout: 'Last login: Fri Oct  9\nWelcome back\n/opt/homebrew/bin/git\n' },
      '/opt/homebrew/bin/git': VERSION,
    });
    expect(await findGit(deps)).toEqual({ path: '/opt/homebrew/bin/git', from: 'shell' });
    expect(started).toEqual(['/bin/zsh -lic command -v git', '/opt/homebrew/bin/git --version']);
  });

  it('on a Mac with NO developer tools: Apple’s stand-in is passed over without being started', async () => {
    const { deps, started } = world('darwin', ['/usr/bin/git'], {
      '/bin/zsh': { ok: true, stdout: '/usr/bin/git\n' },
      '/usr/bin/xcode-select': { ok: false, stdout: '' },
      '/usr/bin/git': VERSION,
    });
    expect(await findGit(deps)).toBeNull();
    // Asked whether the tools are there; the stand-in itself never ran.
    expect(started).toEqual(['/bin/zsh -lic command -v git', '/usr/bin/xcode-select -p']);
  });

  it('on a Mac whose developer tools were removed but still named: the folder must exist', async () => {
    const { deps, started } = world('darwin', ['/usr/bin/git'], {
      '/bin/zsh': { ok: true, stdout: '/usr/bin/git\n' },
      '/usr/bin/xcode-select': { ok: true, stdout: '/Library/Developer/CommandLineTools\n' },
    });
    expect(await findGit(deps)).toBeNull();
    expect(started).not.toContain('/usr/bin/git --version');
  });

  it('on a Mac with Apple’s developer tools: /usr/bin/git is git', async () => {
    const { deps } = world('darwin', ['/usr/bin/git', '/Library/Developer/CommandLineTools'], {
      '/bin/zsh': { ok: true, stdout: '/usr/bin/git\n' },
      '/usr/bin/xcode-select': { ok: true, stdout: '/Library/Developer/CommandLineTools\n' },
      '/usr/bin/git': { ok: true, stdout: 'git version 2.50.1 (Apple Git-155)\n' },
    });
    expect(await findGit(deps)).toEqual({ path: '/usr/bin/git', from: 'system' });
  });

  it('a path that does not answer is not git, and the next one is tried', async () => {
    const { deps, started } = world('linux', ['/home/a/bin/git', '/usr/bin/git'], {
      '/bin/bash': { ok: true, stdout: '/home/a/bin/git\n' },
      '/home/a/bin/git': { ok: true, stdout: 'not git at all\n' },
      '/usr/bin/git': VERSION,
    }, { HOME: '/home/a', SHELL: '/bin/bash' });
    expect(await findGit(deps)).toEqual({ path: '/usr/bin/git', from: 'system' });
    expect(started).toEqual(['/bin/bash -lic command -v git', '/home/a/bin/git --version', '/usr/bin/git --version']);
  });

  it('a shell that hangs or fails still leaves the usual places', async () => {
    const { deps } = world('linux', ['/usr/bin/git'], { '/usr/bin/git': VERSION }, { HOME: '/home/a' });
    expect(await findGit(deps)).toEqual({ path: '/usr/bin/git', from: 'system' });
  });

  it('on Windows: `where git`, then Git for Windows’ usual folders', async () => {
    const usual = 'C:\\Program Files\\Git\\cmd\\git.exe';
    const first = world('win32', ['C:\\tools\\git\\cmd\\git.exe'], { 'where.exe': { ok: true, stdout: 'C:\\tools\\git\\cmd\\git.exe\r\nC:\\other\\git.exe\r\n' }, 'C:\\tools\\git\\cmd\\git.exe': VERSION }, { USERPROFILE: 'C:\\Users\\Ava', ProgramFiles: 'C:\\Program Files' });
    expect(await findGit(first.deps)).toEqual({ path: 'C:\\tools\\git\\cmd\\git.exe', from: 'shell' });
    const second = world('win32', [usual], { [usual]: VERSION }, { USERPROFILE: 'C:\\Users\\Ava', ProgramFiles: 'C:\\Program Files' });
    expect(await findGit(second.deps)).toEqual({ path: usual, from: 'system' });
  });

  it('the app’s own comes first when it is in place and answers; when it does not answer, the person’s is used', async () => {
    const home = gitHome(dir);
    mkdirSync(join(home, 'bin'), { recursive: true });
    const own = join(home, 'bin', 'git');
    writeFileSync(own, GIT_SCRIPT, { mode: 0o755 });
    writeFileSync(join(home, GIT_RECORD_FILE), JSON.stringify({ tag: GIT_TAG, sha256: (GIT_DOWNLOADS['darwin-arm64'] as GitDownload).sha256, entries: 4 }));

    const answering = world('darwin', ['/opt/homebrew/bin/git'], { [own]: { ok: true, stdout: 'git version 2.53.0\n' }, '/bin/zsh': { ok: true, stdout: '/opt/homebrew/bin/git\n' }, '/opt/homebrew/bin/git': VERSION });
    expect(await findGit(answering.deps)).toEqual({ path: own, from: 'app' });
    expect(answering.started).toEqual([`${own} --version`]);

    const broken = world('darwin', ['/opt/homebrew/bin/git'], { '/bin/zsh': { ok: true, stdout: '/opt/homebrew/bin/git\n' }, '/opt/homebrew/bin/git': VERSION });
    expect(await findGit(broken.deps)).toEqual({ path: '/opt/homebrew/bin/git', from: 'shell' });
  });

  it('none: nothing found is nothing, not an error', async () => {
    const { deps } = world('darwin', [], { '/bin/zsh': { ok: true, stdout: '' } });
    expect(await findGit(deps)).toBeNull();
  });
});
