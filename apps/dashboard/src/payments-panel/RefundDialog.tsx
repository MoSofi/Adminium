// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Refund a payment taken online, in two steps.
 *
 * Step 1 reads what may still be refunded (the server's preview): Full fills
 * it in and keeps it, Part lets the person type less. Over the most that can
 * be refunded, the line under the amount turns red and Continue goes off.
 * Step 2 asks once more in so many words, with focus on Back; Refund is the
 * danger button. The key that makes the refund happen once is minted when the
 * person continues to step 2, so a double click or a lost answer refunds once,
 * and a changed amount after Back is a new refund.
 *
 * Its words load with it (the deferred `payments` namespace), so Studio can
 * open it too.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Badge, Button, ChoiceChips, FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField, InputGroup, SegmentedControl, Skeleton, Textarea } from '@adminium/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CornerDownLeft, RotateCcw } from 'lucide-react';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import type { PanelRefund } from './paymentPanelApi.js';
import { fetchRefundPreview, REFUND_REASONS, requestRefund, type RefundPreview, type RefundReason } from './refundApi.js';
import { decimalsOf, formatMoney, holdsCardNumber, moreThan, newPaymentKey, typedAmount } from './paymentText.js';
import { readerLocale, usePaymentsMessages } from './paymentsMessages.js';
import { refusalWords } from './refundWords.js';

const REASON_WORDS: Record<RefundReason, () => string> = {
  requested_by_customer: () => t('payments:refund.reasons.requested_by_customer', 'Requested by customer'),
  duplicate: () => t('payments:refund.reasons.duplicate', 'Duplicate'),
  fraudulent: () => t('payments:refund.reasons.fraudulent', 'Fraudulent'),
  other: () => t('payments:refund.reasons.other', 'Other'),
};

export interface RefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The online payment to refund. */
  attemptId: string;
  /** The payment's own number, when it has one ("REC-0012"); the record's label otherwise. */
  number?: string | null | undefined;
  /** Called once the server took the refund (asked, done, or refused by the service in its words). */
  onRequested: (refund: PanelRefund) => void;
}

/** What the amount must be, in the decimals the payment was taken in. */
function amountProblem(typed: string | null, preview: RefundPreview): 'invalid' | 'over' | null {
  if (typed === null || !moreThan(typed, '0') || decimalsOf(typed) > decimalsOf(preview.refundable)) return 'invalid';
  return moreThan(typed, preview.refundable) ? 'over' : null;
}

