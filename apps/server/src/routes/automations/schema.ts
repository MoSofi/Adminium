// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The wire shapes for `/automations` and `/automation-runs`
 * (42-automations-and-workflow-logs.md §3.1).
 *
 * The STORED shapes live in `@adminium/meta`'s `json-payloads.ts` and are
 * reused verbatim for the bodies — a rule the API accepts and a rule the
 * store holds are the same document, and re-declaring it here is how the two
 * drift. What is declared here is everything the wire adds: the computed
 * `stats` a card draws, the `valid` flag the toggle reads, the source
 * catalogue every select is built from, and the run views Workflow Logs
 * renders.
 */

import { z } from 'zod';
import {
  automationGraphSchema,
  automationTriggerSchema,
  automationRunStatusSchema,
  automationTraceSchema,
  automationTriggerEventSchema,
} from '@adminium/meta';

// --- rules ------------------------------------------------------------------

const ruleStatsSchema = z.object({
  /** Last 30 days (D22). */
  runs30d: z.number().int(),
  /** succeeded ÷ (succeeded + failed); null with no finished runs. */
  successRate30d: z.number().nullable(),
  lastRunAt: z.number().int().nullable(),
});

export const ruleViewSchema = z.object({
  id: z.string(),
  connectionId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  trigger: automationTriggerSchema,
  graph: automationGraphSchema,
  timeSavedMinutes: z.number().int().nullable(),
  nextRunAt: z.number().int().nullable(),
  /** Complete enough to switch on (D12). */
  valid: z.boolean(),
  /** The first step that is not finished; null when `valid`. */
  incompleteNodeId: z.string().nullable(),
  stats: ruleStatsSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type RuleView = z.infer<typeof ruleViewSchema>;

export const automationsListQuery = z.object({ connectionId: z.string().optional() });
export const automationsListReply = z.object({ rules: z.array(ruleViewSchema) });
export const automationIdParams = z.object({ id: z.string().min(1).max(36) });

export const automationCreateBody = z.object({
  name: z.string().min(1).max(120),
  connectionId: z.string().nullable(),
  trigger: automationTriggerSchema,
  graph: automationGraphSchema,
  enabled: z.boolean().default(false),
  timeSavedMinutes: z.number().int().min(0).max(10_000).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

export const automationPatchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  trigger: automationTriggerSchema.optional(),
  graph: automationGraphSchema.optional(),
  enabled: z.boolean().optional(),
  timeSavedMinutes: z.number().int().min(0).max(10_000).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

export const automationTestBody = z.object({
  /** The ON-SCREEN document, not the stored one (D14). */
  trigger: automationTriggerSchema,
  graph: automationGraphSchema,
  /** Defaults to the newest row of the trigger table. */
  sampleRecordId: z.string().max(400).optional(),
});

export const automationTestReply = z.object({
  trace: automationTraceSchema,
  sample: z
    .object({ table: z.string(), pk: z.record(z.string(), z.unknown()), label: z.string() })
    .nullable(),
});

// --- the source catalogue (every table/column select is built from this) ----

const sourceColumnSchema = z.object({
  name: z.string(),
  label: z.string(),
  logicalType: z.string(),
  isPk: z.boolean(),
  /** Masked or secret — a rule may read it but never write it. */
  pii: z.boolean(),
  /** The classifier read this as an address; the email step offers it first. */
  emailLike: z.boolean(),
  /** A relative-time operator is offered only on these. */
  dateLike: z.boolean(),
});

const sourceTableSchema = z.object({
  id: z.string(),
  label: z.string(),
  canRead: z.boolean(),
  canCreate: z.boolean(),
  canUpdate: z.boolean(),
  /** Which column the poller could watch, per event (D4); null = cannot. */
  watch: z.object({ created: z.string().nullable(), updated: z.string().nullable() }),
  columns: z.array(sourceColumnSchema),
  /**
   * Tables whose rows point AT this one, and the column that does it —
   * 34 §3.7 step 3's child-table picker, seeded from foreign keys.
   *
   * ONLY EDGES THE PIPELINE CAN ACTUALLY JOIN appear here. `readSource` reads
   * children with `where <fk> = row[<parent pk[0]>]`, so a composite foreign
   * key, or one pointing at a unique column that is not the first primary-key
   * column, cannot be expressed by the single `fkColumn` a mapping stores. The
   * filter lives here, on the side that has the whole relation, rather than in
   * an editor that would have to be told the pipeline's join rule to repeat it.
   *
   * `lineItems` carries the engine's own classification, which is a SUGGESTION
   * for ordering and never a selection: the rule needs two foreign keys plus
   * qty × rate numerics, so a one-FK child like `invoice_items` is not tagged
   * and still has to be pickable.
   */
  children: z.array(
    z.object({ table: z.string(), column: z.string(), lineItems: z.boolean() }),
  ),
  /** The record page a notification would link to, when one exists. */
  pageSlug: z.string().nullable(),
});

export const automationSourcesReply = z.object({
  connections: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      dialect: z.string(),
      timezone: z.string(),
      tables: z.array(sourceTableSchema),
    }),
  ),
  /** Live template keys for the email step's select. */
  templates: z.array(z.object({ key: z.string(), name: z.string() })),
  /** Roles a notification can address. */
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
});

// --- stats ------------------------------------------------------------------

export const automationStatsQuery = z.object({
  /** The VIEWER's IANA zone — "today" is theirs, not the server's (D22). */
  tz: z.string().max(64).optional(),
});

export const automationStatsReply = z.object({
  activeRules: z.number().int(),
  rulesCreated7d: z.number().int(),
  runsToday: z.number().int(),
  runsYesterday: z.number().int(),
  successToday: z.number().nullable(),
  successYesterday: z.number().nullable(),
  timeSavedMinutes30d: z.number().int(),
  timeSavedMinutesPrev30d: z.number().int(),
});

// --- runs -------------------------------------------------------------------

export const runRowSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  ruleName: z.string(),
  status: automationRunStatusSchema,
  origin: z.string(),
  trigger: z.string(),
  startedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  wakeAt: z.number().int().nullable(),
});

export const runViewSchema = runRowSchema.extend({
  trace: automationTraceSchema.nullable(),
  triggerEvent: automationTriggerEventSchema,
  error: z.string().nullable(),
});

export const automationRunsListQuery = z.object({
  /** The comp's three filters (D9): running = pending + running + waiting. */
  status: z.enum(['success', 'failed', 'running']).optional(),
  automationId: z.string().max(36).optional(),
  /** `<startedAt>:<id>` from the previous page's `cursor.next`. */
  cursor: z.string().max(80).optional(),
  tz: z.string().max(64).optional(),
});

export const automationRunsListReply = z.object({
  runs: z.array(runRowSchema),
  cursor: z.object({ next: z.string().nullable() }),
  counts: z.object({
    all: z.number().int(),
    success: z.number().int(),
    failed: z.number().int(),
    running: z.number().int(),
  }),
});

export const automationRunIdParams = z.object({ id: z.string().min(1).max(36) });
export const automationRunReply = z.object({ run: runViewSchema });

export const automationRunStatsReply = z.object({
  runsToday: z.number().int(),
  successRateToday: z.number().nullable(),
  failedToday: z.number().int(),
  avgDurationMsToday: z.number().int().nullable(),
});

export const automationDeleteReply = z.object({ deleted: z.literal(true) });
