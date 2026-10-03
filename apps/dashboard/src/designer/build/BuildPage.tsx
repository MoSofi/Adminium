// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The build page, `/design/$sessionId`: the chat on one side, the app on the
 * other. The chat is drawn from the session's events (read, then followed
 * live), so a reload shows exactly what the stream showed. The person writes
 * at the foot; while a turn runs the send button is a stop. A question card
 * can be answered by its buttons or in the person's own words.
 *
 * The chat is 420 wide and can be dragged (or moved with the arrow keys)
 * between 340 and 600. On a phone the two halves are tabs.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Eye, MessageSquare } from 'lucide-react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { designerApi, designerKeys, sessionQuery, versionsQuery, type DesignerCard, type DesignerVersion } from '../api.js';
import { useDesignerModel } from '../models/useModel.js';
import { useModelControl } from '../models/useModelControl.js';
import { BuildComposer } from '../parts/BuildComposer.js';
import {
  DesignerMessage,
  FailedNote,
  LimitNote,
  NotAppliedNote,
  PackageCard,
  PersonMessage,
  QuestionCard,
  RemovalCard,
  SavedChip,
  StepsBlock,
  StoppedNote,
  UsageLine,
} from '../parts/chat.js';
import { TopBar } from '../parts/TopBar.js';
import { SessionTitle } from './SessionTitle.js';
import { foldTurns, isWorking, waitingCards, type TurnView } from './turns.js';
import { useSessionEvents } from './useSessionEvents.js';
import { WorkArea } from './WorkArea.js';

export const CHAT_WIDTH = { min: 340, max: 600, start: 420, step: 20 } as const;

function errorText(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error);
}

function answerOf(value: unknown): { text?: string; accept?: boolean } {
  return typeof value === 'object' && value !== null ? (value as { text?: string; accept?: boolean }) : {};
}

