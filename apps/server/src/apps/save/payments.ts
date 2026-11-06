// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `payments`.
 *
 * The inverse of `installPayments` (`apps/saved-parts.ts`), written only when
 * the person did not say no and the database has a table set up to be paid:
 *  - each payable table no install owns, its columns by ref;
 *  - the ways to pay: where from, how, its label, whether it is on, its
 *    rules, its place in the list;
 *  - the pay page's shop name, country and whether it lists the lines.
 *
 * Never a way's details (a bank account), the pay page's logo or contacts, a
 * payment service's keys, or any attempt, payment, refund or link. The keys
 * and the account are filled in after installing; the install lists them.
 * Adminium is never a party to a payment.
 */
import { savedPaymentsSchema, type SavedPayable, type SavedPayments, type SavedPaymentWay } from '@adminium/manifest';
import { payableProfilesRepo, paymentMethodsRepo, paymentSettingsRepo, type PayableProfile } from '@adminium/meta';

import { MANUAL_SOURCE } from '../../payments/ways.js';
import { PAY_PAGE_DOC, payPageSchema } from '../../routes/payments/ways.js';
import type { ConvertContext, ConvertPart } from './types.js';
import { columnRef, noteAddOnUse, tableRefOf } from './uses.js';

class LeftOut extends Error {}

function col(name: unknown): string {
  const ref = columnRef(name);
  if (ref === null) throw new LeftOut(`the column "${String(name)}" has no name a file can carry`);
  return ref;
}

const optCol = (name: string | null | undefined): string | undefined => (name === null || name === undefined ? undefined : col(name));

/** A payable table's stored mapping → the file's, by refs. */
function payableOf(ctx: ConvertContext, profile: PayableProfile): SavedPayable {
  const table = tableRefOf(ctx, profile.tableName);
  if (table === null) throw new LeftOut('its table is not saved with the app');
  const m = profile.mapping;
  if (m === null) throw new LeftOut('its set-up no longer reads');
  let payments: SavedPayable['payments'] = { kind: 'kept' };
  if (m.payments.kind === 'table') {
    const own = tableRefOf(ctx, m.payments.table);
    if (own === null) throw new LeftOut('the table its payments are written to is not saved with the app');
    const values: Record<string, string> = {};
    for (const [method, value] of Object.entries(m.payments.method.values)) values[method] = value;
    payments = {
      kind: 'table',
      table: own,
      link: col(m.payments.link),
      amount: col(m.payments.amount),
      date: col(m.payments.date),
      method: { column: col(m.payments.method.column), values },
      ...(m.payments.note === null ? {} : { note: col(m.payments.note) }),
      ...(m.payments.voided === null ? {} : { voided: col(m.payments.voided) }),
      reference: col(m.payments.reference),
      ...(m.payments.refunded === null || m.payments.refunded === undefined ? {} : { refunded: col(m.payments.refunded) }),
      amountUnit: m.payments.amountUnit,
    };
  }
  const label = optCol(m.label);
  const due = m.due === null ? undefined : { column: col(m.due.column) };
  const status = m.status === null ? undefined : { column: col(m.status.column), paid: m.status.paid, ...(m.status.refunded === null ? {} : { refunded: m.status.refunded }) };
  const customerEmail = optCol(m.customerEmail);
  const customerCountry = optCol(m.customerCountry);
  return {
    table,
    ...(label === undefined ? {} : { label }),
    amount: { column: col(m.amount.column), ...(m.amount.unit === null ? {} : { unit: m.amount.unit }) },
    currency: 'column' in m.currency ? { column: col(m.currency.column) } : 'fixed' in m.currency ? { fixed: m.currency.fixed } : { connection: true },
    ...(due === undefined ? {} : { due }),
    payments,
    ...(status === undefined ? {} : { status }),
    ...(customerEmail === undefined ? {} : { customerEmail }),
    ...(customerCountry === undefined ? {} : { customerCountry }),
    ...(m.pageFields.length === 0 ? {} : { pageFields: m.pageFields.map(col) }),
  };
}

