// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CHAT WINDOW a visitor sees on the owner's website: the launcher, and
 * the panel it opens.
 *
 * THE LAUNCHER. A round button in the business's colour, with "Chat with
 * {business}" beside it while the window is closed; a reply that came while
 * it was closed shows as a count and "1 new message from {business}". Open,
 * it turns to a chevron that hides the window. On a phone the window is a
 * sheet over the whole page, closed from its own header, with no launcher.
 *
 * THE PANEL. The business's logo (or its initials), name, and under it the
 * business's welcome line, else today's hours;
 * the language button when the chat speaks more than one; the log; the box.
 * The log starts with the first line, which says who answers here and
 * whether an AI service reads the messages, as it really is now (automatic
 * answers only in hours: outside them it never claims them), with the
 * privacy notice. Then the conversation: the visitor's messages and their
 * state, automatic answers (marked, with "Talk to a person" under the latest
 * while they run, and the language when it is not the visitor's), a
 * person's replies under their first name, and the lines a person's acts
 * leave ("Dana closed this chat · 10:04"). While a person is wanted, the
 * hand-over card; outside hours with no chat going, the card that takes a
 * question.
 *
 * Nothing here says "online", nothing types, nothing is read back: a
 * person answers when they answer.
 */
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useT } from '@adminium/i18n/react';
import { BookOpen, Check, ChevronDown, CircleAlert, Clock, ExternalLink, Globe, LoaderCircle, MessageCircle, MessageCirclePlus, Send, Timer, TriangleAlert, UserRound, WifiOff, X } from 'lucide-react';

import { monogram } from '../XApp.js';
import { X_LANGUAGES } from '../words.js';
import type { ChatConfig, ChatMessage } from './api.js';
import { AwayCard, HandCard, type AwayWords } from './Cards.js';
import { clockOf, closingOf, codeOf, languageName, lengthOf, opensWords, Said } from './say.js';
import type { Pending, useChatSession } from './session.js';

/** The longest message the door takes, in code points. */
export const MESSAGE_MAX = 2000;
/** Where the business's own away words name the next opening. */
export const OPENS_TOKEN = '{opens}';
/** How long a person may be wanted before the window says it is still waiting. */
export const WAITING_LONG_MS = 5 * 60_000;

type Chat = ReturnType<typeof useChatSession>;

/** Which first line a chat shows: automatic answers (A), a person helped by an AI service (B), or a person (C). */
export function firstLineOf(config: Pick<ChatConfig, 'automatic' | 'miloDrafts' | 'aiService'>, open: boolean): 'automatic' | 'drafts' | 'person' {
  // Automatic answers never run outside hours, so the line never claims them then.
  if (config.automatic && open && config.aiService !== null) return 'automatic';
  if (config.miloDrafts && config.aiService !== null) return 'drafts';
  return 'person';
}

export interface ChatWindowProps {
  config: ChatConfig;
  chat: Chat;
  /** The window's language (`en-US`). */
  tag: string;
  /** The panel fills the whole viewport (a phone). */
  sheet: boolean;
  /** The side the launcher sits on. */
  side: 'left' | 'right';
  layerRef: RefObject<HTMLDivElement | null>;
  onLanguage: (tag: string) => void;
  onToggle: (open: boolean) => void;
  /** The hours opened while a question was being left: the window is read again. */
  onInHours: () => void;
  /** The box's text, kept by the app so a refused message can come back to it. */
  draft: string;
  setDraft: (text: string) => void;
}

