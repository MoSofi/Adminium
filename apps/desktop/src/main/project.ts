// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What main needs to serve a project folder that is not Electron's: the port,
 * the words of the one question it asks, and the test seam that opens a folder
 * before the app has a screen to pick one on (plan 66, spec 05).
 *
 * Electron-free, like `lan.ts` and `backup.ts`, so every line of it is tested
 * under plain Node.
 */
import { existsSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { isAbsolute, join } from 'node:path';

import { LOOPBACK_HOST } from '../server/env.js';
import type { DesktopStopWords } from '../preload/api.js';
import type { GitDownload } from './git.js';
import type { ServerBusy } from './server-manager.js';

/** The ports a project's server tries, in order: the same range `adminium design` uses on a terminal. */
export const PROJECT_PORTS = { first: 4700, last: 4799 } as const;

/** The first port in the range that nothing on this machine listens on. */
export async function firstFreePort(
  from: number = PROJECT_PORTS.first,
  to: number = PROJECT_PORTS.last,
  host = '127.0.0.1',
): Promise<number> {
  for (let port = from; port <= to; port += 1) {
    const free = await new Promise<boolean>((done) => {
      const probe = createServer();
      probe.once('error', () => {
        done(false);
      });
      probe.listen(port, host, () => {
        probe.close(() => {
          done(true);
        });
      });
    });
    if (free) return port;
  }
  throw new Error(`No port from ${String(from)} to ${String(to)} is free on this computer.`);
}

/** The names a project folder's config file may have, as the server looks for them. */
const CONFIG_FILES = ['adminium.config.ts', 'adminium.config.mjs', 'adminium.config.js'] as const;

/**
 * The name of the test seam: a project folder to open at launch.
 *
 * A PACKAGED APP NEVER READS IT. Opening a folder builds and runs the code in
 * it, and the question that must come first ("do you trust this folder?") has
 * no screen yet. An environment variable that made a released app run a folder
 * unasked would be exactly the door spec 08 exists to keep shut; so the seam is
 * for the desktop's own tests and for trying the built (unpackaged) app, and
 * it goes when the real way in is built.
 */
export const E2E_PROJECT_ENV = 'ADMINIUM_DESKTOP_E2E_PROJECT';

export function seamProject(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  fs: { exists: (path: string) => boolean; real: (path: string) => string } = { exists: existsSync, real: realpathSync },
): { readonly root: string } | undefined {
  if (isPackaged) return undefined;
  const named = env[E2E_PROJECT_ENV]?.trim() ?? '';
  if (named === '' || !isAbsolute(named)) return undefined;
  let root: string;
  try {
    root = fs.real(named);
  } catch {
    return undefined;
  }
  // The folder itself, never a parent that happens to be a project.
  return CONFIG_FILES.some((file) => fs.exists(join(root, file))) ? { root } : undefined;
}

/**
 * A second seam, for the offer to keep versions: this computer is taken to have
 * no git, and the download is the test's own file from the test's own server.
 * JSON: `{ "url": "http://127.0.0.1:…", "sha256": "…", "bytes": 123 }`.
 * A PACKAGED APP NEVER READS IT: it would let an environment variable choose
 * the program the app fetches and runs.
 */
export const E2E_GIT_ENV = 'ADMINIUM_DESKTOP_E2E_GIT';

export function seamGit(env: NodeJS.ProcessEnv, isPackaged: boolean): { readonly url: string; readonly download: GitDownload } | null {
  if (isPackaged) return null;
  const raw = env[E2E_GIT_ENV]?.trim() ?? '';
  if (raw === '') return null;
  try {
    const value = JSON.parse(raw) as { url?: unknown; sha256?: unknown; bytes?: unknown };
    if (typeof value.url !== 'string') return null;
    // This machine only, by its number: parsed, not matched as text.
    const address = new URL(value.url);
    if (address.protocol !== 'http:' || address.hostname !== LOOPBACK_HOST || address.port === '') return null;
    if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) return null;
    if (typeof value.bytes !== 'number' || !Number.isInteger(value.bytes) || value.bytes < 1) return null;
    return { url: value.url, download: { file: 'git.tar.gz', bytes: value.bytes, sha256: value.sha256 } };
  } catch {
    return null;
  }
}

/** With the seam only: the first port to try, so a test run stays inside the ports it was given. */
export const E2E_PORT_ENV = 'ADMINIUM_DESKTOP_E2E_PORT';

/** The port range a project's server is picked from: the product's, unless an unpackaged test run names its own start. */
export function projectPortRange(env: NodeJS.ProcessEnv, isPackaged: boolean): { first: number; last: number } {
  if (isPackaged) return PROJECT_PORTS;
  const first = Number(env[E2E_PORT_ENV] ?? '');
  if (!Number.isInteger(first) || first < 1024 || first > 65000) return PROJECT_PORTS;
  return { first, last: first + 19 };
}

/** English, until the project's page hands over its own language's (`project.setStopWords`), as with the menu. */
export const EN_US_STOP_WORDS: DesktopStopWords = Object.freeze({
  turn: 'The Designer is in the middle of a turn.',
  start: 'An app is being added to this project.',
  save: 'Your changes are being saved.',
  restore: 'An earlier version is being put back.',
  style: 'The style is being changed.',
  other: 'This project is being changed.',
  quitDetail: 'If you quit now it is stopped where it is. What was already written stays.',
  closeDetail: 'If you close the project now it is stopped where it is. What was already written stays.',
  quitAnyway: 'Quit anyway',
  closeAnyway: 'Close anyway',
  keepWorking: 'Keep working',
});

/** A native question's words. */
export interface StopBusyWords {
  title: string;
  detail: string;
  goOn: string;
  stay: string;
}

/** What is said before the app ends a project's server that is in the middle of something. */
export function stopBusyWords(busy: ServerBusy, why: 'quit' | 'close' = 'quit', words: DesktopStopWords = EN_US_STOP_WORDS): StopBusyWords {
  const what: Record<string, string> = { turn: words.turn, start: words.start, save: words.save, restore: words.restore, style: words.style };
  return {
    title: what[busy.kind] ?? words.other,
    detail: why === 'close' ? words.closeDetail : words.quitDetail,
    goOn: why === 'close' ? words.closeAnyway : words.quitAnyway,
    stay: words.keepWorking,
  };
}

/** The session cookie's names on a project's server: design mode names it by port, a shared project does not. */
export function sessionCookieNames(base: string, port: number): string[] {
  return [`${base}_${String(port)}`, base];
}
