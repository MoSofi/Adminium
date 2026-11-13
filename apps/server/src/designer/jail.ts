// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where the Designer's model may read and write.
 *
 * Three folders of the project and nothing else: the app's own folder
 * (`apps/<key>/`), and the project's `hooks/` and `actions/`, because server
 * logic is part of building an app. Never the project's config, its `.env`,
 * its data, its build output, another app, or anything outside the folder.
 *
 * Every rule here exists because a path can say one thing and mean another:
 * `..` climbs out, a link points elsewhere, `APPS` is `apps` on a disk that
 * ignores case, and two Unicode spellings of one word look the same. A path
 * is refused unless it is plainly, by every reading, a file inside one of
 * the three folders.
 *
 * This keeps the model from WRITING outside the app. It does not make what
 * it writes harmless: hooks and actions are code this server runs. So while
 * the operator keeps own code off (`trial/own-code.ts`), the jail itself
 * writes and deletes no code: nothing in hooks/ or actions/, and none of the
 * files a build of the app's own runs, whoever asks it to. And while a turn
 * runs on the operator's AI under its dashboard scope, it writes nothing a
 * customer sees (`operator-scope.ts`).
 */
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { APP_KEY_PATTERN } from '../project/apps/read-app.js';
import { ownCodeAllows, OWN_CODE_MESSAGES } from '../trial/own-code.js';
import { noCardRefusal } from './write-guard.js';
import { scopedNow, scopedPathRefusal } from './operator-scope.js';
import { refuseDesignerWrite } from '../trial/size-cap.js';

export class JailError extends Error {
  override readonly name = 'JailError';
}

/** The longest path the model may name. */
export const MAX_PATH = 300;
/** The largest file the model may write. */
export const MAX_WRITE_BYTES = 262_144;

