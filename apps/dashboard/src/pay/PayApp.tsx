// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The customer's pay page.
 *
 * Every outcome comes from the server, which asks the payment service: the
 * page never decides that a payment went through. It shows the shop (never
 * the customer: links get forwarded), what is due, and the ways the shop's
 * rules allow; a press of a provider's way solves the human check, asks for a
 * checkout and sends the browser to the provider's page the server checked.
 * Coming back, it asks again every few seconds until the answer is final.
 *
 * A status change is read out in a polite live region, title and its key
 * sentence. Focus is never moved by a refresh; after the person's own press
 * removes the control they used, it goes to the heading of what replaced it.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { switchLocale } from '@adminium/i18n/page';
import { useI18n, useLocale, useT } from '@adminium/i18n/react';
import {
  ArrowLeft,
  ArrowUpRight,
  Ban,
  Banknote,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  CreditCard,
  FlaskConical,
  Globe,
  Hourglass,
  Info,
  Landmark,
  Link2Off,
  LoaderCircle,
  Lock,
  Mail,
  Phone,
  RotateCcw,
  Store,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { fetchBack, fetchChallenge, fetchPreview, isPreviewEdit, mayGoTo, openLink, postCheckout, type Credentials, type PayPage, type PayState, type PayWay } from './api.js';
import { groupedIban, money, shortDate } from './money.js';
import { solve } from './proof.js';
import type { PayRoute } from './route.js';
import { PAY_LANGUAGES } from './words.js';

/** How often the way-back page asks again while the provider has not said. */
export const BACK_POLL_MS = 3000;
/** After this many asks the page says it is taking long, and keeps asking more slowly. */
const BACK_SLOW_AFTER = 20;

const TOKEN_KEY = 'adminium-pay-last-link';

type Phase = { kind: 'page' } | { kind: 'getting-ready'; source: string } | { kind: 'redirecting'; url: string; source: string } | { kind: 'bank' };

type Tone = 'positive' | 'warning' | 'danger' | 'info' | 'neutral';

interface Status {
  tone: Tone;
  icon: LucideIcon | 'spinner';
  title: string;
  paras: string[];
  action?: { label: string; onPress: () => void };
  link?: { label: string; href: string };
  contact?: boolean;
}

/** An icon in the page's sizes; never read out (the words beside it say it). */
function Icon({ of: Of, size = 18, flip = false }: { of: LucideIcon | 'spinner'; size?: number; flip?: boolean }): ReactNode {
  if (Of === 'spinner') return <LoaderCircle className="pp-icon pp-spin" size={size} strokeWidth={2} aria-hidden="true" />;
  return <Of className={flip ? 'pp-icon pp-flip' : 'pp-icon'} size={size} strokeWidth={2} aria-hidden="true" />;
}

export function providerKind(source: string | null | undefined): 'stripe' | 'paypal' | 'demo' | 'other' {
  if (source === 'payments-stripe') return 'stripe';
  if (source === 'payments-paypal') return 'paypal';
  if (source === 'demo') return 'demo';
  return 'other';
}

function readStoredToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A browser that keeps nothing: "Try again" then says to open the link again.
  }
}

interface BankAccount {
  currency?: string;
  holder?: string;
  iban?: string | null;
  bic?: string | null;
  accountNumber?: string | null;
  sortCode?: string | null;
  bank?: string | null;
}

/** The tile that stands in for a shop with no logo: the first mark of its first two words ("Crumb & Co." → "C&"). */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}&]/u.test(word));
  return words
    .slice(0, 2)
    .map((word) => [...word].find((char) => /[\p{L}\p{N}&]/u.test(char)) ?? '')
    .join('');
}

