// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pay page's own API, for whoever holds a pay link.
 *
 * ─── WHAT IT ANSWERS ───────────────────────────────────────────────────────
 *
 *   GET  /pay/api/:token            the page: the shop, what is due, the ways to pay, or why not
 *   GET  /pay/api/:token/challenge  the human check for this link (solved when Pay is pressed)
 *   POST /pay/api/:token/checkout   start paying with one service: where to send the customer
 *   GET  /pay/api/back/:nonce       the customer came back: how it stands now, asked of the provider
 *
 * ─── THE RULES IT KEEPS ────────────────────────────────────────────────────
 *
 * - Every request asks first whether customers can reach the pay address;
 *   when they cannot, every link stops working.
 * - The amount is read again on every request: a link never carries one and
 *   a browser never sends one.
 * - A link that is unknown, revoked, replaced or expired answers the same.
 * - The page never shows the customer's name, address, email or past
 *   payments: links get forwarded. Partly paid says only how much of the
 *   total is already paid.
 * - A test link opens only for a signed-in person who may manage payments;
 *   every other request ignores any staff session.
 * - Starting a checkout costs a human check bound to the link, and is capped
 *   per link, per network address and per install, in meta (every process
 *   counts the same). A link whose payments keep failing locks for the hour.
 * - Nothing is ever cached, and no referrer leaves the page.
 */
import { subtractAmounts, type PaymentMode } from '@adminium/add-on-contracts';
import { localeFromTag, type LocaleId } from '@adminium/i18n';
import { createServerI18n, type I18nInstance } from '@adminium/i18n/server';
import { translationsRepo, paymentAttemptsRepo, paymentCountersRepo, paymentLinksRepo, paymentMethodsRepo, paymentSettingsRepo, publicProofsRepo, type MetaDb, type PaymentAttempt, type PaymentLink } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import { LINK_FAILURES_TO_LOCK, linkFailBucket, type CheckoutService } from '../../payments/checkout.js';
import { linkForToken, linkOpens, linkStateForToken, payAddress, payReachable } from '../../payments/links.js';
import { currencyScale } from '@adminium/manifest';
import { resolvePayable, type PayableSources, type ResolvedPayable } from '../../payments/payables.js';
import type { ProviderLookup } from '../../payments/providers.js';
import { isTestPayable } from '../../payments/test-payables.js';
import { waysFor, type WayOffer } from '../../payments/ways.js';
import { checkProof, issueChallenge, proofKey } from '../../public-api/proof.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { PAY_PAGE_DOC, payPageSchema } from '../payments/ways.js';
import { loadOverrideMap } from '../../i18n/server-i18n.js';

export interface PayRoutesDeps {
  meta: MetaDb;
  sources: PayableSources;
  checkout: CheckoutService;
  /** The providers that can take a checkout now in a mode, by key. */
  readyProviders: (mode: 'test' | 'live') => Promise<string[]>;
  secret: string;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  /** Whether the receipt email went out for a payment; none sent when not given. */
  receiptSent?: (attempt: PaymentAttempt) => Promise<boolean>;
  /** The provider for a key and mode (`paymentProviderFor`): what a staff test payment offers by default. */
  providerFor?: (key: string, mode: PaymentMode) => Promise<ProviderLookup>;
  now?: () => number;
}

/** Checkouts one link may start in an hour. */
export const LINK_CHECKOUTS_PER_HOUR = 20;
/** Checkouts one network address may start in an hour (carrier NAT puts many phones behind one). */
export const ADDRESS_CHECKOUTS_PER_HOUR = 60;
/** Checkouts one install may start in an hour, every link together. */
export const INSTALL_CHECKOUTS_PER_HOUR = 600;

export const PAY_STATES = [
  'ready',
  'unknown',
  'unavailable',
  'test-staff-only',
  'paid',
  'processing',
  'checking',
  'failed',
  'cancelled',
  'nothing-due',
  'voided',
  'no-ways',
  'locked',
  'expired',
  'shop-checks',
  'test-ended',
] as const;
export type PayState = (typeof PAY_STATES)[number];

