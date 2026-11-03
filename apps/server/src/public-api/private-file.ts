// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A file a signed-in person downloads through the row that names it:
 * `GET /public/files/:ref/:rowId/:column`.
 *
 * ── BY THE ROW, NEVER BY THE FILE ──────────────────────────────────────────
 * A file's own record says which row it belongs to, and that moves: the last
 * row that named it takes it over. So authority never comes from the file.
 * The row is read through the resource's whole scope — its claim, its
 * conditions, its parent chain — and the file served is the one THAT column of
 * THAT row names, by Adminium's own file id. A column holding a URL, a bucket
 * key or anything else serves nothing: what it points at is not Adminium's to
 * hand out as the person's own.
 *
 * ── HOW IT IS SENT ─────────────────────────────────────────────────────────
 * Streamed from this server, never redirected, with the headers a file
 * opened on the portal's own origin needs: a sandboxing CSP (a hostile PDF or
 * image runs no script there), `nosniff`, `private` caching, and no referrer.
 * Only the kinds a page draws as they are open inline: PNG, JPEG, WebP, GIF
 * and PDF. Everything else is a download: SVG (a document that can carry
 * script), TIFF (stored for print, drawn by some browsers and not others), and
 * any kind added later until it is put on the list on purpose.
 */
import type { StoredFile } from '@adminium/meta';
import { z } from 'zod';

import { parseRef } from '../files/refs.js';

/** `GET /public/files/:ref/:rowId/:column`. */
export const privateFileParams = z.object({
  ref: z.string().min(1).max(64),
  rowId: z.string().min(1).max(200),
  column: z.string().min(1).max(128),
});

/** The Adminium file id a column's value names, or null for anything else (a URL, a key, a list). */
export function fileIdOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = parseRef(value);
  return parsed?.kind === 'id' ? parsed.id : null;
}

/** The only types a file opens inline as: what a page draws as it is. */
const INLINE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);

/** Whether a file may open inline on the page: one of the types on the list, nothing else. */
export function opensInline(mime: string): boolean {
  return INLINE_TYPES.has(mime.toLowerCase().split(';')[0]!.trim());
}

/** A `Content-Disposition` value, the filename quoted and its UTF-8 form alongside. */
export function dispositionOf(file: Pick<StoredFile, 'filename' | 'mime'>): string {
  const plain = file.filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${opensInline(file.mime) ? 'inline' : 'attachment'}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`;
}

/** The headers every private download carries, whatever its type. */
export function privateFileHeaders(file: Pick<StoredFile, 'filename' | 'mime' | 'sha256' | 'sizeBytes'>): Record<string, string> {
  return {
    'content-type': file.mime,
    'content-length': String(file.sizeBytes),
    'content-disposition': dispositionOf(file),
    'content-security-policy': 'sandbox',
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=0, must-revalidate',
    'referrer-policy': 'no-referrer',
    etag: `"${file.sha256}"`,
  };
}
