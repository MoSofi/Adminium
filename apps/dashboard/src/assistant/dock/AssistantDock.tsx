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
import { assistantApi, type AssistantContext, type AssistantHostRef, type VoiceChoices } from '../api.js';
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
import { clearDockSignal, setDockOpen, setDockSignal } from './dockStore.js';
import { LiveDraft } from './LiveDraft.js';
import { LiveProposal } from './LiveProposal.js';
import { PanelView, type ScopeChip } from './PanelView.js';
import { draftHome, ParkedDraft, type DraftHome } from './ParkedDraft.js';
import { usePanelConversation, type PanelPage } from './usePanelConversation.js';
import { bootLocale } from '../../i18n/setup.js';
import { useDictation } from '../voice/useDictation.js';
import { arrivedReply, useSpeech } from '../voice/useSpeech.js';
import type { MicView, VoiceMenuView } from './PanelView.js';

export interface AssistantDockProps {
  /** False while the panel is closed: nothing is drawn, the conversation is still followed. */
  visible: boolean;
  /** Whatever lists this person's pages (the bootstrap): read only to find a page's address from its id. */
  pages?: unknown;
  /**
   * How it stands, when its place decides that and not the room it measures: in a frame of its own on an
   * app's staff address it fills the frame, beside a page it does not cover (`staff/panel.tsx`).
   */
  layout?: DockLayout | undefined;
}

/**
 * The address of a data page, from its id. Pages are reached by slug, and a
 * turn remembers the id; the list of this person's pages has both. `null` for
 * a page they no longer have.
 */
const slugs = new WeakMap<object, Map<string, string | null>>();

export function pageSlugOf(pages: unknown, pageId: string): string | null {
  if (typeof pages !== 'object' || pages === null) return null;
  // Asked on every draw of the thread; the list of pages is the same object until it is fetched again.
  const known = slugs.get(pages) ?? new Map<string, string | null>();
  slugs.set(pages, known);
  const cached = known.get(pageId);
  if (cached !== undefined) return cached;
  const found = findSlug(pages, pageId);
  known.set(pageId, found);
  return found;
}

