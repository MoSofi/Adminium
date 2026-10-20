// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The build page, `/design/$sessionId`: the chat on one side, the app on the
 * other. The chat is drawn from the session's events (read, then followed
 * live), so a reload shows exactly what the stream showed. The person writes
 * at the foot; while a turn runs the send button is a stop. A question card
 * can be answered by its buttons or in the person's own words.
 *
 * The chat starts 380 wide and can be dragged (or moved with the arrow keys)
 * between 340 and 600. As the window narrows it gives that width up by
 * itself, and gets it back when there is room. When the work area's bar at
 * its most folded no longer fits beside the narrowest chat, the two halves
 * become views with a switch between them; the one out of sight is kept at
 * its size, so the preview's frame lives on and can still be looked at.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { AttachTray, SentFiles, useAttach, useReadsImages } from '../parts/attach.js';
import { PickedTray, SentPicked } from '../parts/picked.js';
import { designerApi, designerKeys, sessionQuery, versionsQuery, yourAppsQuery, type DesignerCard, type DesignerEffort, type DesignerPicked, type DesignerVersion, type PicturesApplied, type PicturesMode } from '../api.js';
import { useDesignerModel } from '../models/useModel.js';
import { useModelControl } from '../models/useModelControl.js';
import { BuildComposer } from '../parts/BuildComposer.js';
import {
  DesignerMessage,
  FailedNote,
  LimitNote,
  LookChip,
  NeedsCard,
  PicturesCard,
  StyleChip,
  NotAppliedNote,
  AddOnCard,
  PackageCard,
  RowsCard,
  PersonMessage,
  QuestionCard,
  RemovalCard,
  SavedChip,
  SpendNotice,
  FigmaPausedLine,
  KeepSpotCard,
  AccessChangeCard,
  PictureLines,
  PictureNote,
  PicturesChip,
  SpotsCard,
  StepsBlock,
  StoppedNote,
  UsageLine,
} from '../parts/chat.js';
import { useDesktopVersions, VersionsOfferDialog } from '../parts/DesktopVersions.js';
import { PictureDialog } from '../parts/pictures/PictureDialog.js';
import { TopBar } from '../parts/TopBar.js';
import { DesktopBuildShare } from '../parts/DesktopProject.js';
import { CHAT_WIDTH, FOLDED_NEED_GUESS, views } from './barLevel.js';
import { LeaveGuard } from './LeaveGuard.js';
import { StyleMenu } from './LookMenu.js';
import { SessionMenu } from './SessionMenu.js';
import { looksNow } from './sight.js';
import { SessionTitle } from './SessionTitle.js';
import { playSpendSound } from './spendSound.js';
import { foldTurns, heldBy, isWorking, spendWarnings, waitingCards, type TurnView } from './turns.js';
import { useFollowEnd } from './useFollowEnd.js';
import { useCodeFiles, type CodeLock } from './useCodeFiles.js';
import { useSessionEvents } from './useSessionEvents.js';
import { VIEW_IDS, ViewSwitch, type BuildView } from './ViewSwitch.js';
import { WorkArea } from './WorkArea.js';

export { CHAT_WIDTH } from './barLevel.js';

/** The window's width, kept current. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return width;
}

function errorText(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error);
}

/** A card's answer as it was sent: words, a yes or no, or (the needs card) the ids that were ticked. */
function answerOf(value: unknown): { text?: string; accept?: boolean | string[]; pictures?: PicturesMode } {
  return typeof value === 'object' && value !== null ? (value as { text?: string; accept?: boolean | string[]; pictures?: PicturesMode }) : {};
}

/** The fixed message of "Make them swappable": one turn that puts the app's own pictures in spots. */
const SWAPPABLE_MESSAGE = 'Make the pictures of this app swappable: put each picture its screens import into a picture spot, keeping the picture, its words and its credit.';

