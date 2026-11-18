// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PICTURES OF A LANDING PAGE: page-owned copies, cleaned, raster only.
 *
 * Files are staff-private, and a page row lives in an add-on's table anyone
 * with that database's access could edit. So a page never shows a file
 * because its document names it: a picture chosen for a page (from Files, or
 * uploaded there and then) is COPIED into a file of the page's own:
 *
 *  - read again and cleaned (`public-api/picture.ts` `cleanPicture`): a PNG,
 *    JPEG, WebP or GIF by its bytes, at most 5 MiB and 8192 pixels a side,
 *    with what the camera wrote beside it taken out. Never an SVG (a document
 *    that can carry script), never anything else;
 *  - kept as a file of kind `landing`, attached to the page's own row (its
 *    connection, its pages table, its key: the files' record keys), so the
 *    Files routes never serve it (they serve uploads only), the daily sweep
 *    never takes it (it is claimed), and it goes to the bin with its page.
 *
 * The door (`routes/pages-door`) serves such a file only while a live page's
 * published document names it, and only the page that owns it
 * ({@link pagePictureOf}): a file id of Files, of another page, or of a page
 * switched off answers nothing, whatever the id.
 */
import { auditEntityKeyPart, filesRepo, newId, type MetaDb, type StoredFile } from '@adminium/meta';

import type { FileStore } from '../files/store.js';
import { sniff, SNIFF_HEAD_BYTES } from '../files/sniff.js';
import { cleanPicture, isPictureMime, PICTURE_MAX_BYTES, PictureRefused } from '../public-api/picture.js';

/** The kind of a page's own picture. */
export const LANDING_PICTURE_KIND = 'landing';

/** What a refused picture is answered with: the words the editor shows. */
export const PICTURE_REFUSED_WORDS = 'This file can’t be used. Use a PNG, JPEG, WebP or GIF of up to 5 MB.';

/** The page a picture belongs to: its database, its pages table and its row's key. */
export interface PictureOwner {
  connectionId: string;
  pagesTable: string;
  /** The page row's key, as text. */
  page: string;
  /** The pages table's key column, for the record reference. */
  pk: string;
}

/** Whether a stored file is a picture this page owns, live and of a size and type served to strangers. */
export function ownedPicture(file: StoredFile | null, owner: Omit<PictureOwner, 'pk'>): file is StoredFile {
  return (
    file !== null &&
    file.kind === LANDING_PICTURE_KIND &&
    file.deletedAt === null &&
    file.entityConnectionId === owner.connectionId &&
    file.entityTable === auditEntityKeyPart(owner.pagesTable) &&
    file.entityId === auditEntityKeyPart(owner.page) &&
    isPictureMime(file.mime) &&
    file.sizeBytes <= PICTURE_MAX_BYTES
  );
}

/** The file of a page's picture by its id, or null unless the page owns it (see {@link ownedPicture}). */
export async function pagePictureOf(meta: MetaDb, owner: Omit<PictureOwner, 'pk'>, fileId: string): Promise<StoredFile | null> {
  const file = await filesRepo(meta).findById(fileId);
  return ownedPicture(file, owner) ? file : null;
}

/** A picture refused: what the route answers, with the words. */
export class PagePictureRefused extends Error {
  constructor(readonly why: 'type' | 'size' | 'unreadable') {
    super(PICTURE_REFUSED_WORDS);
    this.name = 'PagePictureRefused';
  }
}

export interface CopyPictureInput {
  bytes: Buffer;
  /** The name it had, kept for staff; never served (a picture goes out under a made-up name). */
  filename: string;
  owner: PictureOwner;
  uploadedBy: string | null;
  at: number;
}

/**
 * Clean `bytes` and keep them as a picture of the page: the new file. Throws
 * {@link PagePictureRefused} for anything that is not a raster picture of at
 * most 5 MiB (the type read from the bytes, never from what the caller said).
 */
export async function keepPagePicture(deps: { meta: MetaDb; storage: Pick<FileStore, 'write'> }, input: CopyPictureInput): Promise<StoredFile> {
  if (input.bytes.length > PICTURE_MAX_BYTES) throw new PagePictureRefused('size');
  const sniffed = sniff(input.bytes.subarray(0, SNIFF_HEAD_BYTES), input.filename);
  if (!sniffed.ok || !isPictureMime(sniffed.type.mime)) throw new PagePictureRefused('type');
  let cleaned;
  try {
    cleaned = cleanPicture(input.bytes, sniffed.type.mime);
  } catch (error) {
    if (error instanceof PictureRefused) throw new PagePictureRefused('unreadable');
    throw error;
  }
  if (cleaned.bytes.length > PICTURE_MAX_BYTES) throw new PagePictureRefused('size');
  const id = newId('file');
  const filename = input.filename.slice(0, 200) || 'picture';
  const written = await deps.storage.write({ id, kind: LANDING_PICTURE_KIND, filename, mime: cleaned.mime, bytes: cleaned.bytes });
  const { owner } = input;
  return filesRepo(deps.meta).create(
    {
      id,
      filename,
      mime: cleaned.mime,
      sizeBytes: written.sizeBytes,
      sha256: written.sha256,
      kind: LANDING_PICTURE_KIND,
      // The page's own row: found by its record keys, gone to the bin with it.
      entity: { connectionId: owner.connectionId, table: owner.pagesTable, pk: { [owner.pk]: owner.page }, label: owner.page },
      attachedAt: input.at,
      uploadedBy: input.uploadedBy,
      storageKey: written.storageKey,
      destinationId: written.destinationId,
      storage: written.storage,
    },
    input.at,
  );
}
