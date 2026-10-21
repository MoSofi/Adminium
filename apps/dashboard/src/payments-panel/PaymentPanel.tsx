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
 * A payment taken online carries a "…" menu with "Refund…" for whoever may
 * refund; when it cannot be refunded now the item stays (focusable, with
 * `aria-disabled`) and says why. Each refund shows under its payment: asked,
 * waiting, failed in the service's words, made in the service's dashboard; a
 * done one reads inline. A dispute is a danger notice and a badge on its row;
 * the record itself is never changed by it.
 *
 * Loaded lazily, with its words, only on a record that takes payments.
 */
import { useId, useState, type ReactNode } from 'react';
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip } from '@adminium/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Banknote, CircleCheck, CircleDot, CircleX, Clock, CornerDownLeft, CreditCard, Ellipsis, FileText, Landmark, Link2, Loader, Mail, Package, Plus, RotateCcw, Send, ServerOff, ShieldAlert, type LucideIcon } from 'lucide-react';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { useAppToasts } from '../pages/toasts.js';
import { emailLink, fetchCurrentLink, makeLink, panelQueryKey, paymentPanelKey, revokeLink, type PanelPayment, type PanelRecord, type PanelRefund, type PaymentPanelView } from './paymentPanelApi.js';
import { decimalsOf, formatMoney, moreThan, shortDay } from './paymentText.js';
import { readerLocale, usePaymentsMessages } from './paymentsMessages.js';
import { RecordPaymentDialog } from './RecordPaymentDialog.js';
import RefundDialog from './RefundDialog.js';
import { refusalWords } from './refundWords.js';
import { serviceName } from './serviceName.js';

const WAY_ICONS: Record<string, LucideIcon> = {
  card: CreditCard,
  'bank-transfer': Landmark,
  cash: Banknote,
  cheque: FileText,
  other: CircleDot,
  online: CreditCard,
};

export { serviceName };

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
  danger: 'bg-danger-soft text-danger',
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

const SUB_TONES = {
  info: { box: 'bg-info-soft px-2.5 py-1.5 text-fg-muted', icon: 'text-info' },
  danger: { box: 'bg-danger-soft px-2.5 py-1.5 font-semibold text-fg', icon: 'text-danger' },
  neutral: { box: 'text-fg-muted', icon: 'text-fg-subtle' },
} as const;

/** A refund's line under its payment, or null when it reads inline (done, asked here). */
function refundLine(refund: PanelRefund, provider: string | null, money: (amount: string) => string, locale: string): { tone: keyof typeof SUB_TONES; icon: LucideIcon; text: string; look: boolean } | null {
  const amount = money(refund.amount);
  if (refund.source === 'provider' && refund.state === 'succeeded') {
    return {
      tone: 'neutral',
      icon: CornerDownLeft,
      text: t('payments:panel.refundedThere', 'Refund of {amount} made in the {service} dashboard on {date} · recorded', { amount, service: serviceName(provider ?? ''), date: shortDay(refund.settledAt ?? refund.createdAt, locale) }),
      look: true,
    };
  }
  switch (refund.state) {
    case 'succeeded':
      return null;
    case 'requires_action':
      return { tone: 'info', icon: Loader, text: t('payments:panel.refundWaitingCustomer', 'Refund of {amount} is waiting for the customer', { amount }), look: false };
    case 'failed': {
      const reason = refund.failureMessage?.trim().replace(/[.。]+$/u, '') ?? '';
      return {
        tone: 'danger',
        icon: CircleX,
        text:
          reason === ''
            ? t('payments:panel.refundFailedPlain', 'The refund of {amount} failed. Contact the customer and record what you agree.', { amount })
            : t('payments:panel.refundFailed', 'The refund of {amount} failed: {reason}. Contact the customer and record what you agree.', { amount, reason }),
        look: false,
      };
    }
    case 'cancelled':
      return { tone: 'neutral', icon: CircleX, text: t('payments:panel.refundCancelled', 'The refund of {amount} was cancelled.', { amount }), look: false };
    default:
      return { tone: 'info', icon: Loader, text: t('payments:panel.refundRequested', 'Refund of {amount} requested', { amount }), look: false };
  }
}