/** Text the Designer may write. A file of any other kind is a person's to add. */
const TEXT_EXTENSIONS = ['.json', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.md', '.svg', '.txt', '.html'] as const;

export interface Jail {
  /** The three folders, as the model writes them. */
  readonly roots: readonly string[];
  /**
   * The absolute path for a project-relative one, or a `JailError`. `write`
   * allows a file that does not exist yet; `read` and `delete` need one that does.
   */
  resolve(path: string, mode: 'read' | 'write' | 'delete' | 'list'): string;
  /** The project-relative path, normalised the way `resolve` reads it. */
  normalise(path: string): string;
  /** Write a file inside the jail: parents made one by one, then a temp file renamed over. */
  write(path: string, content: string): string;
  delete(path: string): string;
}

/** Folded for comparison: one Unicode spelling, one case. */
const fold = (segment: string): string => segment.normalize('NFC').toLowerCase();

export function createJail(root: string, appKey: string): Jail {
  if (!APP_KEY_PATTERN.test(appKey)) throw new JailError(`"${appKey}" is not an app key.`);
  const realRoot = realpathSync(root);
  const roots: string[][] = [['apps', appKey], ['hooks'], ['actions']];

  function segmentsOf(path: string): string[] {
    if (typeof path !== 'string' || path.length === 0) throw new JailError('A path is needed.');
    if (path.length > MAX_PATH) throw new JailError(`A path is at most ${String(MAX_PATH)} characters.`);
    if (path.includes('\\') || path.includes('\0')) throw new JailError('A path uses "/" and nothing else to separate its parts.');
    if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) throw new JailError('A path is relative to the project folder.');
    const segments = path.replace(/\/+$/, '').split('/');
    for (const segment of segments) {
      if (segment === '' || segment === '.' || segment === '..') throw new JailError(`"${path}" is not a plain path.`);
      if (segment.startsWith('.')) throw new JailError(`"${path}": names starting with "." are never read or written here.`);
      if (fold(segment) === 'node_modules') throw new JailError(`"${path}": node_modules is not part of the app.`);
      // A short name (`VITECO~1.TS`) is a second spelling of another file on some disks.
      if (segment.includes('~')) throw new JailError(`"${path}": a name with "~" is never read or written here.`);
    }
    // The root a path is under, by its folded spelling; rewritten to the root's real one.
    const folded = segments.map(fold);
    const under = roots.find((rootSegments) => rootSegments.every((part, index) => folded[index] === fold(part)));
    if (under === undefined) {
      throw new JailError(`"${path}" is outside what the Designer may touch: apps/${appKey}/, hooks/ and actions/.`);
    }
    // What a build left is not the app's source: it can hold more than the source says (a file a bundler read from elsewhere).
    const first = folded[under.length];
    if (under[0] === 'apps' && first !== undefined && /^dist(-|$)/.test(first)) {
      throw new JailError(`"${path}": a build's output is not read or written here. The app's source is in src/ and manifest/.`);
    }
    return [...under, ...segments.slice(under.length).map((segment) => segment.normalize('NFC'))];
  }

  /** Every folder from the project down to (not including) the last segment must be a real folder, no link. */
  function checkParents(segments: readonly string[], create: boolean): void {
    let current = realRoot;
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      if (!existsSync(current)) {
        if (!create) return;
        mkdirSync(current);
      }
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new JailError(`"${segments.join('/')}" goes through something that is not a plain folder.`);
    }
    // The deepest folder that exists resolves to where it says it is.
    const deepest = join(realRoot, ...segments.slice(0, -1));
    if (existsSync(deepest) && realpathSync(deepest) !== deepest) throw new JailError(`"${segments.join('/')}" does not lead where it says.`);
  }

  function resolve(path: string, mode: 'read' | 'write' | 'delete' | 'list'): string {
    const segments = segmentsOf(path);
    const file = join(realRoot, ...segments);
    if (!file.startsWith(realRoot + sep)) throw new JailError(`"${path}" is outside the project.`);
    if (mode !== 'list' && segments.length === roots.find((r) => r.every((part, index) => segments[index] === part))?.length) {
      throw new JailError(`"${path}" is a folder, not a file.`);
    }
    if (mode !== 'list') {
      const name = segments[segments.length - 1] as string;
      const dot = name.lastIndexOf('.');
      const extension = dot <= 0 ? '' : name.slice(dot).toLowerCase();
      if (!(TEXT_EXTENSIONS as readonly string[]).includes(extension)) {
        throw new JailError(`"${path}": the Designer reads and writes text files (${TEXT_EXTENSIONS.join(' ')}), not this one.`);
      }
      if (extension === '.html' && !segments.slice(0, -1).some((segment) => segment === 'src')) {
        throw new JailError(`"${path}": an HTML file belongs in a side's src/ folder.`);
      }
    }
    checkParents(segments, false);
    if (existsSync(file) || isLink(file)) {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new JailError(`"${path}" is a link, which is never followed.`);
      if (mode === 'list' ? !stat.isDirectory() && !stat.isFile() : !stat.isFile()) throw new JailError(`"${path}" is not a plain file.`);
    } else if (mode === 'read' || mode === 'delete') {
      throw new JailError(`"${path}" does not exist.`);
    }
    return file;
  }

  /**
   * While own code is off, or a turn runs on the operator's AI under its dashboard scope: a path, or a content, that
   * is code this server or a build would run is not written. In such a turn, nothing customer-facing either.
   */
  function refuseCode(path: string, content: string | null): void {
    const scoped = scopedPathRefusal(root, segmentsOf(path).join('/'));
    if (scoped !== null) throw new OperatorScopeJailError(scoped);
    if (ownCodeAllows('designerCode').allowed && !scopedNow(root)) return;
    if (isCodeWrite(root, appKey, segmentsOf(path).join('/'), content)) throw new OwnCodeJailError();
  }

  return {
    roots: roots.map((segments) => segments.join('/')),
    normalise: (path) => segmentsOf(path).join('/'),
    resolve,
    write(path, content) {
      if (typeof content !== 'string') throw new JailError('The content of a file is text.');
      if (content.includes('\0')) throw new JailError('The content of a file is text, and this has a NUL in it.');
      if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new JailError(`A file is at most ${String(MAX_WRITE_BYTES / 1024)} KB.`);
      const file = resolve(path, 'write');
      refuseCode(path, content);
      // A trial's data folder past its limit takes no more of the Designer's files.
      refuseDesignerWrite(Buffer.byteLength(content, 'utf8'));
      const segments = segmentsOf(path);
      checkParents(segments, true);
      const temp = join(dirname(file), `.designer-${String(process.pid)}.tmp`);
      writeFileSync(temp, content, { mode: 0o644 });
      renameSync(temp, file);
      return file;
    },
    delete(path) {
      const file = resolve(path, 'delete');
      refuseCode(path, null);
      rmSync(file);
      return file;
    },
  };
}

/** A write the jail refuses while own code is off: its words are the operator's, not a path's problem. */
export class OwnCodeJailError extends JailError {
  constructor() {
    super(OWN_CODE_MESSAGES.designerCode);
  }
}

/** A write the jail refuses in a turn on the operator's AI that builds dashboards only (`operator-scope.ts`). */
export class OperatorScopeJailError extends JailError {}

/**
 * Whether writing `normal` (the jail's spelling of a path) with `content` (null: a delete, or the path alone) is
 * writing code: hooks/ and actions/, which the server imports, and what a build of the app's own runs or would be
 * told to run (its build.json, its package and config files, the files its config imports, a build command in
 * app.json). The same paths a card or a person's yes guards on an ordinary server, and an app's tsconfig.json and
 * jsconfig.json files.
 */
export function isCodeWrite(root: string, appKey: string, normal: string, content: string | null): boolean {
  // A tsconfig or jsconfig anywhere in the app, own build or not: a bundler follows its `extends` to any file.
  const folded = normal.normalize('NFC').toLowerCase();
  if (folded.startsWith(`apps/${appKey.toLowerCase()}/`) && /^[jt]sconfig[a-z.]*\.json$/.test(folded.slice(folded.lastIndexOf('/') + 1))) return true;
  const why = noCardRefusal(root, appKey, normal, content);
  return why !== null && why !== 'phone-file';
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
