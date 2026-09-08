// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File routes (37-files-and-storage.md Appendix C, §3.3, §3.4, 37-T11),
 * mounted under `/api/v1`.
 *
 * THE AUTHORISATION MODEL IS THE THING TO READ FIRST (D11). There is no
 * "can upload" permission, deliberately:
 *
 *   • Uploading requires `create` or `update` on the table the file is FOR.
 *     A file attached to a record is that record's data and inherits its
 *     authority; a separate global grant would let someone who cannot touch
 *     invoices attach a PDF to one.
 *   • Reading an attached file's bytes requires `read` on its table.
 *   • An UNATTACHED upload is readable by its uploader and by `files.manage`.
 *     That is the create-form window: the record does not exist yet, so there
 *     is no record grant to inherit and the uploader is the only claimant.
 *   • `files.manage` is about OTHER PEOPLE'S files — lists are mine-only
 *     without it, the `exports.manage` precedent.
 *
 * Every 403 names the grant it wanted, as the data routes do.
 *
 * WHICH KINDS THIS ROUTE SERVES. `upload` and (34) `document` only. Exports,
 * imports, the branding logo, schema files and archives keep the routes and
 * the rules they already have — `GET /exports/:id/download` has its own
 * expiry and ownership semantics, and re-serving those rows here would be a
 * second door onto the same bytes with a different lock. They 404 here, by
 * kind, which is a deliberate refusal and not an oversight.
 *
 * THE UPLOAD BODY IS THE FILE. Metadata rides the query string and the raw
 * stream goes to the spool (D5) — no multipart parser, matching the three
 * raw-body precedents already in the tree. The content-type parser is
 * registered INSIDE this plugin's encapsulation, so a wildcard parser here
 * cannot change how any other route reads a body.
 */

import type { Readable } from 'node:stream';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  destinationsRepo,
  filesRepo,
  settingsRepo,
  type DsnCrypto,
  type FileKind,
  type MetaDb,
  type StoredFile,
} from '@adminium/meta';

import { auditExempt, audited } from '../../audit/coverage.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { LOCAL_DESTINATION_ID } from '../../files/destinations.js';
import { widgetDataChannel } from '../../realtime/hub.js';
import { FileNotFoundError } from '../../files/drivers/driver.js';
import { DEFAULT_REF_SHAPE, formatRef, parseRef, type RefShape } from '../../files/refs.js';
import { SpoolTooLargeError } from '../../files/spool.js';
import { UnsupportedFileTypeError, type FileStore } from '../../files/store.js';
import type { SniffTypeKey } from '../../files/sniff.js';
import { SNIFF_TYPE_KEYS } from '../../files/sniff.js';
import {
  fileIdParams,
  filesAttachBody,
  filesContentQuery,
  filesGetReply,
  filesListQuery,
  filesListReply,
  filesPatchBody,
  filesResolveBody,
  filesResolveReply,
  filesUploadQuery,
  filesUploadReply,
  filesUsageReply,
  type FileView,
} from './schema.js';

/** See-everyone's-files. Not what authorises an upload — see the header. */
export const FILES_MANAGE_PERMISSION = 'system:files:manage';

/** The kinds this route group serves. Everything else keeps its own door. */
const SERVED_KINDS: ReadonlySet<string> = new Set<FileKind>(['upload']);

/**
 * The route-scoped body limit. Deliberately the HARD CEILING rather than the
 * configured `files.maxBytes`: Fastify's limit is applied by the parser, before
 * any handler runs, and a 413 from it carries no explanation. The spool's cap
 * is what enforces the operator's setting, and it can say which limit was hit
 * and by how much. This one exists only so a caller cannot stream 40 GiB into
 * the box while the spool decides it does not want it.
 */
const HARD_BODY_LIMIT = 2_147_483_648;

/** Kinds a browser may render inline without becoming a delivery vector (D9). */
const INLINE_SAFE: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

