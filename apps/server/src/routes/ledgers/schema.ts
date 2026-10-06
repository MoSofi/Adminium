// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bodies and replies of the ledger-rule routes: an owner's posting on one of
 * their tables as it is stored, what a rule's page lists, and what the two
 * runs answer.
 */
import { storedPosting } from '@adminium/meta';
import { z } from 'zod';

const key = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/, 'an add-on or ledger id');
const name = z.string().min(1).max(200);

export const ledgerParams = z.object({ addOn: key, ledger: key });
export const ledgerQuery = z.object({ connectionId: z.string().min(1).max(64) });
export const postingParams = z.object({ id: z.string().min(1).max(64), table: name, posting: key });

/** An owner's posting: the stored rule without its id (the address names it), a feature (an app's word) or `via` (an owner's sheet draws none). */
export const postingBody = storedPosting.omit({ id: true, needs: true, via: true }).strict();
export type PostingBody = z.infer<typeof postingBody>;

/** A stored posting as a rule's page reads one. */
const postingShape = storedPosting.omit({ into: true }).extend({ action: z.string() });

export const postingsReply = z.object({
  postings: z.array(
    postingShape.extend({
      table: z.string(),
      tableLabel: z.string(),
      /** The app whose rule it is; null for one the owner drew. */
      owner: z.string().nullable(),
      enabled: z.boolean(),
      state: z.enum(['live', 'off', 'idle', 'unavailable']),
      /** Rows that hold something under the rule now. */
      holding: z.number().int(),
      /** Saves let through while the add-on could not be asked. */
      unplanned: z.number().int(),
    }),
  ),
  canChange: z.boolean(),
});

export const sourcesReply = z.object({
  tables: z.array(
    z.object({
      table: z.string(),
      label: z.string(),
      states: z.array(z.string()).optional(),
      columns: z.array(z.object({ name: z.string(), label: z.string(), type: z.string(), enum: z.array(z.string()).optional(), decided: z.boolean() })),
      lineOf: z.array(z.object({ table: z.string(), via: z.string() })).optional(),
    }),
  ),
  actions: z.record(z.string(), z.object({ inputs: z.record(z.string(), z.string()) })),
  settings: z.array(z.string()),
});

export const storedReply = storedPosting;
export const switchBody = z.object({ enabled: z.boolean() }).strict();
export const switchReply = z.object({ enabled: z.boolean() });

export const makeItemsBody = z
  .object({
    connectionId: z.string().min(1).max(64),
    table: name,
    /** The column that names each row. */
    label: name,
    limit: z.number().int().min(1).max(500).optional(),
    /** The key the last call stopped at: the next one starts after it. */
    after: z.string().max(400).optional(),
  })
  .strict();
export const makeItemsReply = z.object({
  made: z.number().int(),
  /** Rows the ledger had already. */
  skipped: z.number().int(),
  /** Rows that could not be taken, each with its reason (the first twenty: then the call answers). */
  refused: z.array(z.object({ row: z.string(), reason: z.string() })),
  more: z.boolean(),
  /** Where the next call starts (`after`), while there is more. */
  next: z.string().optional(),
});

export const catchUpBody = z
  .object({
    connectionId: z.string().min(1).max(64),
    limit: z.number().int().min(1).max(200).optional(),
    /** The receipt the last call stopped at: the next one starts after it, past whatever could not be worked out. */
    after: z.string().max(64).optional(),
  })
  .strict();
export const catchUpReply = z.object({ planned: z.number().int(), refused: z.array(z.object({ receipt: z.string(), reason: z.string() })), left: z.number().int(), next: z.string().optional() });
