// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's panel, docked at the end edge of the dashboard (Milo Panel
 * comp; measures in workplan/64-specs/09-panel-comp-map.md).
 *
 * ONE CONVERSATION, EVERY PAGE. The panel stays where it is while the person
 * walks from page to page; each question is asked on the page they are on
 * (read from the page channel, never passed in), and every turn says where it
 * was asked.
 *
 * WHAT THE PAGE IS, WHEN IT SAID NOTHING. A page that publishes no context
 * gets the general assistant: it is told only the route, and can say where
 * things are done.
 *
 * THREE WAYS OF STANDING. Docked beside the page while the page keeps its
 * width; over the page's end when it would not; a sheet from the bottom on a
 * phone. Docked it is a landmark beside the page. Over the page it is a
 * dialog: the page behind is inert, focus stays inside, Escape closes it.
 *
 * MOUNTED WHILE CLOSED, ONCE IT HAS BEEN OPENED. A question asked and then
 * the panel closed is still being answered: the bubble turns while it runs
 * and marks an answer that has not been read.
 */
import { cn } from '@adminium/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowUp, Ellipsis, ListFilter, MessageSquarePlus, Rows3, Sparkles, Square, SquareCheck, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { t } from '../../i18n/t.js';
import { usePageAssistant, type PageAssistantShown, type PageAssistantView } from '../../shell/PageActionsProvider.js';
import type { AssistantContext, AssistantHostRef } from '../api.js';
import { useAssistantMessages } from '../assistantMessages.js';
import { contextCopy, type AssistantFactValues } from '../contexts.js';
import { AllowanceBar } from '../parts/AllowanceBar.js';
import { AssistantBubble as Speaker } from '../parts/AssistantBubble.js';
import { Idle } from '../parts/Idle.js';
import { Warning } from '../parts/ResultCard.js';
import { UnavailableBar } from '../parts/UnavailableBar.js';
import { TurnView } from '../TurnView.js';
import type { ThreadTurn } from '../useAssistantSession.js';
import { dockLayout, type DockLayout } from './dockLayout.js';
import { setDockOpen, setDockSignal } from './dockStore.js';
import { ParkedDraft } from './ParkedDraft.js';
import { usePanelConversation, type PanelPage } from './usePanelConversation.js';

export interface AssistantDockProps {
  /** False while the panel is closed: nothing is drawn, the conversation is still followed. */
  visible: boolean;
}

/** The page the person is on, for the assistant: what the page published, or the general one. */
function usePanelPage(): { page: PanelPage; shown: PageAssistantShown; view: PageAssistantView | undefined } {
  const published = usePageAssistant();
  const route = useRouterState({
    select: (state) => {
      const match = state.matches.at(-1);
      const appKey = (match?.params as { appKey?: unknown } | undefined)?.appKey;
      return `${match?.routeId ?? ''}\n${typeof appKey === 'string' ? appKey : ''}`;
    },
  });
  return useMemo(() => {
    if (published !== null) {
      return {
        page: { context: published.context as AssistantContext, host: published.host as AssistantHostRef },
        shown: published.shown,
        view: published.host.view,
      };
    }
    const [routeId = '', app = ''] = route.split('\n');
    const host: AssistantHostRef = { connectionIds: [], ...(routeId === '' ? {} : { route: routeId }), ...(app === '' ? {} : { app }) };
    return { page: { context: 'general', host }, shown: {}, view: undefined };
  }, [published, route]);
}

/** Docked, over or a sheet: decided from the room the page would be left with. */
function useDockLayout(element: HTMLElement | null, visible: boolean): DockLayout {
  const [layout, setLayout] = useState<DockLayout>('docked');
  const current = useRef<DockLayout | undefined>(undefined);
  useLayoutEffect(() => {
    if (element === null || !visible) return;
    const row = element.parentElement;
    const pageColumn = element.previousElementSibling;
    if (row === null || !(pageColumn instanceof HTMLElement)) return;
    const measure = () => {
      // What the page column and the panel share: the row, less whatever stands in it before the
      // page (the rail, at whatever width it has now). Not the page column's own width: that
      // already has the panel taken out of it whenever the panel is docked.
      let before = 0;
      for (const child of row.children) {
        if (child === pageColumn) break;
        if (child instanceof HTMLElement && getComputedStyle(child).position !== 'fixed') before += child.offsetWidth;
      }
      const room = row.clientWidth - before;
      const next = dockLayout({ viewport: window.innerWidth, room, previous: current.current });
      if (next !== current.current) {
        current.current = next;
        setLayout(next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(pageColumn);
    return () => observer.disconnect();
  }, [element, visible]);
  return layout;
}

/** A dialog or drawer of the PAGE is open: the record comes first, the panel waits (comp 11). */
function usePageDialogOpen(active: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    const check = () => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      setOpen([...dialogs].some((dialog) => dialog.closest('[data-assistant-dock]') === null));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'role'] });
    return () => observer.disconnect();
  }, [active]);
  return open;
}

