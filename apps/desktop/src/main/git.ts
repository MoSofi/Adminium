// SPDX-License-Identifier: AGPL-3.0-only
/**
 * git for a project's versions: found on this computer, or fetched on a
 * person's yes.
 *
 * Adminium Designer keeps a version after every change with git. A person who
 * installs the app may have none, so the app looks, in this order, and the
 * first that really answers wins:
 *
 *   1. the app's own, when an earlier download is in place and whole;
 *   2. the one the person's shell knows (an app started from the Dock has a
 *      short PATH, so the login shell is asked);
 *   3. none: versions are off, and the app offers to fetch one.
 *
 * THE MAC'S STAND-IN. A Mac with no developer tools still has `/usr/bin/git`.
 * It is not git: started, it raises the system's "install the command line
 * developer tools" dialog and does no work. So `/usr/bin/git` counts only when
 * `xcode-select -p` names a folder that exists, and is otherwise passed over
 * WITHOUT BEING STARTED. Starting it "to see" is the dialog.
 *
 * THE DOWNLOAD is git's own build as its publisher ships it (`dugite-native`,
 * from GitHub's releases), fetched on a yes and run as a separate program. We
 * do not ship it and do not mirror it. Which file, and the SHA-256 it must
 * have, are constants in this signed app: a hash read from beside the download
 * would be the download vouching for itself.
 *
 * Electron-free: every line is tested under plain Node.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { chmod, link, mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, posix, resolve, sep, win32 } from 'node:path';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

// ─── What is fetched ─────────────────────────────────────────────────────────

/** The release every download below belongs to. A newer app may pin a newer one; an installed older one keeps working. */
export const GIT_TAG = 'v2.53.0-4';
export const GIT_VERSION = '2.53.0';

export interface GitDownload {
  file: string;
  bytes: number;
  sha256: string;
}

/** One file per system and chip. A system that is not here is offered nothing. */
export const GIT_DOWNLOADS: Readonly<Record<string, GitDownload>> = Object.freeze({
  'darwin-arm64': { file: 'dugite-native-v2.53.0-4098283-macOS-arm64.tar.gz', bytes: 62_348_987, sha256: 'f9dc64635a5b62fbd7ad95db73268bbb8912255ac516d65d37bf7af22fcb8ffe' },
  'darwin-x64': { file: 'dugite-native-v2.53.0-4098283-macOS-x64.tar.gz', bytes: 66_136_060, sha256: 'ae6686718aa34f4140424db16b92a47dcffd6d1f312eb8b5f3b267f7404e2680' },
  'linux-x64': { file: 'dugite-native-v2.53.0-4098283-ubuntu-x64.tar.gz', bytes: 65_269_219, sha256: 'cca76aa31ad9e835e771ee7f55b73934777fbd8d16757a10d307ba06de860901' },
  'linux-arm64': { file: 'dugite-native-v2.53.0-4098283-ubuntu-arm64.tar.gz', bytes: 23_223_345, sha256: 'a161f45af4626bb7e0c688854bd4a9aee47cc514bca404cff0a5e3536ef1c0af' },
  'win32-x64': { file: 'dugite-native-v2.53.0-4098283-windows-x64.tar.gz', bytes: 47_119_821, sha256: '7b76bc5c32c0d7c5984efdc2a8a32697cf1e8a43bc55176fbf9869c0ee995130' },
  'win32-arm64': { file: 'dugite-native-v2.53.0-4098283-windows-arm64.tar.gz', bytes: 45_084_825, sha256: '1abbeb3a2ce06e9b80e75bb888dce959b6c73bdb11ccc670a01a71d64f4422a5' },
});

export function gitDownloadFor(platform: string, arch: string): GitDownload | null {
  return GIT_DOWNLOADS[`${platform}-${arch}`] ?? null;
}

/** Where a download's file is. Built from the two constants and nothing a page or a folder could say. */
export function gitDownloadUrl(download: GitDownload): string {
  return `https://github.com/desktop/dugite-native/releases/download/${GIT_TAG}/${download.file}`;
}

/** The only hosts a download may be answered from: the address itself, and where GitHub sends a release's file. */
const DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

export function isGitDownloadHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && DOWNLOAD_HOSTS.has(parsed.hostname) && parsed.username === '' && parsed.port === '';
  } catch {
    return false;
  }
}

// ─── Where the app's own git lives ───────────────────────────────────────────

export interface GitInstallRecord {
  tag: string;
  sha256: string;
  /** How many files and links were written: a folder that holds fewer was cut short. */
  entries: number;
}

