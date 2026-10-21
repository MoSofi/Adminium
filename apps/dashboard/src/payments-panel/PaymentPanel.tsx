// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The record page's Payment panel: what is due, what was paid and how, what
 * waits for the bank, the pay link, and the two actions — copy a pay link
 * and record a payment taken by hand.
 *
 * Every figure is the server's (`POST /payments/panel`): the balance follows
 * every payment and every refund, so a refund reopens it and the actions come
 * back. The actions are for whoever may change the record; a reader sees the
 * panel and no button.
 *
 * Loaded lazily, with its words, only on a record that takes payments.
 */
import { useState, type ReactNode } from 'react';
import { Badge, Button } from '@adminium/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Banknote, CircleCheck, CircleDot, Clock, CreditCard, FileText, Landmark, Link2, Package, Plus, Send, ServerOff, type LucideIcon } from 'lucide-react';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { useAppToasts } from '../pages/toasts.js';
import { fetchCurrentLink, makeLink, panelQueryKey, paymentPanelKey, revokeLink, type PanelPayment, type PanelRecord, type PaymentPanelView } from './paymentPanelApi.js';
import { decimalsOf, formatMoney, moreThan, shortDay } from './paymentText.js';
import { readerLocale, usePaymentsMessages } from './paymentsMessages.js';
import { RecordPaymentDialog } from './RecordPaymentDialog.js';

const WAY_ICONS: Record<string, LucideIcon> = {
  card: CreditCard,
  'bank-transfer': Landmark,
  cash: Banknote,
  cheque: FileText,
  other: CircleDot,
  online: CreditCard,
};

/** The service's name, as its own mark (never translated). */
export function serviceName(provider: string): string {
  if (provider === 'payments-stripe') return 'Stripe';
  if (provider === 'payments-paypal') return 'PayPal';
  if (provider === 'demo') return t('payments:panel.by.online', 'online');
  return provider.replace(/^payments-/, '');
}

function byWay(way: string, last4: string | null): string {
  const words: Record<string, () => string> = {
    'bank-transfer': () => t('payments:panel.by.bank-transfer', 'by bank transfer'),
    cash: () => t('payments:panel.by.cash', 'in cash'),
    card: () => t('payments:panel.by.card', 'by card on our own terminal'),
    cheque: () => t('payments:panel.by.cheque', 'by cheque'),
    other: () => t('payments:panel.by.other', 'another way'),
    online: () => t('payments:panel.by.online', 'online'),
  };
  const said = (words[way] ?? words['other']!)();
  return last4 === null ? said : `${said} ••${last4}`;
}

/** The sentence for a refusal the server gave, in the reader's language. */
function refusalNotice(code: string): { tone: 'neutral' | 'warn' | 'info'; icon: LucideIcon; text: string } | null {
  switch (code) {
    case 'NOT_SENT':
      return { tone: 'neutral', icon: Send, text: t('payments:panel.notice.draft', 'Send the invoice first. A payment can only be recorded against a sent invoice.') };
    case 'NEEDS_UPDATE':
      return { tone: 'warn', icon: Package, text: t('payments:panel.notice.update', "This invoice table needs its app's update to take online payments.") };
    case 'VOIDED':
      return { tone: 'neutral', icon: Ban, text: t('payments:panel.notice.voided', 'This invoice was voided. No payment can be taken.') };
    case 'NO_CURRENCY':
      return { tone: 'warn', icon: Ban, text: t('payments:panel.notice.noCurrency', 'This record has no currency, so no payment can be recorded.') };
    case 'AMOUNT_UNCLEAR':
      return { tone: 'warn', icon: Ban, text: t('payments:panel.notice.unclear', 'The amount of this record is not exact in its currency, so no payment can be recorded.') };
    case 'NOTHING_DUE':
      return null;
    default:
      return { tone: 'neutral', icon: Ban, text: t('payments:panel.notice.notPayable', 'This record cannot take a payment right now.') };
  }
}

const NOTICE_TONES = {
  neutral: 'bg-surface-3 text-fg-muted',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
} as const;

