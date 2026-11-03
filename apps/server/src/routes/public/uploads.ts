// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `POST /public/uploads?ref=<ref>&column=<column>&name=<file name>` — A
 * GUEST'S FILE FOR AN APP'S FILE COLUMN (a customer's logo, a print job's
 * artwork).
 *
 * One file per request, the request's body being the file itself (no
 * multipart: the bytes go straight to the spool, as the forms door's and the
 * staff upload route's do). What it is judged by comes from the key, never
 * from the request:
 *
 *  - the gate, as every public route: the key, its origin, the visitor's and
 *    the key's limits, the session it carries;
 *  - the entry `ref` names, as a create or a change through it would reach
 *    it (its claim, its parent): an entry of the key that lists the column in
 *    its `uploads` — or one of its child rows' lists, the column then written
 *    `<child>.<column>` (`order_lines.artwork`, two levels at most);
 *  - the column's own rule for a guest's file (`rules.file.upload`): its
 *    kinds, its size (and the install's `files.maxBytes`);
 *  - a human check, one proof per file (`x-adminium-proof`, purpose
 *    `upload`, bound to the key; spent once), unless the guest is signed in
 *    to the entry (its claim's session, or a parent's), checked before a byte
 *    is read.
 *
 * A body longer than the column takes is refused on its declared length
 * before it is read, and cut off where it passes the cap otherwise. Then the
 * upload store takes it (`public-uploads/store.ts`): the address's daily
 * files and bytes, the app columns' share of the space, the content sniffed
 * (a script renamed `.jpg` is no JPEG), a picture cleaned of what the camera
 * wrote, an SVG written again from its own tree and refused (`kind`, saying
 * what it holds) when it holds more than a drawing. Kept private: a guest's
 * SVG is never shown on a page or served as a product asset, only handed back
 * as a download. Kept unattached for a day, for the guest's next write through the
 * entry to name (`public-uploads/columns.ts`). It answers:
 *
 *   200 `{ data: { id, name, size, kind } }`   taken: `id` is what the write names
 *   413, 415, 429, 507, 400 `PUBLIC_UPLOAD_REFUSED` `{ reason }`
 *       `too-big`, `kind`, `cap`, `quota`, `column`
 *   403 `PUBLIC_PROOF_REQUIRED`                404 `PUBLIC_REF_NOT_FOUND`
 *
 * The file is never served back by its id: once a write names it, it is the
 * row's own file, read through the row (`GET /public/files`) or by staff.
 */
import type { Readable } from 'node:stream';

import { FILE_COLUMN_MAX_BYTES } from '@adminium/manifest';
import { publicProofsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { checkProof } from '../../public-api/proof.js';
import { hasVisitorReach } from '../../public-api/keys.js';
import type { ResolvedKey } from '../../public-api/resolve.js';
import type { PublicSessionContext } from '../../public-api/claim.js';
import type { CompiledResource } from '../../public-api/scope.js';
import { parentOf } from '../../public-api/visible-with.js';
import { columnUploadKey, uploadKindsOf } from '../../public-uploads/columns.js';
import { COLUMN_UPLOAD_KIND, type PublicUploads, type UploadRefusal } from '../../public-uploads/store.js';
import { publicErrorReply, type PublicErrorCode } from './schema.js';

/** Room past a column's cap for nothing else: the body is the file, and the spool's own cap is the column's. */
export const UPLOAD_BODY_SLACK = 64 * 1024;

/** The largest body the route reads: the largest file any column takes, and the slack. */
export const UPLOAD_BODY_LIMIT = FILE_COLUMN_MAX_BYTES + UPLOAD_BODY_SLACK;

const STATUS: Readonly<Record<UploadRefusal, number>> = { 'too-big': 413, kind: 415, quota: 507, cap: 429 };

export const publicUploadQuery = z
  .object({
    ref: z.string().min(1).max(64),
    /** The column, or `<child>.<column>` / `<child>.<grandchild>.<column>` for a child row's. */
    column: z.string().min(1).max(200),
    name: z.string().max(1024).optional(),
  })
  .strict();

export const publicUploadReply = z.object({
  data: z.object({ id: z.string(), name: z.string(), size: z.number().int(), kind: z.string() }),
});

type Found = { resource: CompiledResource; table: ResolvedTable; view: SnapshotView };

export interface UploadRouteDeps {
  meta: MetaDb;
  uploads: PublicUploads;
  /** The proof key (`proofKey(secret)`). */
  proofKey: Buffer;
  /** The namespace's gate, as every public route runs it first. */
  gate: (request: FastifyRequest, reply: FastifyReply) => Promise<{ key: ResolvedKey; session: PublicSessionContext | null } | null>;
  /** The entry `ref` names for a create or a change, as a write through it would reach it; null once refused (answered). */
  resolve: (request: FastifyRequest, reply: FastifyReply, ok: { key: ResolvedKey; session: PublicSessionContext | null }, ref: string) => Promise<Found | null>;
  fail: (reply: FastifyReply, status: number, code: PublicErrorCode, message: string, params?: Record<string, unknown>) => FastifyReply;
  preflight: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  now?: () => number;
}

/**
 * The table and column a `column` path names under an entry: its own column,
 * or a child row's (`order_lines.artwork`), each level's `uploads` saying the
 * guest may upload there. Null for anything else.
 */
export function uploadTargetOf(found: Found, path: string): { table: ResolvedTable; column: string } | null {
  const parts = path.split('.');
  const column = parts.pop()!;
  if (parts.length > 2) return null;
  if (parts.length === 0) return (found.resource.uploads ?? []).includes(column) ? { table: found.table, column } : null;
  let child = found.resource.children?.get(parts[0]!);
  if (child !== undefined && parts.length === 2) child = child.children?.[parts[1]!];
  if (child === undefined || !(child.uploads ?? []).includes(column)) return null;
  try {
    return { table: found.view.table(child.table), column };
  } catch {
    return null;
  }
}

/**
 * Whether a guest is excused the proof: signed in to the entry (the person's
 * own row, the entry's claim, or a parent it is reached through), or a key no
 * visitor holds.
 */
function proofExcused(key: ResolvedKey, resource: CompiledResource, session: PublicSessionContext | null): boolean {
  if (!hasVisitorReach(key.kind) || key.requiresStaff !== null) return true;
  if (session === null) return false;
  return session.grant.ref === resource.ref || (resource.claim?.ref !== undefined && session.grant.ref === resource.claim.ref) || parentOf(resource) !== null;
}

export async function registerUploads(app: FastifyInstance, deps: UploadRouteDeps): Promise<void> {
  const proofs = publicProofsRepo(deps.meta);
  const now = deps.now ?? Date.now;

  await app.register(async (door) => {
    // The body is the file: every type is handed over as the stream it is, inside this plugin only.
    door.removeAllContentTypeParsers();
    door.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

    door.options('/public/uploads', { schema: { hide: true } }, deps.preflight);
    door.post(
      '/public/uploads',
      {
        bodyLimit: UPLOAD_BODY_LIMIT,
        config: {
          rateLimitBucket: 'public',
          audit: auditExempt("a guest uploading a file for an app's column: the upload row is the record, and the write that names it is audited"),
        },
        schema: {
          querystring: publicUploadQuery,
          response: { 200: publicUploadReply, 400: publicErrorReply, 401: publicErrorReply, 403: publicErrorReply, 404: publicErrorReply, 413: publicErrorReply, 415: publicErrorReply, 429: publicErrorReply, 503: publicErrorReply, 507: publicErrorReply },
        },
      },
      async (request: FastifyRequest<{ Querystring: z.infer<typeof publicUploadQuery> }>, reply: FastifyReply) => {
        const refused = (reason: UploadRefusal | 'column') =>
          deps.fail(reply, reason === 'column' ? 400 : STATUS[reason], 'PUBLIC_UPLOAD_REFUSED', 'That file was not taken.', { reason });
        const ok = await deps.gate(request, reply);
        if (ok === null) return reply;
        const found = await deps.resolve(request, reply, ok, request.query.ref);
        if (found === null) return reply;
        const target = uploadTargetOf(found, request.query.column);
        const rule = target === null ? undefined : target.table.columns.get(target.column)?.file;
        if (target === null || rule?.upload === undefined) return refused('column');

        // The human check, before a byte is read: one proof per file, spent once.
        if (!proofExcused(ok.key, found.resource, ok.session)) {
          const proved = checkProof(deps.proofKey, request.headers['x-adminium-proof'], { keyId: ok.key.keyId, purpose: 'upload', now: now() });
          if (!proved.ok || !(await proofs.spend({ id: proved.spendId, keyId: ok.key.keyId, purpose: 'upload', expiresAt: proved.expiresAt }))) {
            return deps.fail(reply, 403, 'PUBLIC_PROOF_REQUIRED', 'Prove this is a person first.');
          }
        }

        // The column's cap: a body that says it is longer is refused before it is read; one that is not is cut off past it.
        const maxBytes = Math.min(rule.upload.maxBytes, rule.maxBytes);
        const declared = Number(request.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes + UPLOAD_BODY_SLACK) {
          // Not read: the connection is closed after the answer rather than drained.
          reply.header('connection', 'close');
          return refused('too-big');
        }

        const taken = await deps.uploads.take({
          source: request.body as Readable,
          name: request.query.name ?? 'file',
          binding: { kind: COLUMN_UPLOAD_KIND, key: columnUploadKey(ok.key.connectionId, target.table.id, target.column) },
          ip: request.ip,
          kinds: uploadKindsOf(rule.upload.kinds),
          maxBytes,
        });
        // An SVG holding more than a drawing (a script, a link out, an editor's own parts): what it holds, and what to do.
        if (!taken.ok && taken.svg !== undefined) {
          const found = taken.svg.replace(/\s*Save it as a plain SVG\.$/, '');
          return deps.fail(reply, STATUS.kind, 'PUBLIC_UPLOAD_REFUSED', `${found} Save it as a plain SVG and upload it again.`, { reason: 'kind' });
        }
        if (!taken.ok) return refused(taken.code);
        return reply.send({ data: taken.upload });
      },
    );
  });
}