export function PayApp({ route }: { route: Exclude<PayRoute, { kind: 'demo' } | { kind: 'none' }> }): ReactNode {
  const t = useT();
  const i18n = useI18n();
  const locale = useLocale();
  const language = PAY_LANGUAGES.find((one) => one.id === locale) ?? PAY_LANGUAGES[0]!;
  const tag = language.tag;

  const [page, setPage] = useState<PayPage | null>(null);
  const [offline, setOffline] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'page' });
  const [credentials, setCredentials] = useState<Credentials>('omit');
  const [message, setMessage] = useState<string | null>(null);
  const [asks, setAsks] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** In Studio's preview: the logo being shown (saved or just uploaded), and the sample lines kept while the switch is off. */
  const [previewLogo, setPreviewLogo] = useState<string | null>(null);
  const sampleLines = useRef<NonNullable<PayPage['payable']>['lines']>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const languageButton = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const moveFocus = useRef(false);

  // ── Loading ────────────────────────────────────────────────────────────
  async function load(): Promise<void> {
    try {
      if (route.kind === 'link') {
        const opened = await openLink(route.token);
        setCredentials(opened.credentials);
        setPage(opened.page);
      } else if (route.kind === 'preview') {
        setPage(await fetchPreview());
      } else {
        setPage(await fetchBack(route.nonce));
      }
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Studio's preview follows the settings as they are typed, from this server's own Studio only.
  useEffect(() => {
    if (route.kind !== 'preview') return undefined;
    const listen = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || !isPreviewEdit(event.data)) return;
      const edit = event.data;
      setPreviewLogo(edit.logoFileId);
      setPage((current) => {
        if (current === null) return current;
        if (current.payable?.lines != null) sampleLines.current = current.payable.lines;
        const lines = edit.showLines ? (sampleLines.current ?? [{ label: 'Sourdough loaves × 24', amount: '96.00' }, { label: 'Delivery', amount: '24.00' }]) : null;
        return { ...current, shop: { ...current.shop, ...edit.shop, hasLogo: edit.logoFileId !== null }, payable: current.payable === null ? null : { ...current.payable, lines } };
      });
    };
    window.addEventListener('message', listen);
    // Says it is listening, so Studio sends what is on its form now.
    window.parent?.postMessage({ type: 'adminium-pay-preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', listen);
  }, [route]);

  // The way back keeps asking while the provider has not said, and never moves focus while it does.
  useEffect(() => {
    if (route.kind !== 'back' || page?.state !== 'checking') return undefined;
    const delay = asks >= BACK_SLOW_AFTER ? BACK_POLL_MS * 4 : BACK_POLL_MS;
    const timer = window.setTimeout(() => {
      void fetchBack(route.nonce)
        .then((next) => {
          setPage(next);
          setAsks((count) => count + 1);
        })
        .catch(() => setAsks((count) => count + 1));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [route, page, asks]);

  // The tab says the shop and what is paid, never the software behind it.
  useEffect(() => {
    const shopName = page?.shop.name ?? '';
    const label = page?.payable?.label ?? null;
    document.title = label === null ? shopName || t('pay:documentTitlePlain', 'Payment') : t('pay:documentTitle', 'Pay {label}', { label });
  }, [page, t]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    headingRef.current?.focus();
  });

  // The menu takes focus when it opens: the checked language, else the first.
  useEffect(() => {
    if (!menuOpen) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }, [menuOpen]);

  const shop = page?.shop ?? { name: '', email: null, phone: null, hasLogo: false };
  const payable = page?.payable ?? null;
  const amount = payable === null ? '' : money(payable.due, payable.currency, tag);
  const providerSource = phase.kind === 'redirecting' || phase.kind === 'getting-ready' ? phase.source : (page?.attempt?.provider ?? null);
  const kind = providerKind(providerSource);
  const providerName = { stripe: t('pay:provider.stripe', 'Stripe'), paypal: t('pay:provider.paypal', 'PayPal'), demo: t('pay:provider.demo', 'the demo service'), other: t('pay:provider.other', 'the payment service') }[kind];

  // ── Pressing a provider's way ──────────────────────────────────────────
  async function pay(source: string): Promise<void> {
    // The preview's buttons go nowhere: it is a made-up invoice.
    if (route.kind !== 'link' || phase.kind !== 'page') return;
    setPhase({ kind: 'getting-ready', source });
    setMessage(null);
    try {
      let answer: Awaited<ReturnType<typeof postCheckout>> | null = null;
      // One silent retry: a challenge can expire while a slow phone solves it.
      for (let round = 0; round < 2; round += 1) {
        const challenge = await fetchChallenge(route.token, credentials);
        const proof = `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}`;
        answer = await postCheckout(route.token, source, proof, credentials, tag);
        if (answer.status !== 403) break;
      }
      if (answer === null || answer.status === 403) {
        moveFocus.current = true;
        setMessage(t('pay:proofFailed', 'The check that you are a person did not pass. Try again.'));
        setPhase({ kind: 'page' });
        return;
      }
      if ('url' in answer.answer && mayGoTo(answer.answer.url, window.location.href)) {
        storeToken(route.token);
        moveFocus.current = true;
        setPhase({ kind: 'redirecting', url: answer.answer.url, source });
        window.location.assign(answer.answer.url);
        return;
      }
      const next = 'state' in answer.answer ? answer.answer : { state: 'failed' as PayState, message: null };
      moveFocus.current = true;
      setMessage(next.message);
      setPage((current) => (current === null ? current : { ...current, state: next.state === 'ready' ? 'failed' : next.state }));
      setPhase({ kind: 'page' });
    } catch {
      moveFocus.current = true;
      setOffline(true);
      setPhase({ kind: 'page' });
    }
  }

  // ── What the status card says ──────────────────────────────────────────
  const tryAgain = useMemo(() => {
    const token = route.kind === 'link' ? route.token : readStoredToken();
    return token === null ? null : { label: t('pay:failed.retry', 'Try again'), onPress: () => window.location.assign(`/pay/${encodeURIComponent(token)}`) };
  }, [route, t]);

  function status(): Status | null {
    if (offline) {
      return {
        tone: 'warning',
        icon: TriangleAlert,
        title: t('pay:offline.title', 'This page could not reach the shop.'),
        paras: [t('pay:offline.body', 'Check your connection and try again.')],
        action: { label: t('pay:offline.retry', 'Try again'), onPress: () => void load() },
        contact: true,
      };
    }
    if (page === null) return null;
    if (phase.kind === 'redirecting') {
      const paras = kind === 'stripe' && locale === 'ar_EG' ? [t('pay:redirect.notArabic', 'The Stripe page is not in Arabic.')] : [];
      return { tone: 'neutral', icon: 'spinner', title: t('pay:redirect.title', 'Taking you to {provider}…', { provider: providerName }), paras, link: { label: t('pay:redirect.link', 'Not moving? Continue to {provider}', { provider: providerName }), href: phase.url } };
    }
    const contactWith = (icon: LucideIcon, title: string, body: string, tone: Tone = 'neutral'): Status => ({ tone, icon, title, paras: [body], contact: true });
    switch (page.state) {
      case 'ready':
        return message === null ? null : { tone: 'warning', icon: Info, title: message, paras: [] };
      case 'checking': {
        const slow = asks >= BACK_SLOW_AFTER;
        return {
          tone: 'info',
          icon: slow ? Clock : 'spinner',
          title: t('pay:checking.title', 'Checking with {provider}…', { provider: providerName }),
          paras: [slow ? t('pay:checking.slow', 'This is taking longer than usual. You can close this page; the shop will still get your payment.') : t('pay:checking.body', 'This takes a few seconds. You can close this page; the shop will still get your payment.')],
        };
      }
      case 'paid': {
        if (route.kind === 'link' || page.attempt === null) return { tone: 'positive', icon: CircleCheck, title: t('pay:paid.already', 'This is paid. Thank you.'), paras: [] };
        const paid = money(page.attempt.amount, payable?.currency ?? 'EUR', tag);
        const receipt = page.attempt.receiptSent ? t('pay:paid.receiptSent', 'A receipt is on its way to your email.') : t('pay:paid.receiptAsk', 'Ask {shop} if you need a receipt.', { shop: shop.name });
        return { tone: 'positive', icon: CircleCheck, title: t('pay:paid.title', 'Thank you. Your payment of {amount} arrived.', { amount: paid }), paras: [receipt] };
      }
      case 'processing': {
        const date = page.processing === null ? '' : shortDate(page.processing.startedAt, tag);
        const method = page.processing?.method ?? null;
        const body =
          method === null
            ? t('pay:processing.plain', "A payment of {amount} was started on {date}. Your bank confirms it in a few working days. You don't need to pay again.", { amount, date })
            : t('pay:processing.withMethod', "A payment of {amount} by {method} was started on {date}. Your bank confirms it in a few working days. You don't need to pay again.", { amount, method, date });
        return { tone: 'info', icon: Clock, title: t('pay:processing.title', 'Your bank is confirming it'), paras: [body] };
      }
      case 'shop-checks':
        return { tone: 'warning', icon: TriangleAlert, title: t('pay:shopChecks.title', 'The shop will check this payment'), paras: [t('pay:shopChecks.body', 'We received a payment, but it does not match the amount due. The shop will look at it and write to you.')], contact: true };
      case 'failed': {
        const paras = [message ?? t('pay:failed.body', 'Nothing was taken.')];
        if (tryAgain === null && route.kind === 'back') paras.push(t('pay:retryLater', 'Open the pay link again to try once more.'));
        return { tone: 'danger', icon: CircleX, title: t('pay:failed.title', 'The payment did not go through.'), paras, ...(tryAgain === null ? {} : { action: tryAgain }) };
      }
      case 'cancelled': {
        const title =
          kind === 'stripe'
            ? t('pay:cancelled.stripe', 'You left the Stripe page before paying.')
            : kind === 'paypal'
              ? t('pay:cancelled.paypal', 'You left the PayPal page before paying.')
              : t('pay:cancelled.title', 'You left the payment page before paying.');
        const paras = [t('pay:cancelled.body', 'Nothing was taken.')];
        if (tryAgain === null) paras.push(t('pay:retryLater', 'Open the pay link again to try once more.'));
        return { tone: 'neutral', icon: Info, title, paras, ...(tryAgain === null ? {} : { action: tryAgain }) };
      }
      case 'nothing-due':
        return contactWith(Info, t('pay:nothingDue.title', 'There is nothing to pay here yet.'), t('pay:nothingDue.body', 'Please contact {shop}.', { shop: shop.name }));
      case 'voided':
        return contactWith(Ban, t('pay:voided.title', 'This can no longer be paid here.'), t('pay:voided.body', 'Please contact {shop}.', { shop: shop.name }));
      case 'expired':
        return contactWith(Hourglass, t('pay:expired.title', 'This pay link has expired.'), t('pay:expired.body', 'Ask {shop} for a new one.', { shop: shop.name }), 'warning');
      case 'unknown':
        return contactWith(Link2Off, t('pay:unknown.title', "This link doesn't work."), t('pay:unknown.body', 'Ask {shop} for a new one.', { shop: shop.name }));
      case 'locked': {
        const bank = page.ways.some((way) => way.method === 'bank-transfer');
        return { tone: 'warning', icon: TriangleAlert, title: t('pay:locked.title', 'Too many payment tries on this link.'), paras: [bank ? t('pay:locked.bodyBank', 'Please try again in an hour, or pay by bank transfer.') : t('pay:locked.body', 'Please try again in an hour.')], contact: !bank };
      }
      case 'no-ways':
        return contactWith(Info, t('pay:noWays.title', 'There is no way to pay this amount online here.'), t('pay:noWays.body', 'Please contact {shop}.', { shop: shop.name }));
      case 'unavailable':
        return contactWith(Store, t('pay:unavailable.title', '{shop} cannot take payments online right now.', { shop: shop.name }), t('pay:unavailable.body', 'Please contact them.'));
      case 'test-staff-only':
        return contactWith(FlaskConical, t('pay:testStaffOnly.title', 'This test link opens only for the staff of {shop}.', { shop: shop.name }), t('pay:testStaffOnly.body', 'Sign in to the dashboard in this browser, then open the link again.'), 'warning');
    }
  }

  const current = status();
  const state = page?.state ?? null;
  // A dead link shows nothing about what it was for: the page is no oracle.
  const solo = state === 'unknown' || state === 'expired' || state === 'test-staff-only';
  const showWays = page !== null && !offline && (state === 'ready' || state === 'locked' || (state === 'cancelled' && route.kind === 'link')) && phase.kind !== 'redirecting' && phase.kind !== 'bank';
  const showHero = payable !== null && !solo && state !== 'voided';
  const ways = page?.ways ?? [];
  const providers = [...new Set(ways.filter((way) => way.source !== 'manual').map((way) => way.source))];
  const manual = ways.filter((way) => way.source === 'manual');
  const bankWay = manual.find((way) => way.method === 'bank-transfer') ?? null;

  const note = (() => {
    const kinds = new Set(providers.map(providerKind));
    if (kinds.has('stripe') && kinds.has('paypal')) return t('pay:ways.noteBoth', "You'll pay on the Stripe or PayPal page. This shop never sees your card.");
    if (kinds.has('stripe')) return t('pay:ways.noteStripe', "You'll pay on the Stripe page. This shop never sees your card.");
    if (kinds.has('paypal')) return t('pay:ways.notePaypal', "You'll pay on the PayPal page. This shop never sees your card.");
    return null;
  })();

  // What the polite region reads: the state's title and its key sentence, or the copy line, or "Getting ready…".
  const live =
    copied !== null
      ? t('pay:bank.copiedLive', '{label} copied.', { label: copied })
      : phase.kind === 'getting-ready'
        ? t('pay:ways.gettingReady', 'Getting ready…')
        : current === null
          ? ''
          : [current.title, current.paras[0] ?? ''].join(' ').trim();

  async function copy(label: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied((now) => (now === label ? null : now)), 2000);
    } catch {
      // Nothing to copy with: the value stays on screen to type.
    }
  }

  function closeMenu(): void {
    setMenuOpen(false);
    languageButton.current?.focus();
  }

  function chooseLanguage(id: (typeof PAY_LANGUAGES)[number]['id']): void {
    const chosen = PAY_LANGUAGES.find((one) => one.id === id);
    if (chosen !== undefined) void switchLocale(i18n, chosen.id).then(() => applyDirection(chosen.tag, chosen.dir));
    closeMenu();
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  const anyBusy = phase.kind !== 'page';

  const wayButton = (source: string, index: number): ReactNode => {
    const wayKind = providerKind(source);
    const busy = phase.kind === 'getting-ready' && phase.source === source;
    const disabled = anyBusy || state === 'locked';
    const label = busy
      ? t('pay:ways.gettingReady', 'Getting ready…')
      : wayKind === 'stripe'
        ? t('pay:ways.stripe', 'Pay by card and other ways')
        : wayKind === 'paypal'
          ? t('pay:ways.paypal', 'Pay with PayPal')
          : wayKind === 'demo'
            ? t('pay:ways.demo', 'Pay with the demo service')
            : t('pay:ways.online', 'Pay online');
    const sub = busy ? null : wayKind === 'stripe' ? t('pay:ways.stripeSub', 'Card, Apple Pay, Google Pay and more, on the secure Stripe page') : wayKind === 'demo' ? t('pay:ways.demoSub', 'Pretend money, test mode only') : null;
    return (
      <button
        key={source}
        type="button"
        className={index === 0 ? 'pp-way pp-way-primary' : 'pp-way'}
        aria-disabled={disabled}
        aria-busy={busy}
        {...(anyBusy && !busy ? { 'data-dim': '' } : {})}
        onClick={() => !disabled && void pay(source)}
      >
        <span className="pp-tile">
          <Icon of={busy ? 'spinner' : wayKind === 'paypal' ? Wallet : CreditCard} />
        </span>
        <span className="pp-way-text">
          <span className="pp-way-label">{label}</span>
          {sub === null ? null : <span className="pp-way-sub">{sub}</span>}
        </span>
        {busy ? null : (
          <span className="pp-way-end">
            <Icon of={ChevronRight} flip />
          </span>
        )}
      </button>
    );
  };

  const manualButton = (way: PayWay): ReactNode => {
    const custom = way.label?.[tag] ?? way.label?.['en-US'] ?? null;
    const label = custom ?? (way.method === 'bank-transfer' ? t('pay:ways.bank', 'Pay by bank transfer') : way.method === 'cash-on-delivery' ? t('pay:ways.cash', 'Pay when it arrives') : t('pay:ways.other', 'Another way to pay'));
    return (
      <button
        key={`${way.source}:${way.method}`}
        type="button"
        className="pp-way"
        aria-disabled={anyBusy}
        {...(anyBusy ? { 'data-dim': '' } : {})}
        onClick={() => {
          if (anyBusy) return;
          moveFocus.current = true;
          if (way.method === 'bank-transfer') {
            setPhase({ kind: 'bank' });
            return;
          }
          setMessage(((way.details as { note?: string | null } | null)?.note ?? null) || t('pay:cash.plain', 'Pay the amount due when your order arrives.'));
        }}
      >
        <span className="pp-tile">
          <Icon of={way.method === 'bank-transfer' ? Landmark : Banknote} />
        </span>
        <span className="pp-way-text">
          <span className="pp-way-label">{label}</span>
        </span>
        <span className="pp-way-end">
          <Icon of={ChevronRight} flip />
        </span>
      </button>
    );
  };

  const bankRows = (account: BankAccount): { key: string; label: string; value: string; copy: string }[] => {
    const rows: { key: string; label: string; value: string; copy: string }[] = [];
    if (account.holder) rows.push({ key: 'holder', label: t('pay:bank.holder', 'Account holder'), value: account.holder, copy: account.holder });
    if (account.iban) rows.push({ key: 'iban', label: t('pay:bank.iban', 'IBAN'), value: groupedIban(account.iban), copy: account.iban.replace(/\s+/g, '') });
    if (account.bic) rows.push({ key: 'bic', label: t('pay:bank.bic', 'BIC'), value: account.bic, copy: account.bic });
    if (account.accountNumber) rows.push({ key: 'account', label: t('pay:bank.accountNumber', 'Account number'), value: account.accountNumber, copy: account.accountNumber });
    if (account.sortCode) rows.push({ key: 'sort', label: t('pay:bank.sortCode', 'Sort code'), value: account.sortCode, copy: account.sortCode });
    if (account.bank) rows.push({ key: 'bank', label: t('pay:bank.bankName', 'Bank'), value: account.bank, copy: account.bank });
    if (payable !== null) {
      rows.push({ key: 'amount', label: t('pay:bank.amount', 'Amount'), value: amount, copy: payable.due });
      rows.push({ key: 'reference', label: t('pay:bank.reference', 'Reference'), value: payable.label, copy: payable.label });
    }
    return rows;
  };

  const accounts = ((bankWay?.details as { accounts?: BankAccount[] } | null)?.accounts ?? []).filter((account) => account.currency === undefined || account.currency === payable?.currency);

  const heroLabel =
    state === 'paid' && route.kind === 'back' ? t('pay:hero.paid', 'Paid') : state === 'processing' ? t('pay:hero.started', 'Payment started') : t('pay:hero.due', 'Amount due');
  const heroAmount = state === 'paid' && route.kind === 'back' && page?.attempt != null && payable !== null ? money(page.attempt.amount, payable.currency, tag) : amount;
  const heroSubs: ReactNode[] = [];
  if (payable !== null) {
    if (state === 'paid' && route.kind === 'back' && page?.attempt != null) {
      heroSubs.push(<bdi key="at">{shortDate(page.attempt.at, tag)}</bdi>);
    } else if (state === 'processing' && page?.processing != null) {
      heroSubs.push(
        <span key="started">
          {page.processing.method === null ? null : <>{page.processing.method} · </>}
          <bdi>{shortDate(page.processing.startedAt, tag)}</bdi>
        </span>,
      );
    } else if (state !== 'paid') {
      if (payable.alreadyPaid !== null) {
        heroSubs.push(
          <span key="partly">
            {t('pay:hero.partly', '{paid} of {total} is already paid.', {
              paid: money(payable.alreadyPaid, payable.currency, tag),
              total: money(payable.total, payable.currency, tag),
            })}
          </span>,
        );
      }
      if (payable.dueDate !== null) heroSubs.push(<span key="due">{t('pay:hero.dueBy', 'Due {date}', { date: shortDate(Date.parse(`${payable.dueDate}T12:00:00Z`), tag) })}</span>);
    }
  }

  // One h1 on every state: the payable's number, else the state's own title.
  const headingIsPayable = payable !== null && !solo;
  const statusTitleIsH1 = !headingIsPayable && current !== null;

  return (
    <div className="pp-page">
      <div role="status" aria-live="polite" className="pp-sr">
        {live}
      </div>
      {page?.test === true ? (
        <div role="note" className="pp-test">
          <Icon of={FlaskConical} size={14} />
          <span>{t('pay:testBand', 'Test page — no money moves.')}</span>
        </div>
      ) : null}
      <header className="pp-header">
        <div className="pp-header-inner">
          {shop.hasLogo && route.kind === 'link' ? (
            <img className="pp-logo" src={`/pay/api/${encodeURIComponent(route.token)}/logo`} alt="" />
          ) : shop.hasLogo && route.kind === 'preview' ? (
            <img className="pp-logo" src={`/pay/api/preview/logo${previewLogo === null ? '' : `?file=${encodeURIComponent(previewLogo)}`}`} alt="" />
          ) : (
            <span className="pp-monogram" aria-hidden="true" dir="ltr">
              {monogram(shop.name)}
            </span>
          )}
          <bdi className="pp-shop">{shop.name}</bdi>
          <button
            ref={languageButton}
            type="button"
            className="pp-language-button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('pay:language.button', 'Language: {name}', { name: language.name })}
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          >
            <Icon of={Globe} size={16} />
            <span>{language.name}</span>
            <Icon of={ChevronDown} size={14} />
          </button>
          {menuOpen ? (
            <div
              ref={menuRef}
              role="menu"
              aria-label={t('pay:language.menu', 'Language')}
              className="pp-menu"
              onKeyDown={(event) => {
                const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
                const at = items.indexOf(document.activeElement as HTMLButtonElement);
                const go = (index: number): void => {
                  event.preventDefault();
                  items[(index + items.length) % items.length]?.focus();
                };
                if (event.key === 'Escape' || event.key === 'Tab') {
                  if (event.key === 'Escape') event.preventDefault();
                  closeMenu();
                } else if (event.key === 'ArrowDown') go(at + 1);
                else if (event.key === 'ArrowUp') go(at - 1);
                else if (event.key === 'Home') go(0);
                else if (event.key === 'End') go(items.length - 1);
              }}
            >
              {PAY_LANGUAGES.map((one) => (
                <button key={one.id} type="button" role="menuitemradio" aria-checked={one.id === locale} lang={one.tag} dir={one.dir} className="pp-menu-item" tabIndex={-1} onClick={() => chooseLanguage(one.id)}>
                  <span>{one.name}</span>
                  {one.id === locale ? <Icon of={Check} size={16} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <main className="pp-main" {...(solo ? { 'data-solo': '' } : {})}>
        {headingIsPayable || showHero ? (
          <div className="pp-col">
            {headingIsPayable ? (
              <div className="pp-title">
                <h1 className="pp-h1" tabIndex={-1} ref={phase.kind === 'bank' ? undefined : headingRef}>
                  <bdi dir="ltr" className="pp-mono">
                    {payable.label}
                  </bdi>
                </h1>
              </div>
            ) : null}
            {showHero && payable !== null ? (
              <div className="pp-card pp-hero">
                <span className="pp-micro">{heroLabel}</span>
                <bdi dir="ltr" className="pp-amount">
                  {heroAmount}
                </bdi>
                {heroSubs.map((sub, index) => (
                  <p key={index} className="pp-small">
                    {sub}
                  </p>
                ))}
              </div>
            ) : null}
            {showHero && payable?.lines != null && payable.lines.length > 0 ? (
              <section className="pp-card pp-lines" aria-labelledby="pp-lines-title">
                <h2 id="pp-lines-title" className="pp-h2">
                  {t('pay:lines.title', 'What this is for')}
                </h2>
                {payable.lines.map((line, index) => (
                  <div key={index} className="pp-line">
                    <span>{line.label}</span>
                    <bdi dir="ltr">{money(line.amount, payable.currency, tag)}</bdi>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        ) : null}

        <div className="pp-col">
          {current === null ? null : (
            <section className="pp-card pp-status" data-tone={current.tone}>
              <div className="pp-status-head">
                <span className="pp-tile">
                  <Icon of={current.icon} />
                </span>
                <div className="pp-status-text">
                  {statusTitleIsH1 ? (
                    <h1 className="pp-h2" tabIndex={-1} ref={headingRef}>
                      {current.title}
                    </h1>
                  ) : (
                    <h2 className="pp-h2">{current.title}</h2>
                  )}
                  {current.paras.map((para) => (
                    <p key={para}>{para}</p>
                  ))}
                </div>
              </div>
              {current.action === undefined ? null : (
                <button type="button" className="pp-button" onClick={current.action.onPress}>
                  <Icon of={RotateCcw} size={16} />
                  <span>{current.action.label}</span>
                </button>
              )}
              {current.link === undefined ? null : (
                <a className="pp-link" href={current.link.href} rel="noreferrer">
                  {current.link.label}
                  <Icon of={ArrowUpRight} size={14} flip />
                </a>
              )}
              {current.contact === true ? <Contact shop={shop} /> : null}
            </section>
          )}

          {showWays ? (
            <section className="pp-ways" aria-labelledby="pp-ways-title">
              <h2 id="pp-ways-title" className="pp-ways-title">
                {t('pay:ways.title', 'Ways to pay')}
              </h2>
              {state === 'locked' ? null : providers.map((source, index) => wayButton(source, index))}
              {manual.map((way) => manualButton(way))}
              {note === null || state === 'locked' ? null : (
                <p className="pp-note">
                  <Icon of={Lock} size={14} />
                  <span>{note}</span>
                </p>
              )}
            </section>
          ) : null}

          {phase.kind === 'bank' ? (
            <section className="pp-card pp-bank" aria-labelledby="pp-bank-title">
              <div className="pp-bank-head">
                <span className="pp-tile">
                  <Icon of={Landmark} />
                </span>
                <h2 id="pp-bank-title" className="pp-h2" tabIndex={-1} ref={headingRef}>
                  {t('pay:bank.title', 'Bank transfer')}
                </h2>
                <button
                  type="button"
                  className="pp-text-button"
                  onClick={() => {
                    moveFocus.current = true;
                    setPhase({ kind: 'page' });
                  }}
                >
                  <Icon of={ArrowLeft} size={14} flip />
                  <span>{t('pay:bank.otherWays', 'Other ways to pay')}</span>
                </button>
              </div>
              {accounts.length === 0 ? <p className="pp-small">{t('pay:bank.noAccount', 'Ask {shop} for its bank details for this currency.', { shop: shop.name })}</p> : null}
              {accounts.map((account, index) => (
                <dl key={index} className="pp-rows">
                  {bankRows(account).map((row) => (
                    <div key={row.key} className="pp-row">
                      <div className="pp-row-text">
                        <dt className="pp-row-label">{row.label}</dt>
                        <dd className="pp-row-value">
                          <bdi dir="ltr">{row.value}</bdi>
                        </dd>
                      </div>
                      <button type="button" className="pp-copy" aria-label={t('pay:bank.copyLabel', 'Copy {label}', { label: row.label })} onClick={() => void copy(row.label, row.copy)}>
                        <Icon of={copied === row.label ? Check : Copy} size={14} />
                        <span>{copied === row.label ? t('pay:bank.copied', 'Copied') : t('pay:bank.copy', 'Copy')}</span>
                      </button>
                    </div>
                  ))}
                </dl>
              ))}
              <p className="pp-small">{t('pay:bank.note', 'Use this reference so the shop can find your payment. It shows as paid once the shop has checked.')}</p>
            </section>
          ) : null}
        </div>
      </main>

      <footer className="pp-footer">
        <div className="pp-footer-inner">
          <span>
            <bdi>{shop.name}</bdi>
            {shop.phone === null ? null : (
              <>
                {' · '}
                <a href={`tel:${shop.phone.replace(/\s+/g, '')}`}>
                  <bdi dir="ltr" className="pp-mono">
                    {shop.phone}
                  </bdi>
                </a>
              </>
            )}
          </span>
          {shop.email === null ? null : (
            <span>
              {t('pay:footer.questions', 'Questions? Write to')}{' '}
              <a href={`mailto:${shop.email}`}>
                <bdi dir="ltr">{shop.email}</bdi>
              </a>
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

/** The page's language and direction, on the document itself. */
export function applyDirection(tag: string, dir: 'ltr' | 'rtl'): void {
  document.documentElement.lang = tag;
  document.documentElement.dir = dir;
}

function Contact({ shop }: { shop: PayPage['shop'] }): ReactNode {
  if (shop.email === null && shop.phone === null) return null;
  return (
    <div className="pp-contact">
      {shop.email === null ? null : (
        <a href={`mailto:${shop.email}`}>
          <Icon of={Mail} size={16} />
          <bdi dir="ltr">{shop.email}</bdi>
        </a>
      )}
      {shop.phone === null ? null : (
        <a href={`tel:${shop.phone.replace(/\s+/g, '')}`}>
          <Icon of={Phone} size={16} />
          <bdi dir="ltr" className="pp-mono">
            {shop.phone}
          </bdi>
        </a>
      )}
    </div>
  );
}
