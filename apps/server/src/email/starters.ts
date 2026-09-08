// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The twelve starters behind the New modal — the comp's `starterDefs` and
 * `seedExtras` (`designs/Email Templates.dc.html` 825-841, 891-920),
 * re-themed for the OPERATOR's audience (39-email-templates-and-campaigns.md
 * D10, Appendix B; 39-T07).
 *
 * WHY THEY GO THROUGH `t()` LIKE THE BUILT-INS. *Add language* (39 D3) creates
 * a linked copy in another locale; for a family minted from a starter that
 * copy is the starter rendered through the target locale's translator, which
 * is what makes the language menu worth having. A starter stored as
 * client-side English JSON could only ever be copied verbatim. So every
 * string here is a `common:email.starters.*` key with the English as its
 * default, and the ICU arguments are the `{{placeholder}}` literals the
 * renderer fills per send — `builtins.ts`'s seed model, reused.
 *
 * WHAT CHANGED FROM THE COMP, AND WHY (Appendix B). The comp's starters are
 * Adminium-the-vendor's mail: `no-reply@adminium.io`, "500 Market St", the
 * "Team plan", a 14-day trial. Seeded copy is user-visible, so it is swept by
 * the 17 §2 grep (the Appendix B substring list, over built bytes — which is
 * why this comment does not spell the words out). Four starters are re-themed under that rule and because
 * a built-in already owns their flow: *Password reset* → **Delivery update**,
 * *Trial ending* → **Appointment reminder**, *Team invite* → **Feedback
 * request**, *Trial expired* → **Account paused**. Every starter says
 * `{{appName}}`, never "Adminium"; `{{first_name}}`/`{{name}}`, never
 * `{{workspace}}`; no street address, no vendor domain. The words the sweep
 * would catch are spelled out in Appendix B; a test greps the English for them.
 *
 * Nothing here duplicates a built-in flow: the reset and the invite stay the
 * product's, seeded by `builtins.ts`.
 */

import type { EmailBrand, EmailCategory } from '@adminium/meta';

import type { Translate } from './builtins.js';
import { newBlockId } from './ids.js';
import type { EmailDocument } from './types.js';

/** The comp's twelve starter slots, in its modal order, with the four re-themed (D10). */
export const EMAIL_STARTER_KEYS = [
  'welcome',
  'shipped',
  'receipt',
  'digest',
  'reminder',
  'feature',
  'feedback',
  'paused',
  'monthly',
  'verify',
  'failed',
  'reengage',
] as const;

export type EmailStarterKey = (typeof EMAIL_STARTER_KEYS)[number];

const STARTER_SET: ReadonlySet<string> = new Set(EMAIL_STARTER_KEYS);

/**
 * The `{{vars}}` each starter's copy uses BEYOND the workspace-user set
 * (`appName`, `name`, `first_name`, `email` — 39 D18) — locale-independent, so the editor's chips and the test-send
 * samples need no translator. `receipt_pdf` is the generated attachment's
 * token, resolved from `vars` at enqueue (39 D8).
 */
export const STARTER_VARS: Readonly<Record<EmailStarterKey, readonly string[]>> = {
  welcome: [],
  shipped: ['order_number', 'tracking_url'],
  receipt: ['order_number', 'amount', 'order_url', 'receipt_pdf'],
  digest: [],
  reminder: ['date', 'time'],
  feature: [],
  feedback: [],
  paused: [],
  monthly: ['month', 'revenue'],
  verify: ['verify_url'],
  failed: ['order_number', 'amount'],
  reengage: [],
};

export function isEmailStarterKey(value: unknown): value is EmailStarterKey {
  return typeof value === 'string' && STARTER_SET.has(value);
}