export const GIT_RECORD_FILE = 'installed.json';

/** `<the app's data folder>/git/<tag>`. */
export function gitHome(userDataDir: string, tag: string = GIT_TAG): string {
  return join(userDataDir, 'git', tag);
}

/** The program inside an unpacked download. */
export function gitProgramIn(home: string, platform: string): string {
  return platform === 'win32' ? join(home, 'cmd', 'git.exe') : join(home, 'bin', 'git');
}

export function readGitRecord(home: string): GitInstallRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(join(home, GIT_RECORD_FILE), 'utf8')) as Partial<GitInstallRecord>;
    if (typeof parsed.tag !== 'string' || typeof parsed.sha256 !== 'string' || typeof parsed.entries !== 'number') return null;
    return { tag: parsed.tag, sha256: parsed.sha256, entries: parsed.entries };
  } catch {
    return null;
  }
}

/**
 * The app's own git, when one is in place and whole: its record is there (it
 * is written last), it names a download this app knows, and the program
 * exists. Any tag will do: an app that pins a newer one still uses the older
 * one a person already has.
 */
export function ownGit(userDataDir: string, platform: string, arch: string): string | null {
  const base = join(userDataDir, 'git');
  let tags: string[];
  try {
    tags = readdirSync(base).sort().reverse();
  } catch {
    return null;
  }
  for (const tag of tags) {
    const home = join(base, tag);
    const record = readGitRecord(home);
    if (record === null || record.tag !== tag) continue;
    // The pinned release must match its pinned hash; an older release is trusted by its own record.
    if (tag === GIT_TAG && record.sha256 !== gitDownloadFor(platform, arch)?.sha256) continue;
    const program = gitProgramIn(home, platform);
    if (existsSync(program)) return program;
  }
  return null;
}

/** At launch: a folder under `git/` with no record is a download that was cut short. It goes. */
export function removeUnfinishedGit(userDataDir: string): string[] {
  const base = join(userDataDir, 'git');
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return removed;
  }
  for (const name of names) {
    const home = join(base, name);
    if (readGitRecord(home) !== null) continue;
    rmSync(home, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

// ─── Finding it ──────────────────────────────────────────────────────────────

export interface RunResult {
  ok: boolean;
  stdout: string;
}

export interface FindGitDeps {
  platform: NodeJS.Platform;
  arch: string;
  /** The app's environment; only `HOME`, `USER`, `SHELL` and Windows' folder names are read. */
  env: NodeJS.ProcessEnv;
  userDataDir: string;
  exists: (path: string) => boolean;
  /** Start a program with a time limit and an environment that is ONLY what is given. Never throws. */
  run: (command: string, args: readonly string[], opts: { timeoutMs: number; env: Record<string, string> }) => Promise<RunResult>;
}

export type GitFound = { path: string; from: 'app' | 'shell' | 'system' };

const ASK_MS = 5_000;
const APPLE_STAND_IN = '/usr/bin/git';

/** What a shell or `--version` is started with: where the person's files are, and nothing else. */
function bareEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['HOME', 'USER', 'LOGNAME', 'SHELL', 'USERPROFILE', 'SystemRoot', 'PATHEXT', 'ComSpec']) {
    const value = env[name];
    if (value !== undefined && value !== '') out[name] = value;
  }
  return out;
}