function Notice({ tone, icon: Icon, children, action }: { tone: keyof typeof NOTICE_TONES; icon: LucideIcon; children: ReactNode; action?: ReactNode }): ReactNode {
  return (
    <div className="flex flex-wrap items-start gap-2.5 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
      <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${NOTICE_TONES[tone]}`}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-[220px] flex-1 pt-1 text-[13px] leading-normal text-fg">{children}</div>
      {action}
    </div>
  );
}

function PaymentRow({ payment, currency, locale }: { payment: PanelPayment; currency: string; locale: string }): ReactNode {
  const Icon = WAY_ICONS[payment.way] ?? CircleDot;
  const amount = formatMoney(payment.amount, payment.currency || currency, locale);
  const date = payment.paidOn === '' ? '' : shortDay(payment.paidOn, locale);
  const fullyRefunded = payment.refunded !== '0' && !moreThan(payment.amount, payment.refunded);
  const partlyRefunded = moreThan(payment.refunded, '0') && !fullyRefunded;
  const refunded = partlyRefunded ? t('payments:panel.refundedInline', 'refunded {amount}', { amount: formatMoney(payment.refunded, payment.currency || currency, locale) }) : null;
  const online = payment.provider !== null;
  const recorder = online
    ? t('payments:panel.recordedBy', 'recorded by {name}', { name: t('payments:panel.online', 'Online payment ({service})', { service: serviceName(payment.provider!) }) })
    : payment.recordedBy === null
      ? null
      : t('payments:panel.recordedBy', 'recorded by {name}', { name: payment.recordedBy });
  const parts: ReactNode[] = online
    ? [
        payment.number === null ? null : <bdi key="n" className="font-mono">{payment.number}</bdi>,
        <bdi key="a" dir="ltr" className="font-mono font-semibold text-fg">{amount}</bdi>,
        payment.wayLabel === null ? null : <span key="w">{payment.wayLabel}</span>,
        <span key="s">{serviceName(payment.provider!)}</span>,
        date === '' ? null : <span key="d">{date}</span>,
        recorder === null ? null : <span key="r">{recorder}</span>,
        refunded === null ? null : <span key="f">{refunded}</span>,
      ]
    : [
        <bdi key="a" dir="ltr" className="font-mono font-semibold text-fg">{amount}</bdi>,
        <span key="w">{byWay(payment.way, payment.cardLast4)}</span>,
        recorder === null ? null : <span key="r">{recorder}</span>,
        refunded === null ? null : <span key="f">{refunded}</span>,
      ];
  const shownParts = parts.filter((part) => part !== null);
  const meta = online ? null : [payment.number, date].filter((part) => part !== null && part !== '').join(' · ');
  return (
    <li className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-muted">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-y-1 text-[13px] leading-normal text-fg-muted">
          {shownParts.map((part, index) => (
            <span key={index} className="inline-flex items-center">
              {index === 0 ? null : (
                <span aria-hidden="true" className="px-1.5 text-fg-subtle">
                  ·
                </span>
              )}
              {part}
            </span>
          ))}
          {payment.test ? (
            <Badge tone="warn" className="ms-2">
              {t('payments:panel.test', 'Test')}
            </Badge>
          ) : null}
          {fullyRefunded ? (
            <Badge tone="neutral" className="ms-2">
              {t('payments:panel.refunded', 'Refunded')}
            </Badge>
          ) : null}
        </div>
        {meta === null || meta === '' ? null : (
          <div className="text-[11.5px] text-fg-subtle">
            <bdi dir="ltr" className="font-mono">
              {meta}
            </bdi>
          </div>
        )}
      </div>
    </li>
  );
}

export interface PaymentPanelProps {
  record: PanelRecord;
  view: PaymentPanelView;
  /** The record itself changed (its balance, its status): the page reads it again. */
  onChanged?: (() => void) | undefined;
}

export default function PaymentPanel({ record, view, onChanged }: PaymentPanelProps): ReactNode {
  usePaymentsMessages();
  const locale = readerLocale();
  const toasts = useAppToasts();
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);

  const due = formatMoney(view.due, view.currency || 'EUR', locale);
  const nothingDue = view.currency !== '' && !moreThan(view.due, '0');
  const notice = view.refusal === null ? null : refusalNotice(view.refusal.code);
  const onlineOk = view.refusal === null && !nothingDue;
  const linksUsable = view.mayChange && view.links.on && onlineOk;

  const current = useQuery({
    queryKey: [...panelQueryKey(record), 'link'],
    queryFn: () => fetchCurrentLink(view.payable),
    enabled: linksUsable,
    staleTime: 30_000,
  });
  const link = linksUsable ? (current.data ?? null) : null;

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: panelQueryKey(record) });
  };
  const failed = (error: unknown): void => {
    toasts.push({ variant: 'error', title: t('payments:panel.toast.failed', 'That did not work: {message}', { message: error instanceof ApiError ? error.message : String(error) }) });
  };

  const copy = useMutation({
    mutationFn: async () => {
      const made = await makeLink(view.payable);
      let copied = true;
      try {
        await navigator.clipboard.writeText(made.link.url);
      } catch {
        copied = false;
      }
      return { ...made, copied };
    },
    onSuccess: async ({ link: made, replaced, copied }) => {
      if (!copied) toasts.push({ variant: 'warning', title: t('payments:panel.toast.copyFailed', 'The pay link is made, but this browser would not copy it: {url}', { url: made.url }) });
      else if (replaced && link !== null) toasts.push({ variant: 'success', title: t('payments:panel.toast.replaced', 'A new pay link replaces the one made on {date}.', { date: shortDay(link.createdAt, locale) }) });
      else toasts.push({ variant: 'success', title: t('payments:panel.toast.copied', 'Pay link copied.') });
      await refresh();
    },
    onError: failed,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeLink(id),
    onSuccess: async () => {
      toasts.push({ variant: 'success', title: t('payments:panel.toast.revoked', 'Pay link revoked. The old address no longer works.') });
      await refresh();
    },
    onError: failed,
  });

  const waitingFor = view.waiting.length > 0;
  const showCopy = linksUsable && !waitingFor;
  const draft = view.refusal?.code === 'NOT_SENT';

  return (
    <div className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-surface p-5 shadow-sm" data-testid="payment-panel">
      {draft ? null : (
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="text-[13px] text-fg-muted">{nothingDue ? t('payments:panel.paid', 'Paid') : t('payments:panel.balanceDue', 'Balance due')}</span>
          <bdi dir="ltr" className="font-mono text-[20px] font-bold tracking-[-0.02em] text-fg">
            {nothingDue ? formatMoney(view.paid, view.currency, locale) : due}
          </bdi>
        </div>
      )}
      {nothingDue && moreThan(view.paid, '0') && view.payments.every((payment) => payment.refunded === '0' || !moreThan(payment.refunded, '0')) ? (
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-pos-soft px-3 py-1 text-[13px] font-bold text-pos">
            <CircleCheck className="size-[15px]" aria-hidden="true" />
            {t('payments:panel.paidInFull', 'Paid in full')}
          </span>
        </div>
      ) : null}

      {notice === null ? null : (
        <Notice tone={notice.tone} icon={notice.icon}>
          {notice.text}
        </Notice>
      )}
      {view.mayChange && !view.links.on && onlineOk ? (
        <Notice tone="info" icon={ServerOff}>
          {t('payments:panel.notice.private', 'Customers cannot reach this server, so pay links are off. You can still record payments.')}
        </Notice>
      ) : null}
      {view.waiting.map((waiting) => (
        <Notice key={waiting.id} tone="info" icon={Clock}>
          {waiting.wayLabel === null
            ? t('payments:panel.waitingPlain', 'An online payment started {date} · waiting for the bank', { date: shortDay(waiting.startedAt, locale) })
            : t('payments:panel.waitingWith', 'Payment by {way} started {date} · waiting for the bank', { way: waiting.wayLabel, date: shortDay(waiting.startedAt, locale) })}
          {waiting.test ? (
            <Badge tone="warn" className="ms-2">
              {t('payments:panel.test', 'Test')}
            </Badge>
          ) : null}
        </Notice>
      ))}
      {link === null ? null : (
        <Notice
          tone="neutral"
          icon={Link2}
          action={
            <Button size="sm" variant="secondary" loading={revoke.isPending} onClick={() => revoke.mutate(link.id)}>
              {t('payments:panel.revoke', 'Revoke')}
            </Button>
          }
        >
          {t('payments:panel.linkLine', 'Pay link made {made} · works until {until}', { made: shortDay(link.createdAt, locale), until: shortDay(link.expiresAt, locale) })}
          {link.mode === 'test' ? (
            <Badge tone="warn" className="ms-2">
              {t('payments:panel.test', 'Test')}
            </Badge>
          ) : null}
        </Notice>
      )}

      {view.payments.length === 0 ? null : (
        <ul aria-label={t('payments:panel.listLabel', 'Payments on this record')} className="m-0 list-none rounded-[10px] border border-border p-0">
          {view.payments.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} currency={view.currency} locale={locale} />
          ))}
        </ul>
      )}

      {showCopy || view.mayRecord ? (
        <div className="flex flex-wrap gap-2">
          {showCopy ? (
            <Button variant="secondary" iconLeft={<Link2 aria-hidden="true" />} loading={copy.isPending} onClick={() => copy.mutate()}>
              {t('payments:panel.copyLink', 'Copy pay link')}
            </Button>
          ) : null}
          {view.mayRecord ? (
            <Button iconLeft={<Plus aria-hidden="true" />} onClick={() => setRecording(true)}>
              {t('payments:panel.record', 'Record a payment')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {view.mayRecord ? (
        <RecordPaymentDialog
          open={recording}
          onOpenChange={setRecording}
          record={record}
          view={view}
          onRecorded={(amount) => {
            toasts.push({ variant: 'success', title: t('payments:panel.toast.recorded', 'Payment of {amount} recorded.', { amount: formatMoney(amount, view.currency, locale, decimalsOf(view.due)) }) });
            void queryClient.invalidateQueries({ queryKey: paymentPanelKey });
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
