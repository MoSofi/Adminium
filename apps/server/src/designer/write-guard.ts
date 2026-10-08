// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What may be written into an app with nobody asked.
 *
 * Two hands write an app's files: the Designer's model, through its tools,
 * and a person, through the Code tab. Some files are never either's to write
 * (a build command this machine runs), and some need a person's yes on a
 * card each turn (server code, files a copied app's build runs). The model
 * can be shown a card; a hand save cannot. So the question "may this path
 * and content be written with no card" is asked here, once, and both hands
 * go by the same answer: what the tools refuse or ask about, a hand save
 * refuses.
 *
 * A file a person changed by hand is theirs until the model has read it: the
 * tools refuse to write one the model has not read in the turn, so a change
 * is built on, not undone.
 */
import { buildCodeStems, codeStem, hasOwnBuild } from '../project/apps/own-build.js';

/** An app manifest's own build command is set by a person: refused when anyone else writes one. */
export function addsBuildCommand(path: string, content: string, appKey: string): boolean {
  const manifestFiles = [`apps/${appKey}/manifest/app.json`, `apps/${appKey}/manifest.json`];
  // Folded: on a disk that ignores case, APP.JSON is app.json.
  if (!manifestFiles.includes(path.normalize('NFC').toLowerCase())) return false;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return parsed !== null && typeof parsed === 'object' && 'build' in parsed;
  } catch {
    // Not JSON: the check will say so.
    return false;
  }
}

/**
 * Whether a write of an app's manifest file changes where its tables are in the database: `key` and `prefixed`
 * name them. An app that was applied has its tables under the old names, and the new ones may be somebody
 * else's (a model that wrote app.json again without "prefixed" met a table "orders" the project already had).
 * `before` is the file as it is, null when there is none.
 */
export function renamesTables(path: string, before: string | null, after: string, appKey: string): boolean {
  const manifestFiles = [`apps/${appKey}/manifest/app.json`, `apps/${appKey}/manifest.json`];
  if (before === null || !manifestFiles.includes(path.normalize('NFC').toLowerCase())) return false;
  try {
    const was = JSON.parse(before) as Record<string, unknown> | null;
    const now = JSON.parse(after) as Record<string, unknown> | null;
    if (was === null || now === null || typeof was !== 'object' || typeof now !== 'object') return false;
    return was['key'] !== now['key'] || was['prefixed'] !== now['prefixed'];
  } catch {
    // Not JSON on either side: the write's own check says so.
    return false;
  }
}

/**
 * A file that decides what a copied app's approved build RUNS, by its path
 * inside the app (folded): its package files, the configs its tools look for
 * and run, its scripts.
 */
export function isBuildFile(inside: string): boolean {
  const name = inside.slice(inside.lastIndexOf('/') + 1);
  return (
    // At any depth: a folder's own package.json says which file an import of the folder runs.
    name === 'package.json' ||
    name === 'package-lock.json' ||
    name === 'npm-shrinkwrap.json' ||
    name === 'pnpm-lock.yaml' ||
    name === 'yarn.lock' ||
    // Every config the build's tools look for and run: Vite's own, and the ones its plugins find by name.
    /^(vite|vitest|postcss|tailwind|babel|rollup|svgo|uno|windi)\.config\.[a-z]+$/.test(inside) ||
    /^[jt]sconfig[a-z.]*\.json$/.test(name) ||
    inside.startsWith('scripts/')
  );
}

/** Why a path needs a person's yes on a card before it is written, or null. `normal` is the jail's own spelling of it. */
export function needsCard(root: string, appKey: string, normal: string): 'server-code' | 'build-code' | null {
  if (/^(hooks|actions)\//i.test(normal)) return 'server-code';
  if (!hasOwnBuild(root, appKey)) return null;
  const lead = `apps/${appKey}/`;
  if (!normal.toLowerCase().startsWith(lead)) return null;
  return buildCodeStems(root, appKey).has(codeStem(normal.slice(lead.length))) ? 'build-code' : null;
}

export type NoCardReason = 'build-json' | 'build-file' | 'server-code' | 'build-code' | 'build-command';

/**
 * Why this path, with this content, may not be written with no card; null
 * when it may. `content` null asks about the path alone. `normal` is the
 * jail's own spelling of the path.
 */
export function noCardRefusal(root: string, appKey: string, normal: string, content: string | null): NoCardReason | null {
  const folded = normal.normalize('NFC').toLowerCase();
  const inside = folded.startsWith(`apps/${appKey}/`) ? folded.slice(`apps/${appKey}/`.length) : null;
  if (inside === 'build.json') return 'build-json';
  if (inside !== null && hasOwnBuild(root, appKey) && isBuildFile(inside)) return 'build-file';
  const card = needsCard(root, appKey, normal);
  if (card !== null) return card;
  return content !== null && addsBuildCommand(normal, content, appKey) ? 'build-command' : null;
}

/** A project-relative path made of plain marks alone, as every listed file's is: fit to be named to the model. */
export const plainPath = (path: unknown): path is string =>
  typeof path === 'string' && path.length <= 300 && /^[A-Za-z0-9._@()[\]-]+(?:\/[A-Za-z0-9._@()[\]-]+)*$/.test(path) && !path.split('/').some((part) => part === '.' || part === '..');

/** How many hand-edited files a session remembers. */
export const HAND_EDITS_MAX = 60;

/**
 * The files the model read in each turn. A tool set lives for one turn, so
 * this is a turn's memory; the turn's number keeps a second turn's writes
 * from passing on the first one's reads.
 */
export interface TurnReads {
  /** The model read this file in this turn. */
  read(turn: number, normal: string): void;
  /**
   * What the model is told when it writes a file the person changed by hand
   * and it has not read in this turn; null when it may write.
   */
  refusal(handEdits: readonly string[] | undefined, turn: number, normal: string): string | null;
}

export function createTurnReads(): TurnReads {
  const reads = new Map<number, Set<string>>();
  // One file whatever the case of its name: most disks a project sits on fold it, and a write to App.tsx there is a write to app.tsx.
  const fold = (path: string): string => path.normalize('NFC').toLowerCase();
  return {
    read(turn, normal) {
      const seen = reads.get(turn) ?? new Set<string>();
      seen.add(fold(normal));
      reads.set(turn, seen);
      // Only the turn that runs matters: an older turn's reads are let go.
      for (const old of reads.keys()) if (old < turn) reads.delete(old);
    },
    refusal(handEdits, turn, normal) {
      const changed = handEdits?.find((path) => fold(path) === fold(normal));
      if (changed === undefined) return null;
      if (reads.get(turn)?.has(fold(normal)) === true) return null;
      return `The person changed ${changed} by hand since your last turn, and you have not read it in this turn. Call read_file on it first, then make your change on top of what it holds now: keep what they changed unless this message asks otherwise.`;
    },
  };
}
