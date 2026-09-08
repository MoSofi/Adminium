// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The brand marks a document may put in its banner, as bytes
 * (39-email-templates-and-campaigns.md D6, §0.2 #1).
 *
 * The comp's Logo mark picker is a grid of twelve Lucide icons rendered as
 * inline SVG. Gmail, Outlook and Apple Mail do not render inline SVG, so the
 * mail needs an `<img>` over real bytes: the twelve ship as 48×48
 * white-on-transparent PNGs under `apps/server/assets/email-marks/`,
 * rasterised once from `lucide-react`'s icon nodes and committed, and travel
 * as a `cid:mark` part attached at delivery. The picker grid is unchanged.
 *
 * The thirteenth tile, *Your logo*, is the workspace's `branding.logoFileId`
 * and is read through the file store by delivery, not from here.
 *
 * Read lazily and memoised: a process that never sends a branded mail never
 * touches the disk, and one that does reads each mark once.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EMAIL_MARKS, type EmailMark } from '@adminium/meta';

/** Where the PNGs live inside the package (`files` in package.json ships it). */
export const EMAIL_MARKS_DIR = 'assets/email-marks';

const MARK_SET: ReadonlySet<string> = new Set(EMAIL_MARKS);

/** True for one of the twelve shipped marks (never `logo`, which is a file). */
export function isShippedMark(value: unknown): value is Exclude<EmailMark, 'logo'> {
  return typeof value === 'string' && MARK_SET.has(value);
}

/** `dist/email/marks.js` and `src/email/marks.ts` are both two levels below the package root. */
function packageRoot(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

export interface MarkBytes {
  filename: string;
  contentType: 'image/png';
  content: Buffer;
}

const cache = new Map<string, Promise<MarkBytes>>();

/**
 * The PNG for a shipped mark. Rejects for a name outside the twelve — the
 * caller has already validated the document's `brand.mark`, so that is a
 * programmer error, not a runtime condition to degrade over.
 */
export function loadMarkBytes(
  mark: Exclude<EmailMark, 'logo'>,
  opts: { moduleUrl?: string | undefined } = {},
): Promise<MarkBytes> {
  if (!isShippedMark(mark)) return Promise.reject(new Error(`unknown email mark: ${String(mark)}`));
  const root = packageRoot(opts.moduleUrl ?? import.meta.url);
  const key = `${root}:${mark}`;
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = readFile(join(root, EMAIL_MARKS_DIR, `${mark}.png`)).then((content) => ({
      filename: `${mark}.png`,
      contentType: 'image/png' as const,
      content,
    }));
    cache.set(key, pending);
  }
  return pending;
}

/** Test seam. */
export function _resetMarkCache(): void {
  cache.clear();
}
