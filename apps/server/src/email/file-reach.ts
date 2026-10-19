// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The files an email document names by their id — its attachments and the
 * pictures in its blocks — as far as whoever writes the document may name
 * them. A document is sent to whoever its author chooses, with those files'
 * bytes: so a file NEWLY named must be an upload (never somebody's export, an
 * import's source or a schema file) its author may read. One no record holds
 * (the Files library's, or an upload for a form not saved yet) is its
 * uploader's, or theirs who keeps the Files library; one a record holds is
 * theirs who read that record's table and reach that row
 * (`files/read-limited.ts`). A file the stored document already named is not
 * asked about again: saving a document somebody else attached it to is not
 * naming it.
 *
 * Asked wherever a document comes in from outside: the editor's save, its
 * test send, and what the assistant drafts and sends.
 */
import { filesRepo, type MetaDb, type StoredFile } from '@adminium/meta';

import { ValidationFailedError } from '../errors.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import type { EmailDocument } from './document.js';

/** Whose files the author of a document may send. */
export interface NamingRights {
  /** The author. */
  userId: string | null;
  /** A permission of the author's. */
  can: (permission: string) => Promise<boolean>;
  /** Whether the author reaches the row a file hangs on. */
  reachesRow: (file: StoredFile) => Promise<boolean>;
}

async function mayName(file: StoredFile, rights: NamingRights): Promise<boolean> {
  if (file.kind !== 'upload') return false;
  if (file.entityConnectionId === null || file.entityTable === null) {
    return (file.uploadedBy !== null && file.uploadedBy === rights.userId) || (await rights.can(PERMISSIONS.filesManage));
  }
  return (await rights.can(`table:${file.entityConnectionId}:${file.entityTable}:read`)) && (await rights.reachesRow(file));
}

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
 * words of an id that names no file a person can attach.
 */
export async function assertNamedFiles(meta: MetaDb, doc: Parameters<typeof fileIdsOf>[0], held: ReadonlySet<string>, rights: NamingRights): Promise<void> {
  const files = filesRepo(meta);
  for (const id of fileIdsOf(doc)) {
    if (held.has(id)) continue;
    const file = await files.findById(id);
    // An id that names nothing is the document's own business, as it always was (it is sent without it).
    if (file === null) continue;
    if (!(await mayName(file, rights))) throw new ValidationFailedError(`File ${id} not found.`, { attachments: 'unknown-file' });
  }
}
