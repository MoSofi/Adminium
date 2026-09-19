// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `/api/v1/assistant/*`.
 *
 * SYNC NOTE: the client-side mirror of these shapes is
 * `apps/dashboard/src/assistant/api.ts` (a type-only copy — the dashboard may
 * not import server runtime code). Change both together. The replies are
 * un-enveloped, the email/invoice/report clients' style.
 *
 * WHY THE JSON COLUMNS ARE PARSED AND NOT CAST HERE. `steps`, `ask`, `result`
 * and `error` are stored documents: a row written by a newer server, or by a
 * shape that has since moved on, is exactly what a reply has to survive. The
 * response is validated on the way out, so a cast that turned out to be wrong
 * would 500 the one route that explains a failure — which is why the detail
 * reply below is permissive about what those fields hold and the route parses
 * before it answers.
 */
import { assistantContextSchema, assistantTurnStatusSchema } from '@adminium/meta';
import { z } from 'zod';

/** The page a session was opened from, and what it was showing. */
export const assistantHostBody = z.object({
  documentId: z.string().max(64).optional(),
  tab: z.string().max(40).optional(),
  connectionIds: z.array(z.string().max(64)).max(20).default([]),
});

export const assistantAvailabilityQuery = z.object({
  context: assistantContextSchema.optional(),
});

/**
 * Why the modal cannot work, when it cannot. `forbidden` never reaches a
 * client that got this far — the route guard answers first — but it is in the
 * vocabulary because the modal renders the same bar for it.
 */
export const assistantUnavailableReason = z.enum(['no-provider', 'network-disabled', 'forbidden']);

export const assistantAvailabilityReply = z.object({
  enabled: z.boolean(),
  reason: assistantUnavailableReason.nullable(),
  /** What the assistant is called here. */
  name: z.string(),
  /** Whether its tools may read rows at all. */
  rowData: z.boolean(),
  /** Whether this session may save what it drafts. */
  canWrite: z.boolean(),
  /** Whether it may reach Settings → AI, which is what the unavailable bar links to. */
  canConfigure: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
});

export const assistantSessionView = z.object({
  id: z.string(),
  context: assistantContextSchema,
  status: z.enum(['open', 'closed']),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  createdAt: z.number(),
});

/** What the modal's header and read-only bar draw, computed per page. */
export const assistantFactsView = z.object({
  /**
   * The named facts the page's own sentence interpolates — numbers and names,
   * never a sentence. A sentence composed here would be English on the wire,
   * and no locale can translate that.
   */
  values: z.object({
    templates: z.number().optional(),
    campaigns: z.number().optional(),
    invoices: z.number().optional(),
    reports: z.number().optional(),
    tables: z.number().optional(),
    connection: z.string().optional(),
    pattern: z.string().optional(),
    write: z.boolean().optional(),
  }),
  scope: z.object({ primary: z.string(), extra: z.number() }),
});

export const assistantSessionCreateBody = z.object({
  context: assistantContextSchema,
  host: assistantHostBody,
  /** The editor page's on-screen, unsaved document. */
  draft: z.record(z.string(), z.unknown()).optional(),
});

export const assistantSessionCreateReply = z.object({
  session: assistantSessionView,
  facts: assistantFactsView,
  /** The server's estimate of what the next request will cost. */
  nextTurnTokens: z.number(),
});

/** One step row as the modal draws it. Open-ish on purpose — see the header. */
export const assistantStepView = z.object({
  id: z.string(),
  state: z.string(),
  icon: z.string(),
  label: z.string(),
  detail: z.string(),
  tables: z.array(z.string()),
  /**
   * The page-read step's named facts. It is the one step the server writes
   * itself, and it carries no sentence: the numbers travel, and the dashboard
   * words them in the operator's language. Dropping this key here would leave
   * a blank row on every reloaded turn.
   */
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const assistantTurnView = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number(),
  status: assistantTurnStatusSchema,
  jobId: z.string().nullable(),
  askText: z.string().nullable(),
  say: z.string().nullable(),
  steps: z.array(assistantStepView),
  ask: z.record(z.string(), z.unknown()).nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type AssistantTurnView = z.infer<typeof assistantTurnView>;

export const assistantTurnCreateBody = z
  .object({
    text: z.string().min(1).max(4000).optional(),
    /** The answer to the previous turn's question: one option key per group. */
    picks: z.record(z.string().max(24), z.string().max(24)).optional(),
  })
  .refine((body) => body.text !== undefined || body.picks !== undefined, {
    message: 'A turn needs either text or picks.',
  });

export const assistantTurnCreateReply = z.object({
  turn: assistantTurnView,
  jobId: z.string(),
  nextTurnTokens: z.number(),
});

export const assistantSessionParams = z.object({ id: z.string().min(1).max(36) });
export const assistantTurnParams = z.object({
  id: z.string().min(1).max(36),
  turnId: z.string().min(1).max(36),
});

export const assistantActionBody = z.object({
  action: z.enum(['save', 'test-send', 'sample', 'language.add']),
  /** `save` only: create the row and open it in the editor. */
  open: z.boolean().optional(),
  name: z.string().min(1).max(120).optional(),
  /** `language.add` only. */
  locale: z.string().min(2).max(10).optional(),
});

export const assistantActionReply = z.object({
  echo: z.record(z.string(), z.unknown()),
  created: z.object({ id: z.string(), kind: z.string(), name: z.string() }).nullable(),
  sample: z
    .object({ artefact: z.record(z.string(), z.unknown()), label: z.string() })
    .nullable(),
});
