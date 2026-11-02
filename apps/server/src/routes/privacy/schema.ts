// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The privacy routes' bodies and replies (`routes/privacy/index.ts`).
 */
import { WEBSITES_MAX } from '@adminium/add-on-contracts/forms/websites';
import { KEPT_BY_LAW_REASONS } from '@adminium/manifest';
import { PRIVACY_EXPORT_STATUSES } from '@adminium/meta';
import { z } from 'zod';

import { REACHABILITY_STATES } from '../../payments/reachability.js';
import { SOURCE_KINDS } from '../../privacy/sources.js';

/** An address as typed into the search; checked as an address by the route. */
const addressField = z.string().trim().min(3).max(320);

export const privacyAddressBody = z.object({ address: addressField });

/** Each field is cleared by null or an empty text; the route checks what is left (an address must be https). */
export const privacyNoticeBody = z.object({
  businessName: z.string().trim().max(120).nullable(),
  noticeUrl: z.string().trim().max(500).nullable(),
});

export const privacyNoticeReply = z.object({
  data: z.object({
    businessName: z.string().nullable(),
    noticeUrl: z.string().nullable(),
    /** Both are set: new public forms and chat may open. */
    ready: z.boolean(),
    /** The name every page a stranger sees uses now (the pay page's, then this, then the workspace's). */
    shownName: z.string(),
  }),
});

export const publicNoticeReply = z.object({
  data: z.object({
    /** The name every page a stranger sees uses. */
    businessName: z.string(),
    noticeUrl: z.string().nullable(),
  }),
});

export const postalAddressBody = z.object({ postalAddress: z.string().trim().max(300).nullable() });
export const postalAddressReply = z.object({ data: z.object({ postalAddress: z.string().nullable() }) });

const sourceView = z.object({
  id: z.string(),
  kind: z.enum(SOURCE_KINDS),
  group: z.enum(['gave', 'agreed', 'held']),
  connectionId: z.string().nullable(),
  table: z.string().nullable(),
  app: z.string().nullable(),
  ref: z.string().nullable(),
  label: z.string().nullable(),
  keptByLaw: z.enum(KEPT_BY_LAW_REASONS).nullable(),
  count: z.number(),
  /** The rows' keys (record keys for an app table; ids for Adminium's own stores), at most 2,000. */
  keys: z.array(z.string()),
});

export const privacyFindReply = z.object({
  data: z.object({
    address: z.string(),
    found: z.boolean(),
    person: z.object({ name: z.string().nullable(), company: z.string().nullable() }).nullable(),
    sources: z.array(sourceView),
  }),
});

/** One thing an erasure leaves, and why (`privacy/what-stays.ts`). */
const staysItem = z.object({
  kind: z.enum(['app-rows', 'documents', 'invoices', 'payments', 'payment-events', 'automation-runs', 'notifications', 'campaign-failures', 'exports', 'do-not-email']),
  reason: z.enum([...KEPT_BY_LAW_REASONS, 'issued-document', 'payment-records', 'kept-a-while', 'objection']),
  count: z.number().nullable(),
  keptDays: z.number().nullable(),
  forever: z.boolean(),
  connectionId: z.string().optional(),
  table: z.string().optional(),
  app: z.string().optional(),
  label: z.string().optional(),
});

export const whatStaysReply = z.object({ data: z.object({ items: z.array(staysItem) }) });

/** The erasure, confirmed by the address typed again (any case, spaces around it or not). */
export const eraseBody = z.object({ address: addressField, confirm: addressField });

/** A column of theirs that cannot be emptied (not null, and neither text nor yes/no): left as it is. */
const leftColumn = z.object({ connectionId: z.string(), table: z.string(), column: z.string(), rows: z.number() });

export const erasePreviewReply = z.object({
  data: z.object({
    address: z.string(),
    found: z.boolean(),
    /** What goes: their rows, copies of them, their mail, consent entries, campaign sends, files on their rows. */
    goes: z.array(
      z.object({
        kind: z.enum(['people', 'copy', 'outbox', 'consent', 'campaign-mail', 'files', 'form-answers', 'form-invitations', 'form-files']),
        count: z.number(),
        connectionId: z.string().optional(),
        table: z.string().optional(),
        app: z.string().optional(),
        label: z.string().optional(),
      }),
    ),
    stays: z.array(staysItem),
    left: z.array(leftColumn),
  }),
});

export const eraseReply = z.object({
  data: z.object({
    /** Rows or entries changed, by source (`people-crm-contacts`, `consent`, `audit`, …). */
    counts: z.record(z.string(), z.number()),
    left: z.array(leftColumn),
    /** Files whose bytes could not be deleted. */
    filesFailed: z.number(),
  }),
});

export const keepingReply = z.object({
  data: z.object({
    rows: z.array(
      z.object({
        key: z.string(),
        fixed: z.boolean(),
        keptFor: z.union([z.literal('forever'), z.literal('until-erased'), z.literal('until-removed'), z.number()]),
        options: z.array(z.number()),
        /** A row an add-on keeps (its form answers): the add-on, whose own settings say how long. */
        addOn: z.object({ key: z.string(), name: z.string() }).optional(),
      }),
    ),
  }),
});

const exportView = z.object({
  id: z.string(),
  status: z.enum(PRIVACY_EXPORT_STATUSES),
  counts: z.record(z.string(), z.number()).nullable(),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
  expiresAt: z.number().nullable(),
});

export const privacyExportCreateReply = z.object({ data: exportView.extend({ jobId: z.string() }) });
export const privacyExportReply = z.object({ data: exportView });
export const privacyExportListReply = z.object({ data: z.array(exportView) });
export const privacyExportParams = z.object({ id: z.string().min(1).max(64) });

// ── "Your websites" and the reach card ───────────────────────────────────────

/** One listed website, with the name of who listed it (null once they are gone). */
const websiteView = z.object({
  origin: z.string(),
  addedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  addedAt: z.number(),
});

export const websitesReply = z.object({
  data: z.object({
    websites: z.array(websiteView),
    /** The most the list holds. */
    max: z.number(),
  }),
});

/** Several lines at once, all or none. A line too long for any address is refused by its check, not here. */
export const websitesAddBody = z.object({ lines: z.array(z.string().max(2_000)).min(1).max(WEBSITES_MAX) });

export const websiteRemoveBody = z.object({ origin: z.string().min(1).max(300) });

export const reachReply = z.object({
  data: z.object({
    state: z.enum(REACHABILITY_STATES),
    /** This server's public address, as the answer read it; null when none is set. */
    origin: z.string().nullable(),
    /** When the facts were read (ms). */
    checkedAt: z.number(),
  }),
});
