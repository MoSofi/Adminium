// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email block registry — the comp's `blockDefs` / `pickerCats` /
 * `defaultData` / `blockSchema` (`designs/Email Templates.dc.html`
 * 1108-1231) as data, keyed by the server's `email.*` kinds
 * (39-email-templates-and-campaigns.md Appendix C, D5, D16).
 *
 * PURE DATA, NO REACT. The canvas, the inspector and the picker all read
 * this one table, so a kind exists exactly once on the dashboard side.
 *
 * `EMAIL_BLOCK_KINDS` IS A COPY OF THE RENDERER'S LIST, AND A GATE HOLDS THE
 * TWO TOGETHER. The server (`apps/server/src/email/render.ts`) owns the wire
 * vocabulary of `adminium_email_templates.blocks`; the dashboard may not
 * import server code (01-architecture.md §2.3), so the list is declared here
 * again and `scripts/check-email-block-vocab.mjs` fails CI when the two
 * differ in membership or order, or when a kind listed here has no entry in
 * `EMAIL_BLOCKS` below. Change one and the other in the same commit.
 *
 * Two kinds are renderable but NOT in the picker (39 D5): `email.spacer`
 * (the comp folds spacer into "Divider / spacer" with a `line` flag) and
 * `email.footer` (the comp's footer is a fixed envelope field). Both keep an
 * entry here so a legacy row still opens with every block recognised.
 *
 * Labels and hints are the comp's English; the UI resolves them through
 * `t()` by kind.
 */

/** The wire vocabulary — identical to the renderer's, gate-checked. */
export const EMAIL_BLOCK_KINDS = [
  'email.heading',
  'email.text',
  'email.button',
  'email.divider',
  'email.spacer',
  'email.footer',
  'email.image',
  'email.two-col',
  'email.list',
  'email.quote',
  'email.social',
  'email.html',
  'email.box',
  'email.stats',
  'email.product',
  'email.multi-currency',
  'email.tax-breakdown',
  'email.discount-codes',
  'email.payment-history',
  'email.recurring',
  'email.loyalty',
  'email.delivery',
  'email.po-terms',
  'email.legal',
  'email.refund-policy',
  'email.contact',
] as const;

export type EmailBlockKind = (typeof EMAIL_BLOCK_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(EMAIL_BLOCK_KINDS);

export function isEmailBlockKind(value: unknown): value is EmailBlockKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

/** The comp's canvas families (`FAMS`, comp 1420) — which preview a kind draws. */
export type EmailBlockFamily =
  | 'Heading'
  | 'Body'
  | 'Box'
  | 'Cta'
  | 'Divider'
  | 'Image'
  | 'Twocol'
  | 'List'
  | 'Quote'
  | 'Stats'
  | 'Product'
  | 'Social'
  | 'Html'
  | 'TitledText'
  | 'TitledRows'
  | 'Recurring'
  | 'Discount'
  | 'Payhistory'
  | 'Contact'
  | 'Loyalty'
  | 'Delivery'
  | 'Spacer'
  | 'Footer';

/** An inspector field: `[key, label, kind]` (comp `blockSchema`). */
export type EmailFieldKind = 'input' | 'area' | 'mono';
export interface EmailBlockField {
  key: string;
  label: string;
  kind: EmailFieldKind;
}

/** One cell of a rows editor: `[key, placeholder, kind, width?]`; `''` key = a plain string row. */
export interface EmailRowCell {
  key: string;
  placeholder: string;
  kind: EmailFieldKind | 'cycle';
  width?: number | undefined;
}

export interface EmailRowsSchema {
  field: string;
  label: string;
  /** The "Add {noun}" button's noun. */
  noun: string;
  /** Rows are bare strings rather than records (paragraphs, list items). */
  plain?: boolean | undefined;
  cells: EmailRowCell[];
}

export interface EmailBlockDef {
  kind: EmailBlockKind;
  /** The comp's picker label. */
  label: string;
  /** Lucide icon name. */
  icon: string;
  /** The comp's one-line hint under the picker tile. */
  hint: string;
  family: EmailBlockFamily;
  /** Shows the Text size axis (comp `size: true`). */
  sized: boolean;
  /** Renders as fine print (comp `fine: true`). */
  fine: boolean;
  /** Offers the Insert-variable chips (comp `vars: true`). */
  vars: boolean;
  fields: EmailBlockField[];
  rows?: EmailRowsSchema | undefined;
  /** In the picker (false for the two legacy kinds). */
  pickable: boolean;
}

const f = (key: string, label: string, kind: EmailFieldKind): EmailBlockField => ({ key, label, kind });
const c = (key: string, placeholder: string, kind: EmailRowCell['kind'], width?: number): EmailRowCell => ({
  key,
  placeholder,
  kind,
  ...(width === undefined ? {} : { width }),
});

function def(
  kind: EmailBlockKind,
  label: string,
  icon: string,
  hint: string,
  family: EmailBlockFamily,
  extra: Partial<Pick<EmailBlockDef, 'sized' | 'fine' | 'vars' | 'fields' | 'rows' | 'pickable'>> = {},
): EmailBlockDef {
  return {
    kind,
    label,
    icon,
    hint,
    family,
    sized: extra.sized ?? false,
    fine: extra.fine ?? false,
    vars: extra.vars ?? false,
    fields: extra.fields ?? [],
    rows: extra.rows,
    pickable: extra.pickable ?? true,
  };
}

/** Every kind's definition — the comp's `blockDefs` + `blockSchema` (1108-1135, 1203-1231). */
export const EMAIL_BLOCKS: Readonly<Record<EmailBlockKind, EmailBlockDef>> = {
  'email.heading': def('email.heading', 'Heading', 'heading', 'Section headline', 'Heading', {
    sized: true,
    vars: true,
    fields: [f('text', 'Heading', 'area')],
  }),
  'email.text': def('email.text', 'Text block', 'align-left', 'One or more paragraphs', 'Body', {
    sized: true,
    vars: true,
    rows: { field: 'paras', label: 'Paragraphs', noun: 'paragraph', plain: true, cells: [c('', 'Paragraph text', 'area')] },
  }),
  'email.button': def('email.button', 'Button', 'mouse-pointer-click', 'Primary call-to-action', 'Cta', {
    vars: true,
    fields: [f('label', 'Button text', 'input'), f('url', 'Link URL', 'mono')],
  }),
  'email.divider': def('email.divider', 'Divider / spacer', 'minus', 'Rule or empty space', 'Divider', {
    fields: [f('height', 'Height (px)', 'mono')],
  }),
  'email.spacer': def('email.spacer', 'Spacer', 'move-vertical', 'Empty space', 'Spacer', {
    fields: [f('size', 'Height (px)', 'mono')],
    pickable: false,
  }),
  'email.footer': def('email.footer', 'Footer text', 'panel-bottom', 'Legacy footer block', 'Footer', {
    vars: true,
    fields: [f('text', 'Footer', 'area')],
    pickable: false,
  }),
  'email.image': def('email.image', 'Image placeholder', 'image', 'Drop artwork in later', 'Image', {
    fields: [f('alt', 'Placeholder label', 'input'), f('url', 'Image URL', 'mono'), f('height', 'Height (px)', 'mono')],
  }),
  'email.two-col': def('email.two-col', 'Two-column text', 'columns-2', 'Side-by-side copy', 'Twocol', {
    sized: true,
    vars: true,
    fields: [f('a', 'Left column', 'area'), f('b', 'Right column', 'area')],
  }),
  'email.list': def('email.list', 'Bulleted list', 'list', 'Short bullet points', 'List', {
    sized: true,
    rows: { field: 'items', label: 'List items', noun: 'item', plain: true, cells: [c('', 'List item', 'input')] },
  }),
  'email.quote': def('email.quote', 'Quote', 'quote', 'Testimonial with attribution', 'Quote', {
    sized: true,
    fields: [f('text', 'Quote', 'area'), f('author', 'Attribution', 'input')],
  }),
  'email.social': def('email.social', 'Social links', 'share-2', 'Footer link chips', 'Social', {
    rows: {
      field: 'links',
      label: 'Links',
      noun: 'link',
      cells: [c('label', 'Label', 'input', 92), c('icon', 'Icon name', 'input', 92), c('url', 'URL', 'mono')],
    },
  }),
  'email.html': def('email.html', 'Custom HTML', 'code', 'Paste your own markup', 'Html', {
    fields: [f('code', 'HTML', 'area')],
  }),
  'email.box': def('email.box', 'Highlight box', 'square-dashed-bottom-code', 'Label and a big value', 'Box', {
    fields: [f('label', 'Label', 'input'), f('value', 'Value', 'mono')],
  }),
  'email.stats': def('email.stats', 'Stat row', 'chart-column', 'Two to four figures', 'Stats', {
    rows: { field: 'stats', label: 'Stats', noun: 'stat', cells: [c('value', '128', 'mono', 68), c('label', 'Label', 'input')] },
  }),
  'email.product': def('email.product', 'Product row', 'package', 'Line items with prices', 'Product', {
    rows: {
      field: 'items',
      label: 'Line items',
      noun: 'item',
      cells: [c('name', 'Item name', 'input'), c('meta', 'Variant / SKU', 'input'), c('qty', 'x1', 'input', 52), c('price', '$0.00', 'mono', 80)],
    },
  }),
  'email.multi-currency': def('email.multi-currency', 'Multi-currency', 'coins', 'Totals in other currencies', 'TitledRows', {
    fields: [f('kicker', 'Section label', 'input'), f('amount', 'Base amount', 'mono')],
    rows: {
      field: 'fx',
      label: 'Currencies & rates',
      noun: 'currency',
      cells: [c('code', 'EUR', 'input', 54), c('sym', '€', 'input', 42), c('rate', '0.92', 'mono')],
    },
  }),
  'email.tax-breakdown': def('email.tax-breakdown', 'Tax breakdown', 'percent', 'Tax components', 'TitledRows', {
    fields: [f('kicker', 'Section label', 'input')],
    rows: { field: 'lines', label: 'Tax components', noun: 'tax line', cells: [c('label', 'Label', 'input'), c('amount', '$0.00', 'mono', 80)] },
  }),
  'email.discount-codes': def('email.discount-codes', 'Discount codes', 'ticket-percent', 'Applied promo codes', 'Discount', {
    fields: [f('kicker', 'Section label', 'input')],
    rows: {
      field: 'codes',
      label: 'Codes',
      noun: 'code',
      cells: [c('code', 'CODE', 'input', 92), c('amount', '-$0.00', 'mono', 76), c('label', 'Description', 'input')],
    },
  }),
  'email.payment-history': def('email.payment-history', 'Payment history', 'history', 'Past payments', 'Payhistory', {
    fields: [f('kicker', 'Section label', 'input')],
    rows: {
      field: 'items',
      label: 'Payments',
      noun: 'payment',
      cells: [c('date', 'Jul 2, 2026', 'input'), c('method', 'Visa ·· 4242', 'input'), c('amount', '$0.00', 'mono', 80)],
    },
  }),
  'email.recurring': def('email.recurring', 'Recurring schedule', 'repeat', 'Delivery cadence', 'Recurring', {
    fields: [f('freq', 'Frequency', 'input'), f('next', 'Next issue date', 'input'), f('note', 'Schedule note', 'input')],
  }),
  'email.loyalty': def('email.loyalty', 'Loyalty points', 'award', 'Rewards balance', 'Loyalty', {
    // The comp's "tier" data key is `level` here: the 17 §2 grep runs over built bytes (Appendix B).
    fields: [f('balance', 'Balance', 'mono'), f('earned', 'Earned', 'mono'), f('level', 'Level', 'input')],
  }),
  'email.delivery': def('email.delivery', 'Delivery timeline', 'truck', 'Fulfilment status', 'Delivery', {
    fields: [f('kicker', 'Section label', 'input')],
    rows: { field: 'steps', label: 'Steps', noun: 'step', cells: [c('label', 'Step name', 'input'), c('status', '', 'cycle', 92)] },
  }),
  'email.po-terms': def('email.po-terms', 'PO terms', 'scroll-text', 'Purchase order terms', 'TitledText', {
    sized: true,
    fields: [f('kicker', 'Section label', 'input'), f('text', 'Body', 'area')],
  }),
  'email.legal': def('email.legal', 'Legal footer', 'scale', 'Fine print', 'TitledText', {
    fine: true,
    fields: [f('text', 'Fine print', 'area')],
  }),
  'email.refund-policy': def('email.refund-policy', 'Refund policy', 'rotate-ccw', 'Returns and refunds', 'TitledText', {
    sized: true,
    fields: [f('kicker', 'Section label', 'input'), f('text', 'Body', 'area')],
  }),
  'email.contact': def('email.contact', 'Contact block', 'life-buoy', 'Support details', 'Contact', {
    fields: [f('kicker', 'Section label', 'input'), f('name', 'Contact name', 'input'), f('email', 'Email', 'mono'), f('phone', 'Phone', 'mono')],
  }),
};

/** The picker's three groups, in the comp's order (`pickerCats`, 1136-1142). */
export const EMAIL_PICKER_GROUPS: readonly { key: 'content' | 'commerce' | 'legal'; label: string; kinds: readonly EmailBlockKind[] }[] = [
  {
    key: 'content',
    label: 'Content',
    kinds: ['email.text', 'email.heading', 'email.image', 'email.button', 'email.divider', 'email.two-col', 'email.list', 'email.quote', 'email.social', 'email.html'],
  },
  {
    key: 'commerce',
    label: 'Commerce & data',
    kinds: [
      'email.box',
      'email.stats',
      'email.product',
      'email.multi-currency',
      'email.tax-breakdown',
      'email.discount-codes',
      'email.payment-history',
      'email.recurring',
      'email.loyalty',
      'email.delivery',
    ],
  },
  { key: 'legal', label: 'Legal & support', kinds: ['email.po-terms', 'email.legal', 'email.refund-policy', 'email.contact'] },
];

/**
 * What a freshly added block holds (comp `defaultData`, 1143-1171), re-themed
 * for the operator's audience (39 D10, Appendix B): no vendor name, no plan
 * words, `{{appName}}` where the comp said Adminium.
 */
export function defaultBlockData(kind: EmailBlockKind): Record<string, unknown> {
  switch (kind) {
    case 'email.heading':
      return { text: 'Section heading', level: 1 };
    case 'email.text':
      return { paras: ['Write your copy here.'] };
    case 'email.button':
      return { label: 'Call to action', url: 'https://example.com' };
    case 'email.divider':
      return { height: 24, line: true };
    case 'email.spacer':
      return { size: 16 };
    case 'email.footer':
      return { text: '' };
    case 'email.image':
      return { alt: 'Hero image — 600 × 240', url: '', height: 160 };
    case 'email.two-col':
      return { a: 'Left column copy.', b: 'Right column copy.' };
    case 'email.list':
      return { items: ['First point', 'Second point', 'Third point'] };
    case 'email.quote':
      return { text: '{{appName}} cut our reporting time in half.', author: 'Priya R., Northwind Co' };
    case 'email.social':
      return {
        links: [
          { label: 'Website', icon: 'globe', url: '#' },
          { label: 'Community', icon: 'message-circle', url: '#' },
          { label: 'Contact us', icon: 'at-sign', url: '#' },
        ],
      };
    case 'email.html':
      return { code: '<p style="font-size:14px">Your HTML here</p>' };
    case 'email.box':
      return { label: 'Amount', value: '$0.00' };
    case 'email.stats':
      return {
        stats: [
          { value: '128', label: 'Tasks done' },
          { value: '3', label: 'Releases' },
          { value: '12%', label: 'Orders up' },
        ],
      };
    case 'email.product':
      return { items: [{ name: 'Item name', meta: 'Variant · SKU', qty: 'x1', price: '$290.00' }] };
    case 'email.multi-currency':
      return {
        kicker: 'Amount due in other currencies',
        amount: 290,
        fx: [
          { code: 'EUR', sym: '€', rate: 0.92 },
          { code: 'GBP', sym: '£', rate: 0.79 },
        ],
      };
    case 'email.tax-breakdown':
      return {
        kicker: 'Tax breakdown',
        lines: [
          { label: 'State tax (6%)', amount: '$17.40' },
          { label: 'City tax (2%)', amount: '$5.80' },
        ],
      };
    case 'email.discount-codes':
      return { kicker: 'Discount codes', codes: [{ code: 'WELCOME10', label: '10% welcome credit', amount: '-$29.00' }] };
    case 'email.payment-history':
      return { kicker: 'Payment history', items: [{ date: 'Jul 2, 2026', method: 'Visa ·· 4242', amount: '$290.00' }] };
    case 'email.recurring':
      return { freq: 'Monthly', next: 'Aug 12, 2026', note: 'until cancelled' };
    case 'email.loyalty':
      return { balance: 1240, earned: 290, level: 'Gold' };
    case 'email.delivery':
      return {
        kicker: 'Delivery timeline',
        steps: [
          { label: 'Ordered', status: 'done' },
          { label: 'Processing', status: 'done' },
          { label: 'Shipped', status: 'current' },
          { label: 'Delivered', status: 'todo' },
        ],
      };
    case 'email.po-terms':
      return {
        kicker: 'Purchase order terms',
        text: 'This message relates to a purchase order governed by the buyer’s standard terms & conditions. Goods remain returnable within 14 days of delivery.',
      };
    case 'email.legal':
      return {
        kicker: '',
        text: '{{appName}}. This email and any attachments are confidential. Prices include applicable taxes where required by law.',
      };
    case 'email.refund-policy':
      return { kicker: 'Refund policy', text: 'Full refunds within 30 days of purchase. Contact support to begin a return.' };
    case 'email.contact':
      return { kicker: 'Questions? Contact us', name: '{{appName}} support', email: 'support@example.com', phone: '+1 (555) 010-0100' };
  }
}

/** The comp's category icons (`catIcon`, 1074). */
export const EMAIL_CATEGORY_ICONS = {
  transactional: 'receipt',
  lifecycle: 'sprout',
  marketing: 'megaphone',
} as const;