/** What the New modal shows per card (comp 117-151) — localized. */
export interface EmailStarterCard {
  key: EmailStarterKey;
  name: string;
  category: EmailCategory;
  /** Lucide icon name (the comp's). */
  icon: string;
  /** The card's mini-preview accent; the comp's default for most. */
  accent: string;
  /** The first heading, for the mini preview. */
  heading: string;
}

/** A starter fully rendered for one locale. */
export interface EmailStarter extends EmailStarterCard {
  document: EmailDocument;
}

const DEFAULT_ACCENT = '#4f46e5';

const V = {
  appName: '{{appName}}',
  name: '{{name}}',
  firstName: '{{first_name}}',
  orderNumber: '{{order_number}}',
  amount: '{{amount}}',
  month: '{{month}}',
  revenue: '{{revenue}}',
  date: '{{date}}',
  time: '{{time}}',
  verifyUrl: '{{verify_url}}',
  orderUrl: '{{order_url}}',
  trackingUrl: '{{tracking_url}}',
} as const;

type Block = Record<string, unknown>;

function blk(block: string, data: Record<string, unknown>, style: Record<string, unknown> = {}): Block {
  return { id: newBlockId(), block, data, style };
}

/** The comp's `sx()` strings for one locale — the extras' copy. */
function extrasCopy(t: Translate) {
  return {
    hero: t('email.starters.extras.hero', { defaultValue: 'Hero image — 600 × 240' }),
    s1: t('email.starters.extras.step1', { defaultValue: 'Invite your team' }),
    s2: t('email.starters.extras.step2', { defaultValue: 'Connect your data' }),
    s3: t('email.starters.extras.step3', { defaultValue: 'Build your first dashboard' }),
    web: t('email.starters.extras.website', { defaultValue: 'Website' }),
    comm: t('email.starters.extras.community', { defaultValue: 'Community' }),
    contact: t('email.starters.extras.contact', { defaultValue: 'Contact us' }),
    order: t('email.starters.extras.order', { defaultValue: 'Order summary' }),
    tax: t('email.starters.extras.tax', { defaultValue: 'Tax breakdown' }),
    pay: t('email.starters.extras.payments', { defaultValue: 'Payment history' }),
    refund: t('email.starters.extras.refund', { defaultValue: 'Refund policy' }),
    refundText: t('email.starters.extras.refundText', {
      defaultValue: 'Full refunds within 30 days of purchase. Contact support to begin a return.',
    }),
    st1: t('email.starters.extras.stat1', { defaultValue: 'Tasks done' }),
    st2: t('email.starters.extras.stat2', { defaultValue: 'Releases' }),
    st3: t('email.starters.extras.stat3', { defaultValue: 'Revenue up' }),
    help: t('email.starters.extras.help', { defaultValue: 'Questions? Contact us' }),
    support: t('email.starters.extras.support', { appName: V.appName, defaultValue: '{appName} support' }),
    quote: t('email.starters.extras.quote', {
      appName: V.appName,
      defaultValue: '{appName} cut our reporting time in half.',
    }),
    quoteAuthor: t('email.starters.extras.quoteAuthor', { defaultValue: 'Priya R., Northwind Co' }),
    item1: t('email.starters.extras.item1', { defaultValue: 'Workshop ticket' }),
    item1Meta: t('email.starters.extras.item1Meta', { defaultValue: 'Sat 12 Sep · 2 seats' }),
    item2: t('email.starters.extras.item2', { defaultValue: 'Extra storage' }),
    item2Meta: t('email.starters.extras.item2Meta', { defaultValue: '250 GB' }),
    stateTax: t('email.starters.extras.stateTax', { defaultValue: 'State tax (6%)' }),
    cityTax: t('email.starters.extras.cityTax', { defaultValue: 'City tax (2%)' }),
    delivery: t('email.starters.extras.delivery', { defaultValue: 'Delivery timeline' }),
    ordered: t('email.starters.extras.ordered', { defaultValue: 'Ordered' }),
    processing: t('email.starters.extras.processing', { defaultValue: 'Processing' }),
    shipped: t('email.starters.extras.shipped', { defaultValue: 'Shipped' }),
    delivered: t('email.starters.extras.delivered', { defaultValue: 'Delivered' }),
  };
}