/** The header's second line: what the assistant is looking at. */
function lookingAt(context: AssistantContext, shown: PageAssistantShown, facts: AssistantFactValues, name: string): string {
  const title = shown.title ?? contextCopy(context, facts, name).page;
  if (shown.record !== undefined) return t('assistant:panel.recordOpen', '{page} · {record} open', { page: title, record: shown.record });
  if (typeof shown.rows === 'number') {
    return t('assistant:panel.rowsShown', '{page} · {rows, plural, one {# row shown} other {# rows shown}}', { page: title, rows: shown.rows });
  }
  return title;
}

/** What "these" will mean in the next message, as the chip says it; null when the page shows everything. */
function chipOf(view: PageAssistantView | undefined, shown: PageAssistantShown): { icon: 'selection' | 'record' | 'filter'; label: string } | null {
  if (view === undefined) return null;
  const ticked = view.selectedIds?.length ?? 0;
  if (ticked > 0) return { icon: 'selection', label: t('assistant:chip.selected', '{count, plural, one {# selected} other {# selected}}', { count: ticked }) };
  if (view.recordId !== undefined && view.recordId !== '') return { icon: 'record', label: shown.record ?? t('assistant:chip.record', 'The open record') };
  if ((view.q ?? '') !== '' || (view.where ?? '') !== '') {
    return {
      icon: 'filter',
      label:
        typeof shown.rows === 'number'
          ? t('assistant:chip.filtered', '{rows, plural, one {# filtered row} other {# filtered rows}}', { rows: shown.rows })
          : t('assistant:chip.filteredUnknown', 'Filtered rows'),
    };
  }
  return null;
}

/** What "these" meant for a question already asked, under its bubble. */
function scopeLabel(turn: ThreadTurn): string | undefined {
  const scope = turn.on.scope;
  if (scope === null) return undefined;
  if (scope.kind === 'selection') return t('assistant:chip.selected', '{count, plural, one {# selected} other {# selected}}', { count: scope.count ?? 0 });
  if (scope.kind === 'record') return t('assistant:chip.record', 'The open record');
  return t('assistant:chip.filteredUnknown', 'Filtered rows');
}

const HEADER_BUTTON = cn(
  'nb-press flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-border bg-surface text-fg-muted',
  'hover:border-border-strong hover:text-fg disabled:pointer-events-none disabled:opacity-40',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
);

