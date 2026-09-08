// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the files resource (37-files-and-storage.md Appendix C,
 * 37-T11).
 *
 * The upload's metadata rides the QUERY STRING, not a JSON body, because the
 * body IS the file (D5). That is the same shape `POST /imports/upload` and
 * `POST /branding/logo` already use — the three raw-body precedents this route
 * joins rather than reinventing with `@fastify/multipart`.
 */

import { z } from 'zod';
import { fileKindSchema } from '@adminium/meta';

import { SNIFF_TYPE_KEYS } from '../../files/sniff.js';

/** A file id, or the `local` sentinel for this server's disk (D3). */
export const destinationIdOrLocal = z.string().min(1).max(64);

export const fileIdParams = z.object({ id: z.string().min(1) });

/**
 * The upload's query. `filename` is REQUIRED and is the human name — the
 * storage key is minted by the driver and never taken from the client (§3.12,
 * "no user-controlled paths").
 */
export const filesUploadQuery = z.object({
  filename: z.string().min(1).max(260),
  destinationId: destinationIdOrLocal.optional(),
  /**
   * What this upload belongs to.
   *
   * `connectionId` is REQUIRED — a file always belongs to a connection (38 D4,
   * which reverses 37 D11's "always a table"). `table` is what the grant is
   * checked against when present, and `recordId` additionally attaches on
   * upload; without a record id the row is an unattached upload — the
   * create-form flow, where the record does not exist yet.
   *
   * With NO table this is a library upload: authorised by `files.manage`,
   * stamped `attached_at` at creation so the unattached sweep leaves it, and
   * belonging to the connection rather than to any row.
   *
   * Still optional on the wire so an older client's request fails in the
   * handler with a sentence rather than in the parser with a field name.
   */
  connectionId: z.string().min(1).optional(),
  table: z.string().min(1).max(400).optional(),
  /** The canonical record-id string (`pkLabel` form), when the record exists. */
  recordId: z.string().min(1).max(400).optional(),
  /** The column whose `file` block narrows the allowlist and picks the ref shape. */
  column: z.string().min(1).max(200).optional(),
});
export type FilesUploadQuery = z.infer<typeof filesUploadQuery>;

/** What every file-shaped reply carries. Never the storage key of a remote object. */
export const fileView = z.object({
  id: z.string(),
  filename: z.string(),
  mime: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  kind: fileKindSchema,
  /** `null` = this server's disk (D3). */
  destinationId: z.string().nullable(),
  uploadedBy: z.string().nullable(),
  createdAt: z.number(),
  attachedAt: z.number().nullable(),
  deletedAt: z.number().nullable(),
  /**
   * The connection this file belongs to — ALWAYS present after 38 D4, whether
   * or not a record claims it. `entity` is the stronger fact and carries the
   * same connection; this is what a library file has instead.
   */
  connectionId: z.string().nullable(),
  entity: z
    .object({ connectionId: z.string(), table: z.string(), recordId: z.string() })
    .nullable(),
  /** Same-origin content path — what a chip links to and a thumbnail renders. */
  contentPath: z.string(),
});
export type FileView = z.infer<typeof fileView>;

export const filesUploadReply = z.object({
  data: fileView,
  /**
   * The value to write into the user's column, in the shape that column is
   * configured for (D7/D31). Absent when the upload named no column.
   */
  ref: z.string().optional(),
});

export const filesGetReply = z.object({ data: fileView });

export const filesListQuery = z.object({
  q: z.string().max(200).optional(),
  kind: fileKindSchema.optional(),
  /** `live` (default) · `trash` · `unattached` — the Files page's presets. */
  state: z.enum(['live', 'trash', 'unattached']).default('live'),
  connectionId: z.string().min(1).optional(),
  table: z.string().min(1).max(400).optional(),
  recordId: z.string().min(1).max(400).optional(),
  destinationId: destinationIdOrLocal.optional(),
  uploadedBy: z.string().min(1).optional(),
  mime: z.string().min(1).max(200).optional(),
  /**
   * Uploaded at or after this epoch-ms instant — the Files page's **Recent**
   * preset (38 D9).
   *
   * A server query, not a client-side slice of the first page: "recent" over
   * rows already fetched answers "which of these fifty are recent", which is
   * not the question. Deliberately about UPLOAD time and not about last
   * access — nothing tracks reads, and inventing a per-user "last opened"
   * would be a second write on every download.
   */
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});
export type FilesListQuery = z.infer<typeof filesListQuery>;

export const filesListReply = z.object({
  data: z.array(fileView),
  nextCursor: z.string().nullable(),
});

/**
 * Batch resolve, so a grid of 50 rows with a file column costs ONE request
 * rather than 50 (§3.5). A ref the caller may not read comes back `null`,
 * exactly like a ref that names nothing — the two are deliberately
 * indistinguishable, because saying "this exists but you cannot see it" is a
 * disclosure the grid has no use for.
 */
export const filesResolveBody = z.object({ refs: z.array(z.string().min(1).max(2048)).max(200) });
export const filesResolveReply = z.object({ data: z.record(z.string(), fileView.nullable()) });

export const filesAttachBody = z.object({
  connectionId: z.string().min(1),
  table: z.string().min(1).max(400),
  recordId: z.string().min(1).max(400),
});

export const filesPatchBody = z.object({ filename: z.string().min(1).max(260) });

export const filesContentQuery = z.object({
  /** Honoured only for kinds a browser can display safely; SVG never (D9). */
  inline: z.coerce.boolean().optional(),
});

export const filesUsageReply = z.object({
  data: z.array(
    z.object({
      /** `null` = this server's disk. */
      destinationId: z.string().nullable(),
      name: z.string(),
      driver: z.string(),
      files: z.number(),
      bytes: z.number(),
      /** Local destinations only — remote drivers cannot know (D23). */
      available: z.number().optional(),
    }),
  ),
});

/** The allowlist vocabulary, re-exported so route and settings agree. */
export const sniffTypeKeySchema = z.enum(SNIFF_TYPE_KEYS);
