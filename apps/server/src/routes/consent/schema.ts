// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The consent routes' bodies and replies (`routes/consent/index.ts`).
 */
import { z } from 'zod';

import { CONSENT_HOWS, CONSENT_PURPOSES, CONSENT_SOURCES, STOP_REASONS } from '../../consent/types.js';

/** At most this many addresses in one "Add addresses". */
export const STOP_ADD_MAX = 500;

export const stopListQuery = z.object({
  q: z.string().trim().max(254).optional(),
  reason: z.enum(STOP_REASONS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

const staffView = z.object({ id: z.string(), label: z.string() });

export const stopEntryView = z.object({
  id: z.string(),
  /** Null once its person was erased: the entry keeps the hash alone. */
  address: z.string().nullable(),
  reason: z.enum(STOP_REASONS),
  origin: z.string().nullable(),
  addedAt: z.number(),
  addedBy: staffView.nullable(),
  erasedAt: z.number().nullable(),
  /** Whether this reader may take it off the list (never an erased person's). */
  mayRemove: z.boolean(),
});

export const stopListReply = z.object({
  data: z.object({ entries: z.array(stopEntryView), next: z.string().nullable(), total: z.number() }),
});

export const stopAddBody = z.object({
  addresses: z.array(z.string().max(320)).min(1).max(STOP_ADD_MAX),
});

export const stopAddReply = z.object({
  data: z.object({
    added: z.number(),
    /** On the list already: left as they were. */
    already: z.number(),
    /** Lines that are no address, as typed. */
    invalid: z.array(z.string()),
  }),
});

export const stopIdParams = z.object({ id: z.string().min(1).max(64) });
export const stopRemoveReply = z.object({ data: z.object({ removed: z.literal(true) }) });

/** One record of a table, as the record page names it. */
export const recordRef = z.object({
  connectionId: z.string().min(1).max(64),
  table: z.string().min(1).max(255),
  recordId: z.string().min(1).max(200),
});

export const recordConsentBody = recordRef.extend({
  purpose: z.enum(CONSENT_PURPOSES),
  how: z.enum(CONSENT_HOWS),
  note: z.string().trim().max(1000).nullable().default(null),
});

const eventView = z.object({
  id: z.string(),
  purpose: z.enum(CONSENT_PURPOSES).nullable(),
  state: z.enum(['yes', 'no', 'replied']),
  source: z.enum(CONSENT_SOURCES),
  detail: z.string().nullable(),
  how: z.enum(CONSENT_HOWS).nullable(),
  note: z.string().nullable(),
  staff: staffView.nullable(),
  wordingVersion: z.string().nullable(),
  /** A public sign-up's network address: only for a reader who sees the table's personal columns. */
  ip: z.string().nullable(),
  at: z.number(),
  confirmedAt: z.number().nullable(),
});

export const panelReply = z.object({
  data: z.object({
    /** Whether an installed app declares the table as people: the record page shows the panel only then. */
    declared: z.boolean(),
    /** The row is an erased person's: nothing is known of them, and nothing more is recorded. */
    erased: z.boolean(),
    /** The columns that hold the record's address and name, by name only (never their values). */
    columns: z.object({ address: z.string().nullable(), name: z.string().nullable() }),
    /** Whether the record's address was found (a table with one e-mail column); without it, only the row's own events count. */
    addressKnown: z.boolean(),
    purposes: z.array(z.object({ purpose: z.enum(CONSENT_PURPOSES), state: z.enum(['yes', 'no', 'not-asked']), event: eventView.nullable() })),
    /** On the do-not-email list: since when, and why. */
    stopped: z.object({ since: z.number(), reason: z.enum(STOP_REASONS), origin: z.string().nullable() }).nullable(),
    lastReplied: z.number().nullable(),
    history: z.array(eventView),
    /** May record consent, press "Replied" and "They said no": a change of this row (its update grant and reach). */
    mayChange: z.boolean(),
  }),
});

export const recordConsentReply = z.object({ data: z.object({ event: eventView }) });

/** "They said no": the record's address put on the do-not-email list. */
export const saidNoReply = z.object({
  data: z.object({
    /** False when the address was on the list already (the entry as it was). */
    added: z.boolean(),
    stopped: z.object({ since: z.number(), reason: z.enum(STOP_REASONS), origin: z.string().nullable() }),
  }),
});

export type EventView = z.infer<typeof eventView>;
