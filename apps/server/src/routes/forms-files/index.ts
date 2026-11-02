// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FILE A STRANGER SENT WITH A FORM, opened by staff:
 * `GET /api/v1/forms/files/:id` (the id the add-on's files table keeps as
 * `file_id`).
 *
 * Only a file an answer took: an unattached one (picked, never sent) is
 * nobody's to open. Only for a person who reads that answer: `read` on the
 * forms add-on's answers table (the add-on's own role grants it), and a row
 * limit that reaches the answer. Everyone else, a stranger first of all (no
 * session), is refused; a file that is not there, or not an answer's, is the
 * same 404 whatever the reason.
 *
 * Always a download (`attachment`), never drawn in the page: `nosniff`, a
 * sandbox policy that runs nothing, and no cache anywhere.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { ForbiddenError, NotFoundError } from '../../errors.js';
import { FileNotFoundError } from '../../files/drivers/driver.js';
import type { FileRecord } from '../../files/read-limited.js';
import type { FileStore } from '../../files/store.js';
import type { FormsFiles } from '../../forms/files.js';
import type { PublicUploads } from '../../public-uploads/store.js';

export interface FormsFilesRoutesDeps {
  uploads: Pick<PublicUploads, 'open'>;
  storage: Pick<FileStore, 'open'>;
  forms: Pick<FormsFiles, 'answersOf'>;
  /** Whether the caller's row limit reaches the answer (`fileRecordCheck`). */
  reachesRecord?: ((request: FastifyRequest, record: FileRecord, action: 'read') => Promise<boolean>) | undefined;
}

/** RFC 5987 `filename*`, with a readable ASCII fallback. */
function attachment(filename: string): string {
  const ascii = filename.replaceAll(/[^\x20-\x7e]/g, '_').replaceAll(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const params = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

export function formsFilesRoutes(deps: FormsFilesRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/forms/files/:id',
      {
        schema: {
          tags: ['forms'],
          summary: 'Download a file a stranger sent with a form answer',
          description: 'The file an answer of a forms add-on took, as an attachment. Needs read on that add-on’s answers table, and a row limit that reaches the answer.',
          params,
        },
      },
      async (request, reply) => {
        const missing = () => new NotFoundError('File not found.');
        const opened = await deps.uploads.open(request.params.id);
        if (opened === null || opened.upload.owner === null) throw missing();
        const { upload, file } = opened;
        const owner = upload.owner!;
        const answers = await deps.forms.answersOf(owner.connectionId, owner.table);
        if (answers === null) throw missing();
        const permission = `table:${owner.connectionId}:${owner.table}:read`;
        if (!(await request.can(permission))) throw new ForbiddenError(`Opening this file needs ${permission}.`, 'TABLE_FORBIDDEN', { permission });
        if (deps.reachesRecord !== undefined && !(await deps.reachesRecord(request, { connectionId: owner.connectionId, table: owner.table, recordId: owner.key, uploadedBy: null }, 'read'))) throw missing();

        let bytes;
        try {
          bytes = await deps.storage.open(file);
        } catch (error) {
          if (error instanceof FileNotFoundError) throw missing();
          throw error;
        }
        return reply
          .header('content-type', file.mime)
          .header('content-length', String(bytes.sizeBytes))
          .header('content-disposition', attachment(upload.name ?? file.filename))
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "sandbox; default-src 'none'")
          .header('cache-control', 'private, no-store')
          .send(bytes.stream);
      },
    );
  };
}