export const convertPayments: ConvertPart = async (ctx) => {
  if (ctx.choices.payments === false) return {};
  const { meta, connectionId } = ctx.source;

  const payables: SavedPayable[] = [];
  for (const profile of await payableProfilesRepo(meta).list(connectionId)) {
    // An install's payable table is that install's.
    if (profile.ownerApp !== null) continue;
    try {
      payables.push(payableOf(ctx, profile));
    } catch (error) {
      if (!(error instanceof LeftOut)) throw error;
      ctx.check.add({ group: 'info', code: 'PAYABLE_LEFT_OUT', kind: 'payments', item: profile.tableName, message: `It is not saved as payable: ${error.message}.` });
    }
  }
  // No set-up here, nothing to carry: the ways and the pay page belong to the whole Adminium.
  if (payables.length === 0) return {};

  const ways: SavedPaymentWay[] = [];
  for (const way of await paymentMethodsRepo(meta).list()) {
    const label = way.label === null ? undefined : Object.fromEntries(Object.entries(way.label).filter(([lang, text]) => lang.length >= 2 && lang.length <= 10 && text.trim() !== '').map(([lang, text]) => [lang, text.trim().slice(0, 60)]));
    const rules = {
      ...(way.rules.countries.length === 0 ? {} : { countries: [...way.rules.countries] }),
      ...(way.rules.currencies.length === 0 ? {} : { currencies: [...way.rules.currencies] }),
      ...(way.rules.min === null ? {} : { min: way.rules.min }),
      ...(way.rules.max === null ? {} : { max: way.rules.max }),
    };
    // Which tables a way is offered for names them by id: the target offers it for every one.
    if (way.rules.onlyFor.length > 0) {
      ctx.check.add({ group: 'info', code: 'PAYMENT_WAY_NARROWED', kind: 'payments', item: `${way.source}/${way.method}`, field: 'rules.onlyFor', message: 'It is offered here for some payable tables only; after installing it is offered for all of them until that is chosen again.' });
    }
    ways.push({
      source: way.source,
      method: way.method,
      enabled: way.enabled,
      ...(label === undefined || Object.keys(label).length === 0 ? {} : { label }),
      ...(Object.keys(rules).length === 0 ? {} : { rules }),
      position: Math.max(0, Math.min(1000, Math.trunc(way.position))),
    });
    if (way.source !== MANUAL_SOURCE) {
      noteAddOnUse(ctx, { key: way.source, optional: true, what: 'it takes payments' });
      ctx.check.add({ group: 'after', code: 'PAYMENT_KEY', kind: 'payments', item: way.source, field: 'keys', afterKind: 'payment-key', message: 'The payment service’s keys are given again after installing.' });
    } else if (way.method === 'bank-transfer') {
      ctx.check.add({ group: 'after', code: 'BANK_ACCOUNT', kind: 'payments', item: `${MANUAL_SOURCE}/bank-transfer`, field: 'details.accounts', afterKind: 'bank-account', message: 'The bank account a transfer is paid into is given again after installing; until then the way is off.' });
    }
  }

  const stored = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema);
  const payPage = stored === null ? undefined : { shopName: stored.shopName, ...(stored.shopCountry === null ? {} : { shopCountry: stored.shopCountry }), showLines: stored.showLines };
  if (stored !== null && (stored.logoFileId !== null || stored.contactEmail !== null || stored.contactPhone !== null)) {
    ctx.check.add({ group: 'info', code: 'PAY_PAGE_CONTACTS', kind: 'payments', item: 'pay page', field: 'logo, contacts', message: 'The pay page’s logo and contact details are not saved: they are set again after installing.' });
  }

  const payments: SavedPayments = { payables, ...(ways.length === 0 ? {} : { ways }), ...(payPage === undefined ? {} : { payPage }) };
  const parsed = savedPaymentsSchema.safeParse(payments);
  if (!parsed.success) {
    ctx.check.add({ group: 'info', code: 'PAYMENTS_LEFT_OUT', kind: 'payments', item: 'payments', message: 'The payments set-up cannot be said in a file, so it is not saved.' });
    return {};
  }
  return { payments: parsed.data };
};
