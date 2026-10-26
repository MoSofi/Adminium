// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT STAYS after a person is erased, and why: the copies the law makes the
 * business keep, and the stores kept for a set time, each with how long.
 *
 * Read from what the search found (`sources.ts`), with a fixed reason per kind:
 *
 *   - rows of an app table the app marks kept by law (`keep: {law}`): theirs,
 *     a copy of them on one, or one that points at them (an invoice to them),
 *     with the law's reason (tax, health, contract, safety); kept as long as
 *     the app keeps them;
 *   - a rendered document (a quote, an invoice, a receipt): an issued
 *     document is kept as it was sent; for `retention.documentsDays`, or for
 *     good while that is empty;
 *   - an invoice the business wrote (Documents → Invoices): tax law, for good;
 *   - a payment: payment records, for good;
 *   - a payment service's message about one: for `retention.paymentEventsDays`;
 *   - the rules' run history: until its run is swept (`retention.automationRunsDays`);
 *   - staff notifications: until they are swept (`retention.notificationsDays`, once read);
 *   - a campaign's failure list: kept with the campaign's send log;
 *   - data exports staff made of a table may hold them: until each expires
 *     (`retention.exportsDays`); they are files, so they are not searched and
 *     carry no count;
 *   - the do-not-email list keeps their address as a code, so they are never
 *     mailed again: for good.
 *
 * Every reason is a code: the screens put it in the reader's language.
 */
import type { KeptByLawReason } from '@adminium/manifest';
import { settingsRepo, type MetaDb } from '@adminium/meta';

import type { PersonFound } from './sources.js';

export type StaysReason = KeptByLawReason | 'issued-document' | 'payment-records' | 'kept-a-while' | 'objection';

export type StaysKind =
  | 'app-rows'
  | 'documents'
  | 'invoices'
  | 'payments'
  | 'payment-events'
  | 'automation-runs'
  | 'notifications'
  | 'campaign-failures'
  | 'exports'
  | 'do-not-email';

export interface StaysItem {
  kind: StaysKind;
  reason: StaysReason;
  /** How many of theirs; null where they are not counted (exports staff made of a table). */
  count: number | null;
  /** Kept for this many days; null with `forever` false: as long as the app keeps them. */
  keptDays: number | null;
  forever: boolean;
  /** An app table's, for `app-rows`. */
  connectionId?: string;
  table?: string;
  app?: string;
  label?: string;
}

/** What stays of a person once erased (see the header). */
export async function whatStays(meta: MetaDb, found: PersonFound): Promise<StaysItem[]> {
  const settings = settingsRepo(meta);
  const [documentsDays, paymentEventsDays, automationRunsDays, notificationsDays, exportsDays] = await Promise.all([
    settings.get('retention.documentsDays'),
    settings.get('retention.paymentEventsDays'),
    settings.get('retention.automationRunsDays'),
    settings.get('retention.notificationsDays'),
    settings.get('retention.exportsDays'),
  ]);
  const count = (kind: string) => found.sources.filter((one) => one.kind === kind).reduce((sum, one) => sum + one.count, 0);
  const items: StaysItem[] = [];

  // Kept by law: their own rows and copies on such a table, and rows that point at them.
  const byTable = new Map<string, StaysItem>();
  const law = (connectionId: string, table: string, app: string, label: string, reason: KeptByLawReason, rows: number) => {
    const key = `${connectionId}\u0000${table}`;
    const held = byTable.get(key);
    if (held !== undefined) held.count = Math.max(held.count ?? 0, rows);
    else byTable.set(key, { kind: 'app-rows', reason, count: rows, keptDays: null, forever: false, connectionId, table, app, label });
  };
  for (const one of found.sources) {
    if (one.keptByLaw === null || one.connectionId === null || one.table === null) continue;
    law(one.connectionId, one.table, one.app ?? '', one.label ?? one.table, one.keptByLaw, one.count);
  }
  for (const one of found.lawLinked) law(one.connectionId, one.table, one.app, one.label, one.reason, one.count);
  items.push(...byTable.values());

  const documents = count('documents');
  if (documents > 0) items.push({ kind: 'documents', reason: 'issued-document', count: documents, keptDays: documentsDays, forever: documentsDays === null });
  const invoices = count('invoices');
  if (invoices > 0) items.push({ kind: 'invoices', reason: 'tax', count: invoices, keptDays: null, forever: true });
  const payments = count('payments');
  if (payments > 0) items.push({ kind: 'payments', reason: 'payment-records', count: payments, keptDays: null, forever: true });
  const events = count('payment-events');
  if (events > 0) items.push({ kind: 'payment-events', reason: 'payment-records', count: events, keptDays: paymentEventsDays, forever: false });
  const runs = count('automation-runs');
  if (runs > 0) items.push({ kind: 'automation-runs', reason: 'kept-a-while', count: runs, keptDays: automationRunsDays, forever: false });
  const notifications = count('notifications');
  if (notifications > 0) items.push({ kind: 'notifications', reason: 'kept-a-while', count: notifications, keptDays: notificationsDays, forever: false });
  const failures = count('campaign-failures');
  if (failures > 0) items.push({ kind: 'campaign-failures', reason: 'kept-a-while', count: failures, keptDays: null, forever: false });
  // Exports staff made of a table are files: not searched, so said of everyone, with no count.
  items.push({ kind: 'exports', reason: 'kept-a-while', count: null, keptDays: exportsDays, forever: false });
  // Their objection outlives them: the address stays on the list as a code (never the address).
  items.push({ kind: 'do-not-email', reason: 'objection', count: null, keptDays: null, forever: true });
  return items;
}
