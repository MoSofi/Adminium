// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Record a payment taken by hand: a bank transfer, cash, a card on the shop's
 * own terminal, a cheque.
 *
 * The amount starts at what is due and may not pass it. "Card on our own
 * terminal" asks for the slip's approval code and the card's last four
 * digits, never more: every text here is refused when it holds a full card
 * number (the server refuses it again). The dialog makes one key when it
 * opens and sends it with every try, so a retry after a lost answer records
 * the payment once.
 *
 * Focus starts on the amount; a refusal sits under its own field
 * (`aria-invalid`, described by the error), and the button that sends stays
 * `aria-disabled` until a way is chosen and the card's fields pass.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, DateInput, FormDialog, FormDialogBody, FormDialogFooter, FormDialogHeader, FormField, Input, InputGroup, Select, Textarea } from '@adminium/ui';
import { useMutation } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';

import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { HAND_WAYS, recordPayment, type HandWay, type PanelRecord, type PaymentPanelView } from './paymentPanelApi.js';
import { approvalCodeOk, formatMoney, holdsCardNumber, lastFourOk, moreThan, newPaymentKey, today, typedAmount } from './paymentText.js';
import { readerLocale } from './paymentsMessages.js';

const WAY_WORDS: Record<HandWay, () => string> = {
  'bank-transfer': () => t('payments:record.ways.bank-transfer', 'Bank transfer'),
  cash: () => t('payments:record.ways.cash', 'Cash'),
  card: () => t('payments:record.ways.card', 'Card on our own terminal'),
  cheque: () => t('payments:record.ways.cheque', 'Cheque'),
  other: () => t('payments:record.ways.other', 'Other'),
};

type Field = 'amount' | 'way' | 'paidOn' | 'note' | 'approvalCode' | 'last4';

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: PanelRecord;
  view: PaymentPanelView;
  /** Called with the amount once the server recorded it. */
  onRecorded: (amount: string) => void;
}

