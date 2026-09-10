// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/documents` wire shapes (34-invoices-add-on.md §7.5; 34-T12).
 *
 * ─── `subject` IS NULLABLE IN THE REPLY, AND THAT IS THE REDACTION ─────────
 *
 * A document's subject is a frozen copy of somebody's data — a customer, an
 * address, what they bought and what it cost. Whether a caller may read it
 * depends on grants over the tables the profile MAPPED, which can be more than
 * the one the record page is showing. So the list and get replies carry
 * `redacted: boolean` and a nullable `subject`, and a caller who may not read
 * every mapped table gets the row WITHOUT it.
 *
 * The row itself is still returned. "Three invoices were issued for this order
 * and you may not read them" is useful and true; hiding their existence would
 * make the record page lie about what happened.
 */

import { z } from 'zod';

export const documentIdParams = z.object({ id: z.string().min(1).max(36) }).strict();

/** A `RecordRef` as a query string: `<connectionId>|<table>|<pkJson>`. */
export const documentsListQuery = z
  .object({
    /** Qualified source name — with `entityId`, "documents for this row". */
    entityTable: z.string().max(200).optional(),
    entityId: z.string().max(200).optional(),
    profileId: z.string().max(36).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export const documentReply = z.object({
  id: z.string(),
  profileId: z.string().nullable(),
  addOnKey: z.string(),
  kind: z.string(),
  connectionId: z.string().nullable(),
  entityTable: z.string().nullable(),
  entityId: z.string().nullable(),
  /** Null when the caller may not read every mapped table — see the header. */
  subject: z.unknown().nullable(),
  number: z.string().nullable(),
  locale: z.string(),
  format: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  delivery: z.string().nullable(),
  renderedAt: z.number().nullable(),
  voidedAt: z.number().nullable(),
  voidReason: z.string().nullable(),
  createdAt: z.number(),
  /** True when this read withheld `subject`, `entity` and `claim`. */
  redacted: z.boolean(),
  /** Whether bytes exist to download. */
  hasContent: z.boolean(),
});

export const documentsListReply = z.object({ documents: z.array(documentReply) });

/**
 * What Studio's profile editor reads (D14).
 *
 * The outline comes from the PROVIDER's own `describe(kind)` — labels in all
 * eight locales, which is why the engine needs no bundle from an add-on.
 */
export const documentKindsReply = z.object({
  kinds: z.array(
    z.object({
      addOnKey: z.string(),
      kind: z.string(),
      label: z.record(z.string(), z.string()),
      formats: z.array(z.string()),
      paper: z.array(z.string()),
      coverage: z.string(),
      outline: z.object({ slots: z.array(z.unknown()) }),
    }),
  ),
});

/** What the record page and `PageCrud` read to show or hide Documents. */
export const documentProvidersReply = z.object({
  installed: z.boolean(),
  addOnKeys: z.array(z.string()),
});

export const documentRenderBody = z
  .object({
    profileId: z.string().min(1).max(36),
    /** The source row's primary key. */
    pk: z.record(z.string(), z.unknown()),
    locale: z.string().max(16).optional(),
  })
  .strict();

export const documentRenderReply = z.object({ jobId: z.string() });

export const documentVoidBody = z
  .object({ reason: z.string().min(1).max(40).default('operator') })
  .strict();

export const documentSendReply = z.object({ delivery: z.string() });

// --- profiles ---------------------------------------------------------------

export const documentProfileReply = z.object({
  id: z.string(),
  addOnKey: z.string(),
  kind: z.string(),
  name: z.string(),
  connectionId: z.string(),
  table: z.string(),
  mapping: z.record(z.string(), z.unknown()),
  options: z.record(z.string(), z.unknown()),
  trigger: z.unknown().nullable(),
  deliver: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const documentProfilesListQuery = z
  .object({ connectionId: z.string().max(36).optional(), addOnKey: z.string().max(80).optional() })
  .strict();

export const documentProfilesListReply = z.object({
  profiles: z.array(documentProfileReply),
});

export const documentProfileCreateBody = z
  .object({
    addOnKey: z.string().min(1).max(80),
    kind: z.string().min(1).max(40),
    name: z.string().min(1).max(120),
    connectionId: z.string().min(1).max(36),
    table: z.string().min(1).max(200),
    mapping: z.record(z.string(), z.unknown()),
    options: z.record(z.string(), z.unknown()).optional(),
    trigger: z
      .object({
        event: z.enum(['record.created', 'record.updated', 'record.deleted']),
        when: z
          .object({ column: z.string().max(128), op: z.string().max(20), value: z.unknown() })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    deliver: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const documentProfilePatchBody = documentProfileCreateBody
  .partial()
  .omit({ addOnKey: true, kind: true, connectionId: true, table: true })
  .strict();