const tokenParams = z.object({ token: z.string().min(1).max(64) });
const nonceParams = z.object({ nonce: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });
/** The page's own eight languages: the one the customer reads is handed to the service's page. */
const PAGE_LOCALES = ['en-US', 'ar-EG', 'cs-CZ', 'da-DK', 'de-DE', 'fr-FR', 'zh-CN', 'zh-TW'] as const;
const checkoutBody = z.object({ source: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/), locale: z.enum(PAGE_LOCALES).optional() });

const shopView = z.object({ name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), hasLogo: z.boolean() });
const pageReply = z.object({
  state: z.enum(PAY_STATES),
  test: z.boolean(),
  shop: shopView,
  payable: z
    .object({
      label: z.string(),
      currency: z.string(),
      due: z.string(),
      total: z.string(),
      alreadyPaid: z.string().nullable(),
      /** `YYYY-MM-DD`, when the record says. */
      dueDate: z.string().nullable(),
      /** The record's lines, when the shop shows them. */
      lines: z.array(z.object({ label: z.string(), amount: z.string() })).nullable(),
    })
    .nullable(),
  ways: z.array(z.object({ source: z.string(), method: z.string(), label: z.record(z.string(), z.string()).nullable(), details: z.unknown() })),
  /** For `processing`: how the payment was made and when it started. */
  processing: z.object({ method: z.string().nullable(), startedAt: z.number() }).nullable(),
  /** On the way back: which service, what it took and when, and whether a receipt went out. */
  attempt: z.object({ provider: z.string(), amount: z.string(), currency: z.string(), at: z.number(), receiptSent: z.boolean() }).nullable(),
});
type PageReply = z.infer<typeof pageReply>;
const challengeReply = z.object({ id: z.string(), salt: z.string(), difficulty: z.number(), expiresAt: z.number() });
const checkoutReply = z.union([z.object({ url: z.string() }), z.object({ state: z.enum(PAY_STATES), message: z.string().nullable(), code: z.string().optional() })]);

/** A checkout answer that is a state, not a redirect; `code` is why the service refused, so the page can say what may follow. */
function say(state: PayState, message: string | null = null, code?: string): { state: PayState; message: string | null; code?: string } {
  return code === undefined ? { state, message } : { state, message, code };
}

function noStore(reply: FastifyReply): void {
  void reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
}

/** Partly paid: the total less what is due, shown as one sentence and never as a list. Exact decimals only. */
export function paidSoFar(payable: Pick<ResolvedPayable, 'total' | 'due' | 'currency'>): string | null {
  const scale = currencyScale(payable.currency);
  const paid = subtractAmounts(payable.total, payable.due, scale);
  const left = subtractAmounts(payable.due, '0', scale);
  // Nothing paid yet, or nothing left (that is "paid"), or an amount that is not exact: no sentence.
  if (paid === null || left === null || /^-|^0(\.0*)?$/.test(paid) || /^-|^0(\.0*)?$/.test(left)) return null;
  return paid;
}


/** Whether the request came through a proxy: it carries the headers one adds. */
function forwardedOf(request: FastifyRequest): boolean {
  return request.headers['x-forwarded-for'] !== undefined || request.headers['forwarded'] !== undefined;
}

/** A payment that was taken, but differs from what was asked: the shop looks at it. */
const AMOUNT_PROBLEMS: ReadonlySet<string> = new Set(['AMOUNT_DIFFERS', 'CURRENCY_DIFFERS', 'MORE_THAN_DUE']);

/**
 * How a pay link's page stands, from scratch, every time: what the API answers
 * and what the HTML writes for a browser with JavaScript off.
 */
