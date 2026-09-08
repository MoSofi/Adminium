// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Send test email (comp 67-115, 1066-1069; Appendix A §E4; D1): recipients
 * as chips, *Quick add teammates* — the first three other active users —
 * the sample-data note, *N recipients* in the footer, then the success
 * phase: *Test sent!* with *Send another* and *Done*. The document the
 * server renders is the ON-SCREEN one (D1); the caller passes it through
 * `onSend`.
 */
import { Info, Mail, Send } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Button, ChipInput, ModalBody, ModalFooter, ModalHeader, TwoPhaseModal, useModalFlow } from '@adminium/ui';

import { t } from '../../../i18n/t.js';

export interface Teammate {
  name: string;
  email: string;
}

export interface TestSendModalProps {
  documentName: string;
  subject: string;
  /** The first variable the document uses, for the note (`{{appName}}`). */
  firstVar: string | null;
  teammates: readonly Teammate[];
  onSend: (to: string[]) => Promise<void>;
  onClose: () => void;
}

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+$/;

export function TestSendModal({ documentName, subject, firstVar, teammates, onSend, onClose }: TestSendModalProps) {
  const flow = useModalFlow<{ count: number }>();
  const [to, setTo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = to.length;

  const send = async () => {
    if (count === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(to);
      flow.toSuccess({ count });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('email:testSend.failed', 'The test could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TwoPhaseModal
      open
      size="md"
      flow={flow}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      successTitle={t('email:testSend.sentTitle', 'Test sent!')}
      successBody={(payload) =>
        t('email:testSend.sentBody', 'Your test of {name} is on its way to {count, plural, one {# recipient} other {# recipients}}.', {
          name: documentName,
          count: payload.count,
        })
      }
      doneLabel={t('email:testSend.done', 'Done')}
      successProps={{
        actions: (
          <Button
            variant="secondary"
            onClick={() => {
              setTo([]);
              flow.reset();
            }}
            data-testid="email-test-again"
          >
            {t('email:testSend.sendAnother', 'Send another')}
          </Button>
        ),
      }}
    >
      <ModalHeader
        icon={<Send />}
        title={t('email:testSend.title', 'Send test email')}
        subtitle={`${documentName} · ${subject}`}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-[15px]">
        <div className="flex flex-col gap-1.5">
          <span id="email-test-to-label" className="text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">
            {t('email:testSend.to', 'Send to')}
          </span>
          <div className="flex items-start gap-2">
            <Mail className="mt-2.5 size-[15px] shrink-0 text-fg-subtle" aria-hidden="true" />
            <ChipInput
              aria-labelledby="email-test-to-label"
              data-testid="email-test-to"
              className="flex-1"
              value={to}
              onValueChange={setTo}
              validate={(chip) => LOOKS_LIKE_EMAIL.test(chip)}
              removeLabel={(chip) => t('email:testSend.removeRecipient', 'Remove {email}', { email: chip })}
              placeholder={t('email:testSend.placeholder', 'name@company.com, …')}
            />
          </div>
        </div>
        {teammates.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle">{t('email:testSend.quickAdd', 'Quick add teammates')}</span>
            <div className="flex flex-wrap gap-1.5">
              {teammates.map((person) => (
                <button
                  key={person.email}
                  type="button"
                  data-testid="email-test-teammate"
                  disabled={to.includes(person.email)}
                  onClick={() => setTo((list) => (list.includes(person.email) ? list : [...list, person.email]))}
                  className="flex items-center gap-1.5 rounded-[20px] border border-border bg-surface py-1 pe-[11px] ps-[5px] text-[11.5px] font-semibold text-fg-muted transition-colors hover:border-border-strong disabled:opacity-50"
                >
                  <Avatar name={person.name} size="xs" />
                  {person.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-start gap-[9px] rounded-[11px] bg-accent-soft px-[13px] py-[11px]">
          <Info className="mt-px size-[15px] shrink-0 text-accent" aria-hidden="true" />
          <span className="text-[11.5px] leading-[1.5] text-fg-muted">
            {firstVar === null
              ? t('email:testSend.noteNoVars', 'Test sends go out exactly as shown.')
              : t('email:testSend.note', 'Variables like {token} are filled with sample data in test sends.', { token: `{{${firstVar}}}` })}
          </span>
        </div>
        {error === null ? null : (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <span className="me-auto text-[11.5px] text-fg-subtle" data-testid="email-test-count">
          {t('email:testSend.count', '{count, plural, one {# recipient} other {# recipients}}', { count })}
        </span>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          iconLeft={<Send />}
          disabled={count === 0}
          loading={busy}
          onClick={() => {
            void send();
          }}
          data-testid="email-test-send"
        >
          {busy ? t('email:testSend.sending', 'Sending…') : t('email:testSend.send', 'Send test')}
        </Button>
      </ModalFooter>
    </TwoPhaseModal>
  );
}
