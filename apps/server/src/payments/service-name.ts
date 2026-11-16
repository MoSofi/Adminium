// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A payment service's name as people read it: the service's own mark, spelled
 * as the service spells it ("PayPal", never "Paypal"), never translated. One
 * place, so a record's "recorded by", a receipt, a notice and the Activity log
 * all say the same name.
 */
const MARKS: Readonly<Record<string, string>> = {
  'payments-stripe': 'Stripe',
  'payments-paypal': 'PayPal',
  'payments-square': 'Square',
  demo: 'Demo',
};

/** The mark of a provider key; another add-on's key without its `payments-` prefix. */
export function serviceMark(key: string): string {
  return MARKS[key] ?? key.replace(/^payments-/, '');
}
