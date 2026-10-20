// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The picture dialog's server side: searching a source, keeping what the
 * person picked, and (`apply`) filling spots with no turn.
 *
 * A picture the person puts in "what changes" is pinned, and its bytes are
 * fetched at once into the session's own folder, outside any hold of the
 * app's folder: the original up to 5 MB, or the source's small copy, said as
 * that ("Only a small copy of this picture could be used."). Apply then
 * writes what is already here. An Unsplash picture is never fetched: it is
 * shown from Unsplash's own address.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { downloadPicture, type FoundPicture, type PictureShelf } from './pictures.js';
import type { PictureSearch, SearchAnswer } from './picture-search.js';
import { DESIGNER_DIR } from './session-store.js';
import { writeWhole } from './spots.js';

/** How long a picked picture's bytes are kept in a session's folder when nothing applies them. */
export const STAGED_KEEP_MS = 24 * 60 * 60_000;

/** A picked picture's bytes, fetched and kept until Apply. */
export interface Staged {
  bytes: Buffer;
  ext: 'jpg' | 'png' | 'webp' | 'gif';
  /** Only the source's small copy could be had. */
  small: boolean;
  sha256: string;
}

export type PinAnswer =
  /** Kept: its bytes are here (`small` when only the small copy could be had), or it is shown from its source's site. */
  | { state: 'kept'; small: boolean; shown?: true }
  /** Its page of results is gone (the server started again): search again to use it. */
  | { state: 'gone' }
  /** Its bytes could not be had: no file of it is a picture that fits. */
  | { state: 'failed' };

export interface PictureDialogDeps {
  root: string;
  search: PictureSearch;
  shelf: PictureShelf;
  download?: typeof downloadPicture;
  now?: () => number;
}

export interface PictureDialog {
  search: PictureSearch['search'];
  sources: PictureSearch['sources'];
  /** Keep a picture the person put in "what changes", and fetch its bytes now. */
  pin(sessionId: string, shelf: string, picture: string, signal?: AbortSignal): Promise<PinAnswer>;
  /** A pinned picture and its bytes (none for one shown from its source's site); null when it is gone. */
  picked(sessionId: string, shelf: string, picture: string, signal?: AbortSignal): Promise<{ picture: FoundPicture; staged: Staged | null } | null>;
}

const SESSION = /^ds_[0-9a-z]{24}$/;
const SHELF = /^shelf_[0-9a-f]{16}$/;
const PICTURE = /^pic_[0-9a-f]{12}$/;

export function createPictureDialog(deps: PictureDialogDeps): PictureDialog {
  const now = deps.now ?? (() => Date.now());
  const download = deps.download ?? downloadPicture;
  const dirOf = (sessionId: string): string => join(deps.root, DESIGNER_DIR, 'sessions', sessionId, 'pictures');
  const nameOf = (shelf: string, picture: string): string => `${shelf}.${picture}`;

  /** Bytes picked and never applied go after a day. */
  const tidy = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      try {
        if (now() - statSync(file).mtimeMs > STAGED_KEEP_MS) rmSync(file, { force: true });
      } catch {
        // Gone already.
      }
    }
  };
  const readStaged = (sessionId: string, shelf: string, picture: string): Staged | null => {
    const base = join(dirOf(sessionId), nameOf(shelf, picture));
    try {
      const meta = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as { ext?: unknown; small?: unknown; sha256?: unknown };
      const ext = meta.ext === 'jpg' || meta.ext === 'png' || meta.ext === 'webp' || meta.ext === 'gif' ? meta.ext : null;
      if (ext === null) return null;
      const bytes = readFileSync(`${base}.${ext}`);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      // What was kept is what is read: a file changed under it is fetched again.
      return sha256 === meta.sha256 ? { bytes, ext, small: meta.small === true, sha256 } : null;
    } catch {
      return null;
    }
  };
  const stage = async (sessionId: string, shelf: string, found: FoundPicture, signal?: AbortSignal): Promise<Staged | null> => {
    const got = await download(found, signal === undefined ? {} : { signal });
    if (got === null) return null;
    const dir = dirOf(sessionId);
    mkdirSync(dir, { recursive: true });
    tidy(dir);
    const base = join(dir, nameOf(shelf, found.id));
    const sha256 = createHash('sha256').update(got.bytes).digest('hex');
    writeWhole(`${base}.${got.ext}`, got.bytes);
    writeWhole(`${base}.json`, JSON.stringify({ ext: got.ext, small: got.small, sha256 }));
    return { bytes: got.bytes, ext: got.ext, small: got.small, sha256 };
  };

  return {
    search: (sessionId, input, signal): Promise<SearchAnswer> => deps.search.search(sessionId, input, signal),
    sources: () => deps.search.sources(),
    async pin(sessionId, shelf, picture, signal) {
      if (!SESSION.test(sessionId) || !SHELF.test(shelf) || !PICTURE.test(picture)) return { state: 'gone' };
      const found = deps.shelf.pin(sessionId, shelf, picture);
      if (found === null) return { state: 'gone' };
      if (found.shown !== undefined) return { state: 'kept', small: false, shown: true };
      const staged = readStaged(sessionId, shelf, picture) ?? (await stage(sessionId, shelf, found, signal));
      return staged === null ? { state: 'failed' } : { state: 'kept', small: staged.small };
    },
    async picked(sessionId, shelf, picture, signal) {
      if (!SESSION.test(sessionId) || !SHELF.test(shelf) || !PICTURE.test(picture)) return null;
      const found = deps.shelf.find(sessionId, shelf, picture);
      if (found === null) return null;
      if (found.shown !== undefined) return { picture: found, staged: null };
      const staged = readStaged(sessionId, shelf, picture) ?? (await stage(sessionId, shelf, found, signal));
      return staged === null ? null : { picture: found, staged };
    },
  };
}
