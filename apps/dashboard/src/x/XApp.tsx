// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page a stranger sees for a form or a survey, drawn from what the
 * server says of it (`/x/forms/api/<slug>`), in the page's language.
 *
 * THE SHELL. The business's logo (or its initial), name and the language
 * menu over the page; its name, where to write and its privacy notice under
 * it; the install's accent. Never the software's name. In a website's frame
 * (`?frame=1`) there is no header, footer or menu, and the page tells the
 * website loader its height whenever it changes (`frame.ts`).
 *
 * THE FORM. Every question kind of the forms vocabulary, "show if" live, the
 * vocabulary's own check before Send (the server checks again; the page
 * never decides), the summary over Send and focus to the first question to
 * fix, a trap field no person sees, and Send solving the human check first.
 *
 * THE ENDINGS. Sent (and the "check your e-mail" step when the visitor ticked
 * a sign-up that asks for one), closed, too many sends (the wait the server
 * gives), "not available", and a link that does not work. A state change is
 * read out in one polite region; after the visitor's own press removes the
 * control they used, focus goes to the new card's heading. Nothing moves
 * focus on load.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { switchLocale } from '@adminium/i18n/page';
import { useI18n, useT } from '@adminium/i18n/react';
import { Ban, Check, ChevronDown, CircleCheck, EyeOff, Globe, Link2Off, LoaderCircle, Mail, RotateCcw, SearchX, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { FormDefinition, FormQuestion, FormTickPurpose } from '@adminium/add-on-contracts/forms';

import { answerValues, checkBeforeSend, formOf, hiddenQuery, shownQuestions, WHOLE_ANSWER, type Held } from './answers.js';
import { fetchChallenge, fetchForm, postAnswer, type XBusiness, type XPage } from './api.js';
import { linkToParent, type FrameLink } from './frame.js';
import { solve } from '../pay/proof.js';
import { controlId, Question, textOf } from './Questions.js';
import type { XRoute } from './route.js';
import { languageOfTag, X_LANGUAGES, type XLanguage } from './words.js';

/** The accents an install may have: anything else is the default. */
const ACCENTS = new Set(['indigo', 'blue', 'teal', 'violet', 'rose', 'red', 'orange', 'black']);

type Tone = 'positive' | 'warning' | 'neutral';

/** What the page shows instead of the form. */
type Ending =
  | { kind: 'sent'; name: string | null; confirm: FormTickPurpose | null }
  | { kind: 'closed' }
  | { kind: 'unavailable' }
  | { kind: 'already' }
  | { kind: 'dead' }
  | { kind: 'offline' };

/** The page's language and direction, on the document itself. */
export function applyDirection(language: XLanguage): void {
  document.documentElement.lang = language.tag;
  document.documentElement.dir = language.dir;
}

/** The tile that stands in for a business with no logo: the first mark of its first two words. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}&]/u.test(word));
  return words
    .slice(0, 2)
    .map((word) => [...word].find((char) => /[\p{L}\p{N}&]/u.test(char)) ?? '')
    .join('');
}

function Icon({ of: Of, size = 18 }: { of: LucideIcon | 'spinner'; size?: number }): ReactNode {
  if (Of === 'spinner') return <LoaderCircle className="x-icon x-spin" size={size} strokeWidth={2} aria-hidden="true" />;
  return <Of className="x-icon" size={size} strokeWidth={2} aria-hidden="true" />;
}

function MailLink({ email, icon = false }: { email: string; icon?: boolean }): ReactNode {
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
function waitWords(seconds: number | null, tag: string): string {
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  const s = seconds === null || seconds <= 0 ? 3600 : seconds;
  return s >= 3600 ? rtf.format(Math.ceil(s / 3600), 'hour') : rtf.format(Math.max(1, Math.ceil(s / 60)), 'minute');
}

export function XApp({ route }: { route: XRoute }): ReactNode {
  const t = useT();
  const i18n = useI18n();
  const frame = route.frame;
  const [page, setPage] = useState<XPage | null>(null);
  const [language, setLanguage] = useState<XLanguage>(() => languageOfTag(document.documentElement.lang || 'en-US'));
  const [values, setValues] = useState<Record<string, Held>>({});
  const [trap, setTrap] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const [tooMany, setTooMany] = useState<number | null | undefined>(undefined);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [live, setLive] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const languageButton = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const moveFocus = useRef<string | null>(null);
  const link = useRef<FrameLink | null>(null);

  const form = page?.state === 'live' ? page.form : null;
  const definition: FormDefinition | null = form?.definition ?? null;
  const vocabularyForm = useMemo(() => (definition === null ? null : formOf(definition)), [definition]);
  const business: XBusiness = page?.business ?? { name: '', legalName: null, email: null, privacyNotice: null, hasLogo: false };
  const tag = language.tag;

  // ── Loading ────────────────────────────────────────────────────────────
  async function load(lang: string | null): Promise<void> {
    if (route.kind !== 'form') {
      setEnding({ kind: 'unavailable' });
      return;
    }
    try {
      const next = await fetchForm(route.slug, { lang, frame });
      setPage(next);
      if (next.state === 'closed') setEnding({ kind: 'closed' });
      else if (next.state === 'unavailable') setEnding({ kind: 'unavailable' });
      // A named survey's link is the survey door's: until it answers for one, the link does not work here.
      else if (route.token !== null) setEnding({ kind: 'dead' });
      else setEnding(null);
      if (ACCENTS.has(next.accent)) document.documentElement.dataset['accent'] = next.accent;
      // The engine's words follow the language the form is drawn in.
      if (next.state === 'live' && next.form.language !== tag) await chooseWords(languageOfTag(next.form.language));
    } catch {
      setEnding({ kind: 'offline' });
    }
  }

  useEffect(() => {
    void load(route.lang ?? tag);
    // A frame's height goes to the website that drew it, once it says hello.
    return () => link.current?.stop();
  }, []);

  useEffect(() => {
    if (!frame || page === null || link.current !== null) return;
    const allowed = page.state === 'live' ? (page.frameOrigins ?? []) : [];
    link.current = linkToParent(window, allowed, () => postHeight());
  }, [page]);

  function postHeight(): void {
    const root = rootRef.current;
    if (root !== null) link.current?.postHeight(root.getBoundingClientRect().height);
  }

  // Every render may change the height: an error, a question "show if" brought, an ending.
  useLayoutEffect(() => {
    if (frame) postHeight();
  });
  useEffect(() => {
    if (!frame || typeof ResizeObserver !== 'function' || rootRef.current === null) return undefined;
    const watcher = new ResizeObserver(() => postHeight());
    watcher.observe(rootRef.current);
    return () => watcher.disconnect();
  }, []);

  // The tab says the business, never the software behind it.
  useEffect(() => {
    if (business.name !== '') document.title = business.name;
  }, [business.name]);

  useEffect(() => {
    const target = moveFocus.current;
    if (target === null) return;
    moveFocus.current = null;
    if (target === 'heading') headingRef.current?.focus();
    else document.getElementById(target)?.focus();
  });

  // The menu takes focus when it opens: the ticked language, else the first.
  useEffect(() => {
    if (!menuOpen) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    (items.find((item) => item.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  }, [menuOpen]);

  async function chooseWords(next: XLanguage): Promise<void> {
    await switchLocale(i18n, next.id);
    applyDirection(next);
    setLanguage(next);
  }

  function closeMenu(): void {
    setMenuOpen(false);
    languageButton.current?.focus();
  }

  function chooseLanguage(next: XLanguage): void {
    closeMenu();
    if (next.tag === tag) return;
    void chooseWords(next).then(() => (form === null ? undefined : load(next.tag)));
  }

  // ── Words for a refusal ────────────────────────────────────────────────
  const numbers = useMemo(() => new Intl.NumberFormat(tag, { numberingSystem: 'latn', maximumFractionDigits: 6 }), [tag]);
  function refusal(question: FormQuestion | undefined, code: string): string {
    const n = (value: number | undefined): string => (value === undefined ? '' : numbers.format(value));
    switch (code) {
      case 'required':
      case 'text':
        if (question?.kind === 'short' && question.role === 'name') return t('x:error.name', 'Enter your name');
        if (question?.kind === 'short' && question.check === 'email') return t('x:error.email', 'Enter an e-mail address like name@company.com');
        return t('x:error.required', 'Answer this question.');
      case 'too-long':
        return t('x:error.tooLong', 'Keep this to {max, plural, one {# character} other {# characters}}.', { max: question !== undefined && 'maxLength' in question ? question.maxLength : 0 });
      case 'email':
        return t('x:error.email', 'Enter an e-mail address like name@company.com');
      case 'phone':
        return t('x:error.phone', 'Enter a phone number with 6 to 15 digits.');
      case 'choice':
        return t('x:error.choice', 'Pick one of the choices.');
      case 'too-few':
        return t('x:error.tooFew', 'Pick at least {min}.', { min: n(question?.kind === 'several' ? question.min : undefined) });
      case 'too-many':
        return t('x:error.tooMany', 'Pick at most {max}.', { max: n(question?.kind === 'several' ? question.max : undefined) });
      case 'date':
        return t('x:error.date', 'Enter a day.');
      case 'too-early':
        return question?.kind === 'date' && question.from === 'today' ? t('x:error.fromToday', 'Pick a day from today on') : t('x:error.fromTomorrow', 'Pick a day from tomorrow on');
      case 'number':
        return t('x:error.number', 'Enter a number.');
      case 'whole':
        return t('x:error.whole', 'Enter a whole number.');
      case 'too-small':
        return t('x:error.tooSmall', 'Enter {min} or more.', { min: n(question?.kind === 'number' ? question.min : undefined) });
      case 'too-large':
        return t('x:error.tooLarge', 'Enter {max} or less.', { max: n(question?.kind === 'number' ? question.max : undefined) });
      case 'score':
        return t('x:error.score', 'Pick a score from 0 to 10.');
      case 'stars':
        return t('x:error.stars', 'Pick from 1 to 5 stars.');
      case 'file':
        return t('x:error.file', 'This file can’t be taken.');
      case 'tick':
        return t('x:error.tick', 'Tick the box, or leave it empty.');
      default:
        return t('x:error.answer', 'Something in the answers was not taken. Check them and send again.');
    }
  }

  // ── Sending ────────────────────────────────────────────────────────────
  const shown = vocabularyForm === null ? [] : shownQuestions(vocabularyForm, values);
  const query = definition === null ? {} : hiddenQuery(definition, route.kind === 'form' ? route.query : null);

  function check(next: Record<string, Held>): Record<string, string> {
    if (vocabularyForm === null || page?.state !== 'live') return {};
    return checkBeforeSend(vocabularyForm, next, { language: form!.language, today: page.today, query });
  }

  function change(id: string, value: Held): void {
    const next = { ...values, [id]: value };
    setValues(next);
    // After a Send, each answer's mark follows what is typed.
    if (checked) setErrors(check(next));
  }

  /** The first question to fix, in the order they are drawn. */
  function firstWrong(found: Record<string, string>): string | null {
    const question = shown.find((one) => found[one.id] !== undefined);
    return question === undefined ? null : controlId(question.id);
  }

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (sending || route.kind !== 'form' || vocabularyForm === null || form === null || page?.state !== 'live') return;
    setChecked(true);
    setTooMany(undefined);
    const found = check(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      moveFocus.current = firstWrong(found);
      setLive(t('x:summary', 'Check the answers marked below.'));
      return;
    }
    setSending(true);
    setLive(t('x:sending', 'Sending…'));
    try {
      const answer = { language: form.language, values: answerValues(vocabularyForm, values), query, website: trap };
      let reply: Awaited<ReturnType<typeof postAnswer>> = { state: 'proof' };
      // One silent retry: a challenge can expire while a slow phone solves it.
      for (let round = 0; round < 2 && reply.state === 'proof'; round += 1) {
        const challenge = await fetchChallenge(route.slug);
        reply = await postAnswer(route.slug, answer, `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}`);
      }
      if (reply.state === 'proof') {
        setLive(t('x:proofFailed', 'The check that you are a person did not pass. Try again.'));
        setErrors({ [WHOLE_ANSWER]: 'proof' });
        return;
      }
      if (reply.state === 'refused') {
        setErrors(reply.errors);
        moveFocus.current = firstWrong(reply.errors);
        setLive(t('x:summary', 'Check the answers marked below.'));
        return;
      }
      if (reply.state === 'too-many') {
        setTooMany(reply.retryAfter);
        return;
      }
      if (reply.state === 'sent') {
        if (definition!.ending.kind === 'page' && !frame) {
          window.location.assign(definition!.ending.url);
          return;
        }
        const nameQuestion = definition!.questions.find((question) => question.kind === 'short' && question.role === 'name');
        const tick = definition!.questions.find((question): question is Extract<FormQuestion, { kind: 'tick' }> => question.kind === 'tick' && question.confirm && values[question.id] === true);
        moveFocus.current = 'heading';
        setEnding({ kind: 'sent', name: form.anonymous || nameQuestion === undefined ? null : firstName(values[nameQuestion.id]), confirm: tick?.purpose ?? null });
        return;
      }
      moveFocus.current = 'heading';
      setEnding({ kind: reply.state });
    } catch {
      moveFocus.current = 'heading';
      setEnding({ kind: 'offline' });
    } finally {
      setSending(false);
    }
  }

  // ── What an ending says ────────────────────────────────────────────────
  function endingCard(current: Ending): { tone: Tone; icon: LucideIcon; title: string; paras: ReactNode[]; contact: boolean; action?: ReactNode } {
    const write = business.email === null ? [] : [t('x:ending.write', 'Write to {email}.', { email: business.email })];
    switch (current.kind) {
      case 'sent': {
        const survey = form?.kind === 'survey';
        const title = survey
          ? current.name === null
            ? t('x:ending.thanks', 'Thank you.')
            : t('x:ending.surveyThanksName', 'Thank you, {name}.', { name: current.name })
          : current.name === null
            ? t('x:ending.thanks', 'Thank you.')
            : t('x:ending.thanksName', 'Thanks, {name}.', { name: current.name });
        const own = definition?.ending.kind === 'words' ? textOf(definition.ending.words, form!.language) : '';
        const paras: ReactNode[] = [...(survey ? [t('x:ending.surveyHelps', 'Your answers help us.')] : []), ...(own === '' ? [] : [own])];
        if (current.confirm === 'newsletter') paras.push(t('x:ending.confirmNewsletter', 'One more step for the newsletter: check your e-mail and press Confirm.'));
        if (current.confirm === 'surveys') paras.push(t('x:ending.confirmSurveys', 'One more step for the surveys: check your e-mail and press Confirm.'));
        const onwards =
          definition?.ending.kind === 'page' ? (
            <a className="x-button-secondary" href={definition.ending.url} target="_top" rel="noreferrer">
              {t('x:ending.continue', 'Continue')}
            </a>
          ) : undefined;
        return { tone: 'positive', icon: CircleCheck, title, paras, contact: false, ...(onwards === undefined ? {} : { action: onwards }) };
      }
      case 'closed':
        return { tone: 'neutral', icon: Ban, title: t('x:ending.closed', 'This form is closed.'), paras: [], contact: true };
      case 'already':
        return { tone: 'neutral', icon: CircleCheck, title: t('x:ending.already', 'You’ve already answered this survey. Thank you.'), paras: [], contact: false };
      case 'dead':
        return { tone: 'neutral', icon: Link2Off, title: t('x:ending.dead', 'This link doesn’t work.'), paras: write, contact: false };
      case 'offline':
        return {
          tone: 'warning',
          icon: TriangleAlert,
          title: t('x:ending.offline', 'This page could not be reached.'),
          paras: [t('x:ending.offlineBody', 'Check your connection and try again.')],
          contact: true,
          action: (
            <button type="button" className="x-button" onClick={() => void load(tag)}>
              <Icon of={RotateCcw} size={16} />
              <span>{t('x:ending.retry', 'Try again')}</span>
            </button>
          ),
        };
      case 'unavailable':
        return { tone: 'neutral', icon: SearchX, title: t('x:ending.unavailable', 'This page isn’t available.'), paras: [], contact: true };
    }
  }

  // The polite region says an ending's title and its key sentence once it shows.
  const card = ending === null ? null : endingCard(ending);
  useEffect(() => {
    if (card === null) return;
    setLive([card.title, ...card.paras.filter((para): para is string => typeof para === 'string').slice(0, 1)].join(' '));
  }, [ending, tag]);

  // ── The language menu: the form's languages (all eight with no form), each named in itself ─
  const choices = form === null ? X_LANGUAGES : X_LANGUAGES.filter((one) => form.languages.includes(one.tag as never));
  const menu =
    frame || choices.length < 2 ? null : (
      <>
        <button
          ref={languageButton}
          type="button"
          className="x-language-button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('x:language.button', 'Language: {name}', { name: language.name })}
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
            aria-label={t('x:language.menu', 'Language')}
            className="x-menu"
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
            {choices.map((one) => (
              <button key={one.id} type="button" role="menuitemradio" aria-checked={one.tag === tag} lang={one.tag} dir={one.dir} className="x-menu-item" tabIndex={-1} onClick={() => chooseLanguage(one)}>
                <span>{one.name}</span>
                {one.tag === tag ? <Icon of={Check} size={16} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </>
    );

  // ── Drawing ────────────────────────────────────────────────────────────
  const sectionTitle = new Map((definition?.sections ?? []).map((section) => [section.id, textOf(section.title, tag)]));
  const drawn = new Set<string>();
  const wholeError = errors[WHOLE_ANSWER];
  const anyError = Object.keys(errors).length > 0;
  const survey = form?.kind === 'survey';
  const formLanguage = form?.language ?? tag;

  const body =
    card !== null ? (
      <section className="x-card x-status" data-tone={card.tone} aria-labelledby="x-status-title">
        <div className="x-status-head">
          <span className="x-tile">
            <Icon of={card.icon} />
          </span>
          <div className="x-status-text">
            <h1 id="x-status-title" className="x-h2" tabIndex={-1} ref={headingRef}>
              {card.title}
            </h1>
            {card.paras.map((para, index) => (
              <p key={index}>{para}</p>
            ))}
          </div>
        </div>
        {card.action ?? null}
        {card.contact && business.email !== null ? <MailLink email={business.email} icon /> : null}
      </section>
    ) : definition !== null && form !== null ? (
      <form className="x-card x-form" noValidate onSubmit={(event) => void send(event)} lang={formLanguage}>
        <div className="x-title">
          <h1 className="x-h1">{textOf(definition.title, formLanguage)}</h1>
          {definition.intro === undefined ? null : <p className="x-intro">{textOf(definition.intro, formLanguage)}</p>}
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
                rtl={language.dir === 'rtl'}
                today={page?.state === 'live' ? page.today : ''}
                onChange={(value) => change(question.id, value)}
              />
            </div>
          );
        })}
        {/* A trap for scripts that fill every field: no person sees it, and no screen reader reads it. */}
        <div className="x-trap" aria-hidden="true">
          <label htmlFor="x-website">{t('x:honeypot', 'Leave this field empty')}</label>
          <input id="x-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(event) => setTrap(event.target.value)} />
        </div>
        {tooMany === undefined ? null : (
          <p className="x-alert" data-tone="warning" role="alert">
            <Icon of={TriangleAlert} size={16} />
            <span>
              {business.email === null
                ? t('x:ending.tooManyPlain', 'Too many sends from here. Please try again {when}.', { when: waitWords(tooMany, tag) })
                : t('x:ending.tooMany', 'Too many sends from here. Please try again {when}, or write to {email}.', { when: waitWords(tooMany, tag), email: business.email })}
            </span>
          </p>
        )}
        {anyError ? (
          <p className="x-alert" data-tone="danger">
            <Icon of={TriangleAlert} size={16} />
            <span>{wholeError === 'proof' ? t('x:proofFailed', 'The check that you are a person did not pass. Try again.') : wholeError !== undefined ? refusal(undefined, wholeError) : t('x:summary', 'Check the answers marked below.')}</span>
          </p>
        ) : null}
        <button type="submit" className="x-button" aria-disabled={sending || undefined}>
          {sending ? <Icon of="spinner" size={16} /> : null}
          <span>{sending ? t('x:sending', 'Sending…') : survey ? t('x:sendAnswers', 'Send answers') : t('x:send', 'Send')}</span>
        </button>
        <p className="x-privacy">
          {business.name === '' ? null : <span>{t('x:keeps', '{business} keeps what you send to answer you.', { business: business.name })} </span>}
          {business.privacyNotice === null ? null : (
            <a href={business.privacyNotice} target="_blank" rel="noreferrer">
              {t('x:footer.privacyNotice', 'Privacy notice')}
            </a>
          )}
        </p>
      </form>
    ) : null;

  return (
    <div className="x-page" data-frame={frame ? '' : undefined} ref={rootRef} aria-busy={page === null && ending === null ? true : undefined}>
      <div role="status" aria-live="polite" className="x-sr">
        {live}
      </div>
      {frame ? null : (
        <header className="x-header">
          <div className="x-header-inner">
            {business.hasLogo ? (
              <img className="x-logo" src="/x/api/logo" alt="" />
            ) : monogram(business.name) === '' ? null : (
              <span className="x-monogram" aria-hidden="true" dir="ltr">
                {monogram(business.name)}
              </span>
            )}
            <bdi className="x-business">{business.name}</bdi>
            {menu}
          </div>
        </header>
      )}
      <main className="x-main">{body}</main>
      {frame ? null : (
        <footer className="x-footer">
          <div className="x-footer-inner">
            {business.name === '' ? null : <bdi>{business.legalName ?? business.name}</bdi>}
            {business.email === null ? null : (
              <span>
                {t('x:footer.questions', 'Questions? Write to')} <MailLink email={business.email} />
              </span>
            )}
            {business.privacyNotice === null ? null : (
              <a href={business.privacyNotice} target="_blank" rel="noreferrer">
                {t('x:footer.privacyNotice', 'Privacy notice')}
              </a>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