export function createPayPageReader(deps: PayRoutesDeps) {
  const { meta } = deps;
  const now = deps.now ?? (() => Date.now());
  const counters = paymentCountersRepo(meta);
  const attempts = paymentAttemptsRepo(meta);
  const proofs = publicProofsRepo(meta);
  const key = proofKey(deps.secret);

  async function shop() {
    const page = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema);
    // The shop's name, never the software's: an unnamed shop goes by its pay address.
    const named = page?.shopName?.trim() ?? '';
    const name = named === '' || named === 'Adminium' ? ((await payAddress(meta)) ?? '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '') : named;
    return { name, email: page?.contactEmail ?? null, phone: page?.contactPhone ?? null, hasLogo: (page?.logoFileId ?? null) !== null, country: page?.shopCountry ?? null };
  }

  async function reachable(request: FastifyRequest): Promise<boolean> {
    return (await payReachable(meta, { networkFeatures: deps.networkFeatures, desktop: deps.desktop, trustProxy: deps.trustProxy, forwarded: forwardedOf(request) })).state === 'reachable';
  }

  /** A test link opens only for someone signed in who may manage payments. */
  async function mayOpen(request: FastifyRequest, link: PaymentLink): Promise<boolean> {
    if (link.mode === 'live') return true;
    try {
      return request.apiKeyPrincipal == null && (await request.can(PERMISSIONS.paymentsManage));
    } catch {
      return false;
    }
  }

  async function waysOf(payable: ResolvedPayable, country: string | null, mode: 'test' | 'live'): Promise<WayOffer[]> {
    // A staff test payable offers its one service, whatever the ways' rules say:
    // the demo service always (it needs no account), any other when it is ready.
    if (payable.onlyProvider !== undefined) {
      if (payable.onlyProvider === 'demo') return mode === 'test' ? [{ source: 'demo', method: 'card', label: null, details: null }] : [];
      if (!(await deps.readyProviders(mode)).includes(payable.onlyProvider)) return [];
      const methods = (await paymentMethodsRepo(meta).list()).filter((one) => one.source === payable.onlyProvider && one.enabled);
      if (methods.length > 0) return methods.map((one) => ({ source: one.source, method: one.method, label: null, details: null }));
      // No way of it set up yet: the service's own first way (PayPal takes `paypal` only), else a card.
      return [{ source: payable.onlyProvider, method: (await firstMethodOf(payable.onlyProvider, mode, payable)) ?? 'card', label: null, details: null }];
    }
    const ways = waysFor({
      methods: await paymentMethodsRepo(meta).list(),
      payable: { kind: payable.ref.kind, profileId: payable.ref.kind === 'profile' ? await profileIdOf(payable) : null, currency: payable.currency, due: payable.due, customerCountry: payable.customerCountry },
      shopCountry: country,
      providers: await deps.readyProviders(mode),
    });
    // A test link opens only for staff: it also offers the demo service, so a test payment needs no account.
    return mode === 'test' && !ways.some((way) => way.source === 'demo') ? [...ways, { source: 'demo', method: 'card', label: null, details: null }] : ways;
  }

  /** The first way a service lists for this payable (the list Ways to pay offers), or null when it cannot be asked. */
  async function firstMethodOf(key: string, mode: 'test' | 'live', payable: ResolvedPayable): Promise<string | null> {
    if (deps.providerFor === undefined) return null;
    try {
      const lookup = await deps.providerFor(key, mode);
      if (!lookup.ok) return null;
      const answer = await lookup.provider.methodsFor({ country: null, currency: payable.currency, amount: payable.due });
      return answer.ok === true ? (answer.methods[0]?.id ?? null) : null;
    } catch {
      return null;
    }
  }

  async function profileIdOf(payable: ResolvedPayable): Promise<string | null> {
    if (payable.ref.connectionId === null || payable.ref.tableName === null) return null;
    return (await deps.sources.profile(payable.ref.connectionId, payable.ref.tableName))?.id ?? null;
  }

  function stateOfAttempt(attempt: PaymentAttempt): PayState | null {
    switch (attempt.state) {
      case 'processing':
        return 'processing';
      case 'succeeded':
      case 'recording':
      case 'recorded':
        return 'paid';
      // Taken but not recordable: a person decides. A payment that differs from
      // what was asked is "the shop will check"; any other arrived money is paid.
      case 'record_refused':
        return AMOUNT_PROBLEMS.has(attempt.problem?.code ?? '') ? 'shop-checks' : 'paid';
      default:
        return null;
    }
  }

  /** What the page shows of a payable: never the customer's name, address or email; its lines only when the shop shows them. */
  async function shownOf(payable: ResolvedPayable): Promise<NonNullable<PageReply['payable']>> {
    const settings = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema);
    const lines = settings?.showLines === true && deps.sources.lines !== undefined ? await deps.sources.lines(payable.ref) : null;
    return { label: payable.label, currency: payable.currency, due: payable.due, total: payable.total, alreadyPaid: paidSoFar(payable), dueDate: payable.dueDate, lines };
  }

  /** Whether a receipt went to the customer for this payment (the receipt email's own record). */
  async function receiptSentFor(attempt: PaymentAttempt): Promise<boolean> {
    return deps.receiptSent === undefined ? false : deps.receiptSent(attempt);
  }

  /** The page for a link, from scratch, every time. */
  async function page(request: FastifyRequest, token: string): Promise<PageReply> {
    const shopInfo = await shop();
    const { country, ...shopView } = shopInfo;
    const base: PageReply = { state: 'unknown', test: false, shop: shopView, payable: null, ways: [], processing: null, attempt: null };
    const opened = await linkStateForToken(meta, token, now());
    // A test link opens for signed-in staff only, so it needs no public
    // address: the staff preview and a test payment work on every install.
    // Everything else stops while customers cannot reach the pay address.
    const staffTest = opened.state === 'open' && opened.link.mode === 'test';
    if (!staffTest && !(await reachable(request))) return { ...base, state: 'unavailable' };
    if (opened.state === 'expired') return { ...base, state: 'expired' };
    if (opened.state === 'test-ended') return { ...base, state: 'test-ended', test: true };
    if (opened.state !== 'open') return base;
    const { link } = opened;
    if (!(await mayOpen(request, link))) return { ...base, state: 'test-staff-only', test: true };
    // A staff test payable is never paid through a live link.
    if (isTestPayable(link.payable) && link.mode === 'live') return base;
    const payable = await resolvePayable(deps.sources, link.payable);
    if (payable === null) return base;
    const shown = await shownOf(payable);
    // What holds the payable: the open attempt, else money taken and not yet written down — succeeded,
    // being recorded, or refused and not yet looked at (the shop decides; the customer never pays twice).
    const open =
      (await attempts.openFor(payable.ref, link.mode)) ??
      (await attempts.forPayable(payable.ref, 20)).find((one) => one.mode === link.mode && (one.state === 'succeeded' || one.state === 'recording' || (one.state === 'record_refused' && one.check === null))) ??
      null;
    const held = open === null ? null : stateOfAttempt(open);
    if (held === 'processing') return { ...base, state: 'processing', test: link.mode === 'test', payable: shown, processing: { method: (open?.paidWith as { label?: string } | null)?.label ?? null, startedAt: open!.createdAt } };
    if (held === 'paid' || held === 'shop-checks') return { ...base, state: held, test: link.mode === 'test', payable: shown };
    if (payable.refusal !== null) {
      const state: PayState = payable.refusal.code === 'VOIDED' ? 'voided' : payable.refusal.code === 'NOTHING_DUE' ? 'paid' : payable.refusal.code === 'NOT_SENT' ? 'nothing-due' : 'unavailable';
      return { ...base, state, test: link.mode === 'test', payable: shown };
    }
    const ways = await waysOf(payable, country, link.mode);
    if (ways.length === 0) return { ...base, state: 'no-ways', test: link.mode === 'test', payable: shown };
    const locked = (await counters.read(linkFailBucket(link.id), now())) >= LINK_FAILURES_TO_LOCK;
    // A locked link still shows the ways to pay by hand.
    if (locked) return { ...base, state: 'locked', test: link.mode === 'test', payable: shown, ways: ways.filter((way) => way.source === 'manual') };
    return { ...base, state: 'ready', test: link.mode === 'test', payable: shown, ways };
  }

  /** Staff only: the pay page settings' preview (a made-up invoice, as a customer would see it). */
  async function mayPreview(request: FastifyRequest): Promise<boolean> {
    if (request.apiKeyPrincipal != null) return false;
    try {
      return (await request.can(PERMISSIONS.paymentsManage)) || (await request.can(PERMISSIONS.paymentsView));
    } catch {
      return false;
    }
  }

  // ── With JavaScript off ─────────────────────────────────────────────────
  // The page cannot run, so the server writes what a customer can still use:
  // the bank details (no copy buttons), else how to reach the shop. In the
  // browser's language when it is one of the eight, with Latin digits.
  const translators = new Map<string, { at: number; i18n: Promise<I18nInstance> }>();
  function translator(locale: LocaleId): Promise<I18nInstance> {
    const cached = translators.get(locale);
    if (cached !== undefined && now() - cached.at < 60_000) return cached.i18n;
    const i18n = loadOverrideMap(meta, locale).then((overrides) => createServerI18n({ locale, overrides }));
    translators.set(locale, { at: now(), i18n });
    return i18n;
  }

  async function noscript(request: FastifyRequest, token: string): Promise<string> {
    const answer = await page(request, token);
    const wanted = String(request.headers['accept-language'] ?? '')
      .split(',')
      .map((part) => part.split(';')[0]!.trim())
      .filter((tag) => tag !== '');
    const locale = wanted.map((tag) => localeFromTag(tag)).find((found, index) => found !== 'en_US' || wanted[index]!.toLowerCase().startsWith('en')) ?? 'en_US';
    const i18n = await translator(locale);
    const t = (key: string, fallback: string, values?: Record<string, string>): string => escapeHtml(i18n.t(key, { defaultValue: fallback, ns: 'pay', ...values }));
    const tag = locale.replace('_', '-');
    const money = (amount: string, currency: string): string => {
      const decimals = (amount.split('.')[1] ?? '').length;
      try {
        return new Intl.NumberFormat(`${tag}-u-nu-latn`, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount as `${number}`); // the decimal string itself: exact, where a Number would round past 15 digits
      } catch {
        return `${currency} ${amount}`;
      }
    };
    const parts: string[] = [`<section class="pp-card pp-status" data-tone="warning"><h1 class="pp-h2">${t('pay:noscript.title', 'This page needs JavaScript to pay online.')}</h1></section>`];
    const bank = answer.ways.find((way) => way.source === 'manual' && way.method === 'bank-transfer') ?? null;
    const payable = answer.payable;
    const accounts = ((bank?.details as { accounts?: Record<string, unknown>[] } | null)?.accounts ?? []).filter((account) => account['currency'] === undefined || account['currency'] === payable?.currency);
    if (payable !== null && accounts.length > 0) {
      const rows: string[] = [];
      const row = (label: string, value: string): void => {
        rows.push(`<div class="pp-row"><div class="pp-row-text"><dt class="pp-row-label">${label}</dt><dd class="pp-row-value"><bdi dir="ltr">${escapeHtml(value)}</bdi></dd></div></div>`);
      };
      const account = accounts[0]!;
      const text = (key: string): string | null => (typeof account[key] === 'string' && account[key] !== '' ? (account[key] as string) : null);
      if (text('holder') !== null) row(t('pay:bank.holder', 'Account holder'), text('holder')!);
      if (text('iban') !== null) row(t('pay:bank.iban', 'IBAN'), text('iban')!.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim());
      if (text('bic') !== null) row(t('pay:bank.bic', 'BIC'), text('bic')!);
      if (text('accountNumber') !== null) row(t('pay:bank.accountNumber', 'Account number'), text('accountNumber')!);
      if (text('sortCode') !== null) row(t('pay:bank.sortCode', 'Sort code'), text('sortCode')!);
      if (text('bank') !== null) row(t('pay:bank.bankName', 'Bank'), text('bank')!);
      row(t('pay:bank.amount', 'Amount'), money(payable.due, payable.currency));
      row(t('pay:bank.reference', 'Reference'), payable.label);
      parts.push(
        `<section class="pp-card pp-bank"><h2 class="pp-h2">${t('pay:bank.title', 'Bank transfer')}</h2><dl class="pp-rows">${rows.join('')}</dl><p class="pp-small">${t('pay:bank.note', 'Use this reference so the shop can find your payment. It shows as paid once the shop has checked.')}</p></section>`,
      );
    }
    const contact: string[] = [];
    if (answer.shop.email !== null) contact.push(`<a href="mailto:${escapeHtml(answer.shop.email)}"><bdi dir="ltr">${escapeHtml(answer.shop.email)}</bdi></a>`);
    if (answer.shop.phone !== null) contact.push(`<a href="tel:${escapeHtml(answer.shop.phone.replace(/\s+/g, ''))}"><bdi dir="ltr">${escapeHtml(answer.shop.phone)}</bdi></a>`);
    if (contact.length > 0) parts.push(`<p class="pp-small">${t('pay:footer.questions', 'Questions? Write to')} ${contact.join(' · ')}</p>`);
    return `<main class="pp-main" data-solo="" lang="${tag}" dir="${locale === 'ar_EG' ? 'rtl' : 'ltr'}"><div class="pp-col">${parts.join('')}</div></main>`;
  }

  return { meta, now, counters, attempts, proofs, key, shop, reachable, mayOpen, waysOf, stateOfAttempt, shownOf, receiptSentFor, page, mayPreview, noscript };
}

