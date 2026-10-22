// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PICTURE IN A DOCUMENT: the value of an add-on's `picture` slot, made here
 * from a file a column of the document's own row holds (a customer's drawn
 * signature on a signed copy).
 *
 * The add-on that draws the document never reads the file store — it gets
 * VALUES (`subject.ts`), and this is the value. So the judging a person's
 * read of the file would get happens here, on the server, every time:
 *
 *  - WHOSE. The slot reads a column of the row itself, `{ "column" }`, and
 *    nothing reached through a link. Whoever the document is drawn for has
 *    already been judged on that row and that column by the door that asked
 *    (a staff door draws nothing for a person who does not read the table,
 *    the row or the column; a guest's door blanks a column withheld from
 *    them, which leaves nothing here), exactly as a text column is.
 *  - WHICH FILE. The column holds files (`rules.file`), one, not a list, and
 *    is no secret one. The id it holds names a file of this database that is
 *    alive and ATTACHED TO THIS VERY RECORD: an id written into the column by
 *    hand, behind Adminium's back, that names another record's file draws
 *    nothing.
 *  - WHAT. A PNG or a JPEG — by the file's sniffed type and again by its own
 *    bytes — no larger than the column's own `maxBytes` and than a picture
 *    shown to visitors (5 MiB), at most 8192 pixels a side; the bytes read are
 *    the bytes stored (their hash), and what a camera writes beside a picture
 *    (the place, the device) is taken out, as for a picture visitors see.
 *
 * Anything short of that is NO picture: the slot is left empty, and a
 * required one is a missing slot, said on the register row like any other.
 * Never a refusal of the whole render for a bad file, and never a guess.
 *
 * The register keeps what was printed without the bytes (`recordedPictures`):
 * the document's own stored file holds the picture as it was drawn.
 */
import { createHash } from 'node:crypto';

import type { DocumentPictureMediaType, DocumentPictureValue } from '@adminium/add-on-contracts';
import { auditEntityKeyPart, filesRepo, type DocumentProfile, type MetaDb } from '@adminium/meta';

import type { SnapshotView } from '../crud/identifiers.js';
import { pkLabel } from '../crud/records.js';
import { fileIdsIn } from '../files/column-values.js';
import { FileNotFoundError } from '../files/drivers/driver.js';
import type { FileStore } from '../files/store.js';
import { cleanPicture, PictureRefused, PICTURE_MAX_BYTES, readCapped } from '../public-api/picture.js';
import type { ProfileMapping, SubjectSlot } from './subject.js';

/** The kinds a picture slot carries: what an HTML page and a PDF writer both draw with no decoder of their own. */
const PICTURE_TYPES: ReadonlySet<string> = new Set<DocumentPictureMediaType>(['image/png', 'image/jpeg']);

/** A picture made for a slot, and the hash of the bytes it carries (what the register keeps instead of them). */
export interface MadePicture {
  value: DocumentPictureValue;
  sha256: string;
}

/**
 * Why a picture slot of an app's document maps something that holds no
 * picture, or null: a picture slot maps a column of the document's own row
 * that holds one file (`rules.file`, no `maxCount`) and takes a PNG or a
 * JPEG. A mistake in the app, found at its install.
 */
export function pictureMappingIssueOf(
  slot: { id: string },
  mapped: Readonly<Record<string, unknown>>,
  column: { type?: string; rules?: { file?: { accept?: readonly string[]; maxCount?: number } } } | undefined,
  where: string,
): string | null {
  const file = column?.rules?.file;
  if (typeof mapped['column'] !== 'string' || mapped['via'] !== undefined || mapped['form'] !== undefined) {
    return `"${slot.id}" of ${where} is a picture, and maps a file column of the document's own row`;
  }
  if (column === undefined || column.type !== 'text' || file === undefined || file.maxCount !== undefined) {
    return `"${slot.id}" of ${where} is a picture, and maps a column that holds one file ("rules": { "file" })`;
  }
  if (!(file.accept ?? []).some((kind) => kind === 'png' || kind === 'jpeg')) {
    return `"${slot.id}" of ${where} is a picture, and its column takes no PNG or JPEG`;
  }
  return null;
}