/**
 * The comp's `seedExtras`, per topic, inserted before the CTA (`withExtras`,
 * comp 921-929). The four re-themed starters keep the composition of the
 * slot they replaced.
 */
function extras(key: EmailStarterKey, t: Translate): Block[] {
  const c = extrasCopy(t);
  const hero = (): Block => blk('email.image', { alt: c.hero, url: '', height: 170 }, { radius: 'md' });
  const steps = (): Block => blk('email.list', { items: [c.s1, c.s2, c.s3] });
  const rule = (): Block => blk('email.divider', { height: 22, line: true });
  const social = (): Block =>
    blk(
      'email.social',
      {
        links: [
          { label: c.web, icon: 'globe', url: '#' },
          { label: c.comm, icon: 'message-circle', url: '#' },
          { label: c.contact, icon: 'at-sign', url: '#' },
        ],
      },
      { align: 'center', pad: 's' },
    );
  const help = (): Block =>
    blk('email.contact', { kicker: c.help, name: c.support, email: 'support@example.com', phone: '+1 (555) 010-0100' });
  const stats = (): Block =>
    blk('email.stats', {
      stats: [
        { value: '128', label: c.st1 },
        { value: '3', label: c.st2 },
        { value: '12%', label: c.st3 },
      ],
    });
  const order = (): Block =>
    blk('email.product', {
      items: [
        { name: c.item1, meta: c.item1Meta, qty: 'x1', price: '$261.00' },
        { name: c.item2, meta: c.item2Meta, qty: 'x1', price: '$29.00' },
      ],
    });
  const tax = (): Block =>
    blk('email.tax-breakdown', {
      kicker: c.tax,
      lines: [
        { label: c.stateTax, amount: '$17.40' },
        { label: c.cityTax, amount: '$5.80' },
      ],
    });
  const pay = (): Block =>
    blk('email.payment-history', {
      kicker: c.pay,
      items: [{ date: 'Jul 2, 2026', method: 'Visa ·· 4242', amount: '$290.00', status: 'paid' }],
    });
  const refund = (): Block => blk('email.refund-policy', { kicker: c.refund, text: c.refundText });
  const delivery = (): Block =>
    blk('email.delivery', {
      kicker: c.delivery,
      steps: [
        { label: c.ordered, status: 'done' },
        { label: c.processing, status: 'done' },
        { label: c.shipped, status: 'current' },
        { label: c.delivered, status: 'todo' },
      ],
    });
  const quote = (): Block => blk('email.quote', { text: c.quote, author: c.quoteAuthor });

  switch (key) {
    case 'welcome':
      return [hero(), steps(), rule(), social()];
    case 'verify':
      return [rule(), help()];
    case 'receipt':
      return [order(), tax(), pay(), refund()];
    case 'digest':
      return [stats(), hero(), steps()];
    case 'monthly':
      return [stats(), hero(), rule(), social()];
    case 'feature':
      return [hero(), steps(), rule(), social()];
    case 'reengage':
      return [hero(), steps(), social()];
    case 'reminder':
      return [steps(), help()];
    case 'paused':
      return [steps(), help()];
    case 'failed':
      return [steps(), help()];
    case 'shipped':
      return [delivery(), help()];
    case 'feedback':
      return [quote(), rule(), social()];
  }
}

interface StarterCopy {
  name: string;
  category: EmailCategory;
  icon: string;
  accent?: string | undefined;
  subject: string;
  preheader: string;
  heading: string;
  paras: string[];
  box?: { label: string; value: string } | undefined;
  cta: string;
  ctaUrl: string;
  /** A generated attachment the starter ships with (the comp's `seedAttach`). */
  generated?: { label: string; token: string } | undefined;
}

