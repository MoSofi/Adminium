// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which tables hold payments taken online, for the write service's guard
 * ({@link WriteServiceOptions.paymentRows}).
 *
 * A payment taken online lands in a payable's own payments table, with the
 * attempt id in a unique reference column (`payments/record.ts`). From then on
 * the row is the provider's record: Adminium wrote it once, and only a refund
 * changes it. Two kinds of table hold such rows:
 *
 *  - the payments table a payable profile maps (`payments.kind = 'table'`),
 *    made by a person in Studio or by an app's manifest, switched on or off:
 *    a payment already taken stays what it is when its payable is switched off;
 *  - the payments part of an app's invoice built on the Invoices shape
 *    (`invoices/invoice@N#payments`), whose reference is `payment_ref` and whose
 *    service is `provider` (`payments/payables.ts`, `resolveShape`).
 *
 * Read from the meta store on each write, so a profile saved a moment ago
 * guards its table at once.
 */
import { appTablesRepo, payableProfilesRepo, type MetaDb, type RefundRowsMapping } from '@adminium/meta';

import { conditionHolds } from '../payments/payables.js';
import { realOfTableId } from '../installs/table-id.js';
import type { WriteContext } from './write-context.js';
import type { PaymentRowRule, WriteTarget } from './write-service.js';

/** The right that sends money back: the install's own, or (D20) the refunding app's. */
async function mayRefund(context: WriteContext, ownerApp: string | null): Promise<boolean> {
  const request = context.request;
  if (request === null || typeof request.can !== 'function') return false;
  try {
    if (await request.can('system:payments:refund')) return true;
    return ownerApp !== null && (await request.can(`payments:${ownerApp}:refund`));
  } catch {
    return false;
  }
}

/** A refund table's rule: the rows that send money back, and the stamps only Adminium fills. */
function refundRule(rows: RefundRowsMapping, ownerApp: string | null): Pick<PaymentRowRule, 'engineOnly' | 'refund'> {
  return {
    engineOnly: [rows.providerRef, rows.state],
    refund: { sendsMoney: (row) => rows.when.every((condition) => conditionHolds(condition, row)), mayRefund: (context) => mayRefund(context, ownerApp) },
  };
}

/** The columns of an invoice shape's payments part that name a payment taken online. */
const SHAPE_RULE: PaymentRowRule = { reference: 'payment_ref', engineOnly: ['payment_ref', 'provider'] };

const SHAPE_PAYMENTS = /^invoices\/invoice@\d+#payments$/;

export function paymentRowsOf(meta: MetaDb): (target: Pick<WriteTarget, 'connectionId' | 'view' | 'table'>) => Promise<PaymentRowRule | null> {
  return async (target) => {
    const tableId = target.table.id;
    const has = (column: string): boolean => target.table.columns.has(column);
    const profiles = await payableProfilesRepo(meta).list(target.connectionId);
    // A refund table of the app's own (E4); a payments table may be one too (a hotel keeps its given-back money there).
    const refunds = profiles.flatMap((profile) => (profile.mapping?.refunds?.model === 'rows' && profile.mapping.refunds.table === tableId ? [refundRule(profile.mapping.refunds, profile.ownerApp)] : []))[0];
    for (const profile of profiles) {
      const payments = profile.mapping?.payments;
      if (payments === undefined || payments.kind !== 'table' || payments.table !== tableId) continue;
      const elsewhere = payments.refundedElsewhere == null ? [] : [payments.refundedElsewhere];
      return { reference: payments.reference, engineOnly: [payments.reference, ...elsewhere, ...(refunds?.engineOnly ?? [])], ...(refunds?.refund === undefined ? {} : { refund: refunds.refund }) };
    }
    if (refunds !== undefined) return { reference: null, ...refunds };
    const real = realOfTableId(target.view.model, tableId);
    const records = await appTablesRepo(meta).byTable(target.connectionId, real);
    if (records.some((record) => SHAPE_PAYMENTS.test(record.builtOn ?? '')) && has('payment_ref')) {
      return { reference: SHAPE_RULE.reference, engineOnly: SHAPE_RULE.engineOnly.filter(has) };
    }
    return null;
  };
}
