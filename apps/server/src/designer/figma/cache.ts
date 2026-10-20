// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What this server already read from Figma, so a frame is read again only when the file moved.
 *
 * Figma allows a View or Collab seat 20 reads a month, and an import is two of them (the frame's
 * nodes, then its picture). So each half is kept as soon as it arrives, written to a temporary name
 * and renamed into place: a retry after the picture failed spends only the picture. An entry is kept
 * by the person, the file, the frame and the file's version. It is the person's own: one person's
 * copy is never served to another, so nobody reads further into a file than their own Figma account
 * can open.
 *
 * An entry that cannot be read back (cut short, not JSON, not a PNG) counts as not there. The oldest
 * entries go once the folder passes its size; a person who disconnects Figma loses theirs.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DESIGNER_DIR } from '../session-store.js';
import type { FigmaNodes } from './client.js';

/** The most the whole cache keeps before the oldest entries go. */
export const FIGMA_CACHE_MAX_BYTES = 50 * 1024 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const USER = /^usr_[0-9A-Za-z]{1,64}$/;

export interface FigmaEntryKey {
  userId: string;
  fileKey: string;
  nodeId: string;
  version: string;
}

export interface FigmaCache {
  nodes(key: FigmaEntryKey): FigmaNodes | null;
  putNodes(key: FigmaEntryKey, nodes: FigmaNodes): void;
  render(key: FigmaEntryKey): Buffer | null;
  putRender(key: FigmaEntryKey, png: Buffer): void;
  /** The newest version kept of a frame, for a read that cannot ask Figma; null when none is kept. */
  newest(userId: string, fileKey: string, nodeId: string): string | null;
  /** Everything kept for a person. */
  forget(userId: string): void;
  /** Where it is kept, for the probe that says whether it outlives a deploy. */
  readonly dir: string;
}

/** A path part made from an outside name: hashed, so nothing in it is a path. */
const part = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 32);

export function createFigmaCache(root: string, opts: { maxBytes?: number } = {}): FigmaCache {
  const dir = join(root, DESIGNER_DIR, 'figma');
  const maxBytes = opts.maxBytes ?? FIGMA_CACHE_MAX_BYTES;
  const userDir = (userId: string): string => {
    if (!USER.test(userId)) throw new Error('not a person');
    return join(dir, userId);
  };
  const frameDir = (key: Pick<FigmaEntryKey, 'userId' | 'fileKey' | 'nodeId'>): string => join(userDir(key.userId), part(`${key.fileKey}\n${key.nodeId}`));
  const entryDir = (key: FigmaEntryKey): string => join(frameDir(key), part(key.version));

  /** Temp then rename: a crash leaves the old file or the new one, never half of one. */
  const write = (path: string, bytes: Buffer | string): void => {
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.${createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 8)}.tmp`;
    writeFileSync(temp, bytes, { mode: 0o600 });
    renameSync(temp, path);
    trim();
  };

  /** The oldest entries go while the cache is over its size. */
  const trim = (): void => {
    const entries: { path: string; bytes: number; at: number }[] = [];
    let total = 0;
    const walk = (folder: string, depth: number): void => {
      if (!existsSync(folder)) return;
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory() && depth < 3) {
          if (depth === 2) {
            let bytes = 0;
            let at = 0;
            for (const file of readdirSync(path)) {
              const stat = statSync(join(path, file));
              bytes += stat.size;
              at = Math.max(at, stat.mtimeMs);
            }
            entries.push({ path, bytes, at });
            total += bytes;
          } else walk(path, depth + 1);
        }
      }
    };
    walk(dir, 0);
    if (total <= maxBytes) return;
    for (const entry of entries.sort((a, b) => a.at - b.at)) {
      if (total <= maxBytes) break;
      rmSync(entry.path, { recursive: true, force: true });
      total -= entry.bytes;
    }
  };

  const read = (path: string): Buffer | null => {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  };

  return {
    dir,
    nodes(key) {
      const bytes = read(join(entryDir(key), 'nodes.json'));
      if (bytes === null) return null;
      try {
        const parsed = JSON.parse(bytes.toString('utf8')) as FigmaNodes;
        // Kept for this version, and holding the frame: anything else is not trusted.
        return parsed.version === key.version && parsed.nodes?.[key.nodeId]?.document?.id === key.nodeId ? parsed : null;
      } catch {
        return null;
      }
    },
    putNodes: (key, nodes) => write(join(entryDir(key), 'nodes.json'), JSON.stringify(nodes)),
    render(key) {
      const bytes = read(join(entryDir(key), 'render.png'));
      return bytes !== null && bytes.length > PNG.length && bytes.subarray(0, PNG.length).equals(PNG) ? bytes : null;
    },
    putRender: (key, png) => write(join(entryDir(key), 'render.png'), png),
    newest(userId, fileKey, nodeId) {
      const folder = frameDir({ userId, fileKey, nodeId });
      if (!existsSync(folder)) return null;
      let best: { version: string; at: number } | null = null;
      for (const entry of readdirSync(folder)) {
        const file = join(folder, entry, 'nodes.json');
        if (!existsSync(file)) continue;
        try {
          const parsed = JSON.parse(readFileSync(file, 'utf8')) as FigmaNodes;
          const at = statSync(file).mtimeMs;
          if (typeof parsed.version === 'string' && part(parsed.version) === entry && (best === null || at > best.at)) best = { version: parsed.version, at };
        } catch {
          // Not readable: not kept.
        }
      }
      return best?.version ?? null;
    },
    forget(userId) {
      if (USER.test(userId)) rmSync(userDir(userId), { recursive: true, force: true });
    },
  };
}

/**
 * Whether what is kept under `dir` outlives the next deploy. In a container whose folder is on the
 * container's own disk (no volume mounted there), it does not: the dialog says so.
 */
export function cacheOutlivesDeploys(dir: string, facts: { inContainer: boolean; deviceOf: (path: string) => number | null }): boolean {
  if (!facts.inContainer) return true;
  let folder = dir;
  // The nearest folder that exists: the cache itself may not be made yet.
  while (facts.deviceOf(folder) === null) {
    const up = join(folder, '..');
    if (up === folder) return true;
    folder = up;
  }
  return facts.deviceOf(folder) !== facts.deviceOf('/');
}

/** The facts `cacheOutlivesDeploys` reads, from this machine. */
export const machineFacts = {
  inContainer: existsSync('/.dockerenv') || existsSync('/run/.containerenv') || (process.env['KUBERNETES_SERVICE_HOST'] ?? '') !== '',
  deviceOf: (path: string): number | null => {
    try {
      return statSync(path).dev;
    } catch {
      return null;
    }
  },
};