export interface FilesRoutesDeps {
  meta: MetaDb;
  storage: FileStore;
  /** Storage-credential closures, for the destination names on `GET /files/usage`. */
  storageCrypto: DsnCrypto;
  /**
   * The per-column `file` block, when a column is named on upload. Supplied by
   * compose from the stored page config; a route that had to load pages itself
   * would need the page id, which an upload does not have.
   */
  columnFileBlock?: (input: {
    connectionId: string;
    table: string;
    column: string;
  }) => Promise<{
    ref?: RefShape | undefined;
    accept?: readonly string[] | undefined;
    maxBytes?: number | undefined;
    destinationId?: string | undefined;
  } | null>;
  /**
   * The table's `config.attachments` block, for a SIDECAR upload (one that
   * names no column). Absent ⇒ sidecar uploads take only the workspace
   * settings.
   *
   * This exists because the alternative was worse: without it, the Studio's
   * Attachments card offered `accept`, `maxBytes` and `maxCount` controls that
   * nothing on the wire respected — three switches that changed only what the
   * browser was willing to send. A cap only the client applies is a
   * suggestion.
   */
  pageAttachments?: (input: {
    connectionId: string;
    table: string;
  }) => Promise<{
    accept?: readonly string[] | undefined;
    maxBytes?: number | undefined;
    maxCount?: number | undefined;
    destinationId?: string | undefined;
  } | null>;
}

function requireUserId(request: FastifyRequest): string {
  const id = request.user?.id;
  if (id === undefined) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  return id;
}

/**
 * RFC 5987 `filename*` plus an ASCII fallback (D9).
 *
 * The existing download routes carry a naive quote/newline replace, which
 * mangles every non-ASCII name into underscores. This keeps the real name for
 * every modern client and degrades to a readable ASCII approximation for the
 * `filename=` parameter, which is all the fallback is for.
 */