function findSlug(pages: unknown, pageId: string): string | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number): string | null => {
    if (typeof node !== 'object' || node === null || depth > 8 || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const entry of node) {
        const found = walk(entry, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }
    const record = node as Record<string, unknown>;
    if (record.pageId === pageId && typeof record.slug === 'string' && record.slug !== '') return record.slug;
    for (const value of Object.values(record)) {
      const found = walk(value, depth + 1);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(pages, 0);
}

/** A language by its own name ("Deutsch"), as the listening line says it. */
function languageName(locale: string): string {
  const tag = locale.replace('_', '-');
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag.split('-')[0] ?? tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Who writes the words down, for the one-time notice. */
function providerName(provider: string | null): string {
  if (provider === 'openai') return 'OpenAI';
  return t('assistant:mic.ownService', 'your workspace’s model service');
}

/** The page the person is on, for the assistant: what the page published, or the general one. */
function usePanelPage(): { page: PanelPage; shown: PageAssistantShown; view: PageAssistantView | undefined } {
  const published = usePageAssistant();
  const route = useRouterState({
    select: (state) => {
      const match = state.matches.at(-1);
      const params = (match?.params ?? {}) as { appKey?: unknown; key?: unknown; _splat?: unknown };
      // One of an add-on's own screens (`/add-ons/<key>/<ref>`): which add-on, and which screen of it.
      const addOn = match?.routeId === '/add-ons/$key/$' && typeof params.key === 'string' ? `${params.key}\n${typeof params._splat === 'string' ? params._splat : ''}` : '\n';
      return `${match?.routeId ?? ''}\n${typeof params.appKey === 'string' ? params.appKey : ''}\n${addOn}`;
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
    const [routeId = '', app = '', addOn = '', addOnPage = ''] = route.split('\n');
    const host: AssistantHostRef = { connectionIds: [], ...(routeId === '' ? {} : { route: routeId }), ...(app === '' ? {} : { app }), ...(addOn === '' ? {} : { addOn, addOnPage }) };
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

/** Where a turn's proposal is used: the data page it was asked on, or its document's page. Null: nowhere to send the person. */
function proposalHome(turn: ThreadTurn, pages: unknown): DraftHome | null {
  if (turn.context === 'data') {
    const slug = turn.on.pageId === null ? null : pageSlugOf(pages, turn.on.pageId);
    return slug === null ? null : { to: '/p/$slug', params: { slug } };
  }
  if (turn.context === 'general') return null;
  return draftHome(turn.context, turn.on.documentId);
}

/** Whether a turn's draft is a change to the rule that is open on the rules page: it names that rule as what it was built from. */
function changesOpenRule(turn: { context: string; result: { basedOn: string | null } | null }, page: AssistantHostContext | null): boolean {
  if (turn.context !== 'automation' || turn.result === null || turn.result.basedOn === null || page === null) return false;
  return (page.host as { documentId?: string | undefined }).documentId === turn.result.basedOn;
}

export function AssistantDock({ visible, pages, layout: fixedLayout }: AssistantDockProps) {
  useAssistantMessages();
  const navigate = useNavigate();
  const { page, shown, view } = usePanelPage();
  const [element, setElement] = useState<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  panelRef.current = element;
  const measured = useDockLayout(element, visible);
  const layout = fixedLayout ?? measured;
  const floating = layout !== 'docked';

  // The chip can be put away: the next message is then asked without "these", until the page shows something else.
  // Put away for THIS page showing THIS: another page, or the same one showing something else
  // (and then the same thing again), has its chip.
  const viewKey = `${page.context}\n${page.host.pageId ?? ''}\n${page.host.documentId ?? ''}\n${JSON.stringify(view ?? null)}`;
  const [dismissedView, setDismissedView] = useState<string | null>(null);
  useEffect(() => {
    setDismissedView((current) => (current !== null && current !== viewKey ? null : current));
  }, [viewKey]);
  const chip = dismissedView === viewKey ? null : chipOf(view, shown);
  const askedPage = useMemo<PanelPage>(() => {
    if (dismissedView !== viewKey) return page;
    const { view: _view, ...host } = page.host;
    return { ...page, host };
  }, [page, dismissedView, viewKey]);

  const conversation = usePanelConversation(askedPage, visible);
  const { turns, working, name } = conversation;
  const facts = (conversation.facts?.values ?? {}) as AssistantFactValues;
  const copy = useMemo(() => contextCopy(page.context, facts, name), [page.context, facts, name]);

  const [input, setInput] = useState('');
  const [picks, setPicks] = useState<Record<string, Record<string, string>>>({});
  const threadEnd = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ── the bubble's signal while the panel is closed ─────────────────────────
  const wasWorking = useRef(false);
  const lastProposal = turns.at(-1)?.answer?.proposal ?? null;
  const waiting =
    lastProposal !== null &&
    (lastProposal.state === 'unchecked' || (lastProposal.state === 'open' && (lastProposal.expiresAt === null || lastProposal.expiresAt > Date.now())));
  useEffect(() => {
    if (visible) {
      setDockSignal('idle');
    } else if (working) {
      setDockSignal('working');
    } else if (waiting) {
      // It asks for a yes or a no: more than an answer that has not been read.
      setDockSignal('proposal');
    } else if (wasWorking.current) {
      // It finished while nobody was looking.
      setDockSignal('unread');
    } else {
      // What it asked for is decided or over: nothing is waiting any more.
      clearDockSignal('proposal');
    }
    wasWorking.current = working;
  }, [visible, working, waiting]);

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
  // What writes is the workspace's to allow: the Create switch stands where a per-visit lock stood.
  // A server from before the switches says nothing of them, and saved drafts: that is kept.
  const enabled = conversation.availability?.abilities?.create ?? true;
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
    return () => {
      if (pageColumn instanceof HTMLElement) pageColumn.inert = false;
    };
  }, [visible, floating, element]);

  // ── focus: in when it opens, back when it closes ──────────────────────────
  // What had focus when the panel was opened (the header's Ask button; the bubble is gone by then).
  const opener = useRef<HTMLElement | null>(null);
  const shownBefore = useRef(visible);
  useEffect(() => {
    const opened = visible && !shownBefore.current;
    const closed = !visible && shownBefore.current;
    shownBefore.current = visible;
    if (opened) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      // Opened by the person, just now: they came to type. (A panel found open after a reload
      // takes nothing: the page they are reading keeps its focus.)
      // After this commit has painted: the field is in the document by then.
      setTimeout(() => {
        const field = inputRef.current;
        if (field !== null && !field.disabled) field.focus();
        else panelRef.current?.focus();
      }, 0);
    }
    if (closed) {
      // Back to what opened it when that is still there; else to the bubble, which is.
      // After this commit: the bubble is back in the document by then.
      setTimeout(() => {
        const active = document.activeElement;
        if (active !== null && active !== document.body) return;
        const back = opener.current !== null && opener.current.isConnected ? opener.current : document.querySelector<HTMLElement>('[data-testid="assistant-bubble"]');
        back?.focus();
      }, 0);
    }
  }, [visible]);
  // The field is closed while a question is answered, and a closed field drops focus: when the
  // answer is in and nothing else has taken focus, the person is put back where they were typing.
  const answering = useRef(false);
  useEffect(() => {
    const ended = answering.current && !working;
    answering.current = working;
    if (ended && visible && (document.activeElement === null || document.activeElement === document.body)) inputRef.current?.focus();
  }, [working, visible]);

  // Focus comes inside: to the field when it can be typed in, to the panel itself while it loads.
  // Over the page it MUST (the page behind is inert); beside the page it is only moved on from
  // the panel itself, where it was put to wait for the field to open.
  const fieldClosed = conversation.phase !== 'ready' || working;
  useEffect(() => {
    if (!visible || element === null) return;
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && active !== element && element.contains(active);
    if (inside) return;
    if (floating) {
      if (fieldClosed) element.focus();
      else inputRef.current?.focus();
    } else if (active === element && !fieldClosed) {
      inputRef.current?.focus();
    }
  }, [visible, floating, element, fieldClosed]);

  // ── speaking to the assistant ──────────────────────────────────────────────
  const voice = conversation.availability?.voice;
  const spoken = bootLocale();

  // ── the assistant speaking ─────────────────────────────────────────────────
  const speech = useSpeech();
  const [choices, setChoices] = useState<VoiceChoices>({ readAloud: false, rate: 1, voice: null });
  const mineKey = JSON.stringify(voice?.mine ?? null);
  useEffect(() => {
    const mine = JSON.parse(mineKey) as VoiceChoices | null;
    if (mine !== null) setChoices(mine);
  }, [mineKey]);
  const voicesHere = speech.voicesFor(spoken);
  // Only where the workspace lets it and the browser has a voice for this person's language.
  const canSpeak = voice?.output === true && speech.supported && voicesHere.length > 0;
  const choose = (change: Partial<VoiceChoices>): void => {
    setChoices((held) => ({ ...held, ...change }));
    // Kept for the person on the server; a save that fails leaves the choice for this visit.
    void assistantApi.setVoiceChoices(change).catch(() => undefined);
    if (change.readAloud === false) speech.stop();
  };
  /** What is read of a turn: what it said, and one short line when there is something to look at. Never the thing itself. */
  const spokenOf = (turn: ThreadTurn): string => {
    const said = turn.say ?? '';
    if (turn.result !== null) return `${said} ${t('assistant:speak.draft', 'There is a draft for you to look at.')}`.trim();
    if ((turn.answer?.proposal ?? null) !== null) return `${said} ${t('assistant:speak.proposal', 'I have put what would change on the screen for you to look at.')}`.trim();
    return said;
  };
  const read = (turn: ThreadTurn): void => speech.speak(turn.id, spokenOf(turn), { locale: spoken, rate: choices.rate, voice: choices.voice });
  // Replies that ARRIVE while the panel is open are read, when the person chose that. What was already
  // there when the conversation loaded is never read by itself.
  const heard = useRef<Set<string> | null>(null);
  const settled = turns.filter((turn) => turn.status === 'done' || turn.status === 'failed').map((turn) => turn.id).join(' ');
  useEffect(() => {
    if (conversation.phase !== 'ready') return;
    const arrived = arrivedReply(heard.current, turns);
    heard.current = arrived.heard;
    const newest = arrived.read;
    if (newest === null) return;
    if (choices.readAloud && canSpeak && visible) read(newest);
    // Only a reply's arrival reads it: not a change of voice or speed afterwards.
  }, [settled, conversation.phase]);
  const stopSpeech = speech.stop;
  useEffect(() => {
    if (!visible) stopSpeech();
  }, [visible, stopSpeech]);
  const voiceMenu: VoiceMenuView | undefined = canSpeak
    ? { readAloud: choices.readAloud, onReadAloud: (next) => choose({ readAloud: next }), rate: choices.rate, onRate: (next) => choose({ rate: next }), voices: voicesHere, voice: choices.voice, onVoice: (uri) => choose({ voice: uri }) }
    : undefined;
  /** What was in the field when the microphone was pressed: the words heard are added after it. */
  const beforeSpeech = useRef('');
  const dictation = useDictation({
    way: voice?.input ?? 'none',
    maxSeconds: voice?.maxSeconds ?? 120,
    language: spoken,
    onText: (text, final) => {
      const before = beforeSpeech.current.trimEnd();
      setInput(before === '' ? text : `${before} ${text}`);
      // Written down: the words wait in the field, selected, to be checked and sent by the person.
      if (final) requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    },
  });
  // Said once per way, on this device: where the voice goes. Until it is read, the microphone does not listen.
  const noticeKey = `adminium-assistant-voice-notice:${dictation.way}`;
  const [noticeShown, setNoticeShown] = useState(false);
  const noticeRead = (): boolean => {
    try {
      return window.localStorage.getItem(noticeKey) === '1';
    } catch {
      return false;
    }
  };
  const listen = (): void => {
    // The microphone opening stops the reading: it would hear itself.
    speech.stop();
    beforeSpeech.current = input;
    dictation.toggle();
  };
  const mic: MicView | undefined =
    dictation.way === 'none'
      ? undefined
      : {
          state: dictation.state,
          seconds: dictation.seconds,
          language: languageName(spoken),
          note: dictation.note,
          maxMinutes: Math.round((voice?.maxSeconds ?? 120) / 60),
          notice: !noticeShown
            ? null
            : dictation.way === 'provider'
              ? t('assistant:mic.noticeProvider', 'What you say is sent to {provider} to be written down. Nothing is kept.', { provider: providerName(voice?.to ?? null) })
              : t('assistant:mic.noticeBrowser', 'What you say is written down by your browser’s own speech service.'),
          onNoticeRead: () => {
            try {
              window.localStorage.setItem(noticeKey, '1');
            } catch {
              // A browser that keeps nothing says it again next time.
            }
            setNoticeShown(false);
            listen();
          },
          onToggle: () => {
            if (dictation.state === 'idle' && !noticeRead()) {
              setNoticeShown(true);
              return;
            }
            listen();
          },
        };
  // Leaving the panel while listening: stopped, and what was heard is thrown away.
  const cancelDictation = dictation.cancel;
  useEffect(() => {
    if (!visible) cancelDictation();
  }, [visible, cancelDictation]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // Escape while a reply is being read stops the reading; the panel stays.
    if (event.key === 'Escape' && speech.speaking !== null) {
      event.stopPropagation();
      event.preventDefault();
      speech.stop();
      return;
    }
    // Escape while listening stops and writes down; the panel stays.
    if (event.key === 'Escape' && dictation.state === 'listening') {
      event.stopPropagation();
      event.preventDefault();
      dictation.toggle();
      return;
    }
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
    unavailable ||
    conversation.phase !== 'ready' ||
    conversation.usedUpUntil !== null ||
    conversation.closedElsewhere ||
    conversation.asking ||
    pageDialogOpen;

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
      canStartNew={conversation.sessionId !== null && !working && !conversation.asking}
      loading={conversation.phase === 'loading'}
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
      {unavailable || copy.actions.length === 0 || canWrite ? null : (
        // A fact about this person's role on this page: they draft and preview here, and do not save.
        <ReadOnlyBar />
      )}
      {conversation.usedUpUntil === null ? null : <AllowanceBar resetsAt={conversation.usedUpUntil} />}
        </>
      }
      busyElsewhere={conversation.busyElsewhere}
      chip={chip}
      onDismissChip={() => setDismissedView(viewKey)}
      followups={newestDraft === null ? [] : newestDraft.followups}
      input={input}
      onInput={(value) => {
        dictation.clearNote();
        setInput(value);
      }}
      onSubmit={(text) => {
        dictation.clearNote();
        // A new message stops what was being read.
        speech.stop();
        submit(text);
      }}
      mic={mic}
      voice={voiceMenu}
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
              starters={conversation.starters}
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
              workTitle={changesOpenRule(turn, pageHost()) ? t('assistant:automation.workTitleChange', 'Changed the open rule') : contextCopy(turn.context, {}, name).workTitle}
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
              {...(canSpeak && turn.status === 'done' && (turn.say ?? '') !== ''
                ? { speech: { speaking: speech.speaking === turn.id, onToggle: () => (speech.speaking === turn.id ? speech.stop() : read(turn)) } }
                : {})}
              picks={picks[turn.id] ?? {}}
              onPick={(groupKey, optionKey) => {
                setPicks((previous) => ({ ...previous, [turn.id]: { ...(previous[turn.id] ?? {}), [groupKey]: optionKey } }));
              }}
              onGo={() => conversation.answer(turn.id, picks[turn.id] ?? {}, askedPage)}
              onRetry={turn.askText === null ? null : () => submit(turn.askText ?? '')}
              renderProposal={(proposal, indent) => {
                // A change to the rule that is open goes into the builder (the card's own "Apply to this rule").
                // Offered beside it, "save as a new rule" would make a second rule of the same thing: not drawn.
                if (changesOpenRule(turn, pageHost()) && proposal.actions.every((action) => action.do === 'doc.save')) return null;
                const home = proposalHome(turn, pages);
                const open = (): void => {
                  if (home === null) return;
                  if (floating) close();
                  void navigate({ to: home.to, ...(home.params === undefined ? {} : { params: home.params }) } as never);
                };
                return (
                  <Speaker spacer={indent} bare>
                    <LiveProposal
                      sessionId={conversation.sessionId}
                      turnId={turn.id}
                      proposal={proposal}
                      name={name}
                      newest={index === turns.length - 1}
                      // Asked away from any page, it belongs to none: it can be used wherever the person is.
                      atHome={turn.context === 'general' || (!turn.on.gone && turn.context === page.context && turn.on.pageId === (page.host.pageId ?? null) && turn.on.documentId === (page.host.documentId ?? null))}
                      homeTitle={turn.on.title ?? contextCopy(turn.context, {}, name).page}
                      onOpenHome={home === null ? null : open}
                      onAsk={submit}
                      blocked={blocked || working}
                      onChanged={() => conversation.loadWhole(turn.id)}
                      onOpenTemplate={(id) => {
                        if (floating) close();
                        void navigate({ to: '/email-templates/$id', params: { id } } as never);
                      }}
                      rtl={document.documentElement.dir === 'rtl'}
                    />
                  </Speaker>
                );
              }}
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
                    {...(canConfigure ? { onOpenSettings: openSettings } : {})}
                    tokensIn={turn.tokensIn}
                    tokensOut={turn.tokensOut}
                    runAction={conversation.runAction}
                    loadWhole={conversation.loadWhole}
                    onOwnDialog={onOwnDialog}
                    onLeave={leave}
                    onOpenAddOn={() => {
                      if (floating) close();
                      void navigate({ to: '/studio/add-ons' });
                    }}
                    // The panel stays open: the conversation goes to Email templates with the person.
                    onOpenEmailTemplates={() => {
                      void navigate({ to: '/email-templates' });
                    }}
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