/** Every starter's copy, through the translator (`starterDefs`, comp 825-841). */
function starterCopy(key: EmailStarterKey, t: Translate): StarterCopy {
  switch (key) {
    case 'welcome':
      return {
        name: t('email.starters.welcome.name', { defaultValue: 'Welcome email' }),
        category: 'lifecycle',
        icon: 'party-popper',
        subject: t('email.starters.welcome.subject', { appName: V.appName, defaultValue: 'Welcome to {appName} 👋' }),
        preheader: t('email.starters.welcome.preheader', { defaultValue: 'Let us get you set up' }),
        heading: t('email.starters.welcome.heading', { firstName: V.firstName, defaultValue: 'Welcome aboard, {firstName}!' }),
        paras: [
          t('email.starters.welcome.para1', {
            appName: V.appName,
            defaultValue: 'We’re glad to have you at {appName}. Your account is ready — here is how to get started.',
          }),
          t('email.starters.welcome.para2', {
            defaultValue: 'Need a hand? Reply to this email any time and a real person will help.',
          }),
        ],
        cta: t('email.starters.welcome.cta', { appName: V.appName, defaultValue: 'Open {appName}' }),
        ctaUrl: 'https://example.com/',
      };
    case 'shipped':
      return {
        name: t('email.starters.shipped.name', { defaultValue: 'Delivery update' }),
        category: 'transactional',
        icon: 'truck',
        subject: t('email.starters.shipped.subject', { orderNumber: V.orderNumber, defaultValue: 'Your order #{orderNumber} is on its way' }),
        preheader: t('email.starters.shipped.preheader', { defaultValue: 'Track your delivery' }),
        heading: t('email.starters.shipped.heading', { defaultValue: 'Your order has shipped' }),
        paras: [
          t('email.starters.shipped.para1', {
            firstName: V.firstName,
            orderNumber: V.orderNumber,
            defaultValue:
              'Good news, {firstName} — order #{orderNumber} has left our warehouse and is on its way. Track it with the button below.',
          }),
        ],
        cta: t('email.starters.shipped.cta', { defaultValue: 'Track delivery' }),
        ctaUrl: V.trackingUrl,
      };
    case 'receipt':
      return {
        name: t('email.starters.receipt.name', { defaultValue: 'Order receipt' }),
        category: 'transactional',
        icon: 'receipt',
        subject: t('email.starters.receipt.subject', { appName: V.appName, defaultValue: 'Your receipt from {appName}' }),
        preheader: t('email.starters.receipt.preheader', { defaultValue: 'Thanks for your order' }),
        heading: t('email.starters.receipt.heading', { defaultValue: 'Thanks for your order' }),
        paras: [
          t('email.starters.receipt.para1', {
            orderNumber: V.orderNumber,
            defaultValue:
              'This confirms we received your payment for order #{orderNumber}. A copy of your receipt is attached for your records.',
          }),
        ],
        box: { label: t('email.starters.receipt.boxLabel', { defaultValue: 'Amount charged' }), value: V.amount },
        cta: t('email.starters.receipt.cta', { defaultValue: 'View your order' }),
        ctaUrl: V.orderUrl,
        generated: { label: t('email.starters.receipt.attachment', { defaultValue: 'Receipt PDF' }), token: '{{receipt_pdf}}' },
      };
    case 'digest':
      return {
        name: t('email.starters.digest.name', { defaultValue: 'Weekly digest' }),
        category: 'marketing',
        icon: 'chart-column',
        subject: t('email.starters.digest.subject', { defaultValue: 'Your week in numbers 📊' }),
        preheader: t('email.starters.digest.preheader', { defaultValue: 'A quick recap of your week' }),
        heading: t('email.starters.digest.heading', { defaultValue: 'Here is how your week went' }),
        paras: [
          t('email.starters.digest.para1', {
            defaultValue: 'Your team completed 128 tasks and shipped 3 releases. Revenue is up 12% versus last week — nice work.',
          }),
        ],
        box: { label: t('email.starters.digest.boxLabel', { defaultValue: 'Tasks completed' }), value: '128' },
        cta: t('email.starters.digest.cta', { defaultValue: 'See full report' }),
        ctaUrl: 'https://example.com/reports',
      };
    case 'reminder':
      return {
        name: t('email.starters.reminder.name', { defaultValue: 'Appointment reminder' }),
        category: 'lifecycle',
        icon: 'timer',
        subject: t('email.starters.reminder.subject', { date: V.date, defaultValue: 'Your appointment is on {date}' }),
        preheader: t('email.starters.reminder.preheader', { time: V.time, defaultValue: 'See you at {time}' }),
        heading: t('email.starters.reminder.heading', { firstName: V.firstName, defaultValue: 'See you soon, {firstName}' }),
        paras: [
          t('email.starters.reminder.para1', {
            date: V.date,
            time: V.time,
            defaultValue:
              'Your appointment is on {date} at {time}. If you need to reschedule, reply to this email or use the button below.',
          }),
          t('email.starters.reminder.para2', { defaultValue: 'Please arrive a few minutes early.' }),
        ],
        cta: t('email.starters.reminder.cta', { defaultValue: 'Manage appointment' }),
        ctaUrl: 'https://example.com/appointments',
      };
    case 'feature':
      return {
        name: t('email.starters.feature.name', { defaultValue: 'Feature announcement' }),
        category: 'marketing',
        icon: 'megaphone',
        accent: '#ea580c',
        subject: t('email.starters.feature.subject', { defaultValue: 'Introducing Automations ⚡' }),
        preheader: t('email.starters.feature.preheader', { defaultValue: 'Automate the busywork' }),
        heading: t('email.starters.feature.heading', { defaultValue: 'Automate the busywork' }),
        paras: [
          t('email.starters.feature.para1', {
            defaultValue:
              'Say hello to Automations — build trigger → action workflows that run themselves. Welcome new signups, follow up on stalled orders and route work on autopilot.',
          }),
        ],
        cta: t('email.starters.feature.cta', { defaultValue: 'Try Automations' }),
        ctaUrl: 'https://example.com/automations',
      };
    case 'feedback':
      return {
        name: t('email.starters.feedback.name', { defaultValue: 'Feedback request' }),
        category: 'marketing',
        icon: 'message-square',
        subject: t('email.starters.feedback.subject', { firstName: V.firstName, defaultValue: 'How did we do, {firstName}?' }),
        preheader: t('email.starters.feedback.preheader', { defaultValue: 'Two minutes, one question' }),
        heading: t('email.starters.feedback.heading', { defaultValue: 'We’d love your feedback' }),
        paras: [
          t('email.starters.feedback.para1', {
            appName: V.appName,
            defaultValue:
              'You’ve been using {appName} for a little while now. Would you take two minutes to tell us how it’s going? Your answers shape what we build next.',
          }),
        ],
        cta: t('email.starters.feedback.cta', { defaultValue: 'Share feedback' }),
        ctaUrl: 'https://example.com/feedback',
      };
    case 'paused':
      return {
        name: t('email.starters.paused.name', { defaultValue: 'Account paused' }),
        category: 'lifecycle',
        icon: 'calendar-x',
        subject: t('email.starters.paused.subject', { appName: V.appName, defaultValue: 'Your {appName} account is paused' }),
        preheader: t('email.starters.paused.preheader', { defaultValue: 'Your data is safe' }),
        heading: t('email.starters.paused.heading', { defaultValue: 'Your account is paused' }),
        paras: [
          t('email.starters.paused.para1', {
            defaultValue:
              'Your account is paused, so you can’t sign in for now. Don’t worry — your data is safe and kept for 30 days.',
          }),
          t('email.starters.paused.para2', { defaultValue: 'Reactivate any time to pick up right where you left off.' }),
        ],
        box: {
          label: t('email.starters.paused.boxLabel', { defaultValue: 'Data kept for' }),
          value: t('email.starters.paused.boxValue', { defaultValue: '30 days' }),
        },
        cta: t('email.starters.paused.cta', { defaultValue: 'Reactivate account' }),
        ctaUrl: 'https://example.com/account',
      };
    case 'monthly':
      return {
        name: t('email.starters.monthly.name', { defaultValue: 'Monthly report' }),
        category: 'marketing',
        icon: 'calendar-range',
        subject: t('email.starters.monthly.subject', { month: V.month, defaultValue: 'Your {month} report is ready 📈' }),
        preheader: t('email.starters.monthly.preheader', { defaultValue: 'Your month in review' }),
        heading: t('email.starters.monthly.heading', { month: V.month, defaultValue: 'Your {month} in review' }),
        paras: [
          t('email.starters.monthly.para1', {
            appName: V.appName,
            defaultValue:
              'Here’s the story of your month on {appName}. Your team shipped more and moved faster — revenue climbed 18% versus last month.',
          }),
          t('email.starters.monthly.para2', { defaultValue: 'Dive into the full breakdown to see exactly what drove the numbers.' }),
        ],
        box: { label: t('email.starters.monthly.boxLabel', { defaultValue: 'Monthly revenue' }), value: V.revenue },
        cta: t('email.starters.monthly.cta', { defaultValue: 'View full report' }),
        ctaUrl: 'https://example.com/reports',
      };
    case 'verify':
      return {
        name: t('email.starters.verify.name', { defaultValue: 'Confirm your email' }),
        category: 'transactional',
        icon: 'mail-check',
        subject: t('email.starters.verify.subject', { defaultValue: 'Confirm your email address' }),
        preheader: t('email.starters.verify.preheader', { defaultValue: 'One quick step' }),
        heading: t('email.starters.verify.heading', { defaultValue: 'Confirm your email' }),
        paras: [
          t('email.starters.verify.para1', {
            appName: V.appName,
            defaultValue:
              'Thanks for signing up! Please confirm your email address to activate your {appName} account. This helps keep your account secure.',
          }),
        ],
        cta: t('email.starters.verify.cta', { defaultValue: 'Confirm email address' }),
        ctaUrl: V.verifyUrl,
      };
    case 'failed':
      return {
        name: t('email.starters.failed.name', { defaultValue: 'Payment failed' }),
        category: 'transactional',
        icon: 'credit-card',
        accent: '#e5484d',
        subject: t('email.starters.failed.subject', { defaultValue: 'Action needed: payment failed' }),
        preheader: t('email.starters.failed.preheader', { defaultValue: 'Update your payment method' }),
        heading: t('email.starters.failed.heading', { defaultValue: 'Your payment didn’t go through' }),
        paras: [
          t('email.starters.failed.para1', {
            orderNumber: V.orderNumber,
            defaultValue:
              'We tried to charge your card for order #{orderNumber} but the payment failed. To avoid a delay, please update your payment method.',
          }),
          t('email.starters.failed.para2', { defaultValue: 'We’ll try again in 3 days.' }),
        ],
        box: { label: t('email.starters.failed.boxLabel', { defaultValue: 'Amount due' }), value: V.amount },
        cta: t('email.starters.failed.cta', { defaultValue: 'Update payment method' }),
        ctaUrl: 'https://example.com/account/payment',
      };
    case 'reengage':
      return {
        name: t('email.starters.reengage.name', { defaultValue: 'Re-engagement' }),
        category: 'marketing',
        icon: 'sparkles',
        accent: '#0d9488',
        subject: t('email.starters.reengage.subject', { appName: V.appName, defaultValue: 'We miss you at {appName}' }),
        preheader: t('email.starters.reengage.preheader', { defaultValue: 'See what is new' }),
        heading: t('email.starters.reengage.heading', { firstName: V.firstName, defaultValue: 'It’s been a while, {firstName}' }),
        paras: [
          t('email.starters.reengage.para1', {
            defaultValue:
              'A lot has changed since you were last here. We’ve shipped Automations, faster dashboards and a brand-new report builder.',
          }),
          t('email.starters.reengage.para2', { defaultValue: 'Come take a look — your account is right where you left it.' }),
        ],
        cta: t('email.starters.reengage.cta', { defaultValue: 'Jump back in' }),
        ctaUrl: 'https://example.com/',
      };
  }
}

