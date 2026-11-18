// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two cards in a chat's log.
 *
 * THE HAND-OVER CARD, while a person is wanted: "A person will answer here."
 * with an optional name and e-mail when the business can send e-mail (both
 * optional, at least one asked for), "Thanks, …" once saved, with "Change";
 * when it cannot, only "Keep this page open to see the reply."
 *
 * THE OUTSIDE-HOURS CARD, when nobody is there and no chat is going on: the
 * question, an optional name and the e-mail to reply to, sent with the human
 * check ("Checking you're a person…" under Send while it runs); when the
 * business cannot send e-mail, only when to write again.
 *
 * Every check is the door's too; the card only says it first.
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '@adminium/i18n/react';
import { Check, CircleAlert, LoaderCircle, TriangleAlert } from 'lucide-react';

import { Said } from './say.js';
import type { DetailsResult, QuestionResult } from './session.js';

/** The door's own check of an address, as a visitor can be told it before Send. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }): ReactNode {
  return (
    <div className="xc-field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

export function HandCard(props: {
  /** `info`: the business cannot send e-mail, so nothing is asked. */
  mode: 'form' | 'info';
  /** The sentence over the fields; once the quiet "still waiting" line shows, it says it instead. */
  showText: boolean;
  name: string;
  email: string;
  saved: boolean;
  newTab: string;
  /** What the door's "too many" asks the visitor to wait, in words. */
  waitWords: (retryAfter: number | null) => string;
  onSave: (name: string, email: string) => Promise<DetailsResult>;
  onChange: () => void;
}): ReactNode {
  const t = useT();
  const id = useId();
  const [name, setName] = useState(props.name);
  const [email, setEmail] = useState(props.email);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (props.mode === 'info') {
    return (
      <div className="xc-card">
        <p className="xc-card-text">
          <Said text={t('xChat:hand.info', 'A person will answer here. Keep this page open to see the reply.')} newTab={props.newTab} />
        </p>
      </div>
    );
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const n = name.trim();
    const e = email.trim();
    if (n === '' && e === '') return setError(t('xChat:card.needOne', 'Add your name or e-mail first.'));
    if (e !== '' && !looksLikeEmail(e)) return setError(t('xChat:card.badEmail', 'Enter an e-mail like name@company.example'));
    setBusy(true);
    const result = await props.onSave(n, e);
    setBusy(false);
    if (result === 'saved') setError('');
    else if (typeof result === 'object' && 'tooMany' in result) setError(props.waitWords(result.tooMany));
    else if (typeof result === 'object') setError(result.field === 'email' ? t('xChat:card.badEmail', 'Enter an e-mail like name@company.example') : t('xChat:card.badName', 'Write your name without a web address.'));
    else setError(t('xChat:status.notSent', 'Not sent.'));
  }

  const saved = props.saved;
  const savedName = props.name.trim();
  const savedEmail = props.email.trim();
  const done = `${savedName === '' ? t('xChat:done.thanks', 'Thanks.') : t('xChat:done.named', 'Thanks, {name}.', { name: savedName })} ${
    savedEmail === '' ? t('xChat:done.stay', 'Keep this page open to see the reply.') : t('xChat:done.leave', 'If you leave, we’ll reply to {email}.', { email: savedEmail })
  }`;
  const helper = `${id}-helper`;
  const errorId = `${id}-error`;
  return (
    <form className="xc-card" onSubmit={(event) => void save(event)} noValidate>
      {props.showText ? (
        <p className="xc-card-text">
          <Said text={t('xChat:hand.text', 'A person will answer here.')} newTab={props.newTab} />
        </p>
      ) : null}
      {saved ? (
        <>
          <div className="xc-done">
            <span className="xc-done-icon">
              <Check size={15} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="xc-done-text">
              <Said text={done} newTab={props.newTab} />
            </span>
          </div>
          <button
            type="button"
            className="xc-change"
            onClick={() => {
              setName(props.name);
              setEmail(props.email);
              props.onChange();
            }}
          >
            {t('xChat:card.change', 'Change')}
          </button>
        </>
      ) : (
        <>
          <Field id={`${id}-name`} label={t('xChat:card.name', 'Your name (optional)')}>
            <input
              id={`${id}-name`}
              autoComplete="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
            />
          </Field>
          <Field id={`${id}-email`} label={t('xChat:card.emailOptional', 'Your e-mail (optional)')}>
            <input
              id={`${id}-email`}
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="name@company.example"
              value={email}
              aria-invalid={error === '' ? 'false' : 'true'}
              aria-describedby={error === '' ? helper : `${helper} ${errorId}`}
              onChange={(event) => {
                setEmail(event.target.value);
                setError('');
              }}
            />
            <p id={helper} className="xc-helper">
              {t('xChat:card.helper', 'So we can reply if you close this page.')}
            </p>
          </Field>
          {error === '' ? null : (
            <p id={errorId} role="alert" className="xc-error">
              {error}
            </p>
          )}
          <button type="submit" className="xc-primary" disabled={busy}>
            {t('xChat:card.save', 'Save')}
          </button>
        </>
      )}
    </form>
  );
}

