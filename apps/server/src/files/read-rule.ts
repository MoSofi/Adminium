// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO MAY READ A FILE: the one rule every route that hands a file's bytes to
 * a person asks (the files routes, and a picture copied onto a landing page).
 *
 *  - A file attached to a record: `read` on its table, its record reached by
 *    the reader's role (a role held to some rows reaches only those), and not
 *    held only in columns that role does not read.
 *  - A file attached to no record (an upload no record took yet, a library
 *    file): its uploader, or `files.manage`.
 */
import type { StoredFile } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import type { FileRecord } from './read-limited.js';

/** See-everyone's-files. Not what authorises an upload. */
export const FILES_MANAGE_PERMISSION = 'system:files:manage';

export interface FileReadRuleDeps {
  /** Whether a file is held only in columns the reader's role does not read. Absent: a file is read with its table, whole. */
  hiddenFile?: ((request: FastifyRequest, file: StoredFile) => Promise<boolean>) | undefined;
  /** Whether the caller reaches the record a file hangs on. Absent: nobody is held to rows. */
  reachesRecord?: ((request: FastifyRequest, record: FileRecord, action: 'read' | 'update') => Promise<boolean>) | undefined;
}

export function fileReadRule(deps: FileReadRuleDeps) {
  /** The grant a file's record implies, or null when it hangs on none. */
  function entityPermission(file: StoredFile, action: 'read' | 'update'): string | null {
    if (file.entityConnectionId === null || file.entityTable === null) return null;
    return `table:${file.entityConnectionId}:${file.entityTable}:${action}`;
  }

  /**
   * Whether the caller reaches the record this file hangs on. A file of a
   * table whose rows the caller reads only in part is read and changed with
   * its record — by its uploader and by a holder of `files.manage` too.
   */
  async function reaches(request: FastifyRequest, file: StoredFile, action: 'read' | 'update'): Promise<boolean> {
    if (deps.reachesRecord === undefined || file.entityConnectionId === null || file.entityTable === null) return true;
    return deps.reachesRecord(request, { connectionId: file.entityConnectionId, table: file.entityTable, recordId: file.entityId, uploadedBy: file.uploadedBy }, action);
  }

  /** May this caller see this file at all? Attached ⇒ the entity table's `read`. Unattached ⇒ the uploader, or `files.manage`. */
  async function canRead(request: FastifyRequest, file: StoredFile): Promise<boolean> {
    const permission = entityPermission(file, 'read');
    if (permission !== null) return (await request.can(permission)) && !((await deps.hiddenFile?.(request, file)) ?? false) && (await reaches(request, file, 'read'));
    if (file.uploadedBy !== null && file.uploadedBy === request.user?.id) return true;
    return request.can(FILES_MANAGE_PERMISSION);
  }

  return { entityPermission, reaches, canRead };
}
