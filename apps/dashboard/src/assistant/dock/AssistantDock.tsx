// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's panel, docked at the end edge of the dashboard.
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
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { t } from '../../i18n/t.js';
import {
  usePageAssistant,
  usePageAssistantHandlersRef,
  type PageAssistantShown,
  type PageAssistantView,
} from '../../shell/PageActionsProvider.js';
import type { AssistantContext, AssistantHostRef } from '../api.js';
import { useAssistantMessages } from '../assistantMessages.js';
import { contextCopy, type AssistantFactValues } from '../contexts.js';
import type { AssistantHostContext } from '../hostContext.js';
import { AllowanceBar } from '../parts/AllowanceBar.js';
import { AssistantBubble as Speaker } from '../parts/AssistantBubble.js';
import { Idle } from '../parts/Idle.js';
import { ReadOnlyBar } from '../parts/ReadOnlyBar.js';
import { Warning } from '../parts/ResultCard.js';
import { UnavailableBar } from '../parts/UnavailableBar.js';
import { TurnView } from '../TurnView.js';
import type { ThreadTurn } from '../thread.js';
import { dockLayout, type DockLayout } from './dockLayout.js';
import { setDockOpen, setDockSignal } from './dockStore.js';
import { LiveDraft } from './LiveDraft.js';
import { PanelView, type ScopeChip } from './PanelView.js';
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
    if (!active) {
      setOpen(false);
      return;
    }
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
function lookingAt(context: AssistantContext, shown: PageAssistantShown, facts: AssistantFactValues | null, name: string): string {
  const copy = contextCopy(context, facts ?? {}, name);
  // A page that drafts says what it knows of itself, from the server's counts (once they are in).
  if (context !== 'data' && context !== 'general') return facts === null ? copy.page : copy.blurb;
  const title = shown.title ?? copy.page;
  if (shown.record !== undefined) return t('assistant:panel.recordOpen', '{page} · {record} open', { page: title, record: shown.record });
  if (typeof shown.rows === 'number') {
    return t('assistant:panel.rowsShown', '{page} · {rows, plural, one {# row shown} other {# rows shown}}', { page: title, rows: shown.rows });
  }
  return title;
}