export function RecordPaymentDialog({ open, onOpenChange, record, view, onRecorded }: RecordPaymentDialogProps): ReactNode {
  const locale = readerLocale();
  const [amount, setAmount] = useState(view.due);
  const [way, setWay] = useState<HandWay | ''>('');
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState('');
  const [approval, setApproval] = useState('');
  const [last4, setLast4] = useState('');
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverError, setServerError] = useState<{ field: Field | null; message: string } | null>(null);
  const key = useRef(newPaymentKey());
  const amountRef = useRef<HTMLInputElement | null>(null);

  // A fresh dialog each time it opens: the balance as it is now, and a new key.
  useEffect(() => {
    if (!open) return;
    setAmount(view.due);
    setWay('');
    setPaidOn(today());
    setNote('');
    setApproval('');
    setLast4('');
    setTouched({});
    setServerError(null);
    key.current = newPaymentKey();
    // The amount takes focus once the dialog has placed its own (on its first control, the close button).
    const timer = window.setTimeout(() => amountRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, view.due]);

  const due = formatMoney(view.due, view.currency, locale);
  const terminal = way === 'card';

  const errors = useMemo(() => {
    const out: Partial<Record<Field, string>> = {};
    const typed = typedAmount(amount);
    if (typed === null || !moreThan(typed, '0')) out.amount = t('payments:record.amountErr', 'Enter an amount above zero.');
    else if (moreThan(typed, view.due)) out.amount = t('payments:record.overDue', 'That is more than the {amount} that is due.', { amount: due });
    if (paidOn === '' || paidOn > today(new Date(Date.now() + 36 * 3600_000))) out.paidOn = t('payments:record.dateErr', 'The day it was paid cannot be in the future.');
    if (holdsCardNumber(note)) out.note = t('payments:record.cardNumber', 'This looks like a full card number. Never write card numbers here.');
    if (terminal) {
      if (holdsCardNumber(approval)) out.approvalCode = t('payments:record.cardNumber', 'This looks like a full card number. Never write card numbers here.');
      else if (!approvalCodeOk(approval)) out.approvalCode = t('payments:record.approvalErr', 'Use letters and digits only, up to 12.');
      if (!lastFourOk(last4)) out.last4 = t('payments:record.last4Err', 'Enter the last four digits only.');
    }
    return out;
  }, [amount, view.due, due, paidOn, note, terminal, approval, last4]);

  // A field says what is wrong once the person has left it (or tried to send);
  // the server's own refusal shows on the field it names.
  const shown = (field: Field): string | undefined => {
    if (serverError?.field === field) return serverError.message;
    return touched[field] === true ? errors[field] : undefined;
  };
  const cannot = way === '' || Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: () =>
      recordPayment({
        ...record,
        amount: typedAmount(amount) ?? amount,
        way: way as HandWay,
        paidOn,
        note: note.trim() === '' ? null : note.trim(),
        approvalCode: terminal ? approval.trim() : null,
        last4: terminal ? last4.trim() : null,
        key: key.current,
      }),
    onSuccess: () => {
      onRecorded(typedAmount(amount) ?? amount);
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        const field = (error.details as { field?: string } | undefined)?.field;
        const known = field === 'amount' || field === 'way' || field === 'paidOn' || field === 'note' || field === 'approvalCode' || field === 'last4' ? field : null;
        setServerError({ field: known, message: known === null ? t('payments:record.failed', 'The payment was not recorded: {message}', { message: error.message }) : error.message });
        return;
      }
      setServerError({ field: null, message: t('payments:record.failed', 'The payment was not recorded: {message}', { message: String(error) }) });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    setTouched({ amount: true, way: true, paidOn: true, note: true, approvalCode: true, last4: true });
    if (cannot || save.isPending) return;
    setServerError(null);
    save.mutate();
  }

  const leave = (field: Field) => () => setTouched((now) => ({ ...now, [field]: true }));
  const edit = (field: Field) => {
    if (serverError?.field === field) setServerError(null);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} width={460}>
      <form
        onSubmit={submit}
        noValidate
        className="flex min-h-0 flex-col"
      >
        <FormDialogHeader
          title={t('payments:record.title', 'Record a payment')}
          subtitle={<bdi className="font-mono">{view.label}</bdi>}
          closeLabel={t('payments:record.close', 'Close')}
        />
        <FormDialogBody className="flex flex-col gap-4">
          {view.waiting.length > 0 ? (
            <div role="alert" className="flex items-start gap-2.5 rounded-[10px] bg-warn-soft px-3 py-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
              <span className="text-[12.5px] font-semibold leading-normal text-fg">
                {t('payments:record.pendingWarn', 'An online payment is waiting for the bank. Recording another one may take the money twice.')}
              </span>
            </div>
          ) : null}
          {serverError !== null && serverError.field === null ? <Alert tone="danger" title={serverError.message} /> : null}
          <FormField label={t('payments:record.amount', 'Amount')} error={shown('amount')}>
            <InputGroup
              ref={amountRef}
              dir="ltr"
              mono
              inputMode="decimal"
              autoComplete="off"
              prefix={view.currency}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                edit('amount');
              }}
              onBlur={leave('amount')}
            />
          </FormField>
          <FormField label={t('payments:record.way', 'Way to pay')} error={shown('way')}>
            <Select
              value={way}
              onChange={(event) => {
                setWay(event.target.value as HandWay | '');
                edit('way');
              }}
              onBlur={leave('way')}
            >
              <option value="" disabled>
                {t('payments:record.wayPh', 'Choose a way to pay')}
              </option>
              {HAND_WAYS.map((one) => (
                <option key={one} value={one}>
                  {WAY_WORDS[one]()}
                </option>
              ))}
            </Select>
          </FormField>
          {terminal ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
              <FormField label={t('payments:record.approval', 'Approval code')} helper={t('payments:record.approvalHelp', 'Up to 12 letters and digits.')} error={shown('approvalCode')}>
                <Input
                  dir="ltr"
                  mono
                  maxLength={12}
                  autoComplete="off"
                  value={approval}
                  onChange={(event) => {
                    setApproval(event.target.value);
                    edit('approvalCode');
                  }}
                  onBlur={leave('approvalCode')}
                />
              </FormField>
              <FormField label={t('payments:record.last4', 'Last four digits')} error={shown('last4')}>
                <Input
                  dir="ltr"
                  mono
                  inputMode="numeric"
                  autoComplete="off"
                  value={last4}
                  onChange={(event) => {
                    setLast4(event.target.value);
                    edit('last4');
                  }}
                  onBlur={leave('last4')}
                />
              </FormField>
            </div>
          ) : null}
          <FormField label={t('payments:record.date', 'Date')} error={shown('paidOn')}>
            <DateInput
              type="date"
              value={paidOn}
              max={today()}
              onChange={(event) => {
                setPaidOn(event.target.value);
                edit('paidOn');
              }}
              onBlur={leave('paidOn')}
            />
          </FormField>
          <FormField label={t('payments:record.note', 'Note')} error={shown('note')}>
            <Textarea
              rows={2}
              maxLength={500}
              placeholder={t('payments:record.notePh', 'Optional')}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                edit('note');
              }}
              onBlur={leave('note')}
            />
          </FormField>
        </FormDialogBody>
        <FormDialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('payments:record.cancel', 'Cancel')}
          </Button>
          <Button type="submit" aria-disabled={cannot || save.isPending} loading={save.isPending}>
            {t('payments:record.submit', 'Record payment')}
          </Button>
        </FormDialogFooter>
      </form>
    </FormDialog>
  );
}
