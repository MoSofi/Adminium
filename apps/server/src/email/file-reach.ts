// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The files an email document names by their id — its attachments and the
 * pictures in its blocks — as far as whoever writes the document may name
 * them. A document is sent to whoever its author chooses, with those files'
 * bytes: so a file NEWLY named must be one a person could attach from the
 * file library (an upload; never somebody's export, an import's source or a
 * schema file), and, when it hangs on a record, a record its author reaches
 * (`files/read-limited.ts`). A file the stored document already named is not
 * asked about again: saving a document somebody else attached it to is not
 * naming it.
 *
 * Asked wherever a document comes in from outside: the editor's save, its
 * test send, and what the assistant drafts and sends.
 */
import { filesRepo, type MetaDb, type StoredFile } from '@adminium/meta';

import { ValidationFailedError } from '../errors.js';
import type { EmailDocument } from './document.js';

/** Every file id a document names. */
export function fileIdsOf(doc: { attachments?: EmailDocument['attachments'] | undefined; blocks?: readonly unknown[] | undefined }): string[] {
  const ids = new Set<string>();
  for (const attachment of doc.attachments ?? []) if (attachment.kind === 'file') ids.add(attachment.fileId);
  for (const block of (doc.blocks ?? []) as unknown as Record<string, unknown>[]) {
    if (block['block'] !== 'email.image') continue;
    const data = block['data'];
    const fileId = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['fileId'] : undefined;
    if (typeof fileId === 'string' && fileId !== '') ids.add(fileId);
  }
  return [...ids];
}

/**
 * Refuses a document that newly names a file its author may not send: in the
 * words of an id that names no file a person can attach. `reached` answers
 * for a file that hangs on a record.
 */
export async function assertNamedFiles(meta: MetaDb, doc: Parameters<typeof fileIdsOf>[0], held: ReadonlySet<string>, reached: (file: StoredFile) => Promise<boolean>): Promise<void> {
  const files = filesRepo(meta);
  for (const id of fileIdsOf(doc)) {
    if (held.has(id)) continue;
    const file = await files.findById(id);
    // An id that names nothing is the document's own business, as it always was (it is sent without it).
    if (file === null) continue;
    const theirs = file.kind === 'upload' && (file.entityConnectionId === null || file.entityTable === null || (await reached(file)));
    if (!theirs) throw new ValidationFailedError(`File ${id} not found.`, { attachments: 'unknown-file' });
  }
}
