// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of a person's data, found: what a source is, and what was found
 * in it (`sources.ts` finds them; `meta-sources.ts` finds Adminium's own).
 */
import type { KeptByLawReason } from '@adminium/manifest';

/** What a source is. */
export const SOURCE_KINDS = [
  'people',
  'copy',
  'outbox',
  'consent',
  'stop-list',
  'campaign-mail',
  'campaign-failures',
  'documents',
  'invoices',
  'payments',
  'payment-events',
  'automation-runs',
  'notifications',
  'files',
  // A forms add-on's answers given by the address, and the survey invitations sent to it.
  'form-answers',
  'form-invitations',
  // The files a form's answers came with (a file question).
  'form-files',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Where it is shown: what the person gave (their rows, copies of them,
 * files), what they agreed to or asked (consent, the do-not-email list), and
 * what the business keeps about them (mail sent, documents, payments, logs).
 */
export type SourceGroup = 'gave' | 'agreed' | 'held';

/** One place a person is kept, with what was found there. */
export interface FoundSource {
  /** Stable within one search, and safe as a file name: `people-crm-contacts`, `consent`. */
  id: string;
  kind: SourceKind;
  group: SourceGroup;
  /** An app table's: its database, snapshot id, app and the app's short name; its label. Null for Adminium's own stores. */
  connectionId: string | null;
  table: string | null;
  app: string | null;
  ref: string | null;
  label: string | null;
  /** The law keeps this table's rows (`keep: {law}`): an erasure leaves them. */
  keptByLaw: KeptByLawReason | null;
  count: number;
  /** The rows' keys (row keys as the record pages name them; ids for Adminium's stores), at most {@link ROWS_MAX}. */
  keys: string[];
  /** The rows as the download writes them (never sent by the find route). */
  rows: Record<string, unknown>[];
  /**
   * The rows as the download's CSV file writes them, when they differ from
   * the JSON's: a form's answers with each question a column of its own,
   * under its label. Absent: the CSV writes {@link rows}.
   */
  csvRows?: Record<string, unknown>[];
}

