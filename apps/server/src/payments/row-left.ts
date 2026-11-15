// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RECORD THAT STOPPED BEING PAYABLE ENDS ITS OPEN PAY PAGES.
 *
 * An app says when a record may be paid (`payableWhen`: an order still
 * `paying`). When a write takes it out of that — the kitchen cancels, the
 * unpaid hold lapses, the order is paid by hand — a customer may still have
 * the provider's page open. It is ended there, so no money is taken for a
 * record nobody may pay any more; a payment the provider finished first wins
 * the race and is followed as usual (the record job then gives it to a person,
 * `record.ts`).
 *
 * Never inside the write: the write is told, and queues a job
 * (`payments.row-left`, one per row at a time) that reads the record again,
 * asks each open page's service to end it, and is tried again while a
 * service cannot be reached. A write whose event is lost (a crash after its
 * commit) is caught by the payments sweep, which asks the same before it asks
 * the service about an open page (`sweep.ts`).
 */
import { DEMO_PAYMENT_KEY, isProviderError, PAYMENT_MODES } from '@adminium/add-on-contracts';
import { appTablesRepo, payableProfilesRepo, paymentAttemptsRepo, paymentLinksRepo, type MetaDb, type PayableRef, type PaymentAttempt } from '@adminium/meta';
import { z } from 'zod';

import type { RecordWriteEvent } from '../crud/after-record-write.js';
import type { JobRegistry } from '../jobs/registry.js';
import { conditionHolds, resolvePayable, type PayableSources } from './payables.js';
import type { ProviderLookup } from './providers.js';

export const PAYMENTS_ROW_LEFT_JOB = 'payments.row-left';

const payloadSchema = z.object({ kind: z.enum(['profile', 'shape']), connectionId: z.string().min(1).max(64), tableName: z.string().min(1).max(255), rowKey: z.string().min(1).max(255) }).strict();

export interface RowLeftDeps {
  meta: MetaDb;
  sources: PayableSources;
  providerFor: (key: string, mode: (typeof PAYMENT_MODES)[number]) => Promise<ProviderLookup>;
  now?: () => number;
}

/** The refusals that say a record may no longer be paid; a passing one (a currency briefly unread, an unclear amount) ends nothing. */
const LEFT: ReadonlySet<string> = new Set(['NOT_NOW', 'VOIDED', 'NOTHING_DUE', 'NOT_SENT', 'NOT_PAYABLE']);

/** Whether a payable may no longer be paid online: gone, or its own reason (not now, voided, paid). */
async function leftPayable(sources: PayableSources, ref: PayableRef): Promise<boolean> {
  const payable = await resolvePayable(sources, ref);
  return payable === null || (payable.refusal !== null && LEFT.has(payable.refusal.code));
}

/**
 * Ends the open pages of one record that may no longer be paid. Throws while
 * a service cannot be reached, so the job tries again. How many it ended.
 */
export async function endLeftPages(deps: RowLeftDeps, ref: PayableRef): Promise<number> {
  if (!(await leftPayable(deps.sources, ref))) return 0;
  const at = (deps.now ?? Date.now)();
  const attempts = paymentAttemptsRepo(deps.meta);
  let ended = 0;
  for (const mode of PAYMENT_MODES) {
    const open = await attempts.openFor(ref, mode);
    // A checkout still being made is left to its own run, which ends it or hands its page out: its page may be live already.
    if (open === null || open.state !== 'open') continue;
    if (open.providerRef !== null && open.provider !== DEMO_PAYMENT_KEY && !(await endedThere(deps, open))) continue;
    if (await attempts.move(open.id, 'expired', {}, at)) ended += 1;
  }
  // Its links say nothing more is to be paid.
  await paymentLinksRepo(deps.meta).retire(ref);
  return ended;
}

/** Asks the service to end the page. False when the page had already gone on to take the money: that is followed as usual. */
async function endedThere(deps: RowLeftDeps, attempt: PaymentAttempt): Promise<boolean> {
  const lookup = await deps.providerFor(attempt.provider, attempt.mode);
  if (!lookup.ok) throw new Error(`The payment service ${attempt.provider} cannot be asked to end its page now.`);
  const answer = await lookup.provider.expire(attempt.providerRef!);
  if (isProviderError(answer)) {
    // A page the service never heard of is ended; one that already took the money is followed as usual (the sweep and the webhook).
    if (answer.code === 'NOT_FOUND') return true;
    if (answer.code === 'ALREADY_COMPLETED') return false;
    throw new Error(`The payment service ${attempt.provider} did not end its page: ${answer.code}`);
  }
  return answer.status === 'expired' || answer.status === 'cancelled' || answer.status === 'failed';
}

export function registerRowLeftHandler(registry: JobRegistry, deps: RowLeftDeps): void {
  registry.registerJobHandler(
    PAYMENTS_ROW_LEFT_JOB,
    payloadSchema,
    async (payload) => ({ ended: await endLeftPages(deps, payload) }),
    { internal: true },
  );
}

/**
 * What hears every write: a change or removal of a payable record that no
 * longer meets its app's `payableWhen` (or its invoice is no longer payable),
 * while a page for it is open, queues the job. Never throws, never waits on a
 * service.
 */
export function createRowLeftWatch(deps: {
  meta: MetaDb;
  enqueue: (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>;
  warn?: (fields: Record<string, unknown>, message: string) => void;
}): { onRecordEvent(event: RecordWriteEvent): Promise<void> } {
  return {
    async onRecordEvent(event) {
      if (event.action === 'create') return;
      try {
        const table = event.table;
        if (table.primaryKey.length !== 1) return;
        const rowKey = String((event.entity.pk as Record<string, unknown>)[table.primaryKey[0]!]);
        let kind: PayableRef['kind'] | null = null;
        const profile = await payableProfilesRepo(deps.meta).byTable(event.connectionId, table.id);
        if (profile?.mapping !== null && profile?.mapping !== undefined) {
          const when = profile.mapping.payableWhen;
          // A record still payable after the change keeps its page.
          if (event.action !== 'delete' && event.after !== null && (when === undefined || when.every((condition) => conditionHolds(condition, event.after!)))) return;
          kind = 'profile';
        } else if (profile?.shape !== null && profile?.shape !== undefined) {
          kind = 'shape';
        } else {
          // An invoice an app built on the Invoices shape, recorded by its name in the database (with its schema when not the default one).
          const tables = appTablesRepo(deps.meta);
          let records = await tables.byTable(event.connectionId, table.name);
          if (records.length === 0 && table.schema !== '') records = await tables.byTable(event.connectionId, `${table.schema}.${table.name}`);
          if (!records.some((record) => /^invoices\/invoice@\d+#document$/.test(record.builtOn ?? ''))) return;
          kind = 'shape';
        }
        const ref: PayableRef = { kind, connectionId: event.connectionId, tableName: table.id, rowKey };
        const attempts = paymentAttemptsRepo(deps.meta);
        let open = false;
        for (const mode of PAYMENT_MODES) if ((await attempts.openFor(ref, mode)) !== null) open = true;
        if (!open) return;
        await deps
          .enqueue({ kind: PAYMENTS_ROW_LEFT_JOB, payload: { ...ref }, dedupeKey: `payments-row-left:${event.connectionId}:${table.id}:${rowKey}`, maxAttempts: 8 })
          .catch(() => undefined);
      } catch (error) {
        deps.warn?.({ err: error, table: event.table.id }, 'payments: a record that stopped being payable could not be looked at');
      }
    },
  };
}
