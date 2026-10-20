// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Frames a person imported and has not sent yet, kept on the server under an id of its own.
 *
 * The dialog shows two chips (the picture and the design document) and they are uploaded with the
 * message, as files dropped there are. Their bytes never go to the page and back: the upload names the
 * import, and the server copies its own bytes in and stamps where they came from. So the server
 * knows which attachments are Figma's (they are never framed as the person's words), and `read_figma`
 * reads a file only by such a stamp, never by anything the document says.
 *
 * An import's bytes are held for a short while; after that its id still names the frame for a day,
 * and an upload reads it again from what the server kept (no counted read unless the file moved).
 */
import { randomBytes } from 'node:crypto';

import type { FigmaImport } from './service.js';

/** How long an import's bytes are held, and how long its id names its frame. */
export const IMPORT_HELD_MS = 15 * 60 * 1000;
export const IMPORT_KNOWN_MS = 24 * 60 * 60 * 1000;
/** The most imports whose bytes are held at once: past it the oldest are read again when sent. */
const HELD_MAX = 20;

export const IMPORT_ID = /^imp_[0-9a-f]{24}$/;

interface Kept {
  userId: string;
  link: { fileKey: string; nodeId: string };
  at: number;
  held: FigmaImport | null;
}

export interface FigmaImports {
  keep(userId: string, done: FigmaImport): string;
  /**
   * The import an id names, for the person who made it; `held` is null once its bytes are no longer
   * held (read it again). Null when the id names nothing of theirs.
   */
  find(userId: string, id: string): { link: { fileKey: string; nodeId: string }; held: FigmaImport | null } | null;
}

export function createFigmaImports(opts: { now?: () => number } = {}): FigmaImports {
  const now = opts.now ?? (() => Date.now());
  const kept = new Map<string, Kept>();
  const tidy = (): void => {
    const at = now();
    for (const [id, entry] of kept) {
      if (at - entry.at > IMPORT_KNOWN_MS) kept.delete(id);
      else if (entry.held !== null && at - entry.at > IMPORT_HELD_MS) entry.held = null;
    }
    const held = [...kept.values()].filter((entry) => entry.held !== null).sort((a, b) => a.at - b.at);
    for (const entry of held.slice(0, Math.max(0, held.length - HELD_MAX))) entry.held = null;
  };
  return {
    keep(userId, done) {
      const id = `imp_${randomBytes(12).toString('hex')}`;
      kept.set(id, { userId, link: { fileKey: done.fileKey, nodeId: done.nodeId }, at: now(), held: done });
      tidy();
      return id;
    },
    find(userId, id) {
      tidy();
      const entry = IMPORT_ID.test(id) ? kept.get(id) : undefined;
      // Another person's import is not theirs to send: the same answer as none.
      if (entry === undefined || entry.userId !== userId) return null;
      return { link: entry.link, held: entry.held };
    },
  };
}