export function BuildPage({ sessionId }: { sessionId: string }): ReactNode {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const session = useQuery(sessionQuery(sessionId));
  const versions = useQuery({ ...versionsQuery(sessionId), enabled: session.data !== undefined });
  const { events, loaded } = useSessionEvents(sessionId);
  const turns = useMemo(() => foldTurns(events), [events]);
  const working = isWorking(turns);
  const waiting = waitingCards(turns);
  const question = waiting.find((card): card is Extract<DesignerCard, { type: 'question' }> => card.type === 'question') ?? null;

  const [text, setText] = useState('');
  const [answering, setAnswering] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [chatWidth, setChatWidth] = useState<number>(CHAT_WIDTH.start);
  const [tab, setTab] = useState<'chat' | 'preview'>('chat');
  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: designerKeys.session(sessionId) });
    void queryClient.invalidateQueries({ queryKey: designerKeys.versions(sessionId) });
    void queryClient.invalidateQueries({ queryKey: designerKeys.apps });
    void queryClient.invalidateQueries({ queryKey: designerKeys.architecture(sessionId) });
    // The preview's list of installed apps: a live `app-changed` can be missed, a turn's end cannot.
    void queryClient.invalidateQueries({ queryKey: ['designer', 'installed'] });
  };

  // A turn that ends, or a version that lands, changes what the top bar and Home show.
  const lastKind = events.at(-1)?.kind;
  useEffect(() => {
    if (lastKind === 'turn-finished' || lastKind === 'version') refresh();
  }, [events.length, lastKind]);

  // Follow the end of the chat unless the person scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const fail = (title: string) => (error: unknown) => toasts.push({ variant: 'error', title, description: errorText(error) });

  const patch = useMutation({
    mutationFn: (change: { title?: string; connectionId?: string; model?: string }) => designerApi.patchSession(sessionId, change),
    onSuccess: (reply) => queryClient.setQueryData(designerKeys.session(sessionId), reply),
    onError: fail(t('designer:build.saveFailed', 'The change was not saved')),
  });
  const start = useMutation({
    mutationFn: (message: string) => designerApi.startTurn(sessionId, message),
    onSuccess: () => {
      setText('');
      pinned.current = true;
    },
    onError: fail(t('designer:build.turnFailed', 'The Designer could not start this turn')),
  });
  const stop = useMutation({ mutationFn: () => designerApi.stop(sessionId), onError: fail(t('designer:build.stopFailed', 'The turn could not be stopped')) });
  const answer = useMutation({
    mutationFn: ({ cardId, value }: { cardId: string; value: unknown }) => designerApi.answer(sessionId, cardId, value),
    onSuccess: (_reply, { value }) => {
      if (answerOf(value).text !== undefined) setText('');
      setAnswering(false);
    },
    onError: fail(t('designer:build.answerFailed', 'The answer was not taken')),
  });
  const restore = useMutation({
    mutationFn: ({ n, record }: { n: number; record: boolean }) => designerApi.restore(sessionId, n, record),
    onSuccess: (reply, { n, record }) => {
      refresh();
      toasts.push({
        variant: reply.applied ? 'success' : 'warning',
        title: record
          ? t('designer:versions.wentBack', 'Your files are as they were in {version}.', { version: `v${String(n)}` })
          : t('designer:turn.putBackDone', 'The files are back as they were.'),
        ...(reply.applied ? {} : { description: t('designer:versions.notApplied', 'They were not applied. The next turn will say why.') }),
      });
    },
    onError: fail(t('designer:versions.failed', 'The files could not be put back')),
  });

  const model = useDesignerModel(
    session.data === undefined
      ? undefined
      : {
          picked: { connectionId: session.data.session.connectionId, model: session.data.session.model },
          onPick: (next) => patch.mutate({ connectionId: next.connectionId, model: next.model }),
        },
  );
  const control = useModelControl(model);

  if (session.isError) {
    return (
      <div className="min-h-dvh bg-bg text-fg">
        <TopBar dashboardLink />
        <main className="mx-auto flex max-w-[520px] flex-col items-center gap-3 px-4 py-24 text-center">
          <h1 className="m-0 text-xl font-extrabold">{t('designer:build.missing', 'This session is not here')}</h1>
          <p className="m-0 text-sm text-fg-muted">{t('designer:build.missingBody', 'It may belong to another project folder.')}</p>
          <Link to="/design" className="text-sm font-bold text-accent hover:underline">
            {t('designer:build.home', 'Back to the Designer')}
          </Link>
        </main>
      </div>
    );
  }

  const data = session.data;
  const busy = start.isPending || answer.isPending || restore.isPending;
  const versionList = versions.data?.versions ?? [];
  const current: DesignerVersion | null = versionList.find((version) => version.current) ?? null;
  const placeholder = question !== null && (answering || question.choices.length === 0) ? t('designer:build.answerPlaceholder', 'Answer the question above…') : t('designer:build.placeholder', 'Describe a change…');
  const canSend = model.picked !== null && model.canBuild !== false && !busy && (!working || question !== null);

  const send = (): void => {
    const message = text.trim();
    if (message === '') return;
    if (question !== null) {
      answer.mutate({ cardId: question.id, value: { text: message } });
      return;
    }
    if (!working) start.mutate(message);
  };

  const onDividerKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const rtl = document.documentElement.dir === 'rtl';
    let delta = 0;
    if (event.key === 'ArrowRight') delta = rtl ? -CHAT_WIDTH.step : CHAT_WIDTH.step;
    if (event.key === 'ArrowLeft') delta = rtl ? CHAT_WIDTH.step : -CHAT_WIDTH.step;
    if (delta === 0) return;
    event.preventDefault();
    setChatWidth((width) => Math.max(CHAT_WIDTH.min, Math.min(CHAT_WIDTH.max, width + delta)));
  };
  const onDividerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const rtl = document.documentElement.dir === 'rtl';
    const startX = event.clientX;
    const startWidth = chatWidth;
    const move = (moved: globalThis.PointerEvent): void => {
      const dx = moved.clientX - startX;
      setChatWidth(Math.round(Math.max(CHAT_WIDTH.min, Math.min(CHAT_WIDTH.max, startWidth + (rtl ? -dx : dx)))));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const turnBlock = (turn: TurnView, last: boolean): ReactNode => {
    const live = turn.outcome === null;
    const isOpen = open[turn.turn] ?? live;
    const ms = turn.finishedAt === null ? null : turn.finishedAt - turn.startedAt;
    const actionable = last && !working && !busy;
    return (
      <div key={turn.turn} className="flex flex-col gap-5">
        {turn.text === null ? null : <PersonMessage text={turn.text} />}
        <DesignerMessage text={turn.reply} streaming={live}>
          <StepsBlock rows={turn.steps} stepCount={turn.stepCount} live={live} ms={ms} open={isOpen} onToggle={() => setOpen((map) => ({ ...map, [turn.turn]: !isOpen }))} />
          {live && turn.usage !== null ? <UsageLine step={turn.usage.step} tokens={turn.usage.tokens} /> : null}
          {turn.cards.map(({ card, answered, answer: given }) => {
            const said = answerOf(given);
            if (card.type === 'question') {
              return (
                <QuestionCard
                  key={card.id}
                  card={card}
                  answered={answered || !live}
                  answer={said.text}
                  busy={busy}
                  onChoose={(choice) => answer.mutate({ cardId: card.id, value: { text: choice } })}
                  onOwnWords={() => {
                    setAnswering(true);
                    box.current?.focus();
                  }}
                />
              );
            }
            if (card.type === 'package') {
              return (
                <PackageCard
                  key={card.id}
                  card={card}
                  answered={answered}
                  closed={!live}
                  accepted={said.accept}
                  busy={busy}
                  onAdd={() => answer.mutate({ cardId: card.id, value: { accept: true } })}
                  onSkip={() => answer.mutate({ cardId: card.id, value: { accept: false } })}
                />
              );
            }
            return (
              <RemovalCard
                key={card.id}
                card={card}
                answered={answered}
                closed={!live}
                kept={said.accept === false}
                busy={busy}
                onKeep={() => answer.mutate({ cardId: card.id, value: { accept: false } })}
                onRemove={() => answer.mutate({ cardId: card.id, value: { accept: true } })}
              />
            );
          })}
          {turn.outcome === 'not-applied' && turn.notApplied !== null ? <NotAppliedNote message={turn.notApplied} /> : null}
          {turn.outcome === 'stopped' ? (
            <StoppedNote
              busy={busy}
              onContinue={actionable ? () => start.mutate(t('designer:turn.continueMessage', 'Continue.')) : undefined}
              onPutBack={actionable && turn.changedFiles ? () => restore.mutate({ n: data?.session.version ?? 0, record: false }) : undefined}
            />
          ) : null}
          {turn.outcome === 'limit' && turn.limit !== null ? (
            <LimitNote
              which={turn.limit.which}
              value={turn.limit.value}
              version={turn.version?.name ?? null}
              busy={busy}
              onKeepGoing={actionable && turn.limit.which !== 'session-tokens' ? () => start.mutate(t('designer:turn.keepGoingMessage', 'Keep going.')) : undefined}
            />
          ) : null}
          {turn.outcome === 'failed' && turn.error !== null ? (
            <FailedNote error={turn.error} busy={busy} onRetry={actionable && turn.text !== null ? () => start.mutate(turn.text ?? '') : undefined} />
          ) : null}
          {turn.version === null ? null : <SavedChip name={turn.version.name} />}
        </DesignerMessage>
      </div>
    );
  };

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <TopBar
        middle={
          data === undefined ? null : (
            <SessionTitle
              title={data.session.title}
              onRename={(title) => patch.mutate({ title })}
              versions={versionList}
              available={versions.data?.available ?? true}
              current={current}
              busy={busy || working}
              onGoBack={(version) => restore.mutate({ n: version.n, record: true })}
            />
          )
        }
        end={
          <a
            href="/"
            className="inline-flex items-center gap-[7px] rounded-[10px] px-[11px] py-2 text-[13px] font-bold text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label={t('designer:build.openDashboard', 'Open in the dashboard')}
          >
            <ExternalLink aria-hidden="true" className="size-4" />
            <span className="hidden lg:inline">{t('designer:build.openDashboard', 'Open in the dashboard')}</span>
          </a>
        }
      />

      <div role="tablist" aria-label={t('designer:build.halves', 'Chat and preview')} className="flex shrink-0 gap-1 border-b border-border bg-surface px-3 py-1.5 md:hidden">
        {(['chat', 'preview'] as const).map((which) => (
          <button
            key={which}
            type="button"
            role="tab"
            aria-selected={tab === which}
            onClick={() => setTab(which)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-bold text-fg-muted aria-selected:bg-surface-2 aria-selected:text-fg"
          >
            {which === 'chat' ? <MessageSquare aria-hidden="true" className="size-[15px]" /> : <Eye aria-hidden="true" className="size-[15px]" />}
            {which === 'chat' ? t('designer:build.chat', 'Chat') : t('designer:build.preview', 'Preview')}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label={t('designer:build.chat', 'Chat')}
          style={{ '--designer-chat-w': `${String(chatWidth)}px` }}
          className={`flex min-w-0 flex-col border-border bg-surface max-md:w-full md:w-[var(--designer-chat-w)] md:shrink-0 md:border-e ${tab === 'chat' ? '' : 'max-md:hidden'}`}
        >
          <div
            ref={scroller}
            onScroll={(event) => {
              const el = event.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            aria-busy={!loaded}
            className="nb-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-3 pt-[22px]"
          >
            {turns.map((turn, index) => turnBlock(turn, index === turns.length - 1))}
            {loaded && turns.length === 0 ? <p className="m-0 text-center text-[13px] text-fg-muted">{t('designer:build.empty', 'Describe what to build or change, and the Designer starts.')}</p> : null}
          </div>
          <BuildComposer
            value={text}
            onChange={setText}
            onSend={send}
            onStop={() => stop.mutate()}
            working={working && question === null}
            canSend={canSend}
            placeholder={placeholder}
            model={control.element}
            inputRef={box}
          />
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('designer:build.resize', 'Resize the chat')}
          aria-valuemin={CHAT_WIDTH.min}
          aria-valuemax={CHAT_WIDTH.max}
          aria-valuenow={chatWidth}
          tabIndex={0}
          onKeyDown={onDividerKey}
          onPointerDown={onDividerDown}
          className="relative z-[5] -mx-1 hidden w-[9px] shrink-0 cursor-col-resize touch-none justify-center focus-visible:outline-2 focus-visible:outline-accent md:flex"
        >
          <span aria-hidden="true" className="h-full w-px bg-border" />
        </div>
        <section aria-label={t('designer:build.work', 'The app')} className={`min-w-0 flex-1 flex-col ${tab === 'preview' ? 'flex' : 'max-md:hidden md:flex'}`}>
          {data === undefined ? null : <WorkArea session={data.session} turns={turns} onFix={(message) => (working ? undefined : start.mutate(message))} />}
        </section>
      </div>
    </div>
  );
}