/** The starters' shared footer — the operator's, not the vendor's (Appendix B). */
export function starterFooter(t: Translate): string {
  return t('email.starters.footer', {
    appName: V.appName,
    defaultValue: 'You are receiving this because you have an {appName} account.\nQuestions? Reply to this email.',
  });
}

/**
 * One starter rendered for a locale: the comp's `buildBlocks` (heading ·
 * body · [box] · cta) with the topic's extras spliced in before the CTA, the
 * shared footer, and — for the three the comp tints — a brand carrying only
 * the accent (name and sender fall back to the workspace, 39 D6).
 */
export function renderStarter(key: EmailStarterKey, t: Translate): EmailStarter {
  const copy = starterCopy(key, t);
  const blocks: Block[] = [
    blk('email.heading', { text: copy.heading, level: 1 }),
    blk('email.text', { paras: copy.paras }),
  ];
  if (copy.box !== undefined) blocks.push(blk('email.box', { label: copy.box.label, value: copy.box.value }));
  blocks.push(...extras(key, t));
  blocks.push(blk('email.button', { label: copy.cta, url: copy.ctaUrl }));

  const brand: EmailBrand | null =
    copy.accent === undefined ? null : { name: '', mark: 'hexagon', accent: copy.accent, fromName: '', fromEmail: '' };

  return {
    key,
    name: copy.name,
    category: copy.category,
    icon: copy.icon,
    accent: copy.accent ?? DEFAULT_ACCENT,
    heading: copy.heading,
    document: {
      subject: copy.subject,
      preheader: copy.preheader,
      blocks: blocks.map((b) => ({
        id: String(b['id']),
        block: String(b['block']),
        data: b['data'] as Record<string, unknown>,
        style: (b['style'] ?? {}) as EmailDocument['blocks'][number]['style'],
      })),
      footer: starterFooter(t),
      brand,
      attachments:
        copy.generated === undefined
          ? []
          : [{ id: newBlockId(), kind: 'generated', label: copy.generated.label, token: copy.generated.token }],
    },
  };
}

/** The New modal's cards, localized (`GET /email-templates/starters`). */
export function starterCards(t: Translate): EmailStarterCard[] {
  return EMAIL_STARTER_KEYS.map((key) => {
    const { document: _document, ...card } = renderStarter(key, t);
    return card;
  });
}

/**
 * Sample values for a test send (39 §3.1 `test-send`): plausible, obviously
 * fake, and covering every var a starter uses. `receipt_pdf` is deliberately
 * absent — a generated attachment whose token is not a known file id is
 * skipped with a warning, which is exactly the contract (39 D8).
 */
export function starterSampleVars(ctx: { appName: string; origin: string; to: string }): Record<string, string> {
  return {
    appName: ctx.appName,
    name: 'Sample Recipient',
    first_name: 'Sample',
    email: ctx.to,
    order_number: '10042',
    amount: '$290.00',
    month: 'July',
    revenue: '$48.2k',
    date: 'Tuesday, 15 September',
    time: '10:30',
    verify_url: `${ctx.origin}/verify/sample-token`,
    order_url: `${ctx.origin}/orders/10042`,
    tracking_url: `${ctx.origin}/track/10042`,
  };
}