export default function RefundDialog({ open, onOpenChange, attemptId, number, onRequested }: RefundDialogProps): ReactNode {
  usePaymentsMessages();
  const locale = readerLocale();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<'full' | 'part'>('full');
  const [partAmount, setPartAmount] = useState('');
  const [reason, setReason] = useState<RefundReason>('requested_by_customer');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);

  const preview = useQuery({ queryKey: ['payment-refund', attemptId], queryFn: () => fetchRefundPreview(attemptId), enabled: open, staleTime: 0 });
  const view = preview.data;

  // A fresh dialog each time it opens: what is left now, Full, and no key yet.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setMode('full');
    setPartAmount('');
    setReason('requested_by_customer');
    setNote('');
    setProblem(null);
    key.current = null;
  }, [open]);

  // Step 2 asks a question: focus waits on Back, the safe answer.
  useEffect(() => {
    if (step !== 2) return;
    const timer = window.setTimeout(() => backRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [step]);

  const amount = view === undefined ? null : mode === 'full' ? view.refundable : typedAmount(partAmount);
  const wrong = view === undefined ? 'invalid' : amountProblem(amount, view);
  const noteHoldsCard = holdsCardNumber(note);
  const cannot = view === undefined || view.refusal !== null || wrong !== null || noteHoldsCard;
  const money = (value: string): string => formatMoney(value, view?.currency ?? 'EUR', locale, decimalsOf(view?.refundable ?? value));
  const subtitle = useMemo(() => {
    if (view === undefined) return null;
    return [number ?? view.label, formatMoney(view.taken, view.currency, locale), view.paidWith].filter((part): part is string => part !== null && part !== '').join(' · ');
  }, [view, number, locale]);

  const send = useMutation({
    mutationFn: () => requestRefund({ attemptId, amount: amount!, reason, note: note.trim() === '' ? null : note.trim(), key: key.current! }),
    onSuccess: ({ refund }) => {
      onRequested(refund);
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      // Refused before anything moved (what is left changed, the key was for another amount): back to step 1, a new key.
      key.current = null;
      setStep(1);
      setProblem(t('payments:refund.failed', 'The refund was not asked: {message}', { message: error instanceof ApiError ? error.message : String(error) }));
      void preview.refetch();
    },
  });

  function toConfirm(event: FormEvent): void {
    event.preventDefault();
    if (cannot) return;
    setProblem(null);
    key.current = newPaymentKey();
    setStep(2);
  }

  const stepWord = (text: string): ReactNode => <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">{text}</span>;
  const testBadge = view?.test === true ? (
    <Badge tone="warn" className="ms-2 align-middle">
      {t('payments:panel.test', 'Test')}
    </Badge>
  ) : null;

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} width={460}>
      {step === 1 ? (
        <form onSubmit={toConfirm} noValidate className="flex min-h-0 flex-col">
          <FormDialogHeader
            title={
              <>
                {stepWord(t('payments:refund.step1', 'Step 1 of 2'))}
                {t('payments:refund.title', 'Refund a payment')}
                {testBadge}
              </>
            }
            subtitle={
              subtitle === null ? undefined : (
                <bdi dir="ltr" className="font-mono">
                  {subtitle}
                </bdi>
              )
            }
            closeLabel={t('payments:refund.close', 'Close')}
          />
          <FormDialogBody className="flex flex-col gap-4">
            {problem === null ? null : <Alert tone="danger" title={problem} />}
            {view === undefined ? (
              preview.isError ? (
                <Alert tone="danger" title={t('payments:refund.failed', 'The refund was not asked: {message}', { message: preview.error instanceof ApiError ? preview.error.message : String(preview.error) })} />
              ) : (
                <div className="flex flex-col gap-3" aria-busy="true">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-2/3" />
                </div>
              )
            ) : view.refusal !== null ? (
              <Alert tone="info" title={refusalWords(view.refusal.code, view.provider, view.refusal.message)} />
            ) : (
              <>
                <FormField
                  label={t('payments:refund.amount', 'Amount')}
                  helper={
                    <span className={wrong === 'over' ? 'font-semibold text-danger' : undefined}>
                      {t('payments:refund.upTo', 'Up to {amount} can be refunded', { amount: money(view.refundable) })}
                    </span>
                  }
                  error={mode === 'part' && partAmount.trim() !== '' && wrong === 'invalid' ? t('payments:record.amountErr', 'Enter an amount above zero.') : undefined}
                  tag={
                    <SegmentedControl
                      aria-label={t('payments:refund.amount', 'Amount')}
                      value={mode}
                      onValueChange={(value) => setMode(value === 'part' ? 'part' : 'full')}
                      options={[
                        { value: 'full', label: t('payments:refund.full', 'Full') },
                        { value: 'part', label: t('payments:refund.part', 'Part') },
                      ]}
                    />
                  }
                >
                  <InputGroup
                    dir="ltr"
                    mono
                    inputMode="decimal"
                    autoComplete="off"
                    prefix={view.currency}
                    readOnly={mode === 'full'}
                    aria-invalid={wrong === 'over' ? true : undefined}
                    value={mode === 'full' ? view.refundable : partAmount}
                    onChange={(event) => setPartAmount(event.target.value)}
                  />
                </FormField>
                <div className="flex flex-col gap-2">
                  <span id={`refund-reason-${attemptId}`} className="text-[12.5px] font-bold text-fg">
                    {t('payments:refund.reason', 'Reason')}
                  </span>
                  <ChoiceChips
                    aria-labelledby={`refund-reason-${attemptId}`}
                    value={reason}
                    onValueChange={(value) => setReason((REFUND_REASONS as readonly string[]).includes(value ?? '') ? (value as RefundReason) : 'requested_by_customer')}
                    options={REFUND_REASONS.map((one) => ({ value: one, label: REASON_WORDS[one]() }))}
                  />
                  <Textarea
                    rows={2}
                    maxLength={500}
                    aria-label={t('payments:refund.note', 'Note')}
                    placeholder={t('payments:refund.notePh', 'Optional')}
                    aria-invalid={noteHoldsCard ? true : undefined}
                    aria-describedby={noteHoldsCard ? `refund-note-error-${attemptId}` : undefined}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  {noteHoldsCard ? (
                    <p id={`refund-note-error-${attemptId}`} className="text-[11.5px] font-medium leading-4 text-danger">
                      {t('payments:record.cardNumber', 'This looks like a full card number. Never write card numbers here.')}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-start gap-2.5 rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
                  <CornerDownLeft className="mt-0.5 size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
                  <span className="text-[12.5px] leading-normal text-fg-muted">
                    {view.paidWith === null
                      ? t('payments:refund.goesBackPlain', 'Goes back the way it was paid. Usually 5–10 days.')
                      : t('payments:refund.goesBack', 'Goes back to {paidWith}. Usually 5–10 days.', { paidWith: view.paidWith })}
                  </span>
                </div>
              </>
            )}
          </FormDialogBody>
          <FormDialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('payments:refund.cancel', 'Cancel')}
            </Button>
            {view !== undefined && view.refusal !== null ? null : (
              <Button type="submit" aria-disabled={cannot}>
                {t('payments:refund.continue', 'Continue')}
              </Button>
            )}
          </FormDialogFooter>
        </form>
      ) : (
        <div className="flex min-h-0 flex-col">
          <FormDialogHeader
            icon={<RotateCcw aria-hidden="true" />}
            tone="danger"
            hideClose
            className="border-b-0"
            title={
              <>
                {stepWord(t('payments:refund.step2', 'Step 2 of 2'))}
                {view?.paidWith == null
                  ? t('payments:refund.questionPlain', 'Refund {amount}?', { amount: money(amount ?? '0') })
                  : t('payments:refund.question', 'Refund {amount} to {paidWith}?', { amount: money(amount ?? '0'), paidWith: view.paidWith })}
                {testBadge}
              </>
            }
            subtitle={t('payments:refund.cantUndo', "This can't be undone.")}
            closeLabel={t('payments:refund.close', 'Close')}
          />
          <FormDialogFooter>
            <Button ref={backRef} type="button" variant="secondary" disabled={send.isPending} onClick={() => setStep(1)}>
              {t('payments:refund.back', 'Back')}
            </Button>
            <Button type="button" variant="destructive" iconLeft={<RotateCcw aria-hidden="true" />} loading={send.isPending} onClick={() => send.mutate()}>
              {t('payments:refund.submit', 'Refund')}
            </Button>
          </FormDialogFooter>
        </div>
      )}
    </FormDialog>
  );
}