/** The away sentence's words, and what "after …" says once a question is sent. */
export interface AwayWords {
  text: string;
  sent: (email: string) => string;
}

export function AwayCard(props: {
  mode: 'form' | 'info';
  words: AwayWords;
  /** The address the reply goes to, once the question is sent (kept while the window is closed and opened again). */
  sentTo: string | null;
  newTab: string;
  /** What the door's "too many" asks the visitor to wait, in words. */
  waitWords: (retryAfter: number | null) => string;
  onSend: (sent: { question: string; name: string; email: string }) => Promise<QuestionResult>;
  /** The hours opened meanwhile: the window starts over as an ordinary chat. */
  onInHours: () => void;
}): ReactNode {
  const t = useT();
  const id = useId();
  const [question, setQuestion] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'checking' | 'fail' | 'notSent' | null>(null);
  const sentTo = props.sentTo;

  const text = (
    <p className="xc-card-text">
      <Said text={props.words.text} newTab={props.newTab} />
    </p>
  );
  if (props.mode === 'info') return <div className="xc-card">{text}</div>;

  async function send(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    if (status === 'checking') return;
    const q = question.trim();
    const e = email.trim();
    if (q === '') return setError(t('xChat:card.needQuestion', 'Write your question first.'));
    if (e === '') return setError(t('xChat:card.needEmail', 'Enter your e-mail so we can reply.'));
    if (!looksLikeEmail(e)) return setError(t('xChat:card.badEmail', 'Enter an e-mail like name@company.example'));
    setError('');
    setStatus('checking');
    const result = await props.onSend({ question: q, name: name.trim(), email: e });
    if (result === 'sent') setStatus(null);
    else if (result === 'proof') setStatus('fail');
    else if (result === 'offline') setStatus('notSent');
    else if (result === 'in-hours') {
      setStatus(null);
      props.onInHours();
    } else if (typeof result === 'object' && 'tooMany' in result) {
      setStatus(null);
      setError(props.waitWords(result.tooMany));
    } else if (typeof result === 'object') {
      setStatus(null);
      setError(
        result.field === 'question'
          ? t('xChat:card.needQuestion', 'Write your question first.')
          : result.field === 'email'
            ? t('xChat:card.badEmail', 'Enter an e-mail like name@company.example')
            : t('xChat:card.badName', 'Write your name without a web address.'),
      );
    }
  }

  if (sentTo !== null) {
    return (
      <div className="xc-card">
        {text}
        <div className="xc-done">
          <span className="xc-done-icon">
            <Check size={15} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="xc-done-text">
            <Said text={props.words.sent(sentTo)} newTab={props.newTab} />
          </span>
        </div>
      </div>
    );
  }

  const errorId = `${id}-error`;
  return (
    <form className="xc-card" onSubmit={(event) => void send(event)} noValidate>
      {text}
      <Field id={`${id}-q`} label={t('xChat:card.question', 'Your question')}>
        <textarea
          id={`${id}-q`}
          rows={3}
          dir="auto"
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
            setError('');
          }}
        />
      </Field>
      <Field id={`${id}-name`} label={t('xChat:card.name', 'Your name (optional)')}>
        <input
          id={`${id}-name`}
          autoComplete="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
        />
      </Field>
      <Field id={`${id}-email`} label={t('xChat:card.email', 'Your e-mail')}>
        <input
          id={`${id}-email`}
          type="email"
          dir="ltr"
          autoComplete="email"
          placeholder="name@company.example"
          value={email}
          aria-invalid={error === '' ? 'false' : 'true'}
          aria-describedby={error === '' ? undefined : errorId}
          onChange={(event) => {
            setEmail(event.target.value);
            setError('');
          }}
        />
      </Field>
      {error === '' ? null : (
        <p id={errorId} role="alert" className="xc-error">
          {error}
        </p>
      )}
      <button type="submit" className="xc-primary" disabled={status === 'checking'}>
        {t('xChat:card.send', 'Send')}
      </button>
      {status === 'checking' ? (
        <span role="status" className="xc-status xc-card-status">
          <LoaderCircle className="x-spin" size={13} strokeWidth={2} aria-hidden="true" />
          <span>{t('xChat:status.checking', 'Checking you’re a person…')}</span>
        </span>
      ) : status === 'fail' || status === 'notSent' ? (
        <span role="alert" className="xc-status xc-card-status" data-bad="">
          {status === 'fail' ? <CircleAlert size={14} strokeWidth={2} aria-hidden="true" /> : <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />}
          <span className="xc-status-text">{status === 'fail' ? t('xChat:status.failed', 'We couldn’t check that you’re a person.') : t('xChat:status.notSent', 'Not sent.')}</span>
          <button type="button" className="xc-retry" onClick={() => void send()}>
            {t('xChat:status.retry', 'Try again')}
          </button>
        </span>
      ) : null}
    </form>
  );
}