/**
 * The pictures of a document's picture slots, for the row as it was read
 * for whoever the document is drawn for: a slot with no picture (unmapped,
 * empty, or a file that does not pass) is left out.
 */
export async function picturesFor(input: {
  meta: MetaDb;
  storage: Pick<FileStore, 'open'>;
  view: SnapshotView | null;
  profile: Pick<DocumentProfile, 'connectionId' | 'table' | 'mapping'>;
  slots: readonly Pick<SubjectSlot, 'id' | 'type'>[];
  /** The row, as read for the reader (a withheld column already emptied). */
  row: Readonly<Record<string, unknown>>;
  /** The row's key. */
  pk: Readonly<Record<string, unknown>>;
}): Promise<Record<string, MadePicture>> {
  const out: Record<string, MadePicture> = {};
  const wanted = input.slots.filter((slot) => slot.type === 'picture');
  if (wanted.length === 0 || input.view === null) return out;
  let table;
  try {
    table = input.view.table(input.profile.table);
  } catch {
    return out;
  }
  const mapping = input.profile.mapping as ProfileMapping;
  // The record's address as a file attached to it keeps it (`files.entityId`).
  const label = auditEntityKeyPart(pkLabel(table, input.pk as Record<string, unknown>));
  const files = filesRepo(input.meta);
  for (const slot of wanted) {
    const mapped = mapping[slot.id];
    // The row's own column, and nothing reached through a link.
    if (mapped === undefined || !('column' in mapped) || 'ref' in mapped) continue;
    const column = table.columns.get(mapped.column);
    const rule = column?.file;
    if (column === undefined || rule === undefined || rule.maxCount !== undefined || column.secret === true) continue;
    const ids = fileIdsIn(input.row[mapped.column]);
    if (ids.length !== 1) continue;
    const file = await files.findById(ids[0]!);
    if (
      file === null ||
      file.deletedAt !== null ||
      file.kind !== 'upload' ||
      file.entityConnectionId !== input.profile.connectionId ||
      (file.entityTable !== table.id && file.entityTable !== table.name) ||
      file.entityId !== label
    ) {
      continue;
    }
    const type = file.mime.toLowerCase().split(';')[0]!.trim();
    const limit = Math.min(rule.maxBytes, PICTURE_MAX_BYTES);
    if (!PICTURE_TYPES.has(type) || file.sizeBytes > limit) continue;
    try {
      const bytes = await readCapped((await input.storage.open(file)).stream, limit);
      // The bytes stored for this file, not others swapped in its place.
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) continue;
      const clean = cleanPicture(bytes, type);
      if (!PICTURE_TYPES.has(clean.mime)) continue;
      out[slot.id] = {
        value: { mediaType: clean.mime as DocumentPictureMediaType, dataUrl: `data:${clean.mime};base64,${clean.bytes.toString('base64')}`, width: clean.width, height: clean.height },
        sha256: createHash('sha256').update(clean.bytes).digest('hex'),
      };
    } catch (error) {
      // Not a picture by its bytes, too large, or not there to read: no picture.
      if (error instanceof PictureRefused) continue;
      if (error instanceof FileNotFoundError) continue;
      throw error;
    }
  }
  return out;
}

/**
 * A subject as the register keeps it: each picture as what it was —
 * `{ mediaType, width, height, sha256 }` — never its bytes, which the
 * document's own file already holds.
 */
export function recordedPictures(subject: Record<string, unknown>, pictures: Readonly<Record<string, MadePicture>>): Record<string, unknown> {
  const fields = subject['fields'] as Record<string, unknown> | undefined;
  if (fields === undefined || Object.keys(pictures).length === 0) return subject;
  const kept: Record<string, unknown> = { ...fields };
  for (const [slot, made] of Object.entries(pictures)) {
    if (kept[slot] === undefined) continue;
    kept[slot] = { mediaType: made.value.mediaType, width: made.value.width, height: made.value.height, sha256: made.sha256 };
  }
  return { ...subject, fields: kept };
}
