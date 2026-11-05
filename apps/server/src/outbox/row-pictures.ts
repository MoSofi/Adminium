// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PICTURE FROM A ROW'S FILE COLUMN IN AN APP'S EMAIL: `email.image` with
 * `fileId: "{{job.photo}}"` shows the photo the job's own `photo` column holds.
 *
 * A message carries the bytes of every picture it shows to whoever it goes
 * to, so a picture is checked here, for each message, against the row the
 * message reached it through — never trusted because a column names it:
 *
 *  - the row is one the message already reads (one of the outbox's links, or a
 *    row one of them points at), read as the message reads it;
 *  - the column is a file column of that row's table, neither secret nor kept
 *    from the reader (personal data the outbox masks), nor withheld from them;
 *  - the file is an upload, not in the bin, held by exactly that row of that
 *    table (a file another row holds is not this row's to send, whatever id a
 *    column was given);
 *  - it is a picture (png, jpeg, gif or webp) of at most 2 MiB.
 *
 * A picture that passes is carried with the queued message by its id; the
 * render shows that file and no other (`email/render.ts`), and delivery
 * weighs it again (`jobs/email-send.ts`). One that does not is left out — or,
 * on an image marked `required`, the message is not sent and says why. An
 * empty column shows nothing, and stops a `required` one.
 */
import { ROW_PICTURE_MAX_BYTES, ROW_PICTURE_TYPES, rowPictureName } from '@adminium/manifest';
import { filesRepo, type MetaDb } from '@adminium/meta';

import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { parseRecordId } from '../crud/records.js';

/** A row a message reads, by the name its template reads it under (`job`, `order.event`). */
export interface ReadRow {
  table: ResolvedTable;
  record: Row;
}

/** What the pictures of one message come to: the files it may show, or why it is not sent. */
export interface RowPictures {
  pictures: Set<string>;
  refused: string | null;
}

/** The pictures of a message's image blocks, each checked against the row it is read through. */
export async function rowPictures(input: {
  meta: MetaDb;
  connectionId: string;
  view: SnapshotView;
  blocks: readonly unknown[];
  vars: Readonly<Record<string, string>>;
  withheld: ReadonlySet<string>;
  rows: ReadonlyMap<string, ReadRow>;
}): Promise<RowPictures> {
  const pictures = new Set<string>();
  for (const block of input.blocks) {
    if (typeof block !== 'object' || block === null) continue;
    const { block: kind, data } = block as { block?: unknown; data?: unknown };
    if (kind !== 'email.image' || typeof data !== 'object' || data === null) continue;
    const name = rowPictureName((data as Record<string, unknown>)['fileId']);
    if (name === null) continue;
    const checked = await pictureOf(input, name);
    if ('fileId' in checked) {
      pictures.add(checked.fileId);
      continue;
    }
    // Left out, unless the template says the message is not worth sending without it.
    if ((data as Record<string, unknown>)['required'] === true) return { pictures, refused: `Not sent: the picture {{${name}}} ${checked.why}` };
  }
  return { pictures, refused: null };
}

/** The file one picture shows, or why it shows none. */
async function pictureOf(
  input: { meta: MetaDb; connectionId: string; view: SnapshotView; vars: Readonly<Record<string, string>>; withheld: ReadonlySet<string>; rows: ReadonlyMap<string, ReadRow> },
  name: string,
): Promise<{ fileId: string } | { why: string }> {
  const at = name.lastIndexOf('.');
  if (at <= 0) return { why: 'names no row' };
  const read = input.rows.get(name.slice(0, at));
  if (read === undefined) return { why: 'is on no row this message reads' };
  const columnName = name.slice(at + 1);
  const column = read.table.columns.get(columnName);
  const effective = read.table.table.columns.find((candidate) => candidate.name === columnName);
  if (column === undefined || effective?.file === undefined) return { why: 'is not a file column' };
  // What the reader may not see is no picture of theirs: a secret, personal data the outbox masks, a column held back from them.
  if (column.secret || column.masked || input.withheld.has(name) || !Object.hasOwn(input.vars, name)) return { why: 'is not shown to this reader' };
  const held = input.vars[name]!;
  if (held.trim() === '') return { why: 'holds no picture' };
  const file = await filesRepo(input.meta).findById(held.trim());
  if (file === null || file.deletedAt !== null) return { why: 'is a file that is gone' };
  // An upload the row has claimed: one waiting to be claimed (`attachedAt` empty) is nobody's yet.
  if (file.kind !== 'upload' || file.attachedAt === null || !heldBy(input, file, read)) return { why: 'is not a file of this row' };
  if (!ROW_PICTURE_TYPES.includes(file.mime)) return { why: 'is not a picture (png, jpeg, gif or webp)' };
  if (file.sizeBytes > ROW_PICTURE_MAX_BYTES) return { why: 'is larger than 2 MB' };
  return { fileId: file.id };
}

/** Whether the file is held by exactly the row the message read it through: its connection, its table, its key. */
function heldBy(
  input: { connectionId: string; view: SnapshotView },
  file: { entityConnectionId: string | null; entityTable: string | null; entityId: string | null },
  read: ReadRow,
): boolean {
  if (file.entityConnectionId !== input.connectionId || file.entityTable === null || file.entityId === null) return false;
  const table = input.view.linkTable(file.entityTable);
  if (table === null || table.id !== read.table.id) return false;
  let key: Row;
  try {
    key = parseRecordId(read.table, file.entityId);
  } catch {
    return false;
  }
  const columns = read.table.primaryKey;
  return columns.length > 0 && columns.every((column) => key[column] !== undefined && read.record[column] !== null && read.record[column] !== undefined && String(key[column]) === String(read.record[column]));
}
