// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A minimal but VALID `data` payload per email block kind — shared by the
 * vocabulary and document suites (not collected: no .test suffix).
 *
 * Deliberately spelled out rather than generated: the renderer drops a block
 * whose required fields are missing (a button with no url renders nothing at
 * all), so a generated stub would quietly assert the empty case and pass while
 * proving nothing. Every kind in `EMAIL_BLOCK_KINDS` must have an entry; the
 * vocabulary suite fails on a missing one.
 *
 * The editor's own defaults live in `apps/dashboard/src/email/model/blocks.ts`
 * and cannot be imported here (the server tree may not reach the dashboard),
 * so these mirror the comp's `defaultData` (1143-1171) by hand.
 */
export const EMAIL_BLOCK_SAMPLES: Record<string, Record<string, unknown>> = {
  'email.heading': { text: 'Reset your password', level: 1 },
  'email.text': { text: 'Hi {{name}}, here is the thing you asked for.' },
  'email.button': { label: 'Choose a new password', url: 'https://example.test/reset' },
  'email.divider': {},
  'email.spacer': { size: 24 },
  'email.footer': { text: 'You are receiving this because you have an account.' },
  // 39 Appendix C — the comp's 24 types.
  'email.image': { alt: 'Hero', url: 'https://example.test/hero.png', height: 160 },
  'email.two-col': { a: 'Left column copy.', b: 'Right column copy.' },
  'email.list': { items: ['First point', 'Second point'] },
  'email.quote': { text: 'It cut our reporting time in half.', author: 'Priya R.' },
  'email.social': { links: [{ label: 'Website', icon: 'globe', url: 'https://example.test' }] },
  'email.html': { code: '<p style="font-size:14px">Your HTML here</p>' },
  'email.box': { label: 'Amount', value: '$290.00' },
  'email.stats': { stats: [{ value: '128', label: 'Tasks done' }, { value: '3', label: 'Releases' }] },
  'email.product': { items: [{ name: 'Extra storage', meta: '250 GB', qty: 'x1', price: '$29.00' }] },
  'email.multi-currency': { kicker: 'In other currencies', amount: 290, fx: [{ code: 'EUR', sym: '€', rate: 0.92 }] },
  'email.tax-breakdown': { kicker: 'Tax breakdown', lines: [{ label: 'State tax (6%)', amount: '$17.40' }] },
  'email.discount-codes': { kicker: 'Discount codes', codes: [{ code: 'WELCOME10', label: '10% credit', amount: '-$29.00' }] },
  'email.payment-history': { kicker: 'Payment history', items: [{ date: 'Jul 2, 2026', method: 'Visa ·· 4242', amount: '$290.00' }] },
  'email.recurring': { freq: 'Monthly', next: 'Aug 12, 2026', note: 'until cancelled' },
  'email.loyalty': { balance: 1240, earned: 290, level: 'Gold' },
  'email.delivery': { kicker: 'Delivery timeline', steps: [{ label: 'Ordered', status: 'done' }, { label: 'Shipped', status: 'current' }] },
  'email.po-terms': { kicker: 'Purchase order terms', text: 'Goods remain returnable within 14 days.' },
  'email.legal': { kicker: '', text: 'This email is confidential.' },
  'email.refund-policy': { kicker: 'Refund policy', text: 'Full refunds within 30 days.' },
  'email.contact': { kicker: 'Questions?', name: 'Support', email: 'support@example.test', phone: '+1 555 010 0100' },
};