/** The last line of what a shell printed that is an absolute path. A login shell may greet before it answers. */
function pathIn(stdout: string, platform: string): string | null {
  // Judged as the system the path is ON judges it, whatever system reads it.
  const absolute = platform === 'win32' ? win32.isAbsolute : posix.isAbsolute;
  const lines = stdout.split(/\r?\n/).map((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? '';
    if (line !== '' && absolute(line)) return line;
  }
  return null;
}

/** On a Mac: whether Apple's developer tools are really there, which is what makes `/usr/bin/git` git. */
async function appleToolsInstalled(deps: FindGitDeps): Promise<boolean> {
  const asked = await deps.run('/usr/bin/xcode-select', ['-p'], { timeoutMs: ASK_MS, env: bareEnvironment(deps.env) });
  const folder = asked.stdout.trim();
  return asked.ok && folder !== '' && isAbsolute(folder) && deps.exists(folder);
}

async function answers(deps: FindGitDeps, path: string): Promise<boolean> {
  const asked = await deps.run(path, ['--version'], { timeoutMs: ASK_MS, env: bareEnvironment(deps.env) });
  return asked.ok && /^git version \d/.test(asked.stdout.trim());
}

/** The paths the person's own setup offers, most telling first. None is started here. */
async function candidates(deps: FindGitDeps): Promise<Array<{ path: string; from: 'shell' | 'system' }>> {
  const env = bareEnvironment(deps.env);
  const found: Array<{ path: string; from: 'shell' | 'system' }> = [];
  if (deps.platform === 'win32') {
    const where = await deps.run('where.exe', ['git'], { timeoutMs: ASK_MS, env });
    const first = where.ok ? pathIn(where.stdout.split(/\r?\n/)[0] ?? '', 'win32') : null;
    if (first !== null) found.push({ path: first, from: 'shell' });
    for (const base of [deps.env['ProgramFiles'], deps.env['ProgramFiles(x86)'], deps.env['LOCALAPPDATA'] === undefined ? undefined : win32.join(deps.env['LOCALAPPDATA'], 'Programs')]) {
      if (base !== undefined && base !== '') found.push({ path: win32.join(base, 'Git', 'cmd', 'git.exe'), from: 'system' });
    }
  } else {
    const shell = deps.env['SHELL'] !== undefined && isAbsolute(deps.env['SHELL']) ? deps.env['SHELL'] : deps.platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
    const asked = await deps.run(shell, ['-lic', 'command -v git'], { timeoutMs: ASK_MS, env });
    const fromShell = asked.ok ? pathIn(asked.stdout, deps.platform) : null;
    // Apple's own place is the system's whoever names it.
    if (fromShell !== null) found.push({ path: fromShell, from: fromShell === APPLE_STAND_IN ? 'system' : 'shell' });
    for (const path of ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git']) found.push({ path, from: 'system' });
  }
  const seen = new Set<string>();
  return found.filter((candidate) => !seen.has(candidate.path) && seen.add(candidate.path) !== undefined && deps.exists(candidate.path));
}

/**
 * Find a git that really works, or `null`. Called once per launch, and again
 * when the person says "Look again".
 */
export async function findGit(deps: FindGitDeps): Promise<GitFound | null> {
  const own = ownGit(deps.userDataDir, deps.platform, deps.arch);
  if (own !== null && (await answers(deps, own))) return { path: own, from: 'app' };

  let appleTools: boolean | null = null;
  for (const { path, from } of await candidates(deps)) {
    if (deps.platform === 'darwin' && path === APPLE_STAND_IN) {
      appleTools ??= await appleToolsInstalled(deps);
      // Not started, not even to ask its version: starting it is the dialog.
      if (!appleTools) continue;
    }
    // A path that does not answer is not git; the next one may be.
    if (await answers(deps, path)) return { path, from };
  }
  return null;
}

/**
 * {@link FindGitDeps.run} for a real machine: the program, its arguments, a
 * time limit, and an environment that is only what was given. No shell.
 */
export async function runProgram(command: string, args: readonly string[], opts: { timeoutMs: number; env: Record<string, string> }): Promise<RunResult> {
  const { execFile } = await import('node:child_process');
  return new Promise((done) => {
    try {
      execFile(command, [...args], { timeout: opts.timeoutMs, env: opts.env, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        done({ ok: error === null, stdout: String(stdout) });
      });
    } catch {
      done({ ok: false, stdout: '' });
    }
  });
}

// ─── Fetching it ─────────────────────────────────────────────────────────────

export type GitFetchFailure = 'no-download' | 'no-connection' | 'refused-address' | 'wrong-file' | 'stopped' | 'could-not-unpack';

export class GitFetchError extends Error {
  override readonly name = 'GitFetchError';
  constructor(
    readonly reason: GitFetchFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface FetchGitOptions {
  userDataDir: string;
  platform: string;
  arch: string;
  /** `fetch`, asked never to follow a redirect itself (each hop is checked here). */
  fetch: (url: string, init: { redirect: 'manual'; signal?: AbortSignal }) => Promise<Response>;
  signal?: AbortSignal;
  onProgress?: (received: number, total: number) => void;
  /** Test seams: the file and where it is. Production passes neither. */
  download?: GitDownload;
  url?: string;
  allowHost?: (url: string) => boolean;
}

const MAX_HOPS = 5;

/** Follow a download's redirects by hand, each one only to a host a release's file is served from. */
async function open(opts: FetchGitOptions, first: string): Promise<Response> {
  const allowed = opts.allowHost ?? isGitDownloadHost;
  let url = first;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    if (!allowed(url)) throw new GitFetchError('refused-address', `The download was sent to an address that is not GitHub's: ${new URL(url).host}`);
    let response: Response;
    try {
      response = await opts.fetch(url, { redirect: 'manual', ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
    } catch (error) {
      if (opts.signal?.aborted === true) throw new GitFetchError('stopped', 'The download was stopped.');
      throw new GitFetchError('no-connection', `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (next === null) throw new GitFetchError('no-connection', 'GitHub answered with a redirect to nowhere.');
      url = new URL(next, url).toString();
      continue;
    }
    if (!response.ok || response.body === null) throw new GitFetchError('no-connection', `GitHub answered ${String(response.status)}.`);
    return response;
  }
  throw new GitFetchError('refused-address', 'The download was redirected too many times.');
}

/**
 * Fetch git, check it, unpack it, and say where its program is.
 *
 * The file is hashed as it arrives and judged before a byte of it is unpacked.
 * It is unpacked into a folder beside the final one and moved into place, and
 * the record is written last: at any moment before that, the folder is one
 * `removeUnfinishedGit` deletes.
 */
export async function fetchGit(opts: FetchGitOptions): Promise<string> {
  const download = opts.download ?? gitDownloadFor(opts.platform, opts.arch);
  if (download === null) throw new GitFetchError('no-download', 'There is no git to download for this kind of computer.');
  const home = gitHome(opts.userDataDir);
  const work = `${home}.partial`;
  const archive = `${home}.download`;
  const cleanUp = (): void => {
    rmSync(work, { recursive: true, force: true });
    rmSync(archive, { force: true });
  };
  cleanUp();
  mkdirSync(dirname(home), { recursive: true });

  try {
    const response = await open(opts, opts.url ?? gitDownloadUrl(download));
    const hash = createHash('sha256');
    let received = 0;
    const file = createWriteStream(archive);
    try {
      for await (const chunk of Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)) {
        const bytes = chunk as Buffer;
        received += bytes.length;
        // A file that grows past what was promised is not the file.
        if (received > download.bytes) throw new GitFetchError('wrong-file', 'The download is larger than the file it should be.');
        hash.update(bytes);
        if (!file.write(bytes)) await new Promise<void>((drained) => file.once('drain', drained));
        opts.onProgress?.(received, download.bytes);
      }
    } catch (error) {
      if (error instanceof GitFetchError) throw error;
      if (opts.signal?.aborted === true) throw new GitFetchError('stopped', 'The download was stopped.');
      throw new GitFetchError('no-connection', `The download broke off: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await new Promise<void>((closed) => file.end(closed));
    }
    if (hash.digest('hex') !== download.sha256) throw new GitFetchError('wrong-file', 'The file that arrived is not the one this version of Adminium expects. It was deleted.');

    let entries: number;
    try {
      entries = await unpackTarGz(archive, work, opts.signal);
    } catch (error) {
      if (opts.signal?.aborted === true) throw new GitFetchError('stopped', 'The download was stopped.');
      throw new GitFetchError('could-not-unpack', `The download could not be unpacked: ${error instanceof Error ? error.message : String(error)}`);
    }
    rmSync(home, { recursive: true, force: true });
    await rename(work, home);
    // Last: until this line the folder is one the next launch deletes.
    writeFileSync(join(home, GIT_RECORD_FILE), `${JSON.stringify({ tag: GIT_TAG, sha256: download.sha256, entries } satisfies GitInstallRecord, null, 2)}\n`);
    return gitProgramIn(home, opts.platform);
  } finally {
    cleanUp();
  }
}

// ─── Unpacking ───────────────────────────────────────────────────────────────

export class UnpackError extends Error {
  override readonly name = 'UnpackError';
}

/** A name from the archive, as a path inside `target`, or a refusal. */
function inside(target: string, name: string): string {
  const cleaned = name.replace(/\\/g, '/');
  if (cleaned === '' || cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned) || cleaned.split('/').includes('..')) {
    throw new UnpackError(`an entry leaves the folder it is unpacked into: ${name}`);
  }
  const full = resolve(target, normalize(cleaned));
  if (full !== target && !full.startsWith(target + sep)) throw new UnpackError(`an entry leaves the folder it is unpacked into: ${name}`);
  return full;
}

const text = (block: Buffer, start: number, length: number): string => {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString('utf8');
};
const octal = (block: Buffer, start: number, length: number): number => {
  const value = text(block, start, length).trim();
  return value === '' ? 0 : Number.parseInt(value, 8);
};

/** The records of a pax header: `<length> <key>=<value>\n`, the length counting itself. */
function paxRecords(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(at, space).toString('utf8'), 10);
    if (!Number.isInteger(length) || length <= 0) break;
    const record = data.subarray(space + 1, at + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals !== -1) out[record.slice(0, equals)] = record.slice(equals + 1);
    at += length;
  }
  return out;
}

/**
 * Unpack a `.tar.gz` into `target` (which must not exist), and say how many
 * files and links were written.
 *
 * Read as a stream, entry by entry: files, folders, and the two kinds of link
 * a git build is full of. Refused, with nothing more written after: a name
 * that is absolute or climbs out with `..`; a symbolic link whose target,
 * followed from where the link stands, lands outside `target`; a hard link to
 * a file outside it; a device, a pipe, or any kind this does not know.
 */
export async function unpackTarGz(archive: string, target: string, signal?: AbortSignal): Promise<number> {
  const { createReadStream } = await import('node:fs');
  const root = resolve(target);
  if (existsSync(root)) throw new UnpackError(`the folder to unpack into already exists: ${root}`);
  await mkdir(root, { recursive: true });

  const stream = createReadStream(archive).pipe(createGunzip());
  let pending: Buffer = Buffer.alloc(0);
  let entries = 0;
  let longName: string | null = null;
  let longLink: string | null = null;
  let pax: Record<string, string> = {};
  // A header that has been read, whose data has not all arrived yet.
  let current: { kind: string; path: string; linkTo: string; mode: number; size: number; padded: number } | null = null;

  const finish = async (entry: NonNullable<typeof current>, data: Buffer): Promise<void> => {
    switch (entry.kind) {
      case 'L':
        longName = data.toString('utf8').replace(/\0+$/, '');
        return;
      case 'K':
        longLink = data.toString('utf8').replace(/\0+$/, '');
        return;
      case 'x':
        pax = paxRecords(data);
        return;
      case 'g':
        return;
      default:
        break;
    }
    const name = pax['path'] ?? longName ?? entry.path;
    const linkTo = pax['linkpath'] ?? longLink ?? entry.linkTo;
    longName = null;
    longLink = null;
    pax = {};
    const path = inside(root, name.replace(/\/+$/, ''));
    if (entry.kind === '5') {
      await mkdir(path, { recursive: true });
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    if (entry.kind === '0' || entry.kind === '\0' || entry.kind === '7') {
      await writeFile(path, data);
      await chmod(path, (entry.mode & 0o111) !== 0 ? 0o755 : 0o644);
    } else if (entry.kind === '2') {
      // Followed from where the link stands, it must still be inside.
      if (isAbsolute(linkTo) || /^[A-Za-z]:/.test(linkTo)) throw new UnpackError(`a link points outside the folder: ${name} → ${linkTo}`);
      const lands = resolve(dirname(path), linkTo);
      if (lands !== root && !lands.startsWith(root + sep)) throw new UnpackError(`a link points outside the folder: ${name} → ${linkTo}`);
      await symlink(linkTo, path);
    } else if (entry.kind === '1') {
      await link(inside(root, linkTo), path);
    } else {
      throw new UnpackError(`an entry of a kind that is not unpacked (${JSON.stringify(entry.kind)}): ${name}`);
    }
    entries += 1;
  };

  for await (const chunk of stream) {
    if (signal?.aborted === true) {
      stream.destroy();
      throw new UnpackError('stopped');
    }
    pending = pending.length === 0 ? (chunk as Buffer) : Buffer.concat([pending, chunk as Buffer]);
    for (;;) {
      if (current === null) {
        if (pending.length < 512) break;
        const header = pending.subarray(0, 512);
        pending = pending.subarray(512);
        // Two empty blocks end an archive; one is skipped the same way.
        if (header.every((byte) => byte === 0)) continue;
        const prefix = text(header, 345, 155);
        const name = text(header, 0, 100);
        const size = octal(header, 124, 12);
        const kind = text(header, 156, 1) || '\0';
        const holdsData = !['1', '2', '5'].includes(kind);
        current = {
          kind,
          path: prefix === '' ? name : `${prefix}/${name}`,
          linkTo: text(header, 157, 100),
          mode: octal(header, 100, 8),
          size: holdsData ? size : 0,
          padded: holdsData ? Math.ceil(size / 512) * 512 : 0,
        };
      }
      if (pending.length < current.padded) break;
      const data = Buffer.from(pending.subarray(0, current.size));
      pending = pending.subarray(current.padded);
      const entry = current;
      current = null;
      await finish(entry, data);
    }
  }
  if (current !== null) throw new UnpackError('the archive ends in the middle of a file');
  return entries;
}