export function ChatWindow(props: ChatWindowProps): ReactNode {
  const t = useT();
  const { config, chat, tag, sheet } = props;
  const { session } = chat;
  const business = config.business.name;
  const newTab = t('xChat:newTab', '(opens in a new tab)');
  // Counts in Latin digits, as every number the product shows.
  const numbers = new Intl.NumberFormat(tag, { numberingSystem: 'latn' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [talking, setTalking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const panelRef = useRef<HTMLElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const langRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(session.open);
  const ids = { notice: 'xc-notice', counter: 'xc-counter' };

  const open = session.open;
  const conversation = session.token !== null && session.state !== null;
  const hoursOpen = session.hours.open;

  // A clock for "still waiting", ticking only while a person is wanted.
  useEffect(() => {
    if (session.state !== 'waiting') return undefined;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [session.state]);

  // The log keeps its end in view whenever what it holds, or the room it has, changes (a status under a
  // message, a card, the band over it).
  const logSize = useRef('');
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log === null) return;
    const size = `${String(log.scrollHeight)}:${String(log.clientHeight)}`;
    if (size === logSize.current) return;
    logSize.current = size;
    log.scrollTop = log.scrollHeight;
  });

  // Focus goes into the panel when the visitor opens it, and back to the launcher when they close it.
  useEffect(() => {
    if (open && !wasOpen.current) (inputRef.current ?? panelRef.current?.querySelector<HTMLElement>('button, input, textarea'))?.focus();
    if (!open && wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  function close(): void {
    setMenuOpen(false);
    props.onToggle(false);
  }

  function onPanelKey(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (menuOpen) {
        setMenuOpen(false);
        langRef.current?.focus();
      } else close();
      return;
    }
    // On a phone the sheet is the whole page: Tab goes round inside it.
    if (event.key === 'Tab' && sheet && panelRef.current !== null) {
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  // ── The header ────────────────────────────────────────────────────────
  let hoursLine: string | null = null;
  if (hoursOpen && session.hours.closesAt !== null) {
    hoursLine = t('xChat:hours.openUntil', 'Open today until {time}', { time: closingOf(session.hours.closesAt, config.timeZone) });
  } else if (!hoursOpen && session.hours.nextOpen !== null) {
    hoursLine = t(
      'xChat:hours.opens',
      '{day, select, today {Opens today at {time}} tomorrow {Opens tomorrow at {time}} date {Opens on {date} at {time}} other {Opens {weekday} at {time}}}',
      opensWords(session.hours.nextOpen, tag),
    );
  }

  // The line under the name: the business's own welcome when it wrote one (in this language, else its default), else the hours.
  const welcome = config.welcome?.trim() ?? '';
  const headerLine = welcome === '' ? hoursLine : welcome;

  const offered = X_LANGUAGES.filter((one) => config.languages.includes(one.tag));
  const current = offered.find((one) => one.tag === tag) ?? X_LANGUAGES.find((one) => one.tag === tag) ?? X_LANGUAGES[0]!;

  const header = (
    <header className="xc-head">
      {config.business.hasLogo ? (
        <img className="xc-tile" src="/x/api/logo" alt="" />
      ) : (
        <span className="xc-tile" data-monogram="" aria-hidden="true" dir="ltr">
          {monogram(business)}
        </span>
      )}
      <div className="xc-title">
        <bdi className="xc-name">{business}</bdi>
        {headerLine === null ? null : (
          <span className="xc-hours">
            <Said text={headerLine} newTab={newTab} />
          </span>
        )}
      </div>
      {offered.length < 2 ? null : (
        <div className="xc-langs">
          <button
            ref={langRef}
            type="button"
            className="xc-lang"
            aria-label={t('xChat:languageOf', 'Language: {name}', { name: current.name })}
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((was) => !was)}
          >
            <Globe size={16} strokeWidth={2} aria-hidden="true" />
            <span dir="ltr" className="x-mono">
              {codeOf(current.tag, config.languages)}
            </span>
          </button>
          {menuOpen ? (
            <ul className="xc-menu" aria-label={t('xChat:language', 'Language')}>
              {offered.map((one) => (
                <li key={one.tag}>
                  <button
                    type="button"
                    lang={one.tag}
                    dir={one.dir}
                    aria-current={one.tag === current.tag ? 'true' : 'false'}
                    onClick={() => {
                      setMenuOpen(false);
                      langRef.current?.focus();
                      if (one.tag !== current.tag) props.onLanguage(one.tag);
                    }}
                  >
                    <span className="xc-menu-name">{one.name}</span>
                    {one.tag === current.tag ? (
                      <span className="xc-menu-tick">
                        <Check size={15} strokeWidth={2} aria-hidden="true" />
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <button type="button" className="xc-square" aria-label={sheet ? t('xChat:close', 'Close chat') : t('xChat:hide', 'Hide chat')} onClick={close}>
        {sheet ? <X size={18} strokeWidth={2} aria-hidden="true" /> : <ChevronDown size={18} strokeWidth={2} aria-hidden="true" />}
      </button>
    </header>
  );

  // ── The log ───────────────────────────────────────────────────────────
  const line = firstLineOf(config, hoursOpen);
  const service = config.aiService ?? '';
  const lineText =
    line === 'automatic'
      ? t('xChat:first.automatic', 'Some answers here are automatic, picked from answers {business} wrote. A person can take over at any time. Your messages are read by an AI service ({service}).', { business, service })
      : line === 'drafts'
        ? t('xChat:first.drafts', 'A person answers here. Staff may use an AI service ({service}) to help write replies.', { service })
        : t('xChat:first.person', 'A person answers here.');
  // Outside hours, with nothing asked of the visitor and no chat going on, there is nothing to say a first line about.
  const noticeShown = conversation || hoursOpen || config.mail || session.pending.length > 0;
  const notice = noticeShown ? (
    <p key="notice" className="xc-notice" id={ids.notice}>
      <Said text={lineText} newTab={newTab} />{' '}
      {config.business.privacyNotice === null ? null : (
        <a href={config.business.privacyNotice} target="_blank" rel="noopener noreferrer">
          {t('xChat:privacy', 'Privacy notice.')}
          <ExternalLink className="xc-link-icon" size={12} strokeWidth={2} aria-hidden="true" />
          <span className="x-sr">{newTab}</span>
        </a>
      )}
    </p>
  ) : null;

  const last = session.messages[session.messages.length - 1];
  const talkOn = session.state === 'bot' && session.pending.length === 0;

  function systemLine(message: ChatMessage): string | null {
    const time = clockOf(message.sentAt, tag);
    if (message.event === 'handed-over') return message.by === 'visitor' ? t('xChat:asked', 'You asked for a person.') : null;
    if (message.event === 'closed') {
      return message.author === undefined ? t('xChat:closed', 'This chat was closed · {time}', { time }) : t('xChat:closedBy', '{name} closed this chat · {time}', { name: message.author.firstName, time });
    }
    if (message.event === 'reopened') {
      return message.author === undefined ? t('xChat:reopened', 'This chat was reopened · {time}', { time }) : t('xChat:reopenedBy', '{name} reopened this chat · {time}', { name: message.author.firstName, time });
    }
    // Any other line (a person taking the chat) is for the staff's side only.
    return null;
  }

  function hoursEndedLine(): ReactNode {
    const ended = session.hoursEnded;
    if (ended === null) return null;
    const closing = ended.closing === null ? '' : closingOf(ended.closing, config.timeZone);
    const text =
      ended.nextOpen === null
        ? t('xChat:hoursEnded.none', '{business}’s hours ended at {closing}. A person may still answer.', { business, closing })
        : t(
            'xChat:hoursEnded.next',
            '{day, select, today {{business}’s hours ended at {closing}. A person may still answer; if not, we’ll reply after {time} today.} tomorrow {{business}’s hours ended at {closing}. A person may still answer; if not, we’ll reply after {time} tomorrow.} date {{business}’s hours ended at {closing}. A person may still answer; if not, we’ll reply on {date} after {time}.} other {{business}’s hours ended at {closing}. A person may still answer; if not, we’ll reply on {weekday} after {time}.}}',
            { business, closing, ...opensWords(ended.nextOpen, tag) },
          );
    return (
      <p key="hours-ended" className="xc-sys">
        <Said text={text} newTab={newTab} />
      </p>
    );
  }

  function message(one: ChatMessage): ReactNode {
    const time = clockOf(one.sentAt, tag);
    if (one.kind === 'system') {
      const text = systemLine(one);
      return text === null ? null : (
        <p key={one.id} className="xc-sys">
          <Said text={text} newTab={newTab} />
        </p>
      );
    }
    if (one.kind === 'visitor') {
      return (
        <div key={one.id} className="xc-mine">
          <div className="xc-bubble" dir="auto">
            <Said text={one.body} newTab={newTab} />
          </div>
          <span className="xc-time x-mono">{time}</span>
        </div>
      );
    }
    if (one.kind === 'automatic') {
      const language = one.language ?? tag;
      const other = language.split('-')[0] !== tag.split('-')[0];
      return (
        <div key={one.id} className="xc-theirs xc-auto">
          <span className="xc-auto-label">
            <BookOpen size={12} strokeWidth={2} aria-hidden="true" />
            {other ? t('xChat:automaticIn', 'Automatic answer · in {language}', { language: languageName(language, tag) }) : t('xChat:automatic', 'Automatic answer')}
          </span>
          <div className="xc-bubble" dir="auto" lang={language}>
            <Said text={one.body} links newTab={newTab} />
          </div>
          <div className="xc-after">
            {talkOn && last?.id === one.id ? (
              <button
                type="button"
                className="xc-talk"
                disabled={talking}
                onClick={() => {
                  setTalking(true);
                  void chat.talk().finally(() => setTalking(false));
                }}
              >
                <UserRound size={14} strokeWidth={2} aria-hidden="true" />
                {t('xChat:talk', 'Talk to a person')}
              </button>
            ) : null}
            <span className="xc-time x-mono">{time}</span>
          </div>
        </div>
      );
    }
    const author = one.author ?? { firstName: business, initials: monogram(business) };
    return (
      <div key={one.id} className="xc-theirs xc-person">
        <span className="xc-who">
          <span className="xc-initials" aria-hidden="true">
            {author.initials}
          </span>
          <bdi>{one.author === undefined ? business : t('xChat:from', '{name} from {business}', { name: author.firstName, business })}</bdi>
        </span>
        <div className="xc-bubble" dir="auto">
          <Said text={one.body} links newTab={newTab} />
        </div>
        <span className="xc-time x-mono">{time}</span>
      </div>
    );
  }

  function pending(one: Pending): ReactNode {
    const bad = one.status === 'fail' || one.status === 'notSent';
    return (
      <div key={one.key} className="xc-mine">
        <div className="xc-bubble" dir="auto">
          <Said text={one.body} newTab={newTab} />
        </div>
        {one.status === 'checking' || one.status === 'queued' ? (
          <span role="status" className="xc-status">
            {one.status === 'checking' ? <LoaderCircle className="x-spin" size={13} strokeWidth={2} aria-hidden="true" /> : <Clock size={13} strokeWidth={2} aria-hidden="true" />}
            <span>{one.status === 'checking' ? t('xChat:status.checking', 'Checking you’re a person…') : t('xChat:status.queued', 'Waiting to send')}</span>
          </span>
        ) : bad ? (
          <span role="alert" className="xc-status" data-bad="">
            {one.status === 'fail' ? <CircleAlert size={14} strokeWidth={2} aria-hidden="true" /> : <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />}
            <span className="xc-status-text">{one.status === 'fail' ? t('xChat:status.failed', 'We couldn’t check that you’re a person.') : t('xChat:status.notSent', 'Not sent.')}</span>
            <button type="button" className="xc-retry" onClick={() => chat.retry(one.key)}>
              {t('xChat:status.retry', 'Try again')}
            </button>
          </span>
        ) : null}
      </div>
    );
  }

  // While a person is wanted: how long, from the hand-over.
  const handedAt = [...session.messages].reverse().find((one) => one.event === 'handed-over')?.sentAt;
  const waitingLong = session.state === 'waiting' && handedAt !== undefined && now - new Date(handedAt).getTime() >= WAITING_LONG_MS;
  const quietMail = config.mail && !(session.saved && session.email !== '');

  function waitWords(retryAfter: number | null): string {
    const minutes = Math.max(1, Math.ceil((retryAfter ?? 60) / 60));
    return minutes <= 1
      ? t('xChat:rate.minute', 'You’ve sent a lot of messages. Wait a minute, then try again.')
      : t('xChat:rate.wait', 'You’ve sent a lot of messages. Wait {minutes, plural, one {{n} minute} other {{n} minutes}}, then try again.', { minutes, n: numbers.format(minutes) });
  }

  const away: AwayWords = (() => {
    const next = session.hours.nextOpen;
    const when = next === null ? null : opensWords(next, tag);
    const stockUntil =
      when === null
        ? t('xChat:away.now', 'We’re away for now.')
        : t('xChat:away.until', '{day, select, today {We’re away until {time} today.} tomorrow {We’re away until {time} tomorrow.} date {We’re away until {date} at {time}.} other {We’re away until {weekday} at {time}.}}', when);
    // The business's own away sentence, when it wrote one: plain text, its `{opens}` filled with the next opening
    // ("9:00 tomorrow"); with no next opening to name, the stock sentence says it truly.
    const own = config.outsideWords?.trim() ?? '';
    const until =
      own === ''
        ? stockUntil
        : !own.includes(OPENS_TOKEN)
          ? own
          : when === null
            ? t('xChat:away.now', 'We’re away for now.')
            : own.split(OPENS_TOKEN).join(t('xChat:away.opens', '{day, select, today {{time} today} tomorrow {{time} tomorrow} date {{date} at {time}} other {{weekday} at {time}}}', when));
    const tail = config.mail
      ? t('xChat:away.leave', 'Leave your question and your e-mail, and we’ll reply by e-mail.')
      : when === null
        ? t('xChat:away.later', 'Write to us again later.')
        : t('xChat:away.again', 'Write to us again then.');
    return {
      text: `${until} ${tail}`,
      sent: (email: string) =>
        when === null
          ? t('xChat:away.sentNone', 'Thanks. We’ll reply to {email}.', { email })
          : t('xChat:away.sent', '{day, select, today {Thanks. We’ll reply to {email} after {time}.} tomorrow {Thanks. We’ll reply to {email} after {time}.} date {Thanks. We’ll reply to {email} on {date} after {time}.} other {Thanks. We’ll reply to {email} on {weekday} after {time}.}}', { ...when, email }),
    };
  })();

  const log: ReactNode[] = [];
  if (session.lost) {
    log.push(
      <p key="lost" className="xc-quiet">
        {t('xChat:lost', 'We couldn’t find your earlier chat. Start a new one below.')}
      </p>,
    );
  }
  if (session.resumedAt !== null) {
    log.push(
      <p key="resumed" className="xc-sys">
        <Said text={t('xChat:resumed', 'Your chat from {time}', { time: clockOf(session.resumedAt, tag) })} newTab={newTab} />
      </p>,
    );
  }
  if (notice !== null) log.push(notice);
  for (const one of session.messages) {
    log.push(message(one));
    if (session.hoursEnded?.after === one.id) log.push(hoursEndedLine());
  }
  for (const one of session.pending) log.push(pending(one));
  if (session.state === 'waiting') {
    if (waitingLong) {
      log.push(
        <p key="waiting" className="xc-quiet">
          <Said
            text={
              quietMail
                ? t('xChat:waitingMail', 'Still waiting for someone at {business}. You can leave your e-mail and close this page.', { business })
                : t('xChat:waiting', 'Still waiting for someone at {business}.', { business })
            }
            newTab={newTab}
          />
        </p>,
      );
    }
    if (config.mail) {
      log.push(
        <HandCard
          key="hand"
          mode="form"
          showText={!waitingLong}
          name={session.name}
          email={session.email}
          saved={session.saved}
          newTab={newTab}
          onSave={chat.saveDetails}
          onChange={chat.changeDetails}
        />,
      );
    } else if (!waitingLong) {
      log.push(<HandCard key="hand" mode="info" showText name="" email="" saved={false} newTab={newTab} onSave={chat.saveDetails} onChange={chat.changeDetails} />);
    }
  }
  const awayShown = !conversation && !hoursOpen && session.pending.length === 0;
  if (awayShown) {
    log.push(<AwayCard key="away" mode={config.mail ? 'form' : 'info'} words={away} sentTo={session.asked} newTab={newTab} waitWords={waitWords} onSend={chat.question} onInHours={props.onInHours} />);
  }

  // ── The box ───────────────────────────────────────────────────────────
  const rate = session.rate;
  const chatFull = rate?.cap === 'conversation';
  const ended = session.state === 'closed' || chatFull;
  const composerShown = !ended && !awayShown;
  const length = lengthOf(props.draft);
  const over = length > MESSAGE_MAX;
  const limited = rate !== null && !chatFull;
  const rateLine =
    rate === null
      ? null
      : chatFull
        ? t('xChat:rate.chat', 'You’ve sent a lot of messages in this chat.')
        : rate.cap === 'minute'
          ? t('xChat:rate.minute', 'You’ve sent a lot of messages. Wait a minute, then try again.')
          : waitWords(rate.until === null ? null : (rate.until - Date.now()) / 1000);
  const rateNode =
    rateLine === null ? null : (
      <p role="status" className="xc-rate">
        <span className="xc-rate-icon">
          <Timer size={14} strokeWidth={2} aria-hidden="true" />
        </span>
        <span>{rateLine}</span>
      </p>
    );

  function submit(event?: FormEvent): void {
    event?.preventDefault();
    if (limited || over || props.draft.trim() === '') return;
    chat.send(props.draft);
    props.setDraft('');
  }

  const write = t('xChat:write', 'Write a message…');
  const footer = ended ? (
    <div className="xc-new">
      {chatFull ? rateNode : null}
      <button
        type="button"
        className="xc-new-button"
        onClick={() => {
          chat.newChat();
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <MessageCirclePlus size={17} strokeWidth={2} aria-hidden="true" />
        {t('xChat:newChat', 'Start a new chat')}
      </button>
    </div>
  ) : composerShown ? (
    <form className="xc-composer" onSubmit={submit}>
      {rateNode}
      <div className="xc-row">
        <textarea
          ref={inputRef}
          className="xc-input"
          rows={1}
          // What the visitor writes takes its own direction; empty, the placeholder reads in the window's.
          dir={props.draft === '' ? current.dir : 'auto'}
          aria-label={write}
          placeholder={write}
          value={props.draft}
          disabled={limited}
          aria-invalid={over ? 'true' : 'false'}
          aria-describedby={over ? ids.counter : undefined}
          onChange={(event) => props.setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="xc-send" aria-label={t('xChat:send', 'Send')} disabled={limited || over}>
          <span className="xc-flip">
            <Send size={17} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
      </div>
      {over ? (
        <span id={ids.counter} className="xc-counter x-mono" dir="ltr">
          {`${numbers.format(length)} / ${numbers.format(MESSAGE_MAX)}`}
        </span>
      ) : null}
    </form>
  ) : null;

  const panelLabel = t('xChat:with', 'Chat with {business}', { business });
  const panel = open ? (
    <section
      ref={panelRef}
      className="xc-panel"
      role="dialog"
      aria-label={panelLabel}
      aria-describedby={notice === null ? undefined : ids.notice}
      aria-modal={sheet ? true : undefined}
      lang={tag}
      dir={current.dir}
      onKeyDown={onPanelKey}
    >
      {header}
      {session.offline ? (
        <div role="status" className="xc-band">
          <span className="xc-band-icon">
            <WifiOff size={14} strokeWidth={2} aria-hidden="true" />
          </span>
          <span>{t('xChat:offline', 'Can’t reach {business}. Trying again…', { business })}</span>
        </div>
      ) : null}
      <div ref={logRef} className="xc-log" role="log" aria-live="polite" aria-label={t('xChat:log', 'Messages')}>
        {log}
      </div>
      {footer}
    </section>
  ) : null;

  // ── The launcher ──────────────────────────────────────────────────────
  const unread = open ? 0 : session.unread;
  const launcher = sheet && open ? null : (
    <button
      ref={launcherRef}
      type="button"
      className="xc-launcher"
      aria-expanded={open}
      aria-label={
        open
          ? t('xChat:hide', 'Hide chat')
          : unread > 0
            ? t('xChat:withNew', 'Chat with {business}, {count, plural, one {{n} new message} other {{n} new messages}}', { business, count: unread, n: numbers.format(unread) })
            : panelLabel
      }
      onClick={() => props.onToggle(!open)}
    >
      {open ? null : (
        <span className="xc-pill" lang={tag} dir={current.dir}>
          {unread > 0 ? t('xChat:newMessages', '{count, plural, one {{n} new message from {business}} other {{n} new messages from {business}}}', { business, count: unread, n: numbers.format(unread) }) : panelLabel}
        </span>
      )}
      <span className="xc-circle">
        {open ? <ChevronDown size={24} strokeWidth={2} aria-hidden="true" /> : <MessageCircle size={24} strokeWidth={2} aria-hidden="true" />}
        {unread > 0 ? (
          <span className="xc-badge x-mono" aria-hidden="true">
            {numbers.format(unread)}
          </span>
        ) : null}
      </span>
    </button>
  );

  return (
    <div ref={props.layerRef} className="xc-layer" dir={props.side === 'right' ? 'ltr' : 'rtl'}>
      {panel}
      {launcher}
    </div>
  );
}
