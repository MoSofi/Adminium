// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The panel as it is drawn: header, bars, thread, composer (Milo Panel comp;
 * measures in workplan/64-specs/09-panel-comp-map.md).
 *
 * A VIEW AND NOTHING ELSE. What it shows is handed to it; it asks no server
 * and reads no page. `AssistantDock` is the half that knows the conversation
 * and the page. Split so every state of the panel can be drawn on its own,
 * in a story or a test, without a conversation behind it.
 */
import { cn } from '@adminium/ui';
import { ArrowUp, Ellipsis, ListFilter, MessageSquarePlus, Rows3, Sparkles, Square, SquareCheck, X } from 'lucide-react';
import { useId, type KeyboardEvent, type ReactNode, type Ref } from 'react';

import { t } from '../../i18n/t.js';
import { ChipList } from '../parts/ChipList.js';
import type { DockLayout } from './dockLayout.js';

/** What "these" will mean in the next message, as the chip above the field says it. */
export interface ScopeChip {
  icon: 'selection' | 'record' | 'filter';
  label: string;
}

export interface PanelViewProps {
  layout: DockLayout;
  name: string;
  /** The header's second line: what the assistant is looking at, or that it is loading. */
  lookingAt: string;
  canStartNew: boolean;
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

      {/* ── thread ─────────────────────────────────────────────────────────── */}
      <div data-testid="assistant-thread" className="min-h-0 flex-1 overflow-y-auto bg-bg px-4 py-[18px]">
        {/* Announced once each is complete, politely: the page the person is working on comes first. */}
        <div role="log" aria-live="polite" aria-relevant="additions" className="flex min-h-full flex-col justify-end gap-3.5">
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
        <div className={cn('flex items-center gap-1.5 rounded-[14px] border border-border bg-surface-2 p-[5px] ps-3', blocked && 'opacity-60')}>
          <label className="sr-only" htmlFor={inputId}>
            {placeholder}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            data-testid="assistant-input"
            type="text"
            value={input}
            disabled={blocked || working}
            placeholder={placeholder}
            onChange={(event) => onInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (!blocked && !working) onSubmit(input);
            }}
            className="min-w-0 flex-1 border-none bg-transparent py-1.5 text-[13px] font-medium text-fg outline-none placeholder:text-fg-subtle"
          />
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
              disabled={blocked || sendIdle}
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