/** What "these" will mean in the next message, as the chip says it; null when the page shows everything. */
function chipOf(view: PageAssistantView | undefined, shown: PageAssistantShown): ScopeChip | null {
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
  // The confirm before a save is a dialog of the panel's own: not one to wait behind.
  const [ownDialogs, setOwnDialogs] = useState(0);
  const onOwnDialog = useCallback((open: boolean) => setOwnDialogs((count) => Math.max(count + (open ? 1 : -1), 0)), []);
  const pageDialogOpen = usePageDialogOpen(visible && !floating && ownDialogs === 0);

  // ── a page that drafts: its own hands, and the lock on what writes ────────
  const pageHost = usePageAssistantHandlersRef<AssistantHostContext>();
  const homeKey = `${page.context}\n${page.host.documentId ?? ''}\n${page.host.pageId ?? ''}`;
  // The guardrail is per page and per visit: walking away, or a reload, locks it again.
  const [enabledOn, setEnabledOn] = useState<string | null>(null);
  const enabled = enabledOn === homeKey;
  const canWrite = conversation.availability?.canWrite ?? false;
  const leave = useCallback(() => {
    if (floating) setDockOpen(false);
  }, [floating]);
  /** A draft is at home on the page, and for an editor the document, it was made for. */
  const atHome = (turn: ThreadTurn): boolean =>
    !turn.on.gone && turn.context === page.context && turn.on.documentId === (page.host.documentId ?? null) && pageHost() !== null;

  // ── over the page it is a dialog: the page is inert, focus comes in, Escape closes ──
  useEffect(() => {
    if (!visible || !floating || element === null) return;
    const pageColumn = element.previousElementSibling;
    if (pageColumn instanceof HTMLElement) pageColumn.inert = true;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (pageColumn instanceof HTMLElement) pageColumn.inert = false;
      // Back to what opened it, when that is still there.
      if (before !== null && before.isConnected) before.focus();
    };
  }, [visible, floating, element]);

  // Focus comes inside: to the field when it can be typed in, to the panel itself while it loads.
  const fieldClosed = conversation.phase !== 'ready' || working;
  useEffect(() => {
    if (!visible || !floating || element === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== element && element.contains(active)) return;
    if (fieldClosed) element.focus();
    else inputRef.current?.focus();
  }, [visible, floating, element, fieldClosed]);

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
      // An editor's unsaved document goes with the question, as it is at this moment.
      const draft = pageHost()?.draft;
      conversation.ask(text, draft === undefined ? askedPage : { ...askedPage, draft });
    },
    // `pageHost` reads a ref: it has no identity worth depending on.
    [conversation, askedPage],
  );

  if (!visible) return null;

  const canConfigure = conversation.availability?.canConfigure ?? false;
  const openSettings = () => {
    if (floating) close();
    void navigate({ to: '/studio/settings/ai' });
  };
  // A draft's own next steps, while it is the newest thing said and it is at home.
  const newestTurn = turns.at(-1);
  const newestDraft = newestTurn !== undefined && newestTurn.result !== null && atHome(newestTurn) ? newestTurn.result : null;

  return (
    <PanelView
      rootRef={setElement}
      inputRef={inputRef}
      threadEndRef={threadEnd}
      layout={layout}
      name={name}
      lookingAt={
        conversation.phase === 'loading'
          ? t('assistant:panel.loading', 'Loading conversation…')
          : lookingAt(page.context, shown, conversation.facts === null ? null : facts, name)
      }
      canStartNew={conversation.sessionId !== null && !working}
      onNew={conversation.newConversation}
      onClose={close}
      onKeyDown={onKeyDown}
      bars={
        <>
      {unavailable ? (
        <UnavailableBar
          reason={conversation.availability?.reason ?? null}
          name={name}
          canConfigure={canConfigure}
          onOpenSettings={openSettings}
        />
      ) : null}
      {unavailable || copy.actions.length === 0 || (enabled && canWrite) ? null : (
        // Until part 4 gives each kind of action its own switch, one lock for all of them: it is
        // per page and per visit, and says so by being there again.
        <ReadOnlyBar name={name} canWrite={canWrite} onEnable={() => setEnabledOn(homeKey)} />
      )}
      {conversation.usedUpUntil === null ? null : <AllowanceBar resetsAt={conversation.usedUpUntil} />}
        </>
      }
      busyElsewhere={conversation.busyElsewhere}
      chip={chip}
      onDismissChip={() => setDismissedView(viewKey)}
      followups={newestDraft === null ? [] : newestDraft.followups}
      input={input}
      onInput={setInput}
      onSubmit={submit}
      placeholder={copy.placeholder}
      blocked={blocked}
      working={working}
      onStop={conversation.stop}
      nextTurnTokens={conversation.nextTurnTokens}
      dimmed={pageDialogOpen}
    >
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
              renderResult={(result) =>
                atHome(turn) ? (
                  <LiveDraft
                    turn={turn}
                    result={result}
                    host={pageHost}
                    copy={copy}
                    name={name}
                    enabled={enabled}
                    canWrite={canWrite}
                    tokensIn={turn.tokensIn}
                    tokensOut={turn.tokensOut}
                    runAction={conversation.runAction}
                    loadWhole={conversation.loadWhole}
                    onOwnDialog={onOwnDialog}
                    onLeave={leave}
                  />
                ) : (
                  <ParkedDraft
                    title={result.title}
                    madeOn={turn}
                    name={name}
                    onOpen={(home) => {
                      if (floating) close();
                      void navigate({ to: home.to, ...(home.params === undefined ? {} : { params: home.params }) } as never);
                    }}
                  />
                )
              }
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
    </PanelView>
  );
}