function contentDisposition(disposition: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replaceAll(/[^\x20-\x7e]/g, '_').replaceAll(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** `bytes=<start>-<end>` — the only Range form this server answers. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    // A suffix range: the LAST n bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export function filesRoutes(deps: FilesRoutesDeps): FastifyPluginAsyncZod {
  const { meta, storage, storageCrypto } = deps;
  const files = filesRepo(meta);
  const destinations = destinationsRepo(meta, storageCrypto);
  const settings = settingsRepo(meta);

  function toView(file: StoredFile): FileView {
    return {
      id: file.id,
      filename: file.filename,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      kind: file.kind,
      destinationId: file.destinationId,
      uploadedBy: file.uploadedBy,
      createdAt: file.createdAt,
      attachedAt: file.attachedAt,
      deletedAt: file.deletedAt,
      // Present whether or not a record claims the file (38 D4). `entity`
      // below repeats it when there IS a record; this is what a library file
      // and an in-flight create-form upload carry instead.
      connectionId: file.entityConnectionId,
      entity:
        file.entityConnectionId === null || file.entityTable === null || file.entityId === null
          ? null
          : { connectionId: file.entityConnectionId, table: file.entityTable, recordId: file.entityId },
      contentPath: `/api/v1/files/${file.id}/content`,
    };
  }

  /** The grant a file's ENTITY implies, or null when it has none. */
  function entityPermission(file: StoredFile, action: 'read' | 'update'): string | null {
    if (file.entityConnectionId === null || file.entityTable === null) return null;
    return `table:${file.entityConnectionId}:${file.entityTable}:${action}`;
  }

  /**
   * May this caller see this file at all? Attached ⇒ the entity table's `read`.
   * Unattached ⇒ the uploader, or `files.manage`. See the header.
   */
  async function canRead(request: FastifyRequest, file: StoredFile): Promise<boolean> {
    const permission = entityPermission(file, 'read');
    if (permission !== null) return request.can(permission);
    if (file.uploadedBy !== null && file.uploadedBy === request.user?.id) return true;
    return request.can(FILES_MANAGE_PERMISSION);
  }

  /** May this caller change or remove it? `update` on the entity, else the uploader. */
  async function canWrite(request: FastifyRequest, file: StoredFile): Promise<boolean> {
    const permission = entityPermission(file, 'update');
    if (permission !== null && (await request.can(permission))) return true;
    if (file.uploadedBy !== null && file.uploadedBy === request.user?.id) return true;
    return request.can(FILES_MANAGE_PERMISSION);
  }

  /** Load a served-kind file, or 404. Trashed rows 404 on content, not on read. */
  async function load(id: string): Promise<StoredFile> {
    const file = await files.findById(id);
    if (file === null || !SERVED_KINDS.has(file.kind)) throw new NotFoundError(`File ${id} not found.`);
    return file;
  }

  /**
   * The allowlist for THIS upload: the workspace setting, narrowed by the
   * column's `accept` when one is named. A column can only ever narrow — a
   * column that named a type the workspace refuses would be a way to widen the
   * security boundary from a page config (D8).
   */
  async function allowedTypesFor(columnAccept: readonly string[] | undefined): Promise<SniffTypeKey[]> {
    const configured = await settings.get('files.allowedTypes');
    const workspace = configured.filter((key): key is SniffTypeKey =>
      (SNIFF_TYPE_KEYS as readonly string[]).includes(key),
    );
    if (columnAccept === undefined) return workspace;
    return workspace.filter((key) => columnAccept.includes(key));
  }

  return async (app) => {
    /**
     * D27's producer half for the SIDECAR routes. An attach, detach, trash or
     * restore has to reach an open record page in another tab the same way the
     * column-bound path does from `routes/data` — otherwise the panel only ever
     * updates for the tab that did the writing.
     *
     * WHY `widget-data:` AND NOT `table:`. `table:<conn>:<table>` is
     * publish-only: `parseChannel` (realtime/hub.ts) has no case for it, so
     * `authorizeChannel` denies every subscription and an event published there
     * reaches no browser on either transport. `widget-data:<conn>:<table>` is
     * the same table gated by exactly `table:<conn>:<table>:read` — the grant
     * that already lets this caller see the record and its files.
     *
     * The frame carries no `pk` and no `row`. `publishWidgetDataStream` exists
     * to PII-mask those, and a resolved table would have to be loaded here to do
     * it; a bare "something about this table's attachments changed" is all the
     * panel needs, and it leaks nothing.
     */
    function publishAttachmentsChanged(file: StoredFile): void {
      // The same guard the data routes use at every publish site: a composition
      // without a hub (several test harnesses, and any embedder that wires no
      // realtime) must still serve these routes. `buildDataTestApp` documents
      // absence as the supported case.
      if (!app.hasDecorator('realtime')) return;
      if (file.entityConnectionId === null || file.entityTable === null) return;
      app.realtime.publish(
        widgetDataChannel(file.entityConnectionId, file.entityTable),
        'record.attachments',
        { type: 'record.attachments', pk: null, row: null },
      );
    }

    /**
     * ANY content type, handed straight to the handler AS A STREAM.
     *
     * Scoped to this plugin's encapsulation, like the three precedents.
     * `parseAs` is deliberately absent: buffering would defeat the spool, whose
     * entire purpose is that the cap fires before the bytes are in the heap.
     *
     * The handler must read `request.body`, NOT `request.raw`. They are the
     * same underlying socket, but Fastify owns the one it handed to the parser:
     * reading `raw` while the parser's stream sits undrained hangs the request
     * on an over-size upload — the connection stays open waiting for a body
     * nobody is consuming, and the 413 the spool raised never reaches the
     * client. (Found by the 413 test timing out at five seconds.)
     */
    app.addContentTypeParser('*', (_request, payload, done) => {
      done(null, payload);
    });

    app.post(
      '/files',
      {
        bodyLimit: HARD_BODY_LIMIT,
        config: { audit: audited('rbac') },
        schema: { querystring: filesUploadQuery, response: { 201: filesUploadReply } },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        const { filename, connectionId, table, recordId, column } = request.query;

        /*
         * A file always belongs to a CONNECTION; whether it also belongs to a
         * table decides which grant authorises it (38 D4).
         *
         * 37 D11 said "there is no upload that belongs to nothing" and made
         * `table` required with it. The first half still holds — a file with
         * no connection at all cannot be created here — but the second was
         * too strong: the owner's Files page uploads a file that belongs to
         * the workspace and is attached to a record later, or never. So a
         * table-less upload is now legal and is authorised by `files.manage`,
         * which is the same grant that reaches the page it is made from.
         */
        if (connectionId === undefined) {
          throw new ValidationFailedError('An upload must name the connection it belongs to.', {
            connectionId: 'required',
          });
        }
        // A column belongs to a table; naming one without the other is a
        // request whose reference shape nothing can resolve.
        if (table === undefined && column !== undefined) {
          throw new ValidationFailedError('A column upload must name the table the column is on.', {
            table: 'required',
          });
        }

        if (table === undefined) {
          // LIBRARY upload: no record to hang a table grant off, so the page's
          // own grant is the door. Deliberately not a second `files.upload`
          // grant — that would be a role row whose only effect is to reach a
          // page its holder cannot open (38 D16, O3 ruled no).
          if (!(await request.can(FILES_MANAGE_PERMISSION))) {
            throw new ForbiddenError(
              'You need files.manage to upload a file that is not attached to a record.',
              'FORBIDDEN',
              { permission: FILES_MANAGE_PERMISSION },
            );
          }
        } else {
          // Attaching to an existing record needs `update`; an unattached upload
          // for a record that does not exist yet needs `create` OR `update` —
          // the create form is the whole reason the unattached state exists.
          const updatePermission = `table:${connectionId}:${table}:update`;
          const allowed =
            recordId === undefined
              ? (await request.can(`table:${connectionId}:${table}:create`)) || (await request.can(updatePermission))
              : await request.can(updatePermission);
          if (!allowed) {
            throw new ForbiddenError(
              recordId === undefined
                ? `You need create or update on ${table} to upload a file for it.`
                : `You need update on ${table} to attach a file to this record.`,
              'FORBIDDEN',
              { permission: updatePermission },
            );
          }
        }

        // A COLUMN upload reads that column's `file` block; a SIDECAR upload
        // (no column named) reads the page's `config.attachments`. Both narrow
        // the same three things, and neither can widen the workspace setting.
        // A library upload has neither: no column to read a block from, and no
        // table whose pages could carry a sidecar block. It gets the workspace
        // limits, which is what `limits === null` already means below.
        const block =
          column === undefined || table === undefined || deps.columnFileBlock === undefined
            ? null
            : await deps.columnFileBlock({ connectionId, table, column });
        const sidecar =
          column !== undefined || table === undefined || deps.pageAttachments === undefined
            ? null
            : await deps.pageAttachments({ connectionId, table });
        const limits = block ?? sidecar;

        const maxBytes = Math.min(
          await settings.get('files.maxBytes'),
          limits?.maxBytes ?? Number.POSITIVE_INFINITY,
        );
        const destinationId = request.query.destinationId ?? limits?.destinationId;

        // The per-record cap, enforced BEFORE the bytes are spooled: a refusal
        // that arrives after a 200 MB upload has landed is a refusal that cost
        // the user two minutes and the server a disk write.
        if (sidecar?.maxCount !== undefined && recordId !== undefined && table !== undefined) {
          const held = await files.listByEntity({ connectionId, table, recordId }, sidecar.maxCount + 1);
          if (held.length >= sidecar.maxCount) {
            throw new ConflictError(
              `This record already has the maximum of ${String(sidecar.maxCount)} attachment(s).`,
              'CONFLICT',
              { maxCount: sidecar.maxCount },
            );
          }
        }

        let result;
        try {
          result = await storage.putUpload({
            kind: 'upload',
            filename,
            claimedMime: request.headers['content-type'],
            source: request.body as Readable,
            maxBytes,
            allowedTypes: await allowedTypesFor(limits?.accept),
            uploadedBy: userId,
            ...(destinationId === undefined
              ? {}
              : { destinationId: destinationId === LOCAL_DESTINATION_ID ? null : destinationId }),
            ...(recordId === undefined || table === undefined
              ? // No record: the row records its CONNECTION instead. With a
                // table this is the create form, and the file stays UNCLAIMED
                // until the CRUD write attaches it — so an abandoned form is
                // still collected by the sweep. Without a table nothing is
                // coming to claim it, so the workspace does (38 D4).
                { entityConnectionId: connectionId, claimed: table === undefined }
              : {
                  entity: {
                    connectionId,
                    table,
                    // The upload path has the canonical record-id STRING, not
                    // the pk map — that is what the grid and the record route
                    // both address a row by. `pk` is filled in by the
                    // reconcile hook on the next write, which does have it.
                    pk: { id: recordId },
                    label: recordId,
                  },
                }),
          });
        } catch (error) {
          if (error instanceof SpoolTooLargeError) {
            throw new AppError(413, 'FILE_TOO_LARGE', `That file is larger than the ${String(maxBytes)}-byte limit.`, {
              maxBytes,
            });
          }
          if (error instanceof UnsupportedFileTypeError) {
            throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', error.message, {
              ...(error.sniffedMime === undefined ? {} : { mime: error.sniffedMime }),
            });
          }
          throw error;
        }

        await app.rbac.audit(request, {
          category: 'data',
          action: 'file.upload',
          connectionId,
          changes: { after: { fileId: result.file.id, filename, mime: result.sniffed.mime, table } },
        });

        // A sidecar upload attaches HERE (the column-bound one attaches later,
        // on the reconcile hook, which publishes from `routes/data`). No-op
        // when the upload named no record.
        publishAttachmentsChanged(result.file);
        const view = toView(result.file);
        if (column === undefined) return reply.status(201).send({ data: view });

        const shape = block?.ref ?? DEFAULT_REF_SHAPE;
        const row = result.file.destinationId === null ? null : await destinations.findById(result.file.destinationId);
        const publicBaseUrl =
          row !== null && 'publicBaseUrl' in row.config ? row.config.publicBaseUrl : undefined;
        const ref = formatRef(
          shape,
          { id: result.file.id, storageKey: result.file.storageKey, publicBaseUrl },
          originOf(request),
        );
        return reply.status(201).send({ data: view, ref });
      },
    );

    app.get(
      '/files',
      { schema: { querystring: filesListQuery, response: { 200: filesListReply } } },
      async (request) => {
        const userId = requireUserId(request);
        const manage = await request.can(FILES_MANAGE_PERMISSION);
        const query = request.query;

        const page = await files.search({
          state: query.state,
          kinds: [...SERVED_KINDS] as FileKind[],
          ...(query.q === undefined ? {} : { q: query.q }),
          ...(query.kind === undefined ? {} : { kind: query.kind }),
          ...(query.connectionId === undefined ? {} : { entityConnectionId: query.connectionId }),
          ...(query.table === undefined ? {} : { entityTable: query.table }),
          ...(query.recordId === undefined ? {} : { entityId: query.recordId }),
          ...(query.since === undefined ? {} : { since: query.since }),
          ...(query.destinationId === undefined
            ? {}
            : { destinationId: query.destinationId === LOCAL_DESTINATION_ID ? null : query.destinationId }),
          ...(query.mime === undefined ? {} : { mime: query.mime }),
          // Mine-only without the grant, the `exports.manage` precedent. An
          // explicit `uploadedBy` is honoured only for someone who may see
          // other people's files at all.
          uploadedBy: manage ? query.uploadedBy : userId,
          limit: query.limit,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        });

        // A caller with `files.manage` sees everything; anyone else additionally
        // passes the per-file read rule, so a table grant they lack cannot leak
        // a row through a record filter.
        const visible = manage
          ? page.rows
          : (await Promise.all(page.rows.map(async (row) => ((await canRead(request, row)) ? row : null)))).filter(
              (row): row is StoredFile => row !== null,
            );

        return { data: visible.map(toView), nextCursor: page.nextCursor };
      },
    );

    app.get(
      '/files/usage',
      { schema: { response: { 200: filesUsageReply } } },
      async (request) => {
        // Either grant: an operator tidying files and an operator sizing a
        // bucket both need this, and it discloses no file's identity.
        if (!(await request.can(FILES_MANAGE_PERMISSION)) && !(await request.can('system:storage:manage'))) {
          throw new ForbiddenError('You do not have the required permission.', 'FORBIDDEN', {
            permission: FILES_MANAGE_PERMISSION,
          });
        }
        const [usage, rows] = await Promise.all([files.usageByDestination(), destinations.list()]);
        const byId = new Map(rows.map((row) => [row.id, row]));
        const seen = new Set(usage.map((entry) => entry.destinationId));

        const out = await Promise.all(
          usage.map(async (entry) => {
            const row = entry.destinationId === null ? null : byId.get(entry.destinationId);
            const driver = await storage.driverFor(entry.destinationId).catch(() => null);
            const available = driver?.usage === undefined ? undefined : (await driver.usage()).available;
            return {
              destinationId: entry.destinationId,
              name: row?.name ?? "This server's disk",
              driver: row?.driver ?? 'local',
              files: entry.files,
              bytes: entry.bytes,
              ...(available === undefined ? {} : { available }),
            };
          }),
        );

        // A configured destination holding nothing still belongs in the strip —
        // "0 files" is the answer an operator who just added one is looking for.
        for (const row of rows) {
          if (seen.has(row.id)) continue;
          out.push({ destinationId: row.id, name: row.name, driver: row.driver, files: 0, bytes: 0 });
        }
        if (!seen.has(null)) {
          const driver = await storage.driverFor(null);
          const available = driver.usage === undefined ? undefined : (await driver.usage()).available;
          out.unshift({
            destinationId: null,
            name: "This server's disk",
            driver: 'local',
            files: 0,
            bytes: 0,
            ...(available === undefined ? {} : { available }),
          });
        }
        return { data: out };
      },
    );

    app.get(
      '/files/:id',
      { schema: { params: fileIdParams, response: { 200: filesGetReply } } },
      async (request) => {
        const file = await load(request.params.id);
        if (!(await canRead(request, file))) throw new NotFoundError(`File ${request.params.id} not found.`);
        return { data: toView(file) };
      },
    );

    app.post(
      '/files/resolve',
      {
        config: { audit: auditExempt('read-only batch lookup; it changes nothing') },
        schema: { body: filesResolveBody, response: { 200: filesResolveReply } },
      },
      async (request) => {
        requireUserId(request);
        const bases = (await destinations.list())
          .filter((row) => !row.disabled)
          .map((row) => ({
            id: row.id,
            publicBaseUrl: 'publicBaseUrl' in row.config ? row.config.publicBaseUrl : undefined,
          }));

        const out: Record<string, FileView | null> = {};
        for (const ref of request.body.refs) {
          const parsed = parseRef(ref, bases);
          if (parsed === null || parsed.kind === 'external') {
            // A foreign link is not ours to resolve and the grid renders it as
            // today's anchor.
            out[ref] = null;
            continue;
          }
          const file =
            parsed.kind === 'id' ? await files.findById(parsed.id) : await files.findByStorageKey(parsed.key);
          // Unreadable and absent are deliberately indistinguishable here —
          // "this exists but you cannot see it" is a disclosure a grid has no
          // use for.
          out[ref] =
            file === null || file.deletedAt !== null || !(await canRead(request, file)) ? null : toView(file);
        }
        return { data: out };
      },
    );

    app.get(
      '/files/:id/content',
      { schema: { params: fileIdParams, querystring: filesContentQuery } },
      async (request, reply) => {
      const file = await load(request.params.id);
      // Trashed bytes 404 (D12): the row is still addressable so it can be
      // restored, but its content is gone as far as every reader is concerned.
      if (file.deletedAt !== null) throw new NotFoundError(`File ${request.params.id} not found.`);
      if (!(await canRead(request, file))) throw new NotFoundError(`File ${request.params.id} not found.`);

      // sha256 is the content's identity — a free, exact ETag, the same
      // reasoning `GET /branding/logo` already uses.
      const etag = `"${file.sha256}"`;
      if (request.headers['if-none-match'] === etag) return reply.status(304).send();

      // SVG is NEVER inline, whatever is asked (D9): it is a document that can
      // carry script, and same-origin inline SVG is a stored-XSS primitive.
      const inline =
        request.query.inline === true && file.mime !== 'image/svg+xml' && INLINE_SAFE.has(file.mime);
      const range = parseRange(request.headers.range, file.sizeBytes);

      let opened;
      try {
        opened = await storage.open(file, range === null ? undefined : range);
      } catch (error) {
        if (error instanceof FileNotFoundError) {
          throw new NotFoundError('The stored bytes for this file are no longer available.');
        }
        throw error;
      }

      reply
        .header('content-type', file.mime)
        .header('content-length', String(opened.sizeBytes))
        .header('content-disposition', contentDisposition(inline ? 'inline' : 'attachment', file.filename))
        .header('x-content-type-options', 'nosniff')
        .header('etag', etag)
        .header('accept-ranges', 'bytes')
        // Private and revalidated: a file's bytes never change under its id, but
        // a grant can be revoked, and a shared cache must not hold somebody
        // else's invoice.
        .header('cache-control', 'private, max-age=0, must-revalidate');

      // An inline response renders in the user's origin, so it is sandboxed
      // even though the allowlist already excludes SVG and HTML — defence in
      // depth for the day a type is added to INLINE_SAFE without this thought.
      if (inline) reply.header('content-security-policy', 'sandbox');
      if (opened.contentRange !== undefined) {
        reply.status(206).header('content-range', opened.contentRange);
      }
      return reply.send(opened.stream);
      },
    );

    app.post(
      '/files/:id/attach',
      {
        config: { audit: audited('rbac') },
        schema: { params: fileIdParams, body: filesAttachBody, response: { 200: filesGetReply } },
      },
      async (request) => {
        requireUserId(request);
        const file = await load(request.params.id);
        const { connectionId, table, recordId } = request.body;
        const permission = `table:${connectionId}:${table}:update`;
        if (!(await request.can(permission))) {
          throw new ForbiddenError(`You need update on ${table} to attach a file to it.`, 'FORBIDDEN', { permission });
        }
        // The file must already be one the caller could act on — otherwise
        // attaching would be a way to adopt somebody else's upload.
        if (!(await canWrite(request, file))) throw new NotFoundError(`File ${request.params.id} not found.`);

        const attached = await files.attach(file.id, {
          connectionId,
          table,
          pk: { id: recordId },
          label: recordId,
        });
        if (attached === null) throw new NotFoundError(`File ${request.params.id} not found.`);
        publishAttachmentsChanged(attached);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'file.attach',
          connectionId,
          changes: { after: { fileId: file.id, table, recordId } },
        });
        return { data: toView(attached) };
      },
    );

    app.post(
      '/files/:id/detach',
      {
        config: { audit: audited('rbac') },
        schema: { params: fileIdParams, response: { 200: filesGetReply } },
      },
      async (request) => {
        requireUserId(request);
        const file = await load(request.params.id);
        if (!(await canWrite(request, file))) throw new NotFoundError(`File ${request.params.id} not found.`);
        const detached = await files.detach(file.id);
        if (detached === null) throw new NotFoundError(`File ${request.params.id} not found.`);
        // The PRE-image: detach clears the entity columns, so `detached`
        // no longer knows which record's panel just lost a row.
        publishAttachmentsChanged(file);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'file.detach',
          ...(file.entityConnectionId === null ? {} : { connectionId: file.entityConnectionId }),
          changes: { before: { fileId: file.id, table: file.entityTable, recordId: file.entityId } },
        });
        return { data: toView(detached) };
      },
    );

    app.patch(
      '/files/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: fileIdParams, body: filesPatchBody, response: { 200: filesGetReply } },
      },
      async (request) => {
        requireUserId(request);
        const file = await load(request.params.id);
        if (!(await canWrite(request, file))) throw new NotFoundError(`File ${request.params.id} not found.`);
        // The DISPLAY name only. The storage key is untouched — renaming an
        // object in a bucket would break every `key`-shaped reference already
        // written into a customer's column.
        const renamed = await files.rename(file.id, request.body.filename);
        if (renamed === null) throw new NotFoundError(`File ${request.params.id} not found.`);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'file.rename',
          changes: { before: { filename: file.filename }, after: { filename: request.body.filename } },
        });
        return { data: toView(renamed) };
      },
    );

    app.delete(
      '/files/:id',
      {
        config: { audit: audited('rbac') },
        schema: { params: fileIdParams, response: { 200: filesGetReply } },
      },
      async (request) => {
        requireUserId(request);
        const file = await load(request.params.id);
        if (!(await canWrite(request, file))) throw new NotFoundError(`File ${request.params.id} not found.`);
        // TRASH, never delete (D12). A file referenced from a customer's own
        // column cannot be proven unreferenced, so hard-delete is only ever the
        // retention purge.
        await files.markDeleted(file.id, app.rbac.now());
        const trashed = await files.findById(file.id);
        publishAttachmentsChanged(file);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'file.delete',
          changes: { before: { fileId: file.id, filename: file.filename } },
        });
        return { data: toView(trashed ?? file) };
      },
    );

    app.post(
      '/files/:id/restore',
      {
        config: { audit: audited('rbac') },
        schema: { params: fileIdParams, response: { 200: filesGetReply } },
      },
      async (request) => {
        requireUserId(request);
        const file = await load(request.params.id);
        if (!(await canWrite(request, file))) throw new NotFoundError(`File ${request.params.id} not found.`);
        // Undo needs no token machinery: the row is still there and still
        // addressable, which is the whole point of trashing rather than deleting.
        const restored = await files.restore(file.id);
        if (restored === null) throw new NotFoundError(`File ${request.params.id} not found.`);
        publishAttachmentsChanged(restored);
        await app.rbac.audit(request, {
          category: 'data',
          action: 'file.restore',
          changes: { after: { fileId: file.id, filename: file.filename } },
        });
        return { data: toView(restored) };
      },
    );
  };
}

/**
 * The request's own origin. There is no `ADMINIUM_BASE_URL` (`security/csrf.ts`
 * says so), so a `url`-shaped reference names the instance the upload actually
 * went through — which is right, and is why D20's caveat is about PUBLIC
 * destinations rather than about this.
 */
function originOf(request: FastifyRequest): string {
  const proto = request.protocol;
  const host = request.headers.host ?? request.hostname;
  return `${proto}://${host}`;
}