/** The "…" menu of a payment (or of a payment waiting for the bank): "Refund…", or why it cannot be refunded now. */
function RowMenu({ label, why, onRefund }: { label: string; why: string | null; onRefund: () => void }): ReactNode {
  const whyId = useId();
  const item = (
    <DropdownMenuItem
      icon={<RotateCcw className="size-4" />}
      aria-disabled={why === null ? undefined : true}
      aria-describedby={why === null ? undefined : whyId}
      className={why === null ? undefined : 'cursor-not-allowed text-fg-subtle'}
      onSelect={(event) => {
        if (why !== null) {
          event.preventDefault();
          return;
        }
        onRefund();
      }}
    >
      {t('payments:panel.menu.refund', 'Refund…')}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="size-[30px] shrink-0 border border-border p-0" aria-label={label}>
          <Ellipsis className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[210px]">
        {why === null ? item : <Tooltip content={why} side="bottom" align="end">{item}</Tooltip>}
        {/* The reason stays in the page while the menu is open, so a screen reader finds it on the first focus. */}
        {why === null ? null : (
          <span id={whyId} className="sr-only">
            {why}
          </span>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PaymentRow({ payment, currency, locale, mayRefund, onRefund }: { payment: PanelPayment; currency: string; locale: string; mayRefund: boolean; onRefund: (payment: PanelPayment) => void }): ReactNode {
  const Icon = WAY_ICONS[payment.way] ?? CircleDot;
  const money = (value: string): string => formatMoney(value, payment.currency || currency, locale, decimalsOf(payment.amount));
  const amount = formatMoney(payment.amount, payment.currency || currency, locale);
  const date = payment.paidOn === '' ? '' : shortDay(payment.paidOn, locale);
  const fullyRefunded = payment.refunded !== '0' && !moreThan(payment.amount, payment.refunded);
  const disputed = payment.dispute?.state === 'open';
  // Refunds done here read inline, each with its day; a refunded amount with no refund behind it (written by hand) reads as one.
  const doneHere = payment.refunds.filter((refund) => refund.state === 'succeeded' && refund.source === 'staff');
  const inline: string[] =
    payment.refunds.length > 0
      ? doneHere.map((refund) => t('payments:panel.refundedOnInline', 'refunded {amount} on {date}', { amount: money(refund.amount), date: shortDay(refund.settledAt ?? refund.createdAt, locale) }))
      : moreThan(payment.refunded, '0') && !fullyRefunded
        ? [t('payments:panel.refundedInline', 'refunded {amount}', { amount: money(payment.refunded) })]
        : [];
  const subs = payment.refunds.map((refund) => ({ refund, line: refundLine(refund, payment.provider, money, locale) })).filter((one) => one.line !== null);
  const online = payment.provider !== null;
  const recorder = online
    ? t('payments:panel.recordedBy', 'recorded by {name}', { name: t('payments:panel.online', 'Online payment ({service})', { service: serviceName(payment.provider!) }) })
    : payment.recordedBy === null
      ? null
      : t('payments:panel.recordedBy', 'recorded by {name}', { name: payment.recordedBy });
  const parts: ReactNode[] = online
    ? [
        payment.number === null ? null : <bdi key="n" className="font-mono font-bold text-accent">{payment.number}</bdi>,
        <bdi key="a" dir="ltr" className="font-mono font-semibold text-fg">{amount}</bdi>,
        payment.wayLabel === null ? null : <span key="w">{payment.wayLabel}</span>,
        <span key="s">{serviceName(payment.provider!)}</span>,
        date === '' ? null : <span key="d">{date}</span>,
        recorder === null ? null : <span key="r">{recorder}</span>,
        ...inline.map((text, index) => <span key={`f${String(index)}`}>{text}</span>),
      ]
    : [
        <bdi key="a" dir="ltr" className="font-mono font-semibold text-fg">{amount}</bdi>,
        <span key="w">{byWay(payment.way, payment.cardLast4)}</span>,
        recorder === null ? null : <span key="r">{recorder}</span>,
        ...inline.map((text, index) => <span key={`f${String(index)}`}>{text}</span>),
      ];
  const shownParts = parts.filter((part) => part !== null);
  const meta = online ? null : [payment.number, date].filter((part) => part !== null && part !== '').join(' · ');
  // Recorded by hand: refunded by hand. Otherwise the server says why not, or nothing does.
  const why = payment.attemptId === null ? refusalWords('BY_HAND', null, '') : payment.refundRefusal === null ? null : refusalWords(payment.refundRefusal.code, payment.provider, payment.refundRefusal.message);
  const ref = payment.number ?? amount;
  return (
    <li className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${disputed ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-fg-muted'}`}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
          {disputed ? (
            <Badge tone="danger" className="ms-2">
              {t('payments:panel.disputed', 'Disputed')}
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
        {subs.map(({ refund, line }) => {
          const tone = SUB_TONES[line!.tone];
          const LineIcon = line!.icon;
          return (
            <div key={refund.id} className={`flex flex-wrap items-start gap-[7px] rounded-md text-[12.5px] leading-normal ${tone.box}`}>
              <LineIcon className={`mt-0.5 size-3.5 shrink-0 ${tone.icon}`} aria-hidden="true" />
              <span className="min-w-0 flex-[1_1_200px]">{line!.text}</span>
              {line!.look ? (
                <a href="/studio/payments?tab=activity" className="shrink-0 rounded-full bg-warn-soft px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[.05em] text-warn no-underline">
                  {t('payments:panel.needsLook', 'Needs a look')}
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
      {mayRefund ? <RowMenu label={t('payments:panel.moreFor', 'More for {ref}', { ref })} why={why} onRefund={() => onRefund(payment)} /> : null}
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
  const [refunding, setRefunding] = useState<PanelPayment | null>(null);

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

  // Emails the current live link, or a new one when there is none (a test link opens for staff only).
  const email = useMutation({
    mutationFn: async () => {
      const current = link !== null && link.mode === 'live' && link.expiresAt > Date.now() ? link : (await makeLink(view.payable)).link;
      return emailLink(current.id);
    },
    onSuccess: async ({ to }) => {
      toasts.push({ variant: 'success', title: t('payments:panel.toast.emailed', 'The pay link is on its way to {to}.', { to }) });
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
        <Notice
          key={waiting.id}
          tone="info"
          icon={Clock}
          action={view.mayRefund ? <RowMenu label={t('payments:panel.moreFor', 'More for {ref}', { ref: waiting.wayLabel ?? serviceName(waiting.provider) })} why={refusalWords('PROCESSING', waiting.provider, '')} onRefund={() => undefined} /> : undefined}
        >
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

      {view.payments
        .filter((payment) => payment.dispute !== null && payment.provider !== null)
        .map((payment) =>
          payment.dispute!.state === 'open' ? (
            <Notice key={`dispute-${payment.id}`} tone="danger" icon={ShieldAlert}>
              <span className="font-bold">{t('payments:panel.disputeLine', 'Disputed — answer it in the {service} dashboard', { service: serviceName(payment.provider!) })}</span>
              <span className="mt-1 block text-[12.5px] text-fg-muted">
                {t('payments:panel.disputeNote', 'If the dispute is lost, the money goes back to the customer. The invoice is not changed by itself.')}
              </span>
            </Notice>
          ) : (
            <Notice key={`dispute-${payment.id}`} tone="neutral" icon={ShieldAlert}>
              {t('payments:panel.disputeClosed', 'The dispute was closed. Its outcome is in the {service} dashboard.', { service: serviceName(payment.provider!) })}
            </Notice>
          ),
        )}

      {view.payments.length === 0 ? null : (
        <ul aria-label={t('payments:panel.listLabel', 'Payments on this record')} className="m-0 list-none rounded-[10px] border border-border p-0">
          {view.payments.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} currency={view.currency} locale={locale} mayRefund={view.mayRefund} onRefund={setRefunding} />
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
          {showCopy ? (
            <Button variant="secondary" iconLeft={<Mail aria-hidden="true" />} loading={email.isPending} onClick={() => email.mutate()}>
              {t('payments:panel.emailLink', 'Email pay link')}
            </Button>
          ) : null}
          {view.mayRecord ? (
            <Button iconLeft={<Plus aria-hidden="true" />} onClick={() => setRecording(true)}>
              {t('payments:panel.record', 'Record a payment')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {refunding !== null && refunding.attemptId !== null ? (
        <RefundDialog
          open
          onOpenChange={(open) => {
            if (!open) setRefunding(null);
          }}
          attemptId={refunding.attemptId}
          number={refunding.number}
          onRequested={(refund) => {
            const amount = formatMoney(refund.amount, refund.currency, locale);
            if (refund.state === 'failed') {
              toasts.push({ variant: 'error', title: t('payments:panel.toast.refundFailed', 'The refund of {amount} failed: {reason}', { amount, reason: refund.failureMessage ?? '' }) });
            } else toasts.push({ variant: 'success', title: t('payments:panel.toast.refundRequested', 'Refund of {amount} requested.', { amount }) });
            void queryClient.invalidateQueries({ queryKey: paymentPanelKey });
            onChanged?.();
          }}
        />
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