export function BuildPage({ sessionId }: { sessionId: string }): ReactNode {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toasts = useAppToasts();
  const session = useQuery(sessionQuery(sessionId));
  const apps = useQuery({ ...yourAppsQuery(), enabled: session.data !== undefined });
  const versions = useQuery({ ...versionsQuery(sessionId), enabled: session.data !== undefined });
  // Inside the desktop app on a computer with no git: versions can be turned on without leaving the page.
  const desktopVersions = useDesktopVersions(() => {
    void queryClient.invalidateQueries({ queryKey: designerKeys.versions(sessionId) });
    toasts.push({ variant: 'success', title: t('designer:versionsOffer.nowOn', 'Versions are on'), description: t('designer:versionsOffer.nowOnNext', 'Your next change is kept as a version.') });
  });
  const [offeringVersions, setOfferingVersions] = useState(false);
  const { events, loaded } = useSessionEvents(sessionId);
  const turns = useMemo(() => foldTurns(events), [events]);
  const working = isWorking(turns);
  /** The folder taken by something done from a page (this one or another): a style change, going back, a hand save. */
  const held = useMemo(() => heldBy(events), [events]);
  const spend = useMemo(() => spendWarnings(turns), [turns]);
  const waiting = waitingCards(turns);
  const question = waiting.find((card): card is Extract<DesignerCard, { type: 'question' }> => card.type === 'question') ?? null;

  const [text, setText] = useState('');
  const [answering, setAnswering] = useState(false);
  /** A message was sent while files hold unsaved text: asked once what to do with them. */
  const [askUnsaved, setAskUnsaved] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  /** The width the person gave the chat; what is drawn may be less while the window is narrow. */
  const [wanted, setWanted] = useState<number>(CHAT_WIDTH.start);
  /** What the work area's bar needs at its most folded: the design's own number until the page has measured its own. */
  const [foldedNeed, setFoldedNeed] = useState<number>(FOLDED_NEED_GUESS);
  const windowWidth = useWindowWidth();
  const wasTwo = useRef(false);
  const layout = views({ window: windowWidth, need: foldedNeed, wanted, two: wasTwo.current });
  wasTwo.current = layout.two;
  const chatWidth = layout.chat;
  const [view, setView] = useState<BuildView>('chat');
  /** Counts the times the page itself opened the Code tab: a save made from the chat that did not go through. */
  const [codeAsked, setCodeAsked] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const follow = useFollowEnd([events.length]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: designerKeys.session(sessionId) });
    void queryClient.invalidateQueries({ queryKey: designerKeys.versions(sessionId) });
    void queryClient.invalidateQueries({ queryKey: designerKeys.apps });
    void queryClient.invalidateQueries({ queryKey: designerKeys.architecture(sessionId) });
    void queryClient.invalidateQueries({ queryKey: designerKeys.files(sessionId) });
    // A turn may have added the phone app, or built it again.
    void queryClient.invalidateQueries({ queryKey: ['designer', 'phone', sessionId] });
    // The preview's list of installed apps: a live `app-changed` can be missed, a turn's end cannot.
    void queryClient.invalidateQueries({ queryKey: ['designer', 'installed'] });
    void queryClient.invalidateQueries({ queryKey: designerKeys.pictures(sessionId) });
  };

  // The app was named mid-turn: its key changed, and the preview, the title and the versions all go by the key.
  // Without this the page keeps the old key until the turn ends, and the preview shows nothing for the whole first build.
  const named = events.filter((event) => event.kind === 'step' && event.tool === 'name_app' && event.state === 'done').length;
  useEffect(() => {
    if (named > 0) refresh();
  }, [named]);

  // A turn that ends, or a version that lands, changes what the top bar and Home show.
  const lastKind = events.at(-1)?.kind;
  useEffect(() => {
    if (lastKind === 'turn-finished' || lastKind === 'version' || lastKind === 'released') refresh();
  }, [events.length, lastKind]);

  // A spending mark passed while the page is open is heard once. One read from the session's file (a reload) is not.
  const heard = useRef({ count: 0, live: false });
  useEffect(() => {
    const fresh = events.slice(heard.current.count);
    // The first read and its `loaded` can land in one render: what came with it is history, not news.
    const news = heard.current.live;
    heard.current = { count: events.length, live: loaded };
    if (news && fresh.some((event) => event.kind === 'spend')) playSpendSound();
  }, [events, loaded]);

  // A card that waits for the person is never left out of sight: it is scrolled to, and focus goes to it
  // (unless they are in the middle of writing a message, which a card must not take from under their hands).
  const waitingId = waiting.at(-1)?.id ?? null;
  useEffect(() => {
    if (waitingId === null) return;
    const card = [...(follow.scroller.current?.querySelectorAll<HTMLElement>('[data-card-id]') ?? [])].find((el) => el.dataset['cardId'] === waitingId);
    if (card === undefined) return;
    follow.reveal(card);
    if (!(document.activeElement === box.current && (box.current?.value ?? '') !== '')) card.focus({ preventScroll: true });
  }, [waitingId, follow.reveal, follow.scroller]);

  const fail = (title: string) => (error: unknown) => toasts.push({ variant: 'error', title, description: errorText(error) });

  const patch = useMutation({
    mutationFn: (change: { title?: string; connectionId?: string; model?: string; effort?: DesignerEffort | null }) => designerApi.patchSession(sessionId, change),
    onSuccess: (reply) => queryClient.setQueryData(designerKeys.session(sessionId), reply),
    onError: fail(t('designer:build.saveFailed', 'The change was not saved')),
  });
  const attach = useAttach({ sessionId, notify: (title) => toasts.push({ variant: 'info', title }) });
  /** The element of the preview the next message is about. */
  const [picked, setPicked] = useState<DesignerPicked | null>(null);
  const start = useMutation({
    // The files go up first; the turn names them. A file the server refuses stops here, with its words, and the message stays in the box.
    mutationFn: async (input: string | { message: string; attachments: readonly string[]; picked?: DesignerPicked | null }) =>
      // A message from the box takes the files waiting with it. One the page sends itself ("Continue.", a retry, a fix) names its own, or none.
      typeof input === 'string'
        ? designerApi.startTurn(sessionId, input, await attach.upload(sessionId), looksNow(), picked)
        : designerApi.startTurn(sessionId, input.message, input.attachments, looksNow(), input.picked ?? null),
    onSuccess: (_reply, input) => {
      if (typeof input !== 'string') {
        follow.pin();
        return;
      }
      setText('');
      attach.clear();
      setPicked(null);
      follow.pin();
    },
    onError: (error) => {
      // The folder is taken by something done from a page (a save, a style change): no fault, said plainly.
      const reason = error instanceof ApiError && typeof error.details === 'object' && error.details !== null ? (error.details as { reason?: unknown }).reason : undefined;
      if (reason === 'DESIGNER_BUSY') toasts.push({ variant: 'info', title: t('designer:code.busy', 'The app is being changed. Try again in a moment.') });
      else fail(t('designer:build.turnFailed', 'The Designer could not start this turn'))(error);
    },
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
  // A new session on the same app: its files are what the model starts from, and this chat stays as it is.
  const newSession = useMutation({
    mutationFn: () => {
      const from = session.data?.session;
      if (from === undefined) throw new Error('no session');
      return designerApi.createSession({ appKey: from.appKey, name: from.title, target: from.target, connectionId: from.connectionId, model: from.model });
    },
    onSuccess: async ({ session: made }) => {
      void queryClient.invalidateQueries({ queryKey: designerKeys.apps });
      setText('');
      await navigate({ to: '/design/$sessionId', params: { sessionId: made.id } });
    },
    onError: fail(t('designer:build.newSessionFailed', 'The new session could not be started')),
  });
  // The styles the menu offers: built in, and the project's own.
  const styles = useQuery({ queryKey: designerKeys.styles, queryFn: designerApi.styles, staleTime: 60_000 });
  // "Change the style": no turn, no model. The server writes it, builds, applies and saves a version.
  const look = useMutation({
    mutationFn: (skill: string) => designerApi.setLook(sessionId, skill),
    onSuccess: (reply) => {
      refresh();
      if (!reply.applied) toasts.push({ variant: 'warning', title: t('designer:style.notApplied', 'The style was written, and the app was not applied. The next turn will say why.') });
    },
    onError: fail(t('designer:style.failed', 'The style could not be changed')),
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

  // The picture dialog: opened from the chip, the spots card or a spot of the preview, and given focus back to what opened it.
  const [pictures, setPictures] = useState<{ open: boolean; spot: string | null; from: HTMLElement | null }>({ open: false, spot: null, from: null });
  const openPictures = (spot: string | null = null): void => setPictures({ open: true, spot, from: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  // Read as soon as the session is: a session on an app that has spots may have no turn yet. One with no app yet has none to read.
  const picturesView = useQuery({ queryKey: designerKeys.pictures(sessionId), queryFn: () => designerApi.pictures(sessionId), enabled: session.data !== undefined, retry: false });
  const undoPictures = useMutation({
    mutationFn: ({ from, to }: { from: number; to: number }) => designerApi.undoPictures(sessionId, from, to),
    onSuccess: (_reply, { to }) => {
      refresh();
      toasts.push({ variant: 'success', title: t('designer:spots.undone', 'Undone: back to {version}.', { version: `v${String(to)}` }) });
    },
    onError: fail(t('designer:spots.undoFailed', 'The pictures could not be undone')),
  });
  const onPicturesApplied = (reply: PicturesApplied): void => {
    refresh();
    if (reply.version === null) return;
    const { n } = reply.version;
    const before = reply.before;
    toasts.push({
      variant: reply.applied ? 'success' : 'warning',
      title: t('designer:spots.savedAs', 'Pictures saved as {version}.', { version: `v${String(n)}` }),
      ...(reply.applied ? {} : { description: t('designer:versions.notApplied', 'They were not applied. The next turn will say why.') }),
      ...(before === null ? {} : { action: { label: t('common.undo', 'Undo'), onAction: () => undoPictures.mutate({ from: n, to: before }) } }),
    });
  };
  const swapping = working && turns.at(-1)?.text === SWAPPABLE_MESSAGE;

  // What keeps the app's files from being changed by hand right now, for the Code tab to say.
  const codeLock: CodeLock = working ? (waiting.length > 0 ? 'waiting' : 'turn') : (held ?? (restore.isPending ? 'restore' : look.isPending ? 'style' : null));
  const versionNow = session.data?.session.version ?? 0;
  const code = useCodeFiles(sessionId, {
    lock: codeLock,
    onNotice: (notice) => toasts.push(notice),
    onPutBack: () => restore.mutateAsync({ n: versionNow, record: false }),
  });
  // The edits the question was about are gone (saved or discarded in the Code tab): the next ones are asked about again.
  const unsaved = code.edited.size;
  useEffect(() => {
    if (unsaved === 0) setAskUnsaved(false);
  }, [unsaved]);

  const model = useDesignerModel(
    session.data === undefined
      ? undefined
      : {
          picked: { connectionId: session.data.session.connectionId, model: session.data.session.model, effort: session.data.session.effort },
          onPick: (next) => patch.mutate({ connectionId: next.connectionId, model: next.model, effort: next.effort ?? null }),
        },
  );
  const readsImages = useReadsImages(model.picked, attach.hasImage);
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
  // The pictures still to fill, for the chip; none for an app that builds its own screens, or one with no pictures at all.
  const shown = picturesView.data;
  const picturesChip =
    shown === undefined || shown.ownBuild || (shown.spots.length === 0 && shown.tables.length === 0 && shown.legacy === 0)
      ? null
      : shown.spots.filter((spot) => spot.thumb === null).length + shown.tables.reduce((sum, table) => sum + table.rows.filter((row) => row.thumb === null).length, 0);
  const busy = start.isPending || answer.isPending || restore.isPending || newSession.isPending || look.isPending || held !== null;
  const appSessions = apps.data?.apps.find((app) => app.key === data?.session.appKey)?.sessions ?? [];
  // A session that has not been used yet is already a new one: another would only be an empty twin.
  const canStartNew = data !== undefined && !working && !busy && turns.length > 0;
  const versionList = versions.data?.versions ?? [];
  const current: DesignerVersion | null = versionList.find((version) => version.current) ?? null;
  const placeholder = question !== null && (answering || question.choices.length === 0) ? t('designer:build.answerPlaceholder', 'Answer the question above…') : picked !== null ? t('designer:pick.placeholder', 'Say what to change about this element…') : t('designer:build.placeholder', 'Describe a change…');
  const canSend = model.picked !== null && model.canBuild !== false && !busy && (!working || question !== null);

  const send = (): void => {
    const message = text.trim();
    if (message === '') return;
    if (question !== null) {
      answer.mutate({ cardId: question.id, value: { text: message } });
      return;
    }
    if (working) return;
    // The Designer reads the files as they are on disk: what is typed and not saved is not there.
    if (code.edited.size > 0 && !askUnsaved) {
      setAskUnsaved(true);
      return;
    }
    setAskUnsaved(false);
    start.mutate(message);
  };
  const saveThenSend = (): void => {
    const message = text.trim();
    setAskUnsaved(false);
    void code.save().then((applied) => {
      if (applied) {
        if (message !== '') start.mutate(message);
        return;
      }
      // Not saved, or saved and not applied: the message stays in the box, and the Code tab says why.
      setView('work');
      setCodeAsked((count) => count + 1);
    });
  };

  const onDividerKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const rtl = document.documentElement.dir === 'rtl';
    let delta = 0;
    if (event.key === 'ArrowRight') delta = rtl ? -CHAT_WIDTH.step : CHAT_WIDTH.step;
    if (event.key === 'ArrowLeft') delta = rtl ? CHAT_WIDTH.step : -CHAT_WIDTH.step;
    if (delta === 0) return;
    event.preventDefault();
    // From the width as it is drawn, and no further than there is room for now.
    setWanted(Math.max(CHAT_WIDTH.min, Math.min(layout.most, chatWidth + delta)));
  };
  const onDividerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const rtl = document.documentElement.dir === 'rtl';
    const startX = event.clientX;
    const startWidth = chatWidth;
    const most = layout.most;
    const move = (moved: globalThis.PointerEvent): void => {
      const dx = moved.clientX - startX;
      setWanted(Math.round(Math.max(CHAT_WIDTH.min, Math.min(most, startWidth + (rtl ? -dx : dx)))));
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
        <SentFiles sessionId={sessionId} files={turn.attachments} />
        <SentPicked picked={turn.picked} />
        <DesignerMessage text={turn.reply} streaming={live}>
          <PictureNote lines={turn.pictures} />
          <StepsBlock rows={turn.steps} stepCount={turn.stepCount} live={live} ms={ms} open={isOpen} onToggle={() => setOpen((map) => ({ ...map, [turn.turn]: !isOpen }))} />
          <FigmaPausedLine rows={turn.steps} />
          {live && turn.usage !== null ? <UsageLine step={turn.usage.step} tokens={turn.usage.tokens} /> : null}
          {turn.cards.map(({ card, answered, answer: given }) => {
            const said = answerOf(given);
            const yes = typeof said.accept === 'boolean' ? said.accept : undefined;
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
            if (card.type === 'needs') {
              return (
                <NeedsCard
                  key={card.id}
                  card={card}
                  answered={answered}
                  closed={!live}
                  accepted={Array.isArray(said.accept) ? said.accept : undefined}
                  answeredPictures={said.pictures}
                  busy={busy}
                  onSend={(ids, chosen) => answer.mutate({ cardId: card.id, value: { accept: ids, ...(chosen === undefined ? {} : { pictures: chosen }) } })}
                />
              );
            }
            if (card.type === 'spots') {
              // Answered by an Apply: what the dialog changed from this turn on.
              const chosen = [...new Set(turns.filter((one) => one.turn >= turn.turn).flatMap((one) => one.pictures.flatMap((line) => (line.kind === 'applied' ? line.names : []))))];
              return <SpotsCard key={card.id} card={card} chosen={chosen} onChoose={() => openPictures(card.spots[0]?.id ?? null)} />;
            }
            if (card.type === 'access-change') {
              return (
                <AccessChangeCard
                  key={card.id}
                  card={card}
                  answered={answered}
                  closed={!live}
                  allowed={yes}
                  busy={busy}
                  onAllow={() => answer.mutate({ cardId: card.id, value: { accept: true } })}
                  onRefuse={() => answer.mutate({ cardId: card.id, value: { accept: false } })}
                />
              );
            }
            if (card.type === 'keep-spot') {
              return (
                <KeepSpotCard
                  key={card.id}
                  card={card}
                  answered={answered}
                  closed={!live}
                  kept={yes}
                  busy={busy}
                  onKeep={() => answer.mutate({ cardId: card.id, value: { accept: true } })}
                  onLetGo={() => answer.mutate({ cardId: card.id, value: { accept: false } })}
                />
              );
            }
            if (card.type === 'pictures') {
              return <PicturesCard key={card.id} card={card} answered={answered} accepted={Array.isArray(said.accept) ? said.accept : undefined} />;
            }
            if (card.type === 'package') {
              return (
                <PackageCard
                  key={card.id}
                  card={card}
                  answered={answered}
                  closed={!live}
                  accepted={yes}
                  busy={busy}
                  onAdd={() => answer.mutate({ cardId: card.id, value: { accept: true } })}
                  onSkip={() => answer.mutate({ cardId: card.id, value: { accept: false } })}
                />
              );
            }
            if (card.type === 'add-on') {
              return (
                <AddOnCard
                  key={card.id}
                  card={card}
                  answered={answered}
                  closed={!live}
                  accepted={yes}
                  busy={busy}
                  onGet={() => answer.mutate({ cardId: card.id, value: { accept: true } })}
                  onSkip={() => answer.mutate({ cardId: card.id, value: { accept: false } })}
                />
              );
            }
            if (card.type === 'rows') {
              return (
                <RowsCard
                  key={card.id}
                  card={card}
                  answered={answered}
                  closed={!live}
                  accepted={yes}
                  busy={busy}
                  onLoad={() => answer.mutate({ cardId: card.id, value: { accept: true } })}
                  onSkip={() => answer.mutate({ cardId: card.id, value: { accept: false } })}
                />
              );
            }
            // A card this page does not know (a newer server's) draws nothing: never another card's buttons.
            if (card.type !== 'removal') return null;
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
              onContinue={actionable ? () => start.mutate({ message: t('designer:turn.continueMessage', 'Continue.'), attachments: [] }) : undefined}
              onPutBack={actionable && turn.changedFiles ? () => restore.mutate({ n: data?.session.version ?? 0, record: false }) : undefined}
            />
          ) : null}
          {turn.outcome === 'limit' && turn.limit !== null ? (
            <LimitNote
              which={turn.limit.which}
              value={turn.limit.value}
              version={turn.version?.name ?? null}
              busy={busy}
              onKeepGoing={actionable && turn.limit.which !== 'session-tokens' ? () => start.mutate({ message: t('designer:turn.keepGoingMessage', 'Keep going.'), attachments: [] }) : undefined}
            />
          ) : null}
          {turn.outcome === 'failed' && turn.error !== null ? (
            <FailedNote error={turn.error} busy={busy} onRetry={actionable && turn.text !== null ? () => start.mutate({ message: turn.text ?? '', attachments: turn.attachments.map((file) => file.id), picked: turn.picked }) : undefined} />
          ) : null}
          {turn.look === null ? null : <LookChip direction={turn.look} />}
          {/* One row under the reply: what it was saved as, then the way to change the style. What the style was changed to comes after it. */}
          {turn.version === null && !(last && !live && data?.look != null) && !(last && !live && picturesChip !== null) ? null : (
            <div data-part="saved-row" className="flex flex-wrap items-center gap-1.5">
              {turn.version === null ? null : <SavedChip name={turn.version.name} />}
              {last && !live && data?.look != null ? <StyleMenu current={data.look} styles={styles.data?.styles ?? []} pending={look.isPending} disabled={working || (busy && !look.isPending)} onPick={(skill) => look.mutate(skill)} /> : null}
              {last && !live && picturesChip !== null ? <PicturesChip toFill={picturesChip} onOpen={() => openPictures()} /> : null}
            </div>
          )}
          {turn.style === null ? null : <StyleChip title={turn.style.title} fontsLater={turn.style.fonts.length > 0} />}
        </DesignerMessage>
        <PictureLines lines={turn.pictures} />
      </div>
    );
  };

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      {desktopVersions === null ? null : <VersionsOfferDialog versions={desktopVersions} open={offeringVersions} onOpenChange={setOfferingVersions} />}
      {data === undefined ? null : (
        <PictureDialog
          sessionId={sessionId}
          open={pictures.open}
          onOpenChange={(next) => setPictures((before) => ({ ...before, open: next }))}
          appName={data.session.title}
          spot={pictures.spot}
          working={working || (held !== null && held !== 'pictures')}
          onApplied={onPicturesApplied}
          onSwappable={() => {
            setPictures((before) => ({ ...before, open: false }));
            start.mutate({ message: SWAPPABLE_MESSAGE, attachments: [] });
          }}
          swapping={swapping}
          returnFocus={() => pictures.from?.focus()}
        />
      )}
      <TopBar
        build
        middle={
          data === undefined ? null : (
            <SessionTitle
              title={data.session.title}
              onRename={(title) => patch.mutate({ title }, { onSuccess: () => toasts.push({ variant: 'success', title: t('designer:build.renamed', 'Renamed to {name}', { name: title }) }) })}
              versions={versionList}
              available={versions.data?.available ?? true}
              current={current}
              busy={busy || working}
              onGoBack={(version) => restore.mutate({ n: version.n, record: true })}
              onTurnVersionsOn={desktopVersions === null || desktopVersions.state.on ? undefined : () => setOfferingVersions(true)}
            />
          )
        }
        end={
          <>
            {data === undefined ? null : (
              <SessionMenu
                sessions={appSessions}
                currentId={sessionId}
                disabled={!canStartNew}
                why={working ? t('designer:build.newSessionWorking', 'The Designer is working. Stop it, or wait for it to finish, before starting a new session.') : undefined}
                onNew={() => newSession.mutate()}
                onOpen={(id) => void navigate({ to: '/design/$sessionId', params: { sessionId: id } })}
              />
            )}
            <DesktopBuildShare />
            <a
              href="/"
              aria-label={t('designer:build.openDash', 'Open Dashboard')}
              className="inline-flex h-[34px] min-w-[34px] shrink-0 items-center justify-center gap-[7px] whitespace-nowrap rounded-[10px] border border-border-strong bg-surface text-[13px] font-bold leading-[normal] text-fg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent min-[900px]:px-[11px]"
            >
              <ExternalLink aria-hidden="true" className="size-[15px] rtl:-scale-x-100" />
              <span className="hidden min-[900px]:inline">{t('designer:build.openDash', 'Open Dashboard')}</span>
            </a>
          </>
        }
      />

      <LeaveGuard count={code.edited.size} />

      {layout.two ? <ViewSwitch view={view} onView={setView} chatWaiting={waiting.length > 0} /> : null}

      <div className="relative flex min-h-0 flex-1">
        {/* In two views the one out of sight keeps its size and is out of reach: hidden, never taken out of the layout. */}
        <aside
          {...(layout.two ? { id: VIEW_IDS.chat.panel, role: 'tabpanel', 'aria-labelledby': VIEW_IDS.chat.tab } : { 'aria-label': t('designer:build.chat', 'Chat') })}
          inert={layout.two && view !== 'chat'}
          style={{ '--designer-chat-w': `${String(chatWidth)}px` }}
          className={
            layout.two
              ? `absolute inset-0 mx-auto flex w-full min-w-0 max-w-[680px] flex-col bg-surface ${view === 'chat' ? '' : 'invisible'}`
              : 'flex w-[var(--designer-chat-w)] min-w-0 shrink-0 flex-col border-e border-border bg-surface'
          }
        >
          {/* `relative`: a word hidden for screen readers (a running step's "(running)") is placed absolutely. With no positioned ancestor it sat at its place in the whole chat's length, far below the window, and the page itself scrolled to empty space. */}
          <div ref={follow.scroller} onScroll={follow.onScroll} aria-busy={!loaded} className="nb-scroll relative min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-[22px] [overflow-anchor:none]">
            <div ref={follow.content} className="flex flex-col gap-5">
              {turns.map((turn, index) => turnBlock(turn, index === turns.length - 1))}
              {loaded && turns.length === 0 ? (
                <p className="m-0 text-pretty text-center text-[13px] leading-normal text-fg-muted">
                  {data !== undefined && !data.session.createdApp && appSessions.length > 1
                    ? t('designer:build.emptyNew', 'A new session on {name}. The Designer starts from the app’s files as they are now; the earlier chats are kept under “Sessions on this app”, at the top.', { name: data.session.title })
                    : t('designer:build.empty', 'Describe what to build or change, and the Designer starts.')}
                </p>
              ) : null}
            </div>
          </div>
          <SpendNotice warnings={spend} onNewSession={canStartNew ? () => newSession.mutate() : undefined} />
          {askUnsaved && code.edited.size > 0 ? (
            <div role="group" aria-label={t('designer:code.unsaved', 'Unsaved changes')} className="mx-3.5 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[12px] border border-border bg-surface-2 px-3 py-2.5 text-[12.5px] font-semibold leading-[1.45] text-fg-muted">
              <span className="min-w-0 flex-1 basis-[200px]">{t('designer:code.composerUnsaved', 'You have unsaved changes in {count, plural, one {# file} other {# files}}. The Designer will not see them.', { count: code.edited.size })}</span>
              <button type="button" onClick={saveThenSend} disabled={!code.canSave} className="rounded-[8px] border border-border-strong bg-surface px-2.5 py-1 text-[12px] font-bold text-fg hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45">
                {t('designer:code.saveFirst', 'Save first')}
              </button>
              <button type="button" onClick={send} className="rounded-[8px] px-2.5 py-1 text-[12px] font-bold text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
                {t('designer:code.sendAnyway', 'Send anyway')}
              </button>
            </div>
          ) : null}
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
            attach={question === null && !start.isPending ? attach : undefined}
            tray={
              question === null ? (
                <>
                  <PickedTray picked={picked} onRemove={() => setPicked(null)} />
                  <AttachTray state={attach} modelName={model.picked?.model ?? null} readsImages={readsImages} />
                </>
              ) : null
            }
          />
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('designer:build.resize', 'Resize the chat')}
          aria-valuemin={CHAT_WIDTH.min}
          aria-valuemax={layout.most}
          aria-valuenow={chatWidth}
          tabIndex={0}
          onKeyDown={onDividerKey}
          onPointerDown={onDividerDown}
          hidden={layout.two}
          className={`relative z-[5] -mx-1 w-[9px] shrink-0 cursor-col-resize touch-none justify-center focus-visible:outline-2 focus-visible:outline-accent ${layout.two ? 'hidden' : 'flex'}`}
        >
          <span aria-hidden="true" className="h-full w-px bg-border" />
        </div>
        <section
          {...(layout.two ? { id: VIEW_IDS.work.panel, role: 'tabpanel', 'aria-labelledby': VIEW_IDS.work.tab } : { 'aria-label': t('designer:build.workArea', 'Work area') })}
          inert={layout.two && view !== 'work'}
          className={layout.two ? `absolute inset-0 flex min-w-0 flex-col bg-bg ${view === 'work' ? '' : 'invisible'}` : 'flex min-w-0 flex-1 flex-col bg-bg'}
        >
          {data === undefined ? null : (
            <WorkArea
              session={data.session}
              turns={turns}
              code={code}
              codeAsked={codeAsked}
              onFix={(message) => (working || busy ? undefined : start.mutate({ message, attachments: [] }))}
              onNotice={(title, more) => toasts.push({ variant: 'info', title, ...(more === undefined ? {} : { description: more }) })}
              onFoldedNeed={setFoldedNeed}
              spots={shown === undefined || shown.ownBuild ? undefined : shown.spots}
              onSpot={(spot) => openPictures(spot)}
              onPicked={(element) => {
                // The chip is in the chat, and so is where the person says what to change: both are brought to them.
                setPicked(element);
                setView('chat');
                window.setTimeout(() => box.current?.focus(), 0);
              }}
              onShot={(file) => {
                // It waits with the message like any file a person attaches, and they say what is wrong in it.
                attach.add([file]);
                setView('chat');
                window.setTimeout(() => box.current?.focus(), 0);
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}
