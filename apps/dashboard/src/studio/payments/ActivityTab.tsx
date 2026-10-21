// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Payments → Activity.
 *
 * Two cards. "Needs a look" pins every row where money moved and something
 * did not follow, however old, each with its sentence and what can be done
 * about it; "Mark as checked" keeps who looked and what they found (a note is
 * required where the money may be owed back). "All activity" lists every
 * attempt and refund, newest first, filtered on the server, paged on its
 * cursor, exported as CSV, and opens one row's story in a drawer.
 *
 * Someone who may only see payments reads all of it and exports it, and is
 * offered nothing to act on. A flag where money may be owed back (paid and
 * not recorded, a different amount, paid after the record was voided) offers
 * "Refund" to whoever may refund: the record page's two-step refund, never an
 * automatic one.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CheckCheck,
  CircleAlert,
  CircleCheck,
  CloudOff,
  Copy,
  Download,
  Eye,
  FileX,
  Flag,
  Landmark,
  Layers,
  PencilLine,
  Receipt,
  RotateCcw,
  RotateCw,
  Scale,
  Settings2,
  ShieldAlert,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Button, Drawer, DrawerBody, DrawerHeader, FormField, Input, Modal, ModalBody, ModalFooter, ModalHeader, Select, Skeleton, Textarea } from '@adminium/ui';

import { bootstrapQuery, holdsSystemAction } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import type { PanelRefund } from '../../payments-panel/paymentPanelApi.js';
import {
  ACTIVITY_COUNT_QUERY_KEY,
  ACTIVITY_QUERY_KEY,
  NOTE_REQUIRED,
  NO_FILTERS,
  STATE_GROUPS,
  activityCountQuery,
  activityQuery,
  checkFlag,
  exportActivity,
  needsLookQuery,
  type ActivityFilters,
  type ActivityRow,
  type StateGroup,
} from './activityApi.js';
import { knownProvider, type ServiceView } from './paymentsApi.js';
import { locale as activeLocale } from './paymentsWords.js';

/** The record page's two-step refund, with its own words: loaded only when someone refunds. */
const RefundDialog = lazy(() => import('../../payments-panel/RefundDialog.js'));

/** The flags where money may be owed back, and so offer a refund. */
const REFUND_FLAGS: ReadonlySet<string> = new Set(['paid-not-recorded', 'amount-differs', 'payable-voided']);

type Tone = 'warn' | 'info' | 'danger' | 'neutral' | 'pos';

const TONE: Record<Tone, string> = {
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-3 text-fg-muted',
  pos: 'bg-pos-soft text-pos',
};

/** The dot of a step in a row's story. */
const DOT: Record<Tone, string> = { warn: 'bg-warn', info: 'bg-info', danger: 'bg-danger', neutral: 'bg-fg-subtle', pos: 'bg-pos' };

// ─── Words ──────────────────────────────────────────────────────────────────
// Switches, never assembled keys: a key built at runtime is invisible to the
// extractor and to the parity gate.

function stateWord(group: StateGroup): string {
  switch (group) {
    case 'started':
      return t('studio:payments.activity.state.started', 'Started');
    case 'paid':
      return t('studio:payments.activity.state.paid', 'Paid');
    case 'waiting':
      return t('studio:payments.activity.state.waiting', 'Waiting for the bank');
    case 'failed':
      return t('studio:payments.activity.state.failed', 'Did not go through');
    case 'expired':
      return t('studio:payments.activity.state.expired', 'Expired');
    case 'refunded':
      return t('studio:payments.activity.state.refunded', 'Refunded');
    case 'refundFailed':
      return t('studio:payments.activity.state.refundFailed', 'Refund failed');
    case 'disputed':
      return t('studio:payments.activity.state.disputed', 'Disputed');
  }
}

function stateTone(group: StateGroup): Tone {
  if (group === 'paid') return 'pos';
  if (group === 'waiting') return 'info';
  if (group === 'failed' || group === 'refundFailed') return 'danger';
  if (group === 'disputed') return 'warn';
  return 'neutral';
}

/** A payment service by its add-on key: the two first-party ones by their name, others as installed. */
function serviceName(key: string, services: readonly ServiceView[]): string {
  const known = knownProvider(key);
  if (known === 'stripe') return 'Stripe';
  if (known === 'paypal') return 'PayPal';
  if (key === 'demo') return t('studio:payments.activity.service.demo', 'Demo service');
  return services.find((one) => one.key === key)?.name ?? key;
}

/** A service's method id as a person reads it. */
function wayWord(way: string): string {
  switch (way) {
    case 'card':
      return t('studio:payments.activity.way.card', 'Card');
    case 'sepa_debit':
      return t('studio:payments.activity.way.sepa', 'SEPA Direct Debit');
    case 'paypal':
      return 'PayPal';
    case 'link':
      return 'Link';
    default:
      return way;
  }
}

function modeWord(mode: 'test' | 'live'): string {
  return mode === 'test' ? t('studio:payments.mode.test', 'Test') : t('studio:payments.mode.live', 'Live');
}