export function AssistantDock({ visible }: AssistantDockProps) {
  useAssistantMessages();
  const navigate = useNavigate();
  const { page, shown, view } = usePanelPage();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const layout = useDockLayout(element, visible);
  const floating = layout !== 'docked';

  // The chip can be put away: the next message is then asked without "these", until the page shows something else.
  const viewKey = JSON.stringify(view ?? null);
  const [dismissedView, setDismissedView] = useState<string | null>(null);
  const chip = dismissedView === viewKey ? null : chipOf(view, shown);
  const askedPage = useMemo<PanelPage>(() => {
    if (dismissedView !== viewKey) return page;
    const { view: _view, ...host } = page.host;
    return { ...page, host };
  }, [page, dismissedView, viewKey]);

  const conversation = usePanelConversation(askedPage);
  const { turns, working, name } = conversation;
  const facts = (conversation.facts?.values ?? {}) as AssistantFactValues;
  const copy = useMemo(() => contextCopy(page.context, facts, name), [page.context, facts, name]);

  const [input, setInput] = useState('');
  const [picks, setPicks] = useState<Record<string, Record<string, string>>>({});
  const inputId = useId();
  const titleId = useId();
  const threadEnd = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ── the bubble's signal while the panel is closed ─────────────────────────
  const wasWorking = useRef(false);
  useEffect(() => {
    if (visible) {
      setDockSignal('idle');
    } else if (working) {
      setDockSignal('working');
    } else if (wasWorking.current) {
      // It finished while nobody was looking.
      setDockSignal('unread');
    }
    wasWorking.current = working;
  }, [visible, working]);

  // ── the thread follows its end ───────────────────────────────────────────
  const lastStatus = turns.at(-1)?.status;
  useEffect(() => {
    if (visible) threadEnd.current?.scrollIntoView({ block: 'end' });
  }, [visible, turns.length, lastStatus, conversation.liveSteps.length]);

  const close = useCallback(() => setDockOpen(false), []);
  const pageDialogOpen = usePageDialogOpen(visible && !floating);

  // ── over the page it is a dialog: the page is inert, focus comes in, Escape closes ──
  useEffect(() => {
    if (!visible || !floating || element === null) return;
    const pageColumn = element.previousElementSibling;
    if (pageColumn instanceof HTMLElement) pageColumn.inert = true;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (pageColumn instanceof HTMLElement) pageColumn.inert = false;
      // Back to what opened it, when that is still there.
      if (before !== null && before.isConnected) before.focus();
    };
  }, [visible, floating, element]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && floating && !event.defaultPrevented) {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab' || !floating || element === null) return;
    // Focus stays inside while the page behind is inert.
    const stops = [...element.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])')].filter(
      (stop) => !stop.hasAttribute('disabled') && stop.offsetParent !== null,
    );
    const first = stops[0];
    const last = stops.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const unavailable = conversation.phase === 'unavailable';
  const blocked =
    unavailable || conversation.phase !== 'ready' || conversation.usedUpUntil !== null || conversation.closedElsewhere || pageDialogOpen;

  const submit = useCallback(
    (text: string) => {
      if (text.trim() === '') return;
      setInput('');
      conversation.ask(text, askedPage);
    },
    [conversation, askedPage],
  );

  if (!visible) return null;

  const canConfigure = conversation.availability?.canConfigure ?? false;
  const openSettings = () => {
    if (floating) close();
    void navigate({ to: '/studio/settings/ai' });
  };
  const ChipIcon = chip === null ? null : chip.icon === 'selection' ? SquareCheck : chip.icon === 'record' ? Rows3 : ListFilter;
  const sendIdle = input.trim() === '';

  return (
    <aside
      ref={setElement}
      data-assistant-dock=""
      data-testid="assistant-dock"
      data-layout={layout}
      // Docked it is a landmark beside the page; over the page it is a dialog in front of it.
      role={floating ? 'dialog' : 'complementary'}
      {...(floating ? { 'aria-modal': true } : {})}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden bg-surface',
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
            {conversation.phase === 'loading'
              ? t('assistant:panel.loading', 'Loading conversation…')
              : lookingAt(page.context, shown, facts, name)}
          </p>
        </div>
        <button
          type="button"
          data-testid="assistant-new"
          className={HEADER_BUTTON}
          disabled={conversation.sessionId === null || working}
          onClick={conversation.newConversation}
          aria-label={t('assistant:panel.new', 'New conversation')}
          title={t('assistant:panel.new', 'New conversation')}
        >
          <MessageSquarePlus className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="assistant-close"
          className={cn(HEADER_BUTTON, 'text-fg-subtle')}
          onClick={close}
          aria-label={t('assistant:close', 'Close')}
          title={t('assistant:close', 'Close')}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      {unavailable ? (
        <UnavailableBar
          reason={conversation.availability?.reason ?? null}
          name={name}
          canConfigure={canConfigure}
          onOpenSettings={openSettings}
        />
      ) : null}
      {conversation.usedUpUntil === null ? null : <AllowanceBar resetsAt={conversation.usedUpUntil} />}

      {/* ── thread ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg px-4 py-[18px]">
        {/* Announced once each is complete, politely: the page the person is working on comes first. */}
        <div role="log" aria-live="polite" aria-relevant="additions" className="flex min-h-full flex-col justify-end gap-3.5">
          {conversation.earlier > 0 ? (
            <p className="text-center text-[11px] font-semibold text-fg-subtle">
              {t('assistant:panel.earlier', '{count, plural, one {# earlier message is} other {# earlier messages are}} not shown.', {
                count: conversation.earlier,
              })}
            </p>
          ) : null}

          {conversation.aged && turns.length === 0 ? (
            <p data-testid="assistant-aged" className="text-center text-[11.5px] leading-[1.5] text-fg-subtle">
              {t('assistant:panel.aged', 'Your earlier conversation was closed because of its age.')}
            </p>
          ) : null}

          {conversation.phase === 'loading' || turns.length > 0 || unavailable ? null : (
            <Idle
              greeting={copy.greeting}
              greetingSub={copy.greetingSub}
              suggestions={copy.suggestions}
              onPick={submit}
              disabled={blocked || working}
            />
          )}

          {turns.map((turn, index) => (
            <TurnView
              key={turn.id}
              turn={turn}
              live={turn.id === turns.at(-1)?.id}
              liveSteps={conversation.liveSteps}
              answered={index < turns.length - 1}
              workTitle={contextCopy(turn.context, {}, name).workTitle}
              context={turn.context}
              name={name}
              canConfigure={canConfigure}
              newest={index === turns.length - 1}
              blocked={blocked || working}
              onAsk={submit}
              onOpenAddOn={() => {
                if (floating) close();
                void navigate({ to: '/studio/add-ons' });
              }}
              askedOn={t('assistant:panel.onPage', 'on {page}', { page: turn.on.title ?? contextCopy(turn.context, {}, name).page })}
              askedScope={scopeLabel(turn)}
              picks={picks[turn.id] ?? {}}
              onPick={(groupKey, optionKey) => {
                setPicks((previous) => ({ ...previous, [turn.id]: { ...(previous[turn.id] ?? {}), [groupKey]: optionKey } }));
              }}
              onGo={() => conversation.answer(turn.id, picks[turn.id] ?? {}, askedPage)}
              onRetry={turn.askText === null ? null : () => submit(turn.askText ?? '')}
              renderResult={(result) => <ParkedDraft title={result.title} madeOn={turn} name={name} onNavigate={floating ? close : undefined} />}
            />
          ))}

          {conversation.closedElsewhere ? (
            <div data-testid="assistant-closed-elsewhere" className="flex flex-col items-center gap-2.5 text-center">
              <span className="text-[11.5px] leading-[1.5] text-fg-subtle">
                {t('assistant:panel.closedElsewhere', 'This conversation was closed in another window.')}
              </span>
              <button
                type="button"
                onClick={conversation.newConversation}
                className="nb-press rounded-[10px] border border-border-strong bg-surface px-[13px] py-2 text-[12.5px] font-bold text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {t('assistant:panel.new', 'New conversation')}
              </button>
            </div>
          ) : null}
          {conversation.problem === null ? null : (
            <Speaker spacer bare>
              <div className="min-w-0 flex-1 overflow-hidden rounded-[16px] border border-border bg-surface pt-4 shadow-menu">
                <Warning text={conversation.problem} />
              </div>
            </Speaker>
          )}
          <div ref={threadEnd} />
        </div>
      </div>

      {/* ── composer ───────────────────────────────────────────────────────── */}
      <div className="relative flex shrink-0 flex-col gap-2 border-t border-border bg-surface px-3.5 pb-[11px] pt-2.5">
        {conversation.busyElsewhere ? (
          <p role="status" data-testid="assistant-still-working" className="text-[11.5px] font-semibold text-fg-muted">
            {t('assistant:panel.stillWorking', '{name} is still working on your last question.', { name })}
          </p>
        ) : null}
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
                onClick={() => setDismissedView(viewKey)}
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
            {copy.placeholder}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            data-testid="assistant-input"
            type="text"
            value={input}
            disabled={blocked || working}
            placeholder={copy.placeholder}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (!blocked && !working) submit(input);
            }}
            className="min-w-0 flex-1 border-none bg-transparent py-1.5 text-[13px] font-medium text-fg outline-none placeholder:text-fg-subtle"
          />
          {working ? (
            // The send button becomes Stop while a question is being answered.
            <button
              type="button"
              data-testid="assistant-stop"
              onClick={conversation.stop}
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
              onClick={() => submit(input)}
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
            {t('assistant:tokens.hint', '~{n} tokens', { n: conversation.nextTurnTokens })}
          </span>
        </div>

        {/* The page's own dialog is open: its scrim covers the page, and this covers the panel. */}
        {pageDialogOpen ? (
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
