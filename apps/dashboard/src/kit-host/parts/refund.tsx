// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Giving back an online payment, mounted on an app's own screen: the two
 * steps the dashboard's refund takes (what and why, then the one sentence
 * that says what will happen), its words, and its toast — never an app's own
 * copy of them (C1-F6, C3-F7). Over the person's own session: the server asks
 * the refund right again, and refuses a payment whose refunds the app keeps
 * as its own rows (it says so: refund it in the app).
 *
 * The confirm mints a key for that amount: pressing Refund again after a lost
 * answer asks the same refund, never a second one.
 */
import { useMaybeT } from '@adminium/i18n/react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import type { KitMounted, RefundProps } from '../contract.js';
import { paymentsClient, PaymentRefused } from '../payments-client.js';
import { mountReact } from '../root.js';

import './files.css';

const REASONS = ['requested_by_customer', 'duplicate', 'fraudulent', 'other'] as const;

type Preview = Awaited<ReturnType<ReturnType<typeof paymentsClient>['refundPreview']>>;
type Stage = { kind: 'reading' } | { kind: 'failed'; message: string } | { kind: 'ready'; preview: Preview } | { kind: 'done'; amount: string };

/** A key of 32 characters for one confirmed refund. */
function newKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function money(amount: string, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

function Refund({ props }: { props: RefundProps }): ReactNode {
  const t = useMaybeT();
  const ids = useId();
  const latest = useRef(props);
  latest.current = props;
  const client = useMemo(() => paymentsClient(() => latest.current.csrfToken, () => latest.current.fetch), []);
  const [stage, setStage] = useState<Stage>({ kind: 'reading' });
  const [step, setStep] = useState<1 | 2>(1);
  const [part, setPart] = useState(false);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('requested_by_customer');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const key = useRef<{ key: string; amount: string } | null>(null);

  useEffect(() => {
    let live = true;
    setStage({ kind: 'reading' });
    client
      .refundPreview(props.attemptId)
      .then((preview) => live && setStage({ kind: 'ready', preview }))
      .catch((error: unknown) => live && setStage({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }));
    return () => {
      live = false;
    };
  }, [client, props.attemptId]);

  if (stage.kind === 'reading') return <p role="status" className="adm-kit-files-count">…</p>;
  if (stage.kind === 'failed') return <p role="alert" className="adm-kit-files-error">{t('payments:refund.failed', 'The refund was not asked: {message}', { message: stage.message })}</p>;
  if (stage.kind === 'done') return <p role="status" data-testid="kit-refund-done">{t('payments:panel.toast.refundRequested', 'Refund of {amount} requested.', { amount: stage.amount })}</p>;
  const { preview } = stage;
  if (preview.refusal !== null) {
    const words =
      preview.refusal.code === 'IN_APP'
        ? t('payments:refund.refusal.inApp', 'Refund this payment in its app, where its refunds are kept.')
        : preview.refusal.code === 'FULLY_REFUNDED'
          ? t('payments:panel.why.full', 'This payment is fully refunded.')
          : preview.refusal.code === 'PROCESSING'
            ? t('payments:panel.why.pending', 'This payment is still waiting for the bank.')
            : preview.refusal.code === 'NOT_TAKEN'
              ? t('payments:panel.why.notTaken', 'No money was taken for this payment.')
              : preview.refusal.message;
    return <p role="note" data-testid="kit-refund-refused">{words}</p>;
  }
  const amount = part ? typed.trim().replace(',', '.') : preview.refundable;
  const valid = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && Number(amount) <= Number(preview.refundable);
  const shown = money(amount, preview.currency, props.locale);

  const send = async (): Promise<void> => {
    if (key.current === null || key.current.amount !== amount) key.current = { key: newKey(), amount };
    setBusy(true);
    setProblem(null);
    try {
      const answer = await client.refund({ attemptId: props.attemptId, amount, reason, note: null, key: key.current.key });
      setStage({ kind: 'done', amount: shown });
      latest.current.onRefunded?.(answer.refund);
    } catch (error) {
      setProblem(error instanceof PaymentRefused ? error.message : t('payments:refund.lost', 'No answer came back. Press Refund again: it asks for the same refund, never a second one.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-kit-field" role="group" aria-labelledby={`${ids}-title`} data-part="kit-refund" data-step={step}>
      <span className="adm-kit-label" id={`${ids}-title`}>
        {t('payments:refund.title', 'Refund a payment')}
        {preview.test ? ` · ${t('payments:panel.test', 'Test')}` : ''}
      </span>
      {step === 1 ? (
        <>
          <div className="adm-kit-files-actions" role="radiogroup" aria-label={t('payments:refund.amount', 'Amount')}>
            <button type="button" role="radio" aria-checked={!part} className={`adm-kit-button${!part ? ' adm-kit-button-primary' : ''}`} onClick={() => setPart(false)}>
              {t('payments:refund.full', 'Full')}
            </button>
            <button type="button" role="radio" aria-checked={part} className={`adm-kit-button${part ? ' adm-kit-button-primary' : ''}`} onClick={() => setPart(true)} data-testid="kit-refund-part">
              {t('payments:refund.part', 'Part')}
            </button>
          </div>
          {part ? (
            <label className="adm-kit-label">
              {t('payments:refund.amount', 'Amount')}
              <input className="adm-kit-input" inputMode="decimal" value={typed} onChange={(event) => setTyped(event.target.value)} aria-invalid={typed !== '' && !valid ? true : undefined} data-testid="kit-refund-amount" />
            </label>
          ) : null}
          <p className="adm-kit-files-count">{t('payments:refund.upTo', 'Up to {amount} can be refunded', { amount: money(preview.refundable, preview.currency, props.locale) })}</p>
          <label className="adm-kit-label">
            {t('payments:refund.reason', 'Reason')}
            <select className="adm-kit-input" value={reason} onChange={(event) => setReason(event.target.value as (typeof REASONS)[number])}>
              {REASONS.map((one) => (
                <option key={one} value={one}>
                  {one === 'requested_by_customer'
                    ? t('payments:refund.reasons.requested_by_customer', 'Requested by customer')
                    : one === 'duplicate'
                      ? t('payments:refund.reasons.duplicate', 'Duplicate')
                      : one === 'fraudulent'
                        ? t('payments:refund.reasons.fraudulent', 'Fraudulent')
                        : t('payments:refund.reasons.other', 'Other')}
                </option>
              ))}
            </select>
          </label>
          <div className="adm-kit-files-actions">
            <button type="button" className="adm-kit-button adm-kit-button-primary" disabled={!valid} onClick={() => setStep(2)} data-testid="kit-refund-continue">
              {t('payments:refund.continue', 'Continue')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {preview.paidWith === null
              ? t('payments:refund.questionPlain', 'Refund {amount}?', { amount: shown })
              : t('payments:refund.question', 'Refund {amount} to {paidWith}?', { amount: shown, paidWith: preview.paidWith })}
          </p>
          <p className="adm-kit-files-count">
            {preview.paidWith === null
              ? t('payments:refund.goesBackPlain', 'Goes back the way it was paid. Usually 5–10 days.')
              : t('payments:refund.goesBack', 'Goes back to {paidWith}. Usually 5–10 days.', { paidWith: preview.paidWith })}
          </p>
          {problem === null ? null : (
            <p role="alert" className="adm-kit-files-error">
              {problem}
            </p>
          )}
          <div className="adm-kit-files-actions">
            <button type="button" className="adm-kit-button adm-kit-button-quiet" disabled={busy} onClick={() => setStep(1)}>
              {t('payments:refund.back', 'Back')}
            </button>
            <button type="button" className="adm-kit-button adm-kit-button-primary" disabled={busy} onClick={() => void send()} data-testid="kit-refund-submit">
              {t('payments:refund.submit', 'Refund')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function mountRefund(element: Element, props: RefundProps): Promise<KitMounted<RefundProps>> {
  return mountReact<RefundProps>('refund', element, props, (now) => <Refund props={now} />);
}