function money(amount: string, currency: string, locale: string): string {
  const decimals = (amount.split('.')[1] ?? '').length;
  try {
    return new Intl.NumberFormat(`${locale}-u-nu-latn`, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

function stamp(at: number, locale: string): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}

/** An invoice (made on the Invoices page or built on its shape), or another record a table marked payable. */
function isInvoice(row: ActivityRow): boolean {
  return row.payable === null || row.payable.kind === 'document' || row.payable.kind === 'shape';
}

function recordOf(row: ActivityRow): string {
  return row.payable?.label ?? row.payable?.rowKey ?? t('studio:payments.activity.noRecord', 'a record no longer there');
}

/** The flag's own sentence, with what it is about. */
export function flagSentence(row: ActivityRow, services: readonly ServiceView[], locale: string): string {
  const service = serviceName(row.service, services);
  const amount = money(row.amount, row.currency, locale);
  const record = recordOf(row);
  const invoice = isInvoice(row);
  switch (row.flag?.code) {
    case 'paid-not-recorded': {
      const head = t('studio:payments.activity.flag.notRecorded', 'Paid at {service}, not recorded: {record} · {amount}.', { service, record, amount });
      const reason = row.flag.reason;
      const why =
        reason === 'ALREADY_PAID' || reason === 'NOTHING_DUE'
          ? invoice
            ? t('studio:payments.activity.why.alreadyPaid', 'The invoice was already paid in full.')
            : t('studio:payments.activity.why.alreadyPaidRecord', 'The record was already paid in full.')
          : reason === 'NOT_TAKEN'
            ? t('studio:payments.activity.why.notTaken', '{service} did not say what it took.', { service })
            : reason === 'NOT_SENT'
              ? t('studio:payments.activity.why.notSent', 'The invoice was not sent yet.')
              : t('studio:payments.activity.why.refused', 'Its table did not take the payment.');
      return `${head} ${why}`;
    }
    case 'amount-differs': {
      const taken = money(row.amount, row.currency, locale);
      const asked = money(row.asked.amount, row.asked.currency, locale);
      if (row.flag.reason === 'MORE_THAN_DUE') return t('studio:payments.activity.flag.moreThanDue', 'Paid, but more than is now due: {service} took {taken} on {record}.', { service, taken, record });
      if (row.flag.reason === 'CURRENCY_DIFFERS') {
        return invoice
          ? t('studio:payments.activity.flag.otherCurrency', 'Paid, but in another currency: {service} took {taken}, the invoice was for {asked}.', { service, taken, asked })
          : t('studio:payments.activity.flag.otherCurrencyRecord', 'Paid, but in another currency: {service} took {taken}, {record} asked for {asked}.', { service, taken, record, asked });
      }
      return invoice
        ? t('studio:payments.activity.flag.amountDiffers', 'Paid, but the amount differs: {service} took {taken}, the invoice was for {asked}.', { service, taken, asked })
        : t('studio:payments.activity.flag.amountDiffersRecord', 'Paid, but the amount differs: {service} took {taken}, {record} asked for {asked}.', { service, taken, record, asked });
    }
    case 'refunded-at-provider':
      return row.payable === null
        ? t('studio:payments.activity.flag.refundedThereNoRecord', 'Refunded in the {service} dashboard: {amount}. Recorded.', { service, amount })
        : t('studio:payments.activity.flag.refundedThere', 'Refunded in the {service} dashboard: {amount} on {record}. Recorded.', { service, amount, record });
    case 'payable-voided':
      return invoice
        ? t('studio:payments.activity.flag.voided', 'Paid after the invoice was voided: {record} · {amount}.', { record, amount })
        : t('studio:payments.activity.flag.voidedRecord', 'Paid after the record was removed or voided: {record} · {amount}.', { record, amount });
    case 'mode-mismatch':
      return t('studio:payments.activity.flag.modeMismatch', 'Not believed: {service} answered in the other mode (test or live) for {record} · {amount}. Nothing was recorded.', { service, record, amount });
    case 'paid-twice':
      return t('studio:payments.activity.flag.paidTwice', 'Paid twice: a payment for {record} · {amount} arrived while another was on its way. Both are recorded.', { record, amount });
    case 'waiting-long': {
      const days = String(Math.floor((Date.now() - row.at) / 86_400_000));
      return row.way === null
        ? t('studio:payments.activity.flag.waitingLong', 'Waiting for the bank for {days} days: {record} · {amount}.', { days, record, amount })
        : t('studio:payments.activity.flag.waitingLongWay', 'Waiting for the bank for {days} days: {record} · {amount} ({way}).', { days, record, amount, way: wayWord(row.way) });
    }
    case 'record-changed':
      return t('studio:payments.activity.flag.recordChanged', 'A recorded payment changed: {record} · {amount} is no longer written down as it was.', { record, amount });
    case 'disputed':
      return t('studio:payments.activity.flag.disputed', 'Disputed: {record} · {amount}. Answer it in the {service} dashboard.', { record, amount, service });
    default:
      return '';
  }
}

function flagLook(row: ActivityRow): { icon: LucideIcon; tone: Tone } {
  switch (row.flag?.code) {
    case 'paid-not-recorded':
      return { icon: CircleAlert, tone: 'warn' };
    case 'amount-differs':
      return { icon: Scale, tone: 'warn' };
    case 'refunded-at-provider':
      return { icon: RotateCcw, tone: 'info' };
    case 'payable-voided':
      return { icon: FileX, tone: 'danger' };
    case 'mode-mismatch':
      return { icon: ShieldAlert, tone: 'warn' };
    case 'paid-twice':
      return { icon: Layers, tone: 'warn' };
    case 'waiting-long':
      return { icon: Landmark, tone: 'info' };
    case 'disputed':
      return { icon: ShieldAlert, tone: 'danger' };
    default:
      return { icon: PencilLine, tone: 'neutral' };
  }
}

/** The muted line under a flag or in a row: when, how and where. */
function metaLine(row: ActivityRow, services: readonly ServiceView[], locale: string): string {
  return [stamp(row.at, locale), row.payable?.label ?? null, row.paidWith, serviceName(row.service, services), modeWord(row.mode)].filter((part): part is string => part !== null && part !== '').join(' · ');
}

interface StoryStep {
  text: string;
  at: number | null;
  tone: Tone;
}

/** What happened, step by step, from the row's own moments. */
export function storyOf(row: ActivityRow, services: readonly ServiceView[], locale: string): StoryStep[] {
  const service = serviceName(row.service, services);
  const amount = money(row.amount, row.currency, locale);
  if (row.kind === 'refund') {
    const steps: StoryStep[] = [
      row.refundSource === 'provider'
        ? { text: t('studio:payments.activity.story.refundThere', 'Refunded in the {service} dashboard: {amount}', { service, amount }), at: row.times.started, tone: 'info' }
        : { text: t('studio:payments.activity.story.refundStarted', 'Refund of {amount} started', { amount }), at: row.times.started, tone: 'neutral' },
    ];
    if (row.group === 'refunded') steps.push({ text: t('studio:payments.activity.story.refunded', '{service} says refunded', { service }), at: row.times.settled ?? row.times.updated, tone: 'pos' });
    if (row.group === 'refundFailed') steps.push({ text: t('studio:payments.activity.story.refundFailed', '{service} says the refund failed', { service }), at: row.times.settled ?? row.times.updated, tone: 'danger' });
    if (row.times.recorded !== null) steps.push({ text: t('studio:payments.activity.story.refundApplied', 'The record’s balance follows it'), at: row.times.recorded, tone: 'pos' });
    return steps;
  }
  const differs = row.asked.amount !== row.amount || row.asked.currency !== row.currency;
  const steps: StoryStep[] = [
    differs
      ? { text: t('studio:payments.activity.story.startedFor', 'Started for {amount}', { amount: money(row.asked.amount, row.asked.currency, locale) }), at: row.times.started, tone: 'neutral' }
      : { text: t('studio:payments.activity.story.started', 'Started'), at: row.times.started, tone: 'neutral' },
  ];
  switch (row.state) {
    case 'creating':
    case 'open':
      steps.push({ text: t('studio:payments.activity.story.onPayPage', 'Waiting for the customer to finish on the {service} page', { service }), at: null, tone: 'neutral' });
      break;
    case 'processing':
      steps.push({ text: t('studio:payments.activity.story.waiting', '{service} says it is waiting for the bank', { service }), at: row.times.settled ?? row.times.updated, tone: 'info' });
      break;
    case 'failed':
      steps.push({ text: t('studio:payments.activity.story.failed', '{service} says it did not go through', { service }), at: row.times.updated, tone: 'danger' });
      steps.push({ text: t('studio:payments.activity.story.nothingTaken', 'Nothing was taken'), at: null, tone: 'neutral' });
      break;
    case 'expired':
      steps.push({ text: t('studio:payments.activity.story.expired', 'The {service} checkout expired before it was paid', { service }), at: row.times.updated, tone: 'neutral' });
      steps.push({ text: t('studio:payments.activity.story.nothingTaken', 'Nothing was taken'), at: null, tone: 'neutral' });
      break;
    case 'cancelled':
      steps.push({ text: t('studio:payments.activity.story.left', 'The customer left the {service} page', { service }), at: row.times.updated, tone: 'neutral' });
      steps.push({ text: t('studio:payments.activity.story.nothingTaken', 'Nothing was taken'), at: null, tone: 'neutral' });
      break;
    case 'abandoned':
      steps.push({ text: t('studio:payments.activity.story.abandoned', 'The checkout was never opened'), at: row.times.updated, tone: 'neutral' });
      break;
    default: {
      steps.push(
        differs
          ? { text: t('studio:payments.activity.story.paidAmount', '{service} says paid {amount}', { service, amount }), at: row.times.settled, tone: 'pos' }
          : { text: t('studio:payments.activity.story.paid', '{service} says paid', { service }), at: row.times.settled, tone: 'pos' },
      );
      if (row.state === 'recorded') steps.push({ text: t('studio:payments.activity.story.recorded', 'Recorded'), at: row.times.recorded, tone: 'pos' });
      if (row.state === 'record_refused') steps.push({ text: t('studio:payments.activity.story.notRecorded', 'Not recorded: it needs a look'), at: row.times.updated, tone: 'warn' });
    }
  }
  if (row.dispute !== null) {
    steps.push({ text: t('studio:payments.activity.story.disputed', 'Dispute opened by the card holder'), at: row.dispute.at, tone: 'danger' });
    steps.push(
      row.dispute.state === 'open'
        ? { text: t('studio:payments.activity.story.disputeAnswer', 'Answer it in the {service} dashboard', { service }), at: null, tone: 'warn' }
        : { text: t('studio:payments.activity.story.disputeClosed', 'The dispute was closed. Its outcome is in the {service} dashboard.', { service }), at: row.dispute.closedAt, tone: 'neutral' },
    );
  }
  return steps;
}

// ─── The "Needs a look" card ────────────────────────────────────────────────

/** A service's webhook stopped, and the sweep found a payment by asking: drawn from the setup's health. */
interface WebhookSilence {
  key: string;
  service: string;
  mode: 'test' | 'live';
  hours: number | null;
}

function silences(services: readonly ServiceView[]): WebhookSilence[] {
  const out: WebhookSilence[] = [];
  for (const service of services) {
    for (const mode of ['live', 'test'] as const) {
      const health = service[mode].health;
      if (health === undefined || health.caughtAt === null) continue;
      if (health.lastEventAt !== null && health.lastEventAt >= health.caughtAt) continue;
      out.push({ key: `${service.key}:${mode}`, service: service.key, mode, hours: health.lastEventAt === null ? null : Math.max(1, Math.floor((Date.now() - health.lastEventAt) / 3_600_000)) });
    }
  }
  return out;
}

function Tile({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }): ReactNode {
  return (
    <span className={`flex size-[34px] shrink-0 items-center justify-center rounded-[10px] ${TONE[tone]}`} aria-hidden="true">
      <Icon className="size-4" />
    </span>
  );
}

function FlagRow({
  row,
  services,
  locale,
  canManage,
  canRefund,
  first,
  onCheck,
  onRefund,
  checkedRef,
}: {
  row: ActivityRow;
  services: readonly ServiceView[];
  locale: string;
  canManage: boolean;
  canRefund: boolean;
  first: boolean;
  onCheck: (row: ActivityRow, from: HTMLButtonElement) => void;
  onRefund: (row: ActivityRow, from: HTMLButtonElement) => void;
  checkedRef: (element: HTMLElement | null) => void;
}): ReactNode {
  const look = flagLook(row);
  // Money may be owed back, and some of it may still go back online.
  const refundable = canRefund && row.check === null && row.flag !== null && REFUND_FLAGS.has(row.flag.code) && row.refund !== null && row.refund.refusal === null;
  const markable = canManage && row.check === null;
  return (
    <div className={`flex flex-wrap items-start gap-3.5 px-5 py-4 ${first ? '' : 'border-t border-border'} ${row.check === null ? '' : 'bg-surface-2'}`} data-testid={`activity-flag-${row.id}`}>
      <Tile icon={look.icon} tone={look.tone} />
      <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
        <p className="text-[13px] font-bold leading-normal [text-wrap:pretty]">{flagSentence(row, services, locale)}</p>
        <p className="text-[11.5px] text-fg-subtle">{metaLine(row, services, locale)}</p>
        {row.check !== null ? (
          <p ref={checkedRef} tabIndex={-1} className="flex items-start gap-1.5 text-[12.5px] text-fg-muted outline-none" data-testid={`activity-checked-${row.id}`}>
            <CheckCheck className="mt-0.5 size-3.5 shrink-0 text-pos" aria-hidden="true" />
            <span>
              {row.check.by === null
                ? row.check.note === null || row.check.note === ''
                  ? t('studio:payments.activity.checkedByYou', 'Checked by you')
                  : t('studio:payments.activity.checkedByYouNote', 'Checked by you · {note}', { note: row.check.note })
                : row.check.note === null || row.check.note === ''
                  ? t('studio:payments.activity.checkedBy', 'Checked by {name}', { name: row.check.byName ?? t('studio:payments.activity.someone', 'someone') })
                  : t('studio:payments.activity.checkedByNote', 'Checked by {name} · {note}', { name: row.check.byName ?? t('studio:payments.activity.someone', 'someone'), note: row.check.note })}
            </span>
          </p>
        ) : null}
        {refundable || markable ? (
          <div className="mt-0.5 flex flex-wrap gap-2">
            {refundable ? (
              <Button variant="secondary" size="sm" iconLeft={<RotateCcw className="size-3.5" aria-hidden="true" />} aria-haspopup="dialog" onClick={(event) => onRefund(row, event.currentTarget)}>
                {row.flag?.code === 'paid-not-recorded'
                  ? t('studio:payments.activity.refundAmount', 'Refund {amount}', { amount: money(row.refund!.refundable, row.currency, locale) })
                  : t('studio:payments.activity.refund', 'Refund')}
              </Button>
            ) : null}
            {markable ? (
              <Button variant="secondary" size="sm" iconLeft={<CircleCheck className="size-3.5" aria-hidden="true" />} aria-haspopup="dialog" onClick={(event) => onCheck(row, event.currentTarget)}>
                {t('studio:payments.activity.markChecked', 'Mark as checked')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CheckDialog({ row, services, locale, onClose }: { row: ActivityRow | null; services: readonly ServiceView[]; locale: string; onClose: (checked: ActivityRow | null, note?: string | null) => void }): ReactNode {
  const client = useQueryClient();
  const toasts = useAppToasts();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const required = row !== null && row.flag !== null && NOTE_REQUIRED.has(row.flag.code);
  useEffect(() => {
    setNote('');
    setError(null);
  }, [row]);
  const save = useMutation({
    mutationFn: async () => {
      if (row === null) return;
      const trimmed = note.trim();
      await checkFlag(row, trimmed === '' ? null : trimmed);
    },
    onSuccess: async () => {
      toasts.push({ variant: 'success', title: t('studio:payments.activity.toast.checked', 'Marked as checked') });
      await client.invalidateQueries({ queryKey: ACTIVITY_QUERY_KEY });
      await client.invalidateQueries({ queryKey: ACTIVITY_COUNT_QUERY_KEY });
      onClose(row, note.trim() === '' ? null : note.trim());
    },
    onError: (failure) => setError(failure instanceof Error ? failure.message : t('studio:payments.error.unknown', 'That did not work. Try again.')),
  });
  const empty = note.trim() === '';
  return (
    <Modal open={row !== null} onOpenChange={(open) => (open ? undefined : onClose(null))}>
      {row === null ? null : (
        <>
          <ModalHeader title={t('studio:payments.activity.markChecked', 'Mark as checked')} closeLabel={t('studio:payments.activity.cancel', 'Cancel')} />
          <ModalBody className="flex flex-col gap-3.5">
            <p className="rounded-[10px] border border-border bg-surface-2 px-3 py-2.5 text-[13px] font-bold leading-normal">{flagSentence(row, services, locale)}</p>
            <FormField
              label={required ? t('studio:payments.activity.noteRequired', 'Note (required)') : t('studio:payments.activity.note', 'Note')}
              helper={t('studio:payments.activity.noteHelp', 'The note stays on this row for everyone who can see Activity.')}
              error={error ?? undefined}
            >
              <Textarea
                ref={area}
                autoFocus
                required={required}
                maxLength={500}
                rows={3}
                placeholder={t('studio:payments.activity.notePlaceholder', 'What did you check?')}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setError(null);
                }}
                data-testid="activity-check-note"
              />
            </FormField>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => onClose(null)}>
              {t('studio:payments.activity.cancel', 'Cancel')}
            </Button>
            <Button
              aria-disabled={required && empty}
              loading={save.isPending}
              onClick={() => {
                if (required && empty) {
                  setError(t('studio:payments.activity.noteNeeded', 'Say what you checked.'));
                  area.current?.focus();
                  return;
                }
                save.mutate();
              }}
              data-testid="activity-check-save"
            >
              {t('studio:payments.activity.markChecked', 'Mark as checked')}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

function NeedsLookCard({ services, locale, canManage, canRefund, onOpenSetup }: { services: readonly ServiceView[]; locale: string; canManage: boolean; canRefund: boolean; onOpenSetup: () => void }): ReactNode {
  const open = useQuery(needsLookQuery());
  const count = useQuery(activityCountQuery());
  const client = useQueryClient();
  const toasts = useAppToasts();
  const [checking, setChecking] = useState<ActivityRow | null>(null);
  const [refunding, setRefunding] = useState<ActivityRow | null>(null);
  const [kept, setKept] = useState<ActivityRow[]>([]);
  const focusAfter = useRef<string | null>(null);
  const returnTo = useRef<HTMLButtonElement | null>(null);
  const silent = silences(services);
  // A checked flag stays in the group, tinted, with its line, until the page is opened again.
  const rows = [...(open.data?.rows ?? []), ...kept.filter((one) => !(open.data?.rows ?? []).some((row) => row.id === one.id))].sort((a, b) => b.at - a.at);
  const headingId = useId();
  const total = count.data ?? open.data?.rows.length ?? 0;
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm" data-testid="activity-needs-look">
      <div className="flex items-center gap-2.5 border-b border-border bg-warn-soft px-5 py-3.5">
        <Flag className="size-4 shrink-0 text-warn" aria-hidden="true" />
        <h2 id={headingId} className="text-[14.5px] font-bold tracking-[-0.01em]">
          {t('studio:payments.activity.needsLook', 'Needs a look')}
        </h2>
        <span className="rounded-full bg-surface px-2 py-px font-mono text-[11px] font-bold text-warn" data-testid="activity-needs-look-count">
          {String(total)}
        </span>
      </div>
      {open.isPending ? (
        <div className="flex flex-col gap-2 p-5" aria-busy="true">
          <Skeleton height={14} />
          <Skeleton height={14} width="60%" />
        </div>
      ) : open.isError ? (
        <ErrorBlock onRetry={() => void open.refetch()} />
      ) : rows.length === 0 && silent.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-[13px] font-semibold" data-testid="activity-nothing-needs-look">
          <CircleCheck className="size-4 text-pos" aria-hidden="true" />
          {t('studio:payments.activity.nothingNeedsLook', 'Nothing needs a look.')}
        </p>
      ) : (
        <>
          {silent.map((one, index) => (
            <div key={one.key} className={`flex flex-wrap items-start gap-3.5 px-5 py-4 ${index === 0 ? '' : 'border-t border-border'}`} data-testid={`activity-silent-${one.key}`}>
              <Tile icon={Webhook} tone="warn" />
              <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                <p className="text-[13px] font-bold leading-normal">
                  {one.hours === null
                    ? t('studio:payments.activity.silentNever', 'No webhook from {service} has arrived yet. Adminium found a payment by checking {service}.', { service: serviceName(one.service, services) })
                    : t('studio:payments.activity.silent', 'No webhook from {service} for {hours, plural, one {# hour} other {# hours}}. Adminium found a payment by checking {service}.', { service: serviceName(one.service, services), hours: one.hours })}
                </p>
                <p className="text-[11.5px] text-fg-subtle">{[serviceName(one.service, services), modeWord(one.mode)].join(' · ')}</p>
                {canManage ? (
                  <div className="mt-0.5">
                    <Button variant="secondary" size="sm" iconLeft={<Settings2 className="size-3.5" aria-hidden="true" />} onClick={onOpenSetup}>
                      {t('studio:payments.activity.openSetup', 'Open setup')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {rows.map((row, index) => (
            <FlagRow
              key={row.id}
              row={row}
              services={services}
              locale={locale}
              canManage={canManage}
              canRefund={canRefund}
              first={index === 0 && silent.length === 0}
              onCheck={(chosen, from) => {
                returnTo.current = from;
                setChecking(chosen);
              }}
              onRefund={(chosen, from) => {
                returnTo.current = from;
                setRefunding(chosen);
              }}
              checkedRef={(element) => {
                // After "Mark as checked" the button is gone: focus goes to the line that replaced it.
                if (element !== null && focusAfter.current === row.id) {
                  focusAfter.current = null;
                  element.focus();
                }
              }}
            />
          ))}
        </>
      )}
      {refunding !== null && refunding.kind === 'attempt' ? (
        <Suspense fallback={null}>
          <RefundDialog
            open
            onOpenChange={(still) => {
              if (still) return;
              setRefunding(null);
              returnTo.current?.focus();
            }}
            attemptId={refunding.id}
            onRequested={(refund: PanelRefund) => {
              const amount = money(refund.amount, refund.currency, locale);
              toasts.push(
                refund.state === 'failed'
                  ? { variant: 'error', title: t('studio:payments.activity.toast.refundFailed', 'The refund of {amount} failed: {reason}', { amount, reason: refund.failureMessage ?? '' }) }
                  : { variant: 'success', title: t('studio:payments.activity.toast.refundRequested', 'Refund of {amount} requested.', { amount }) },
              );
              void client.invalidateQueries({ queryKey: ACTIVITY_QUERY_KEY });
            }}
          />
        </Suspense>
      ) : null}
      <CheckDialog
        row={checking}
        services={services}
        locale={locale}
        onClose={(checked, note = null) => {
          setChecking(null);
          if (checked === null) {
            returnTo.current?.focus();
            return;
          }
          focusAfter.current = checked.id;
          setKept((list) => [...list.filter((one) => one.id !== checked.id), { ...checked, check: { at: Date.now(), by: null, byName: null, note } }]);
        }}
      />
    </section>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }): ReactNode {
  return (
    <div role="alert" className="flex flex-col items-center gap-2.5 px-5 py-8 text-center" data-testid="activity-load-error">
      <Tile icon={CloudOff} tone="danger" />
      <p className="text-[13px] font-bold">{t('studio:payments.activity.loadFailed', 'Could not load payments')}</p>
      <Button iconLeft={<RotateCw className="size-3.5" aria-hidden="true" />} onClick={onRetry}>
        {t('studio:payments.activity.tryAgain', 'Try again')}
      </Button>
    </div>
  );
}

// ─── All activity ───────────────────────────────────────────────────────────

function StatePill({ group }: { group: StateGroup }): ReactNode {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-bold ${TONE[stateTone(group)]}`}>{stateWord(group)}</span>;
}

function ModeBadge({ mode }: { mode: 'test' | 'live' }): ReactNode {
  return <Badge tone={mode === 'test' ? 'warn' : 'neutral'}>{modeWord(mode)}</Badge>;
}

function whatOf(row: ActivityRow): ReactNode {
  return (
    <>
      {row.kind === 'refund' ? `${t('studio:payments.activity.refundOf', 'Refund')} · ` : null}
      <bdi dir="ltr" className="font-mono text-[0.96em]">
        {recordOf(row)}
      </bdi>
    </>
  );
}

function wayOf(row: ActivityRow, services: readonly ServiceView[]): string {
  return [row.paidWith ?? (row.way === null ? null : wayWord(row.way)), serviceName(row.service, services)].filter((part): part is string => part !== null).join(' · ');
}

function PaymentDrawer({ row, services, locale, onClose }: { row: ActivityRow | null; services: readonly ServiceView[]; locale: string; onClose: () => void }): ReactNode {
  const toasts = useAppToasts();
  if (row === null) return null;
  const service = serviceName(row.service, services);
  const ids: { label: string; value: string }[] = [];
  if (row.kind === 'attempt' && row.refs.attempt !== null) ids.push({ label: t('studio:payments.activity.id.attempt', 'Attempt id'), value: row.refs.attempt });
  if (row.refs.checkout !== null) ids.push({ label: t('studio:payments.activity.id.checkout', '{service} checkout id', { service }), value: row.refs.checkout });
  if (row.refs.payment !== null) ids.push({ label: t('studio:payments.activity.id.payment', '{service} payment id', { service }), value: row.refs.payment });
  if (row.refs.refund !== null) ids.push({ label: t('studio:payments.activity.id.refund', '{service} refund id', { service }), value: row.refs.refund });
  const story = storyOf(row, services, locale);
  return (
    <Drawer open size="lg" onOpenChange={(open) => (open ? undefined : onClose())}>
      <DrawerHeader
        title={
          <span>
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">{row.kind === 'refund' ? t('studio:payments.activity.refundOf', 'Refund') : t('studio:payments.activity.payment', 'Payment')}</span>
            <bdi dir="ltr" className="font-mono">
              {recordOf(row)}
            </bdi>
          </span>
        }
        closeLabel={t('studio:payments.activity.close', 'Close')}
      />
      <DrawerBody className="flex flex-col gap-5" data-testid="activity-drawer">
        <div className="flex flex-wrap items-center gap-2.5">
          <bdi dir="ltr" className="font-mono text-[24px] font-bold tracking-[-0.02em]">
            {money(row.amount, row.currency, locale)}
          </bdi>
          <StatePill group={row.group} />
          <ModeBadge mode={row.mode} />
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[18px] gap-y-2 text-[13px]">
          <dt className="text-fg-subtle">{t('studio:payments.activity.col.way', 'Way to pay')}</dt>
          <dd className="font-semibold">{row.paidWith ?? (row.way === null ? '—' : wayWord(row.way))}</dd>
          <dt className="text-fg-subtle">{t('studio:payments.activity.col.service', 'Service')}</dt>
          <dd className="font-semibold">{service}</dd>
          <dt className="text-fg-subtle">{t('studio:payments.activity.col.record', 'Record')}</dt>
          <dd className="font-semibold">
            <bdi dir="ltr" className="font-mono">
              {recordOf(row)}
            </bdi>
          </dd>
        </dl>
        <section className="flex flex-col gap-3">
          <h3 className="text-[14.5px] font-bold tracking-[-0.01em]">{t('studio:payments.activity.whatHappened', 'What happened')}</h3>
          <ol className="flex flex-col">
            {story.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex shrink-0 flex-col items-center pt-1" aria-hidden="true">
                  <span className={`size-2.5 rounded-full ${DOT[step.tone]}`} />
                  {index < story.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
                </span>
                <div className="min-w-0 pb-3.5">
                  <p className="text-[13px] font-bold">{step.text}</p>
                  {step.at === null ? null : (
                    <p dir="ltr" className="mt-px text-start font-mono text-[11.5px] text-fg-subtle">
                      {stamp(step.at, locale)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
        {ids.length > 0 ? (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-[14.5px] font-bold tracking-[-0.01em]">{t('studio:payments.activity.ids', 'Ids')}</h3>
            <ul>
              {ids.map((id) => (
                <li key={id.label} className="flex flex-wrap items-center gap-2.5 border-t border-border py-2">
                  <span className="w-[150px] shrink-0 text-[12.5px] text-fg-subtle">{id.label}</span>
                  <code dir="ltr" className="min-w-[140px] flex-1 text-start font-mono text-[12.5px] [overflow-wrap:anywhere]">
                    {id.value}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('studio:payments.activity.copyId', 'Copy {label}', { label: id.label })}
                    iconLeft={<Copy className="size-3.5" aria-hidden="true" />}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(id.value)
                        .then(() => toasts.push({ variant: 'success', title: t('studio:payments.activity.toast.copied', 'Copied') }))
                        .catch(() => toasts.push({ variant: 'warning', title: t('studio:payments.activity.toast.copyFailed', 'Could not copy. Select the text and copy it.') }));
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </DrawerBody>
    </Drawer>
  );
}

function AllActivityCard({ services, locale }: { services: readonly ServiceView[]; locale: string }): ReactNode {
  const toasts = useAppToasts();
  const [filters, setFilters] = useState<ActivityFilters>(NO_FILTERS);
  const [seenWays, setSeenWays] = useState<string[]>([]);
  const [opened, setOpened] = useState<ActivityRow | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const list = useInfiniteQuery(activityQuery(filters));
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.rows), [list.data]);
  useEffect(() => {
    const ways = rows.map((row) => row.way).filter((way): way is string => way !== null);
    setSeenWays((known) => (ways.every((way) => known.includes(way)) ? known : [...new Set([...known, ...ways])].sort()));
  }, [rows]);
  const filtered = filters.state !== '' || filters.service !== '' || filters.way !== '' || filters.mode !== '' || filters.from !== '' || filters.to !== '';
  const headingId = useId();
  const serviceKeys = [...new Set([...services.map((one) => one.key), 'demo'])];
  const exporting = useMutation({
    mutationFn: () => exportActivity(filters),
    onSuccess: (name) => toasts.push({ variant: 'success', title: t('studio:payments.activity.toast.downloaded', 'Downloaded {file}', { file: name }) }),
    onError: () => toasts.push({ variant: 'error', title: t('studio:payments.activity.toast.exportFailed', 'Could not export. Try again.') }),
  });
  const set = (patch: Partial<ActivityFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const open = (row: ActivityRow, from: HTMLElement) => {
    opener.current = from;
    setOpened(row);
  };

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-sm" data-testid="activity-all">
      <div className="flex flex-wrap items-baseline gap-2.5 px-5 pt-3.5">
        <h2 id={headingId} className="text-[14.5px] font-bold tracking-[-0.01em]">
          {t('studio:payments.activity.all', 'All activity')}
        </h2>
        <span className="text-[11.5px] text-fg-subtle">{t('studio:payments.activity.allSub', 'Payment attempts, payments and refunds')}</span>
      </div>
      <div className="flex flex-wrap items-end gap-2.5 border-b border-border px-5 pb-3.5 pt-3">
        <FormField className="w-[150px] max-sm:w-[calc(50%-5px)]" label={t('studio:payments.activity.filter.state', 'State')}>
          <Select value={filters.state} onChange={(event) => set({ state: event.target.value as StateGroup | '' })} data-testid="activity-filter-state">
            <option value="">{t('studio:payments.activity.filter.allStates', 'All states')}</option>
            {STATE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {stateWord(group)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField className="w-[150px] max-sm:w-[calc(50%-5px)]" label={t('studio:payments.activity.filter.service', 'Service')}>
          <Select value={filters.service} onChange={(event) => set({ service: event.target.value })} data-testid="activity-filter-service">
            <option value="">{t('studio:payments.activity.filter.allServices', 'All services')}</option>
            {serviceKeys.map((key) => (
              <option key={key} value={key}>
                {serviceName(key, services)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField className="w-[150px] max-sm:w-[calc(50%-5px)]" label={t('studio:payments.activity.filter.way', 'Way to pay')}>
          <Select value={filters.way} onChange={(event) => set({ way: event.target.value })} data-testid="activity-filter-way">
            <option value="">{t('studio:payments.activity.filter.allWays', 'All ways')}</option>
            {[...new Set([...seenWays, ...(filters.way === '' ? [] : [filters.way])])].map((way) => (
              <option key={way} value={way}>
                {wayWord(way)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField className="w-[150px] max-sm:w-[calc(50%-5px)]" label={t('studio:payments.activity.filter.mode', 'Test / Live')}>
          <Select value={filters.mode} onChange={(event) => set({ mode: event.target.value as ActivityFilters['mode'] })} data-testid="activity-filter-mode">
            <option value="">{t('studio:payments.activity.filter.allModes', 'Test and live')}</option>
            <option value="test">{modeWord('test')}</option>
            <option value="live">{modeWord('live')}</option>
          </Select>
        </FormField>
        <FormField className="w-[150px] max-sm:w-[calc(50%-5px)]" label={t('studio:payments.activity.filter.from', 'From')}>
          <Input type="date" dir="ltr" className="font-mono" value={filters.from} onChange={(event) => set({ from: event.target.value })} data-testid="activity-filter-from" />
        </FormField>
        <FormField className="w-[150px] max-sm:w-[calc(50%-5px)]" label={t('studio:payments.activity.filter.to', 'To')}>
          <Input type="date" dir="ltr" className="font-mono" value={filters.to} onChange={(event) => set({ to: event.target.value })} data-testid="activity-filter-to" />
        </FormField>
        <Button variant="secondary" className="ms-auto" iconLeft={<Download className="size-3.5" aria-hidden="true" />} loading={exporting.isPending} onClick={() => exporting.mutate()} data-testid="activity-export">
          {t('studio:payments.activity.export', 'Export CSV')}
        </Button>
      </div>

      {list.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3 px-5 py-4" data-testid="activity-loading">
          <span className="sr-only">{t('studio:payments.activity.loading', 'Loading payments')}</span>
          {[0, 1, 2, 3, 4, 5].map((one) => (
            <Skeleton key={one} height={16} />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorBlock onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        filtered ? (
          <div className="flex flex-col items-center gap-2.5 px-5 py-8 text-center" data-testid="activity-no-match">
            <p className="text-[13px] font-bold">{t('studio:payments.activity.noMatch', 'No payments match these filters.')}</p>
            <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
              {t('studio:payments.activity.clearFilters', 'Clear filters')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center" data-testid="activity-empty">
            <Tile icon={Receipt} tone="neutral" />
            <p className="text-[14px] font-bold">{t('studio:payments.activity.emptyTitle', 'No payments yet.')}</p>
            <p className="text-[13px] text-fg-muted">{t('studio:payments.activity.emptyBody', 'When customers pay, they appear here.')}</p>
          </div>
        )
      ) : (
        <>
          <div className="overflow-x-auto max-md:hidden">
            <table className="w-full border-collapse text-[13px]" data-testid="activity-table">
              <thead>
                <tr className="bg-surface-2 text-start">
                  {[t('studio:payments.activity.col.when', 'When'), t('studio:payments.activity.col.what', 'What'), t('studio:payments.activity.col.way', 'Way to pay')].map((label) => (
                    <th key={label} scope="col" className="whitespace-nowrap border-b border-border px-3 py-2 text-start text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle first:ps-5">
                      {label}
                    </th>
                  ))}
                  <th scope="col" className="border-b border-border px-3 py-2 text-end text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">
                    {t('studio:payments.activity.col.amount', 'Amount')}
                  </th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-start text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">
                    {t('studio:payments.activity.col.state', 'State')}
                  </th>
                  <th scope="col" className="border-b border-border px-3 py-2 pe-5">
                    <span className="sr-only">{t('studio:payments.activity.col.mode', 'Test or live')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={`border-b border-border last:border-0 ${opened?.id === row.id ? 'bg-accent-soft' : ''}`} data-testid="activity-row">
                    <td dir="ltr" className="whitespace-nowrap py-2.5 pe-3 ps-5 font-mono text-[12px] text-fg-muted">
                      {stamp(row.at, locale)}
                    </td>
                    <td className="px-3 py-2.5">
                      <button type="button" className="cursor-pointer text-start font-bold text-fg hover:underline" onClick={(event) => open(row, event.currentTarget)}>
                        {whatOf(row)}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{wayOf(row, services)}</td>
                    <td dir="ltr" className="whitespace-nowrap px-3 py-2.5 text-end font-mono font-semibold">
                      {money(row.amount, row.currency, locale)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <StatePill group={row.group} />
                        {row.flag !== null && row.check === null ? (
                          <span title={t('studio:payments.activity.needsLook', 'Needs a look')} className="inline-flex text-warn">
                            <Flag className="size-[13px]" aria-hidden="true" />
                            <span className="sr-only">{t('studio:payments.activity.needsLook', 'Needs a look')}</span>
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-2.5 pe-5 ps-3">
                      <ModeBadge mode={row.mode} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden" data-testid="activity-cards">
            {rows.map((row) => (
              <li key={row.id} className="border-b border-border">
                <button type="button" className="flex w-full flex-col gap-1.5 px-4 py-3 text-start" onClick={(event) => open(row, event.currentTarget)}>
                  <span className="flex w-full items-baseline gap-2.5">
                    <span className="min-w-0 text-[13px] font-bold">{whatOf(row)}</span>
                    <bdi dir="ltr" className="ms-auto whitespace-nowrap font-mono text-[13px] font-semibold">
                      {money(row.amount, row.currency, locale)}
                    </bdi>
                  </span>
                  <span className="text-[12px] text-fg-muted">
                    {wayOf(row, services)} ·{' '}
                    <bdi dir="ltr" className="font-mono">
                      {stamp(row.at, locale)}
                    </bdi>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatePill group={row.group} />
                    <ModeBadge mode={row.mode} />
                    {row.flag !== null && row.check === null ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-warn">
                        <Flag className="size-3" aria-hidden="true" />
                        {t('studio:payments.activity.needsLook', 'Needs a look')}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {list.hasNextPage ? (
        <div className="flex justify-center border-t border-border bg-surface-2 px-5 py-3">
          <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} data-testid="activity-older">
            {t('studio:payments.activity.older', 'Load older payments')}
          </Button>
        </div>
      ) : null}
      <PaymentDrawer
        row={opened}
        services={services}
        locale={locale}
        onClose={() => {
          setOpened(null);
          opener.current?.focus();
        }}
      />
    </section>
  );
}

// ─── The tab ────────────────────────────────────────────────────────────────

export function ActivityTab({ services, canManage, onOpenSetup }: { services: readonly ServiceView[]; canManage: boolean; onOpenSetup: () => void }): ReactNode {
  const locale = activeLocale();
  // Refunding is its own right, apart from managing payments.
  const bootstrap = useQuery(bootstrapQuery()).data;
  const canRefund = bootstrap !== undefined && holdsSystemAction(bootstrap, 'payments.refund');
  return (
    <div className="flex flex-col gap-[18px]" data-testid="payments-activity">
      {!canManage ? (
        <div role="note" className="flex items-center gap-2.5 rounded-[14px] bg-info-soft px-4 py-3 text-[13px] font-semibold" data-testid="activity-view-only">
          <Eye className="size-[17px] shrink-0 text-info" aria-hidden="true" />
          <span>{t('studio:payments.activity.viewOnly', 'You can view payments. Ask someone who manages payments to act.')}</span>
        </div>
      ) : null}
      <NeedsLookCard services={services} locale={locale} canManage={canManage} canRefund={canRefund} onOpenSetup={onOpenSetup} />
      <AllActivityCard services={services} locale={locale} />
    </div>
  );
}
