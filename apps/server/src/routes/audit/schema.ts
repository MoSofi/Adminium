/**
 * Zod schemas for the audit resource (08-server-api.md §2.14). The API
 * returns structured rows — the verb + bold-resource sentence anatomy is a
 * client concern (`Audit Log.dc.html`).
 */
import { z } from 'zod';
import { actorKindSchema, auditCategorySchema } from '@adminium/meta';

export const auditEntryDto = z.object({
  id: z.string(),
  createdAt: z.number(),
  actorKind: actorKindSchema,
  actorId: z.string().nullable(),
  actorLabel: z.string(),
  category: auditCategorySchema,
  /** Dotted verb, e.g. `role.permission.change` (07 §3.11). */
  action: z.string(),
  connectionId: z.string().nullable(),
  entity: z.record(z.string(), z.unknown()).nullable(),
  changes: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditEntryDto = z.infer<typeof auditEntryDto>;

export const auditListQuery = z.object({
  actorId: z.string().optional(),
  category: auditCategorySchema.optional(),
  /** Resource-type filter matched against the dotted action verb prefix. */
  resource: z.string().max(80).optional(),
  /** Epoch-ms range bounds (inclusive `from`, inclusive `to`). */
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  /** Opaque keyset cursor from a previous reply. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditListQuery = z.infer<typeof auditListQuery>;

export const auditListReply = z.object({
  entries: z.array(auditEntryDto),
  /** Pass back as `cursor` for the next page; `null` on the last page. */
  nextCursor: z.string().nullable(),
});
export type AuditListReply = z.infer<typeof auditListReply>;

export const auditIdParams = z.object({ id: z.string() });

export const auditEntryReply = auditEntryDto;
