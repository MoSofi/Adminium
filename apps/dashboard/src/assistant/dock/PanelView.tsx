// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The panel as it is drawn: header, bars, thread, composer.
 *
 * A VIEW AND NOTHING ELSE. What it shows is handed to it; it asks no server
 * and reads no page. `AssistantDock` is the half that knows the conversation
 * and the page. Split so every state of the panel can be drawn on its own,
 * in a story or a test, without a conversation behind it.
 */
import { Select, Switch, cn } from '@adminium/ui';
import { ArrowUp, CircleAlert, Ellipsis, Hourglass, ListFilter, LoaderCircle, MessageSquarePlus, Mic, MicOff, Rows3, Sparkles, Square, SquareCheck, Timer, Volume2, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';

import { t } from '../../i18n/t.js';
import { ChipList } from '../parts/ChipList.js';
import type { DockLayout } from './dockLayout.js';

/** What "these" will mean in the next message, as the chip above the field says it. */
export interface ScopeChip {
  icon: 'selection' | 'record' | 'filter';
  label: string;
}

/**
 * The microphone, as the composer draws it. Absent: no button (the workspace
 * has it off, or this browser can neither record nor write speech down).
 */
export interface MicView {
  state: 'idle' | 'asking' | 'listening' | 'working';
  /** Seconds listened so far. */
  seconds: number;
  /** The language being listened in, by its own name ("Deutsch"). */
  language: string;
  /** What stands under the field after the microphone was used. */
  note: 'check' | 'failed' | 'blocked' | 'used' | 'stopped' | null;
  /** The longest one recording may be, in minutes: said when it stopped by itself. */
  maxMinutes: number;
  /** Shown the first time the microphone is pressed: where the voice goes. Null once it was read. */
  notice: string | null;
  onNoticeRead: () => void;
  onToggle: () => void;
}

/**
 * The person's own choices for replies read aloud, behind the header's
 * speaker. Absent: no speaker (the workspace has reading aloud off, or this
 * browser has no voice for the person's language).
 */
export interface VoiceMenuView {
  readAloud: boolean;
  onReadAloud: (next: boolean) => void;
  rate: number;
  onRate: (next: number) => void;
  /** The browser's voices for the person's language; the choice is drawn only when there are several. */
  voices: readonly { uri: string; name: string }[];
  voice: string | null;
  onVoice: (uri: string | null) => void;
}

const RATES: readonly number[] = [0.75, 1, 1.25, 1.5];

export interface PanelViewProps {
  layout: DockLayout;
  name: string;
  /** The header's second line: what the assistant is looking at, or that it is loading. */
  lookingAt: string;
  canStartNew: boolean;
  /** The conversation is still being fetched: nothing of it is announced as it arrives. */
  loading?: boolean;
  onNew: () => void;
  onClose: () => void;
  /** The bars under the header: no model, actions locked, the day used up. */
  bars?: ReactNode;
  /** The thread. */
  children: ReactNode;
  busyElsewhere: boolean;
  chip: ScopeChip | null;
  onDismissChip: () => void;
  /** A draft's own next steps, above the field. */
  followups: readonly string[];
  input: string;
  onInput: (value: string) => void;
  onSubmit: (text: string) => void;
  placeholder: string;
  /** Nothing can be asked: no model, the day used up, a dialog of the page in front. */
  blocked: boolean;
  /** Speaking to the assistant; absent where it cannot be done. */
  mic?: MicView | undefined;
  /** The assistant speaking: this person's choices; absent where it cannot. */
  voice?: VoiceMenuView | undefined;
  working: boolean;
  onStop: () => void;
  nextTurnTokens: number;
  /** A dialog of the page itself is open: the panel waits behind it. */
  dimmed: boolean;
  rootRef?: Ref<HTMLElement>;
  inputRef?: Ref<HTMLInputElement>;
  threadEndRef?: Ref<HTMLDivElement>;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

const HEADER_BUTTON = cn(
  'nb-press flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted',
  'hover:border-border-strong hover:text-fg disabled:pointer-events-none disabled:opacity-40',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
);

export function PanelView({
  layout,
  name,
  lookingAt,
  canStartNew,
  loading,
  onNew,
  onClose,
  bars,
  children,
  busyElsewhere,
  chip,
  onDismissChip,
  followups,
  input,
  onInput,
  onSubmit,
  placeholder,
  blocked,
  mic,
  voice,
  working,
  onStop,
  nextTurnTokens,
  dimmed,
  rootRef,
  inputRef,
  threadEndRef,
  onKeyDown,
}: PanelViewProps) {
  const inputId = useId();
  const titleId = useId();
  const floating = layout !== 'docked';
  const ChipIcon = chip === null ? null : chip.icon === 'selection' ? SquareCheck : chip.icon === 'record' ? Rows3 : ListFilter;
  const sendIdle = input.trim() === '';
  const [voiceOpen, setVoiceOpen] = useState(false);
  const micRef = useRef<HTMLButtonElement>(null);
  const voiceId = useId();
  const listening = mic?.state === 'listening';
  const micBusy = mic !== undefined && mic.state !== 'idle';
  // While the microphone is asked for or the words are being written down, the field says so.
  const shownPlaceholder =
    mic?.state === 'asking'
      ? t('assistant:mic.asking', 'Allow the microphone to speak to {name}', { name })
      : mic?.state === 'working'
        ? t('assistant:mic.working', 'Writing down what you said…')
        : placeholder;
  const micLabel = listening ? t('assistant:mic.stop', 'Stop listening') : t('assistant:mic.speak', 'Speak to {name}', { name });
  const micNote =
    mic === undefined || mic.note === null
      ? null
      : mic.note === 'check'
        ? { tone: 'text-fg-subtle', Icon: null, text: t('assistant:mic.check', 'Check the text, then send.') }
        : mic.note === 'stopped'
          ? { tone: 'text-fg-subtle', Icon: Timer, text: t('assistant:mic.stopped', 'Stopped at {minutes, plural, one {# minute} other {# minutes}}.', { minutes: mic.maxMinutes }) }
          : mic.note === 'blocked'
            ? { tone: 'text-warn', Icon: MicOff, text: t('assistant:mic.blocked', 'The microphone is blocked for this site. Allow it in your browser’s address bar.') }
            : mic.note === 'used'
              ? { tone: 'text-warn', Icon: Hourglass, text: t('assistant:mic.used', 'Voice is used up for today.') }
              : { tone: 'text-danger', Icon: CircleAlert, text: t('assistant:mic.failed', 'That did not work. Try again.') };

  return (
    <aside
      ref={rootRef}
      data-assistant-dock=""
      data-testid="assistant-dock"
      data-layout={layout}
      // Docked it is a landmark beside the page; over the page it is a dialog in front of it.
      role={floating ? 'dialog' : 'complementary'}
      {...(floating ? { 'aria-modal': true } : {})}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden bg-surface outline-none',
        // The shell's row grows with the page and the document scrolls: the panel stays in view.
        layout === 'docked' && 'sticky top-0 h-dvh w-[400px] shrink-0 self-start border-s border-border',
        // Above the sticky top bar (30), below the product's own dialogs (50) and the toasts.
        layout === 'over' && 'fixed inset-y-0 end-0 z-40 w-[400px] max-w-full border-s border-border shadow-[0_0_48px_rgba(10,10,16,0.18)]',
        layout === 'sheet' && 'fixed inset-x-0 bottom-0 top-3 z-40 rounded-t-[18px] pt-2 shadow-menu',
      )}
    >
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-[11px] border-b border-border bg-surface py-[13px] pe-3 ps-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-accent text-accent-fg shadow-[0_3px_10px_color-mix(in_srgb,var(--accent)_38%,transparent)]">
          <Sparkles className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[15px] font-extrabold tracking-[-0.015em] text-fg">
            {name}
          </h2>
          <p data-testid="assistant-looking-at" className="mt-0.5 truncate text-[11.5px] text-fg-subtle">
            {lookingAt}
          </p>
        </div>
        {voice === undefined ? null : (
          <button
            type="button"
            data-testid="assistant-voice"
            className={cn(HEADER_BUTTON, voiceOpen && 'border-accent text-accent')}
            aria-expanded={voiceOpen}
            aria-controls={voiceId}
            onClick={() => setVoiceOpen((open) => !open)}
            aria-label={t('assistant:speak.settings', 'Reading aloud')}
            title={t('assistant:speak.settings', 'Reading aloud')}
          >
            <Volume2 className="size-4" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          data-testid="assistant-new"
          className={HEADER_BUTTON}
          disabled={!canStartNew}
          onClick={onNew}
          aria-label={t('assistant:panel.new', 'New conversation')}
          title={t('assistant:panel.new', 'New conversation')}
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="assistant-close"
          className={cn(HEADER_BUTTON, 'text-fg-subtle')}
          onClick={onClose}
          aria-label={t('assistant:close', 'Close')}
          title={t('assistant:close', 'Close')}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      {bars}

      {voice === undefined || !voiceOpen ? null : (
        // The person's own choices for replies read aloud: kept for them, on every device.
        <div id={voiceId} data-testid="assistant-voice-choices" className="flex shrink-0 flex-col gap-2.5 border-b border-border bg-surface px-4 py-3">
          <label className="flex items-center gap-2.5 text-[12.5px] font-bold text-fg">
            <Switch data-testid="assistant-read-aloud" checked={voice.readAloud} onCheckedChange={voice.onReadAloud} aria-label={t('assistant:speak.readAloud', 'Read replies aloud')} />
            <span aria-hidden="true">{t('assistant:speak.readAloud', 'Read replies aloud')}</span>
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
              <span>{t('assistant:speak.speed', 'Speed')}</span>
              <Select data-testid="assistant-voice-rate" value={String(voice.rate)} onChange={(event) => voice.onRate(Number(event.target.value))} className="h-7 py-0 text-[12px]">
                {(RATES.includes(voice.rate) ? RATES : [...RATES, voice.rate].sort((a, b) => a - b)).map((rate) => (
                  <option key={rate} value={String(rate)}>{`${String(rate)}×`}</option>
                ))}
              </Select>
            </label>
            {voice.voices.length < 2 ? null : (
              <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] font-semibold text-fg-muted">
                <span>{t('assistant:speak.voice', 'Voice')}</span>
                <Select
                  data-testid="assistant-voice-pick"
                  value={voice.voice ?? ''}
                  onChange={(event) => voice.onVoice(event.target.value === '' ? null : event.target.value)}
                  className="h-7 min-w-0 py-0 text-[12px]"
                  wrapperClassName="min-w-0 flex-1"
                >
                  <option value="">{t('assistant:speak.voiceDefault', 'The browser’s own')}</option>
                  {voice.voices.map((one) => (
                    <option key={one.uri} value={one.uri}>
                      {one.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
        </div>
      )}

      {/* ── thread ─────────────────────────────────────────────────────────── */}
      <div data-testid="assistant-thread" className="min-h-0 flex-1 overflow-y-auto bg-bg px-4 py-[18px]">
        {/* Announced once each is complete, politely: the page the person is working on comes first. */}
        <div
          // A LOG only once the conversation is in: what a reload restores is the past, not news,
          // and a region that exists while it arrives would read all of it out.
          key={loading === true ? 'loading' : 'thread'}
          {...(loading === true ? {} : { role: 'log', 'aria-live': 'polite' as const, 'aria-relevant': 'additions' as const })}
          className="flex min-h-full flex-col justify-end gap-3.5"
        >
          {children}
          <div ref={threadEndRef} />
        </div>
      </div>

      {/* ── composer ───────────────────────────────────────────────────────── */}
      <div className="relative flex shrink-0 flex-col gap-2 border-t border-border bg-surface px-3.5 pb-[11px] pt-2.5">
        {busyElsewhere ? (
          <p role="status" data-testid="assistant-still-working" className="text-[11.5px] font-semibold text-fg-muted">
            {t('assistant:panel.stillWorking', '{name} is still working on your last question.', { name })}
          </p>
        ) : null}
        {followups.length === 0 ? null : (
          <ChipList variant="compact" items={followups.map((label) => ({ label }))} onPick={onSubmit} disabled={blocked || working} />
        )}
        {chip === null || ChipIcon === null ? null : (
          <div className="flex">
            <span
              data-testid="assistant-chip-scope"
              className="inline-flex h-[26px] items-center gap-1.5 rounded-lg bg-accent-soft-solid pe-[3px] ps-[9px] text-[11.5px] font-bold text-accent"
            >
              <ChipIcon className="size-3" aria-hidden="true" />
              <span>{chip.label}</span>
              <button
                type="button"
                onClick={onDismissChip}
                aria-label={t('assistant:chip.remove', 'Ask without “{label}”', { label: chip.label })}
                className="flex size-5 items-center justify-center rounded-[6px] text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          </div>
        )}
        {mic === undefined || mic.notice === null ? null : (
          // Said once, from the microphone, before the first word is heard: where the voice goes.
          <div role="note" data-testid="assistant-mic-notice" className="flex items-start gap-2 rounded-[12px] border border-border bg-surface-2 px-3 py-2.5">
            <Mic className="mt-px size-3.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-pretty text-[12px] font-medium leading-[1.5] text-fg">{mic.notice}</span>
            <button
              type="button"
              data-testid="assistant-mic-notice-ok"
              onClick={() => {
                mic.onNoticeRead();
                // This button is about to go: the focus moves to the microphone, where Escape stops the listening.
                micRef.current?.focus();
              }}
              className="shrink-0 rounded-[8px] px-2 py-1 text-[11.5px] font-bold text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t('assistant:mic.noticeOk', 'OK')}
            </button>
          </div>
        )}
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-[14px] border bg-surface-2 p-[5px]',
            listening ? 'border-accent' : 'border-border',
            mic === undefined && 'ps-3',
            blocked && 'opacity-60',
          )}
        >
          {mic === undefined ? null : (
            <button
              type="button"
              ref={micRef}
              data-testid="assistant-mic"
              data-state={mic.state}
              onClick={mic.onToggle}
              disabled={blocked || working || mic.state === 'asking' || mic.state === 'working'}
              aria-label={micLabel}
              title={micLabel}
              aria-pressed={listening}
              className={cn(
                'nb-press flex size-8 shrink-0 items-center justify-center rounded-full',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none',
                listening ? 'bg-accent text-accent-fg shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_18%,transparent)]' : 'text-fg-muted hover:bg-surface-3 hover:text-fg',
                (mic.state === 'asking' || mic.state === 'working') && 'text-fg-subtle',
              )}
            >
              {mic.state === 'working' ? (
                <LoaderCircle className="size-[15px] animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Mic className="size-[15px]" aria-hidden="true" />
              )}
            </button>
          )}
          <label className="sr-only" htmlFor={inputId}>
            {shownPlaceholder}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            data-testid="assistant-input"
            type="text"
            value={input}
            disabled={blocked || working || mic?.state === 'asking' || mic?.state === 'working'}
            // While listening the words heard are written here: typed ones would be written over.
            readOnly={listening}
            placeholder={shownPlaceholder}
            onChange={(event) => onInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              // Nothing is sent by voice alone: while the microphone is at work, Enter waits.
              if (!blocked && !working && !micBusy) onSubmit(input);
            }}
            className="min-w-0 flex-1 border-none bg-transparent py-1.5 text-[13px] font-medium text-fg outline-none placeholder:text-fg-subtle"
          />
          {listening && mic !== undefined ? (
            // While listening: the language heard and how long, where the eye already is.
            <span role="status" data-testid="assistant-mic-listening" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap pe-1 font-mono text-[10.5px] font-semibold text-accent">
              <span className="sr-only">{t('assistant:mic.listening', 'Listening')}</span>
              {/* Said once ("Listening"); the language and the running seconds are for the eye, not read out each second. */}
              <span aria-hidden="true" className="font-sans">
                {mic.language}
              </span>
              <span aria-hidden="true">·</span>
              <span aria-hidden="true">{`${String(Math.floor(mic.seconds / 60))}:${String(mic.seconds % 60).padStart(2, '0')}`}</span>
            </span>
          ) : null}
          {working ? (
            // The send button becomes Stop while a question is being answered.
            <button
              type="button"
              data-testid="assistant-stop"
              onClick={onStop}
              aria-label={t('assistant:panel.stop', 'Stop')}
              title={t('assistant:panel.stop', 'Stop')}
              className="nb-press flex size-[34px] shrink-0 items-center justify-center rounded-full bg-fg text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Square className="size-3 fill-current" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              data-testid="assistant-send"
              disabled={blocked || sendIdle || micBusy}
              onClick={() => onSubmit(input)}
              aria-label={t('assistant:composer.send', 'Send')}
              className={cn(
                'nb-press flex size-[34px] shrink-0 items-center justify-center rounded-full',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none',
                sendIdle ? 'bg-surface-3 text-fg-subtle' : 'bg-accent text-accent-fg',
              )}
            >
              <ArrowUp className="size-[15px]" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex items-start gap-2">
          {micNote === null ? null : (
            <span role="status" data-testid="assistant-mic-note" data-note={mic?.note ?? ''} className={cn('flex min-w-0 items-start gap-1.5 text-pretty text-[11.5px] font-semibold leading-[1.4]', micNote.tone)}>
              {micNote.Icon === null ? null : <micNote.Icon className="mt-px size-3 shrink-0" aria-hidden="true" />}
              <span>{micNote.text}</span>
            </span>
          )}
          <span className="ms-auto whitespace-nowrap font-mono text-[10.5px] text-fg-subtle">
            {t('assistant:tokens.hint', '~{n} tokens', { n: nextTurnTokens })}
          </span>
        </div>

        {/* The page's own dialog is open: its scrim covers the page, and this covers the panel. */}
        {dimmed ? (
          <div
            data-testid="assistant-dimmed"
            className="pointer-events-auto fixed inset-y-0 end-0 z-[8] flex w-[400px] items-center justify-center bg-surface/65 p-6 backdrop-grayscale"
          >
            <span className="flex items-center gap-[9px] rounded-[12px] border border-border bg-surface px-[15px] py-[11px] text-[12.5px] font-bold text-fg shadow-menu">
              <Ellipsis className="size-3.5 text-fg-subtle" aria-hidden="true" />
              {t('assistant:panel.pageDialog', 'Close what is open on the page to use {name}.', { name })}
            </span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