/** Text for HTML: the five characters that could open markup, escaped. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export type PayPageReader = ReturnType<typeof createPayPageReader>;

export function payRoutes(deps: PayRoutesDeps): FastifyPluginAsyncZod {
  const { meta, now, counters, attempts, proofs, key, shop, reachable, mayOpen, stateOfAttempt, shownOf, receiptSentFor, page, mayPreview } = createPayPageReader(deps);

  return async (app) => {
    // The pay page's own words as the shop reworded them in Translations: this one namespace only, the
    // words every customer already reads on the page, so anyone may ask. Nothing else is served here.
    app.get(
      '/pay/api/words/:locale',
      { config: { rateLimitBucket: 'pay-page' }, schema: { hide: true, params: z.object({ locale: z.enum(PAGE_LOCALES) }), response: { 200: z.object({ words: z.record(z.string(), z.string()) }) } } },
      async (request, reply) => {
        void reply.header('cache-control', 'public, max-age=60');
        const rows = await translationsRepo(meta).listBundle(request.params.locale.replace('-', '_'), 'pay');
        const words: Record<string, string> = {};
        for (const row of rows) words[row.key] = row.value;
        return { words };
      },
    );

    app.get(
      '/pay/api/preview',
      { config: { rateLimitBucket: 'pay-page' }, schema: { hide: true, response: { 200: pageReply } } },
      async (request, reply): Promise<PageReply> => {
        noStore(reply);
        const { country, ...shopView } = await shop();
        if (!(await mayPreview(request))) return { state: 'unknown', test: false, shop: shopView, payable: null, ways: [], processing: null, attempt: null };
        const settings = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema);
        const due = new Date(now() + 14 * 86_400_000).toISOString().slice(0, 10);
        const sample = { label: 'INV-0042', currency: 'EUR', due: '120.00', total: '120.00', alreadyPaid: null, dueDate: due };
        const lines = settings?.showLines === true ? [{ label: 'Sourdough loaves × 24', amount: '96.00' }, { label: 'Delivery', amount: '24.00' }] : null;
        const ways = waysFor({
          methods: await paymentMethodsRepo(meta).list(),
          payable: { kind: 'document', profileId: null, currency: sample.currency, due: sample.due, customerCountry: null },
          shopCountry: country,
          providers: await deps.readyProviders('live').then(async (live) => (live.length > 0 ? live : deps.readyProviders('test'))),
        });
        // As a customer sees a live link: no test band.
        return { state: 'ready', test: false, shop: shopView, payable: { ...sample, lines }, ways: ways.length > 0 ? ways : [{ source: 'demo', method: 'card', label: null, details: null }], processing: null, attempt: null };
      },
    );

    app.get(
      '/pay/api/:token',
      { config: { rateLimitBucket: 'pay-page' }, schema: { hide: true, params: tokenParams, response: { 200: pageReply } } },
      async (request, reply) => {
        noStore(reply);
        return page(request, request.params.token);
      },
    );

    app.get(
      '/pay/api/:token/challenge',
      { config: { rateLimitBucket: 'pay-page' }, schema: { hide: true, params: tokenParams, response: { 200: challengeReply } } },
      async (request, reply) => {
        noStore(reply);
        const link = await linkForToken(meta, request.params.token, now());
        // An unknown link still gets a challenge: the answer must not tell which tokens exist.
        return issueChallenge(key, link?.id ?? 'none', 'pay', now());
      },
    );

    app.post(
      '/pay/api/:token/checkout',
      {
        config: {
          rateLimitBucket: 'pay-checkout',
          // A live link's page posts with no cookie; a test link's carries the
          // staff session, and the Origin check still keeps other sites out.
          csrf: 'origin',
          audit: auditExempt('the attempt row it makes is the record; a customer is not an actor the audit log names'),
        },
        schema: { hide: true, params: tokenParams, body: checkoutBody, response: { 200: checkoutReply, 403: checkoutReply } },
      },
      async (request, reply) => {
        noStore(reply);
        const answer = await page(request, request.params.token);
        if (answer.state !== 'ready') return say(answer.state);
        const link = await linkForToken(meta, request.params.token, now());
        // Revoked, replaced or expired a moment ago: as any link that does not open.
        if (link === null) return say('unknown');

        const proved = checkProof(key, request.headers['x-adminium-proof'], { keyId: link.id, purpose: 'pay', now: now() });
        if (!proved.ok || !(await proofs.spend({ id: proved.spendId, keyId: link.id, purpose: 'pay', expiresAt: proved.expiresAt }))) {
          return reply.status(403).send(say('ready', 'The check that you are a person did not pass. Try again.'));
        }
        const caps: [string, number][] = [
          [`link:${link.id}`, LINK_CHECKOUTS_PER_HOUR],
          [`address:${request.ip}`, ADDRESS_CHECKOUTS_PER_HOUR],
          ['install', INSTALL_CHECKOUTS_PER_HOUR],
        ];
        for (const [bucket, max] of caps) {
          if ((await counters.hit(`checkout-${bucket}`, now())) > max) return say('locked');
        }

        const way = answer.ways.find((one) => one.source === request.body.source && one.source !== 'manual');
        if (way === undefined) return say('no-ways');
        const payable = await resolvePayable(deps.sources, link.payable);
        if (payable === null) return say('unknown');
        // A test link is opened by signed-in staff, whose session lives on the
        // host they signed in on: a test payment comes back there. A live one
        // always comes back to the pay address.
        const address = link.mode === 'test' ? `${request.protocol}://${request.host}` : await payAddress(meta);
        const started = await deps.checkout.start({
          link,
          payable,
          provider: request.body.source,
          methods: answer.ways.filter((one) => one.source === request.body.source).map((one) => one.method),
          payAddress: address!,
          locale: request.body.locale ?? null,
        });
        if (started.kind === 'redirect') return { url: started.url };
        if (started.kind === 'in-progress') return say('processing');
        if (started.kind === 'busy') return say('checking');
        return say('failed', started.message, started.code);
      },
    );

    app.get(
      '/pay/api/back/:nonce',
      { config: { rateLimitBucket: 'pay-page' }, schema: { hide: true, params: nonceParams, response: { 200: pageReply } } },
      async (request, reply): Promise<PageReply> => {
        noStore(reply);
        const { name, email, phone, hasLogo } = await shop();
        const base: PageReply = { state: 'unknown', test: false, shop: { name, email, phone, hasLogo }, payable: null, ways: [], processing: null, attempt: null };
        const found = await attempts.byNonce(request.params.nonce);
        const link = found?.linkId == null ? null : await paymentLinksRepo(meta).byId(found.linkId);
        if (link?.mode !== 'test' && !(await reachable(request))) return { ...base, state: 'unavailable' };
        if (found === null || link === null || !(await mayOpen(request, link))) return base;
        // Asked of the provider, once; never decided by the redirect.
        const attempt = (await deps.checkout.settle(found.id)) ?? found;
        // A link revoked, replaced or expired since still tells its holder how
        // their own payment stands, but no longer what the record asks.
        const payable = linkOpens(link, now()) ? await resolvePayable(deps.sources, attempt.payable) : null;
        const shown = payable === null ? null : await shownOf(payable);
        const test = attempt.mode === 'test';
        const told = {
          ...base,
          test,
          payable: shown,
          attempt: {
            provider: attempt.provider,
            amount: attempt.takenAmount ?? attempt.amount,
            currency: attempt.takenCurrency ?? attempt.currency,
            at: attempt.updatedAt,
            receiptSent: await receiptSentFor(attempt),
          },
        };
        if (attempt.state === 'failed') return { ...told, state: 'failed' };
        if (attempt.state === 'cancelled' || attempt.state === 'expired' || attempt.state === 'abandoned') return { ...told, state: 'cancelled' };
        const held = stateOfAttempt(attempt);
        if (held === 'processing') return { ...told, state: 'processing', processing: { method: (attempt.paidWith as { label?: string } | null)?.label ?? null, startedAt: attempt.createdAt } };
        if (held === 'paid' || held === 'shop-checks') return { ...told, state: held };
        // Still open at the provider: the page asks again in a moment.
        return { ...told, state: 'checking' };
      },
    );
  };
}

export type { PageReply as PayPageReply };
