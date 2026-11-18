// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORM ITSELF, as a stranger fills it in: drawn by a form's own page
 * (`XApp.tsx`, its title the page's `h1`) and by a landing page's Form block
 * (`pages/FormBlock.tsx`, its title an `h2` inside the page). One component,
 * so the two can never draw or check a form differently.
 *
 * What it holds: the answers as typed, the files picked (each sent as it is
 * picked), the marks after a Send. What it does: every kind of question of
 * the forms vocabulary, "show if" live, the vocabulary's own check before
 * Send (the server checks again; the page never decides), the summary over
 * Send and focus to the first question to fix, a trap field no person sees,
 * and Send solving the human check first.
 *
 * What it leaves to its host: the ending. Once the door answers, the host is
 * told (`onEnding`) and draws its own card: a form's page in place of the
 * form, a landing page inside the Form block. A host that draws too many
 * sends as an ending of its own says so (`onTooMany`); otherwise it is said
 * over Send and the answers stay.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '@adminium/i18n/react';
import { EyeOff, LoaderCircle, Mail, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { FormDefinition, FormQuestion, FormQuestionOf, FormTickPurpose } from '@adminium/add-on-contracts/forms';

import { answerValues, checkBeforeSend, formOf, hiddenQuery, shownQuestions, WHOLE_ANSWER, type Held } from './answers.js';
import { fetchChallenge, postAnswer, type XBusiness, type XForm, type XInvitation } from './api.js';
import type { FileRow } from './Files.js';
import { controlId, Question, textOf } from './Questions.js';
import type { refusalWords as RefusalWords } from './refusals.js';

/** What the page shows instead of the form, once the door has answered. */
export type Ending =
  | { kind: 'sent'; name: string | null; confirm: FormTickPurpose | null }
  | { kind: 'closed' }
  | { kind: 'unavailable' }
  | { kind: 'already' }
  | { kind: 'dead' }
  | { kind: 'offline' };

export function Icon({ of: Of, size = 18 }: { of: LucideIcon | 'spinner'; size?: number }): ReactNode {
  if (Of === 'spinner') return <LoaderCircle className="x-icon x-spin" size={size} strokeWidth={2} aria-hidden="true" />;
  return <Of className="x-icon" size={size} strokeWidth={2} aria-hidden="true" />;
}

export function MailLink({ email, icon = false }: { email: string; icon?: boolean }): ReactNode {
  return (
    <a href={`mailto:${email}`} className={icon ? 'x-contact' : undefined}>
      {icon ? <Icon of={Mail} size={16} /> : null}
      <bdi dir="ltr">{email}</bdi>
    </a>
  );
}

/** The first word of a typed name, for "Thanks, {name}.". */
function firstName(value: Held): string | null {
  if (typeof value !== 'string') return null;
  const first = value.trim().split(/\s+/)[0] ?? '';
  return first === '' ? null : [...first].slice(0, 40).join('');
}

/** A wait in seconds, said as the page's language says "in an hour". */
export function waitWords(seconds: number | null, tag: string, day = false): string {
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  // A day's cap opens again tomorrow, whatever the hours.
  if (day) return rtf.format(1, 'day');
  const s = seconds === null || seconds <= 0 ? 3600 : seconds;
  return s >= 3600 ? rtf.format(Math.ceil(s / 3600), 'hour') : rtf.format(Math.max(1, Math.ceil(s / 60)), 'minute');
}

type Translate = ReturnType<typeof useT>;

/** What "sent" says: thanks (by first name where there is one), the owner's own ending, and an e-mail step the visitor ticked. */
export function sentWords(t: Translate, ending: Extract<Ending, { kind: 'sent' }>, form: XForm | null): { title: string; paras: string[] } {
  const survey = form?.kind === 'survey';
  const title = survey
    ? ending.name === null
      ? t('x:ending.thanks', 'Thank you.')
      : t('x:ending.surveyThanksName', 'Thank you, {name}.', { name: ending.name })
    : ending.name === null
      ? t('x:ending.thanks', 'Thank you.')
      : t('x:ending.thanksName', 'Thanks, {name}.', { name: ending.name });
  const definition = form?.definition;
  const own = definition?.ending.kind === 'words' ? textOf(definition.ending.words, form!.language) : '';
  const paras = [...(survey ? [t('x:ending.surveyHelps', 'Your answers help us.')] : []), ...(own === '' ? [] : [own])];
  if (ending.confirm === 'newsletter') paras.push(t('x:ending.confirmNewsletter', 'One more step for the newsletter: check your e-mail and press Confirm.'));
  if (ending.confirm === 'surveys') paras.push(t('x:ending.confirmSurveys', 'One more step for the surveys: check your e-mail and press Confirm.'));
  return { title, paras };
}

export interface FormBodyProps {
  /** The form's slug at the forms door, and a named survey's token (every call carries it). */
  slug: string;
  token: string | null;
  /** The page's own address, for the form's hidden values; null when it has none to give. */
  query: URLSearchParams | null;
  /** The builder's look at a draft: drawn whole, and nothing is sent from it. */
  preview: boolean;
  /** In a website's frame: no cookie goes, and the answer says where it was sent from. */
  frame: boolean;
  /** The website's origin, once it said hello (a frame only). */
  parentOrigin?: (() => string | null) | undefined;
  /** A landing page's key: the answer counts as sent from that page (`?on=`). */
  on?: string | null | undefined;
  form: XForm;
  today: string;
  business: XBusiness;
  invitation?: XInvitation | undefined;
  /** The engine's language (the words the page says itself), and whether it reads right to left. */
  tag: string;
  rtl: boolean;
  /** The form's title: the page's own heading on a form's page, a section's in a landing page. */
  heading: 'h1' | 'h2';
  /** Sets this form's control ids apart from another form's on the same page. */
  scope?: string | undefined;
  /** Says a change in the page's one polite region. */
  say: (words: string) => void;
  /** The door answered: the host draws the ending. */
  onEnding: (ending: Ending) => void;
  /** Too many sends, as an ending of the host's own; without it, said over Send. */
  onTooMany?: ((retryAfter: number | null, day: boolean) => void) | undefined;
  /** Every time the form is drawn (a frame's height may have changed). */
  onDrawn?: (() => void) | undefined;
}

export function FormBody(props: FormBodyProps): ReactNode {
  const t = useT();
  const { slug, token, preview, frame, form, business, invitation, tag, say } = props;
  const scope = props.scope ?? '';
  const definition: FormDefinition = form.definition;
  const vocabularyForm = useMemo(() => formOf(definition), [definition]);
  const [values, setValues] = useState<Record<string, Held>>({});
  // Each file question's rows, kept in a ref as well: a Send waits for the files on their way, then reads them.
  const [fileRows, setFileRows] = useState<Record<string, FileRow[]>>({});
  const rowsRef = useRef<Record<string, FileRow[]>>({});
  const sendingFiles = useRef(new Set<Promise<void>>());
  const rowSeq = useRef(0);
  const [trap, setTrap] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const [tooMany, setTooMany] = useState<number | null | undefined>(undefined);
  const [tooManyDay, setTooManyDay] = useState(false);
  const moveFocus = useRef<string | null>(null);

  useLayoutEffect(() => {
    props.onDrawn?.();
  });

  useEffect(() => {
    const target = moveFocus.current;
    if (target === null) return;
    moveFocus.current = null;
    document.getElementById(target)?.focus();
  });

  // ── Words for a refusal: loaded at the first Send, off the page's first load (`refusals.ts`) ─
  const words = useRef<typeof RefusalWords | null>(null);
  const [, setWordsReady] = useState(false);
  async function loadWords(): Promise<void> {
    if (words.current !== null) return;
    words.current = (await import('./refusals.js')).refusalWords;
    setWordsReady(true);
  }
  const refusal = (question: FormQuestion | undefined, code: string): string => words.current?.(t, tag, question, code) ?? '';

  // ── Files ──────────────────────────────────────────────────────────────
  /** The values with each file question's taken files, by the ids the file door gave. */
  function withFiles(own: Record<string, Held>, rows: Record<string, FileRow[]>): Record<string, Held> {
    const out = { ...own };
    for (const [id, list] of Object.entries(rows)) {
      const ids = list.flatMap((row) => (row.state === 'taken' && row.id !== undefined ? [row.id] : []));
      out[id] = ids.length === 0 ? undefined : ids;
    }
    return out;
  }

  function updateRows(id: string, update: (rows: FileRow[]) => FileRow[]): void {
    rowsRef.current = { ...rowsRef.current, [id]: update(rowsRef.current[id] ?? []) };
    setFileRows(rowsRef.current);
  }

  /** Files picked for a question: refused at once when too large or of no kind it takes, else each sent now. */
  async function pickFiles(question: FormQuestionOf<'file'>, files: File[]): Promise<void> {
    // A preview sends nothing, a file included.
    if (preview) return;
    // Loaded with the file control itself, never in the page's first load.
    const { FILES_MAX, refusalBeforeSending, sendFile } = await import('./Files.js');
    const many = question.many === true;
    let room = many ? FILES_MAX - (rowsRef.current[question.id] ?? []).filter((row) => row.state !== 'refused').length : 1;
    const fresh: FileRow[] = [];
    const toSend: [FileRow, File][] = [];
    for (const file of many ? files : files.slice(0, 1)) {
      rowSeq.current += 1;
      const row: FileRow = { key: `f${String(rowSeq.current)}`, name: file.name, size: file.size, state: 'sending' };
      const early = refusalBeforeSending(file, question);
      if (early !== null || room <= 0) {
        fresh.push({ ...row, state: 'refused', code: early ?? 'count' });
        continue;
      }
      room -= 1;
      fresh.push(row);
      toSend.push([row, file]);
    }
    // A question that takes one file: the new pick takes the place of the old.
    updateRows(question.id, (rows) => [...(many ? rows : []), ...fresh]);
    if (toSend.length === 0) say(t('x:files.refused', '{file} was not added.', { file: fresh[0]?.name ?? '' }));
    for (const [row, file] of toSend) {
      const job = sendFile(slug, question.id, file, token).then((reply) => {
        updateRows(question.id, (rows) => rows.map((one) => (one.key !== row.key ? one : reply.state === 'taken' ? { ...one, state: 'taken', id: reply.id, size: reply.size } : { ...one, state: 'refused', code: reply.code })));
        say(reply.state === 'taken' ? t('x:files.added', '{file} added.', { file: row.name }) : t('x:files.refused', '{file} was not added.', { file: row.name }));
      });
      sendingFiles.current.add(job);
      void job.finally(() => sendingFiles.current.delete(job));
    }
  }

  function removeFile(id: string, key: string): void {
    const row = (rowsRef.current[id] ?? []).find((one) => one.key === key);
    updateRows(id, (rows) => rows.filter((one) => one.key !== key));
    if (row !== undefined) say(t('x:files.removed', '{file} removed.', { file: row.name }));
  }

  const held = useMemo(() => withFiles(values, fileRows), [values, fileRows]);

  // After a Send, a question's mark follows its files as they arrive or go.
  useEffect(() => {
    if (checked) setErrors(check(held));
  }, [fileRows]);

  // ── Sending ────────────────────────────────────────────────────────────
  const shown = shownQuestions(vocabularyForm, held);
  const query = hiddenQuery(definition, props.query);

  function check(next: Record<string, Held>): Record<string, string> {
    return checkBeforeSend(vocabularyForm, next, { language: form.language, today: props.today, query });
  }

  function change(id: string, value: Held): void {
    const next = { ...values, [id]: value };
    setValues(next);
    // After a Send, each answer's mark follows what is typed.
    if (checked) setErrors(check(withFiles(next, rowsRef.current)));
  }

  /** The first question to fix, in the order they are drawn. */
  function firstWrong(found: Record<string, string>): string | null {
    const question = shown.find((one) => found[one.id] !== undefined);
    return question === undefined ? null : controlId(question.id, scope);
  }

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (sending || preview) return;
    await loadWords();
    setChecked(true);
    setTooMany(undefined);
    // Files still on their way are waited for: the answer names the ones taken.
    if (sendingFiles.current.size > 0) {
      setSending(true);
      say(t('x:sending', 'Sending…'));
      await Promise.allSettled([...sendingFiles.current]);
      setSending(false);
    }
    const now = withFiles(values, rowsRef.current);
    const found = check(now);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      moveFocus.current = firstWrong(found);
      say(t('x:summary', 'Check the answers marked below.'));
      return;
    }
    setSending(true);
    say(t('x:sending', 'Sending…'));
    try {
      const parent = frame ? (props.parentOrigin?.() ?? null) : null;
      const answer = { language: form.language, values: answerValues(vocabularyForm, now), query, website: trap, ...(parent === null ? {} : { from: parent }), ...(token === null ? {} : { t: token }) };
      let reply: Awaited<ReturnType<typeof postAnswer>> = { state: 'proof' };
      // The human check's solver is fetched at the first Send, off the page's first load: no page needs it before.
      const { solve } = await import('../pay/proof.js');
      // One silent retry: a challenge can expire while a slow phone solves it.
      for (let round = 0; round < 2 && reply.state === 'proof'; round += 1) {
        const challenge = await fetchChallenge(slug, token);
        reply = await postAnswer(slug, answer, `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}`, { frame, ...(props.on === undefined || props.on === null ? {} : { on: props.on }) });
      }
      if (reply.state === 'proof') {
        say(t('x:proofFailed', 'The check that you are a person did not pass. Try again.'));
        setErrors({ [WHOLE_ANSWER]: 'proof' });
        return;
      }
      if (reply.state === 'refused') {
        setErrors(reply.errors);
        moveFocus.current = firstWrong(reply.errors);
        say(t('x:summary', 'Check the answers marked below.'));
        return;
      }
      if (reply.state === 'too-many') {
        if (props.onTooMany !== undefined) {
          props.onTooMany(reply.retryAfter, reply.day === true);
          return;
        }
        setTooManyDay(reply.day === true);
        setTooMany(reply.retryAfter);
        return;
      }
      if (reply.state === 'sent') {
        if (definition.ending.kind === 'page' && !frame) {
          window.location.assign(definition.ending.url);
          return;
        }
        const nameQuestion = definition.questions.find((question) => question.kind === 'short' && question.role === 'name');
        const tick = definition.questions.find((question): question is Extract<FormQuestion, { kind: 'tick' }> => question.kind === 'tick' && question.confirm && values[question.id] === true);
        // A named survey greets the person it was sent to; anything else, the name typed (never on an anonymous survey).
        const name = invitation?.firstName ?? (form.anonymous || nameQuestion === undefined ? null : firstName(values[nameQuestion.id]));
        props.onEnding({ kind: 'sent', name, confirm: tick?.purpose ?? null });
        return;
      }
      props.onEnding({ kind: reply.state });
    } catch {
      props.onEnding({ kind: 'offline' });
    } finally {
      setSending(false);
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  const sectionTitle = new Map((definition.sections ?? []).map((section) => [section.id, textOf(section.title, tag)]));
  const drawn = new Set<string>();
  const wholeError = errors[WHOLE_ANSWER];
  const anyError = Object.keys(errors).length > 0;
  const survey = form.kind === 'survey';
  const formLanguage = form.language;
  const about = invitation?.about ?? null;
  const Title = props.heading;
  const trapId = `x-website${scope === '' ? '' : `-${scope}`}`;
  const previewId = `x-preview${scope === '' ? '' : `-${scope}`}`;

  return (
    <form className="x-card x-form" noValidate onSubmit={(event) => void send(event)} lang={formLanguage}>
      <div className="x-title">
        <Title className="x-h1">{textOf(definition.title, formLanguage)}</Title>
        {/* What a named survey is about, from its invitation; otherwise the form's own intro. */}
        {about !== null ? (
          <p className="x-intro">{t('x:surveyAbout', 'About {record}.', { record: about })}</p>
        ) : definition.intro === undefined ? null : (
          <p className="x-intro">{textOf(definition.intro, formLanguage)}</p>
        )}
      </div>
      {form.anonymous ? (
        <p className="x-note">
          <Icon of={EyeOff} size={16} />
          <span>{t('x:anonymous', 'Your answers are not linked to your name.')}</span>
        </p>
      ) : null}
      {shown.map((question) => {
        const heading = question.section !== undefined && !drawn.has(question.section) ? sectionTitle.get(question.section) : undefined;
        if (question.section !== undefined) drawn.add(question.section);
        const code = errors[question.id];
        return (
          <div key={question.id} className="x-question">
            {heading === undefined ? null : <h2 className="x-section">{heading}</h2>}
            <Question
              question={question}
              value={values[question.id]}
              error={code === undefined ? null : refusal(question, code)}
              tag={formLanguage}
              rtl={props.rtl}
              today={props.today}
              scope={scope}
              onChange={(value) => change(question.id, value)}
              files={
                question.kind === 'file'
                  ? { rows: fileRows[question.id] ?? [], onPick: (files) => void pickFiles(question, files), onRemove: (key) => removeFile(question.id, key) }
                  : undefined
              }
            />
          </div>
        );
      })}
      {/* A trap for scripts that fill every field: no person sees it, and no screen reader reads it. */}
      <div className="x-trap" aria-hidden="true">
        <label htmlFor={trapId}>{t('x:honeypot', 'Leave this field empty')}</label>
        <input id={trapId} name="website" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(event) => setTrap(event.target.value)} />
      </div>
      {tooMany === undefined ? null : (
        <p className="x-alert" data-tone="warning" role="alert">
          <Icon of={TriangleAlert} size={16} />
          <span>
            {business.email === null
              ? t('x:ending.tooManyPlain', 'Too many sends from here. Please try again {when}.', { when: waitWords(tooMany, tag, tooManyDay) })
              : t('x:ending.tooMany', 'Too many sends from here. Please try again {when}, or write to {email}.', { when: waitWords(tooMany, tag, tooManyDay), email: business.email })}
          </span>
        </p>
      )}
      {anyError ? (
        <p className="x-alert" data-tone="danger">
          <Icon of={TriangleAlert} size={16} />
          <span>{wholeError === 'proof' ? t('x:proofFailed', 'The check that you are a person did not pass. Try again.') : wholeError !== undefined ? refusal(undefined, wholeError) : t('x:summary', 'Check the answers marked below.')}</span>
        </p>
      ) : null}
      <button type="submit" className="x-button" aria-disabled={sending || preview || undefined} aria-describedby={preview ? previewId : undefined}>
        {sending ? <Icon of="spinner" size={16} /> : null}
        <span>{sending ? t('x:sending', 'Sending…') : survey ? t('x:sendAnswers', 'Send answers') : t('x:send', 'Send')}</span>
      </button>
      {preview ? (
        <p className="x-note" id={previewId}>
          {t('x:preview', 'Nothing is sent from here.')}
        </p>
      ) : null}
      <p className="x-privacy">
        {business.name === '' ? null : <span>{t('x:keeps', '{business} keeps what you send to answer you.', { business: business.name })} </span>}
        {business.privacyNotice === null ? null : (
          <a href={business.privacyNotice} target="_blank" rel="noreferrer">
            {t('x:footer.privacyNotice', 'Privacy notice')}
          </a>
        )}
      </p>
    </form>
  );
}
