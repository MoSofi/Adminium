// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Texts → Conversations: one thread per phone number and app, the messages
 * in it, and the answer box.
 *
 * WHO. The console-wide keys (`texts.read`, `texts.reply`, through
 * `holdsSystemAction`) open every conversation; an app role's
 * `texts:<app>:read|reply` (the bootstrap's `textApps`) opens that app's
 * alone. The server judges every request again and writes an audit row for
 * every read and answer, which the page says plainly.
 *
 * WHAT A THREAD SHOWS. A customer's words and staff answers as bubbles, each
 * taking the direction of its own words, so an Arabic message reads right to
 * left on an English console and the other way round. A text an app sent is
 * shown by its app and template alone: its words are never kept. STOP and
 * START are lines of their own, with whether the one confirmation went.
 *
 * LIVE. A notice on `texts` (or `texts:<app>`) says only that some thread
 * changed. The page reads the list again on every notice and every time its
 * connection opens, because a notice sent while it was away reaches nobody,
 * and the list would otherwise stay wrong until a reload.
 */
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCheck, ExternalLink, MessageSquareText, MessagesSquare, Send, Settings2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, EmptyState, Select, Skeleton, Switch, Textarea } from '@adminium/ui';

import { appSectionsOf, bootstrapQuery, slugForTable, type BootstrapData } from '../../app/bootstrap.js';
import { hrefForRecord } from '../../app/links.js';
import { createRealtimeClient } from '../../app/ws.js';
import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { blockWords, DELIVERY_TONE, deliveryLabel, failureWords, reachWords, refusedWords } from './conversationWords.js';
import {
  markRead,
  mayAnswer,
  newClientKey,
  olderItems,
  sendReply,
  threadQuery,
  threadsKey,
  threadsQuery,
  type Thread,
  type ThreadDetail,
  type ThreadItem,
  type TextReader,
} from './conversationsApi.js';
import { RepliesByApp } from './RepliesByApp.js';
import { CounterLine } from './TextCounterView.js';
import { ENGLISH_LINE_WORDS, estimateLength, limitsOf } from './textCounter.js';
import { lineWordsQuery } from './textLineWords.js';
import { activeLocale, reasonWords, stamp } from './textsWords.js';

// ─── names ──────────────────────────────────────────────────────────────────

function appNames(bootstrap: BootstrapData): Map<string, string> {
  return new Map(appSectionsOf(bootstrap).map((section) => [section.appKey, section.label] as const));
}

const appName = (names: ReadonlyMap<string, string>, app: string | null): string => (app === null ? t('studio:texts.conv.noApp', 'No app') : (names.get(app) ?? app));

/** The number as this person may see it, always left to right in its own run. */
function PhoneRun({ thread, className = '' }: { thread: Pick<Thread, 'phone' | 'masked'>; className?: string }) {
  return (
    <bdi dir="ltr" className={`font-mono ${className}`}>
      {thread.phone ?? thread.masked ?? '—'}
    </bdi>
  );
}

function When({ at }: { at: number }) {
  return (
    <bdi dir="ltr" className="font-mono text-[11px] text-fg-subtle">
      {stamp(at, activeLocale())}
    </bdi>
  );
}

// ─── live ───────────────────────────────────────────────────────────────────

/** Reads the conversations again on every notice, and on every (re)connect. */
function useLiveThreads(reader: TextReader, openId: string | null): void {
  const client = useQueryClient();
  const open = useRef(openId);
  open.current = openId;
  const channels = useMemo(() => (reader.everything !== null ? ['texts'] : [...reader.apps.keys()].sort().map((app) => `texts:${app}`)), [reader]);
  const joined = channels.join(' ');
  useEffect(() => {
    if (joined === '') return;
    const again = (thread: string | null): void => {
      void client.invalidateQueries({ queryKey: [...threadsKey, 'list'] });
      if (thread === null || thread === open.current) void client.invalidateQueries({ queryKey: [...threadsKey, 'one'] });
    };
    const live = createRealtimeClient({
      channels: joined.split(' '),
      sseEventTypes: ['texts.changed'],
      // A notice missed while the connection was down is never sent again: read everything again on every open.
      onStatusChange: (connected) => {
        if (connected) again(null);
      },
      onEvent: (event) => {
        if (event.type !== 'texts.changed') return;
        const thread = (event.data as { thread?: unknown } | null)?.thread;
        again(typeof thread === 'string' ? thread : null);
      },
    });
    live.start();
    return () => live.stop();
  }, [client, joined]);
}

// ─── the list ───────────────────────────────────────────────────────────────

function ThreadRow({ thread, names, selected, onOpen }: { thread: Thread; names: ReadonlyMap<string, string>; selected: boolean; onOpen: () => void }) {
  const unread = thread.unread > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      data-testid="texts-thread-row"
      data-thread={thread.id}
      className={`flex w-full flex-col gap-1 border-b border-border px-3.5 py-3 text-start last:border-b-0 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${selected ? 'bg-accent-soft' : ''}`}
    >
      <span className="flex items-center gap-2">
        <PhoneRun thread={thread} className={`min-w-0 truncate text-[12.5px] ${unread ? 'font-semibold' : ''}`} />
        <span className="ms-auto shrink-0">
          <When at={thread.lastAt} />
        </span>
      </span>
      <span className="flex items-center gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate text-fg-muted" dir="auto">
          {thread.preview ?? (thread.lastKind === 'text' || thread.lastDirection === 'out' ? t('studio:texts.conv.lastAutomated', 'An automated text') : '')}
        </span>
        {unread ? (
          <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-[11px] font-semibold text-accent-fg" data-testid="texts-thread-unread">
            <span className="sr-only">{t('studio:texts.conv.unreadCount', '{count, plural, one {# unread message} other {# unread messages}}', { count: thread.unread })}</span>
            <span aria-hidden>{thread.unread}</span>
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{appName(names, thread.app)}</Badge>
        {thread.stopped ? <Badge tone="warn">{t('studio:texts.conv.stoppedBadge', 'Asked to stop')}</Badge> : null}
      </span>
    </button>
  );
}

// ─── one thread ─────────────────────────────────────────────────────────────

function SystemLine({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <li className="mx-auto max-w-[460px] rounded-full border border-border bg-surface-2 px-3.5 py-1.5 text-center text-[12px] text-fg-muted" data-testid={testId}>
      {children}
    </li>
  );
}

function Bubble({ item, names, app }: { item: ThreadItem; names: ReadonlyMap<string, string>; app: string | null }) {
  if (item.kind === 'stop') {
    return (
      <SystemLine testId="texts-item-stop">
        <span className="font-semibold">{t('studio:texts.conv.stopLine', 'Replied STOP. No text from this business goes to this number now.')}</span> <When at={item.at} />
        <span className="block">{item.confirmed === true ? t('studio:texts.conv.stopConfirmed', 'One plain confirmation went out, with no question and no offer.') : t('studio:texts.conv.stopNotConfirmed', 'No confirmation went out.')}</span>
      </SystemLine>
    );
  }
  if (item.kind === 'start') {
    return (
      <SystemLine testId="texts-item-start">
        <span className="font-semibold">{t('studio:texts.conv.startLine', 'Replied START. The provider’s block is lifted, but this is not a yes: they must agree again before any text.')}</span> <When at={item.at} />
      </SystemLine>
    );
  }
  const out = item.direction === 'out';
  return (
    <li className={`flex flex-col gap-1 ${out ? 'items-end' : 'items-start'}`} data-testid={`texts-item-${item.source === 'app' ? 'app' : out ? 'out' : 'in'}`}>
      <div className={`max-w-[min(520px,88%)] rounded-[14px] border px-3.5 py-2.5 text-[13.5px] ${out ? 'rounded-ee-[4px] border-transparent bg-accent-soft' : 'rounded-es-[4px] border-border bg-surface'}`}>
        {item.source === 'app' ? (
          <p className="text-fg-muted" data-testid="texts-item-template">
            {t('studio:texts.conv.appText', 'Automated text from {app}, template {template}. Its words are not kept.', { app: appName(names, app), template: item.template ?? '—' })}
          </p>
        ) : item.kind === 'help' ? (
          <p className="text-fg-muted">{t('studio:texts.conv.helpLine', 'Asked for HELP. The provider answered with your contact details.')}</p>
        ) : (
          <p dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="texts-item-body">
            {item.body}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11.5px] text-fg-muted">
        <When at={item.at} />
        {out && item.by !== null ? <span data-testid="texts-item-by">{t('studio:texts.conv.by', 'Answered by {name}', { name: item.by.label })}</span> : null}
        {item.delivery === null ? null : <Badge tone={DELIVERY_TONE[item.delivery.status]}>{deliveryLabel(item.delivery.status)}</Badge>}
        {item.delivery?.reason != null && (item.delivery.status === 'skipped' || item.delivery.status === 'failed' || item.delivery.status === 'not-sent') ? <span>{reasonWords(item.delivery.reason)}</span> : null}
        {item.refused === null ? null : <span className="text-danger">{refusedWords(item.refused)}</span>}
      </div>
    </li>
  );
}

function ReplyBox({ detail }: { detail: ThreadDetail }) {
  const ids = useId();
  const client = useQueryClient();
  const toasts = useAppToasts();
  const [body, setBody] = useState('');
  // One key per message: a retry after a dropped request sends nothing twice.
  const key = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  // The answer's line is in the business's language, which the thread does not say: the console's language stands in for it.
  const words = useQuery(lineWordsQuery(activeLocale())).data ?? ENGLISH_LINE_WORDS;
  const line = detail.thread.theyCanReply ? words.replyStop : null;
  const estimate = estimateLength(line === null ? body : `${body}${words.gap}${line}`, limitsOf('standard'));
  const send = useMutation({
    mutationFn: () => {
      key.current ??= newClientKey();
      return sendReply(detail.thread.id, body, key.current);
    },
    onSuccess: (sent) => {
      key.current = null;
      void client.invalidateQueries({ queryKey: threadsKey });
      if (sent.result.outcome === 'refused') {
        setOutcome({ tone: 'danger', text: refusedWords(sent.result.reason) });
        return;
      }
      setBody('');
      const words =
        sent.result.outcome === 'held' && sent.result.opensAt !== null
          ? t('studio:texts.conv.held', 'Your answer waits for the sending hours. It goes at {time}.', { time: stamp(sent.result.opensAt, activeLocale()) })
          : t('studio:texts.conv.queued', 'Your answer is queued to go now.');
      setOutcome({ tone: 'info', text: words });
      toasts.push({ variant: 'success', title: words });
    },
    onError: (error) => setOutcome({ tone: 'danger', text: failureWords(error) }),
  });
  const empty = body.trim() === '';
  return (
    <form
      className="flex flex-col gap-2 border-t border-border bg-surface p-3.5"
      data-testid="texts-reply"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty && !estimate.tooLong) send.mutate();
      }}
    >
      <label htmlFor={`${ids}-reply`} className="text-[12px] font-semibold">
        {t('studio:texts.conv.replyLabel', 'Your answer')}
      </label>
      <Textarea
        id={`${ids}-reply`}
        dir="auto"
        rows={3}
        value={body}
        maxLength={1600}
        onChange={(event) => {
          setBody(event.target.value);
          if (outcome?.tone === 'info') setOutcome(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !empty && !estimate.tooLong) {
            event.preventDefault();
            send.mutate();
          }
        }}
        data-testid="texts-reply-body"
      />
      <CounterLine estimate={estimate} testId="texts-reply-counter" />
      <p className="text-[11.5px] text-fg-muted" data-testid="texts-reply-optout">
        {line === null
          ? t('studio:texts.conv.optOutContact', 'A line giving your phone or e-mail for stopping texts is added to the end. Staff record a stop request they get that way.')
          : t('studio:texts.conv.optOutReply', '“{line}” is added to the end, and counts toward the length.', { line })}
        {detail.answering ? ` ${t('studio:texts.conv.answering', 'They wrote in the last 7 days, so an answer needs no yes of its own. A STOP still stops it.')}` : ''}
      </p>
      {outcome === null ? null : (
        <p role="status" className={`text-[12.5px] ${outcome.tone === 'danger' ? 'text-danger' : 'text-fg-muted'}`} data-testid="texts-reply-outcome">
          {outcome.text}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" iconLeft={<Send className="size-4 rtl:-scale-x-100" />} loading={send.isPending} disabled={empty || estimate.tooLong} data-testid="texts-reply-send">
          {t('studio:texts.conv.send', 'Send answer')}
        </Button>
      </div>
    </form>
  );
}

function ThreadPane({ id, names, reader, bootstrap, onBack }: { id: string; names: ReadonlyMap<string, string>; reader: TextReader; bootstrap: BootstrapData; onBack: () => void }) {
  const client = useQueryClient();
  const toasts = useAppToasts();
  const detail = useQuery(threadQuery(id));
  const [older, setOlder] = useState<{ items: ThreadItem[]; next: string | null } | null>(null);
  useEffect(() => setOlder(null), [id]);
  const loadOlder = useMutation({
    mutationFn: (cursor: string) => olderItems(id, cursor),
    onSuccess: (page) => setOlder((held) => ({ items: [...(held?.items ?? []), ...page.items], next: page.next })),
  });
  const read = useMutation({
    mutationFn: () => markRead(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: threadsKey });
      toasts.push({ variant: 'success', title: t('studio:texts.conv.markedRead', 'Marked as read.') });
    },
  });
  if (detail.isError) return <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={failureWords(detail.error)} />;
  if (detail.data === undefined) return <Skeleton className="h-[320px] w-full" />;
  const { thread } = detail.data;
  const items = [...detail.data.items, ...(older?.items ?? [])].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const next = older === null ? detail.data.next : older.next;
  const slug = thread.record === null ? null : slugForTable(bootstrap, thread.record.connectionId, thread.record.table);
  const canAnswer = mayAnswer(reader, thread.app);
  return (
    <section className="flex min-h-[420px] flex-col" aria-labelledby={`thread-${thread.id}`} data-testid="texts-thread">
      <header className="sticky top-0 z-[1] flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-[var(--accent-soft-solid)] px-3.5 py-2.5">
        <Button variant="ghost" size="sm" className="md:hidden" iconLeft={<ArrowLeft className="size-4 rtl:-scale-x-100" />} onClick={onBack} data-testid="texts-thread-back">
          {t('studio:texts.conv.back', 'All conversations')}
        </Button>
        <h3 id={`thread-${thread.id}`} className="text-[14.5px] font-bold">
          <PhoneRun thread={thread} />
        </h3>
        <Badge tone="neutral">{appName(names, thread.app)}</Badge>
        {slug !== null && thread.record !== null ? (
          <a href={hrefForRecord(slug, thread.record.key)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline" data-testid="texts-thread-record">
            {t('studio:texts.conv.openRecord', 'Open the record')}
            <ExternalLink aria-hidden className="size-3.5 rtl:-scale-x-100" />
          </a>
        ) : null}
        {thread.unread > 0 ? (
          <Button variant="secondary" size="sm" className="ms-auto" iconLeft={<CheckCheck className="size-4" />} loading={read.isPending} onClick={() => read.mutate()} data-testid="texts-thread-read">
            {t('studio:texts.conv.markRead', 'Mark as read')}
          </Button>
        ) : thread.readBy !== null && thread.readAt !== null ? (
          <span className="ms-auto text-[11.5px] text-fg-muted" data-testid="texts-thread-read-by">
            {t('studio:texts.conv.readBy', 'Read by {name}', { name: thread.readBy.label })} <When at={thread.readAt} />
          </span>
        ) : null}
      </header>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-border px-3.5 py-2.5 text-[12.5px]" data-testid="texts-thread-standing">
        <dt className="text-fg-subtle">{t('studio:texts.conv.stopState', 'Stop list')}</dt>
        <dd>{thread.stopped ? t('studio:texts.conv.stoppedYes', 'On the do-not-text list. Nothing goes to this number.') : t('studio:texts.conv.stoppedNo', 'Not on the do-not-text list.')}</dd>
        <dt className="text-fg-subtle">{t('studio:texts.conv.consentState', 'Answering')}</dt>
        <dd>{detail.data.answering ? t('studio:texts.conv.answeringYes', 'They wrote in the last 7 days: an answer needs no other yes.') : t('studio:texts.conv.answeringNo', 'An answer needs their yes to texts, as any text does.')}</dd>
        <dt className="text-fg-subtle">{t('studio:texts.conv.replyState', 'Their replies')}</dt>
        <dd>{thread.theyCanReply ? t('studio:texts.conv.canReplyYes', 'They can reply by text.') : t('studio:texts.conv.canReplyNo', 'This person can’t reply by text.')}</dd>
      </dl>
      <ol className="flex flex-1 flex-col gap-3 px-3.5 py-4" aria-label={t('studio:texts.conv.messages', 'Messages')} data-testid="texts-thread-items">
        {next !== null ? (
          <li className="flex justify-center">
            <Button variant="ghost" size="sm" loading={loadOlder.isPending} onClick={() => loadOlder.mutate(next)} data-testid="texts-thread-older">
              {t('studio:texts.conv.older', 'Show earlier messages')}
            </Button>
          </li>
        ) : null}
        {items.map((item) => (
          <Bubble key={item.id} item={item} names={names} app={thread.app} />
        ))}
      </ol>
      {detail.data.canReply.ok && canAnswer ? (
        <ReplyBox detail={detail.data} />
      ) : (
        <p className="border-t border-border bg-surface-2 px-3.5 py-3 text-[13px] text-fg-muted" data-testid="texts-reply-blocked">
          {blockWords(canAnswer ? detail.data.canReply.reason : 'not-allowed')}
          {!thread.theyCanReply && detail.data.canReply.reason !== 'stopped' ? ` ${t('studio:texts.conv.canReplyNo', 'This person can’t reply by text.')}` : ''}
        </p>
      )}
    </section>
  );
}

// ─── the tab ────────────────────────────────────────────────────────────────

export function ConversationsTab({ reader, canManage }: { reader: TextReader; canManage: boolean }): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const names = useMemo(() => appNames(bootstrap), [bootstrap]);
  const [app, setApp] = useState<string>('*');
  const [unread, setUnread] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [switches, setSwitches] = useState(false);
  const reads = reader.everything !== null || reader.apps.size > 0;
  const list = useQuery({ ...threadsQuery({ app: app === '*' ? undefined : app, unread }), enabled: reads });
  useLiveThreads(reader, open);
  const ids = useId();

  const appChoices = reader.everything !== null ? [...names.keys()] : [...reader.apps.keys()];
  const threads = list.data?.threads ?? [];

  const switchesButton = canManage ? (
    <Button variant="secondary" size="sm" iconLeft={<Settings2 className="size-4" />} onClick={() => setSwitches(true)} data-testid="texts-replies-open">
      {t('studio:texts.replies.title', 'Replies by app')}
    </Button>
  ) : null;

  if (!reads) {
    return (
      <div className="flex flex-col gap-3.5" data-testid="texts-conversations">
        <Card data-testid="texts-conv-no-access">
          <p className="text-[13px]">{t('studio:texts.conv.noAccess', 'You can’t read customers’ texts. Whoever runs this server can give you the right, for every app or for one.')}</p>
          {switchesButton === null ? null : <div className="mt-3">{switchesButton}</div>}
        </Card>
        {switches ? <RepliesByApp onClose={() => setSwitches(false)} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5" data-testid="texts-conversations">
      {list.data !== undefined && !list.data.replies.canArrive ? <Alert tone="warn" title={t('studio:texts.conv.reach.title', 'Replies can’t reach this server')} body={reachWords(list.data.replies.state)} data-testid="texts-conv-no-door" /> : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <Select aria-label={t('studio:texts.conv.filterApp', 'App')} value={app} onChange={(event) => setApp(event.target.value)} wrapperClassName="w-auto" className="h-[36px] font-semibold" data-testid="texts-conv-app">
          <option value="*">{t('studio:texts.conv.allApps', 'Every app')}</option>
          {appChoices.map((key) => (
            <option key={key} value={key}>
              {appName(names, key)}
            </option>
          ))}
          {reader.everything !== null ? <option value="">{t('studio:texts.conv.noApp', 'No app')}</option> : null}
        </Select>
        <label htmlFor={`${ids}-unread`} className="inline-flex items-center gap-2 text-[13px] font-semibold">
          <Switch id={`${ids}-unread`} checked={unread} onCheckedChange={setUnread} data-testid="texts-conv-unread" />
          {t('studio:texts.conv.unreadOnly', 'Unread only')}
        </label>
        {list.data !== undefined ? (
          <span className="font-mono text-[12px] text-fg-muted" data-testid="texts-conv-unread-total">
            {t('studio:texts.conv.unreadTotal', '{count, plural, =0 {Nothing unread} one {# unread} other {# unread}}', { count: list.data.unread })}
          </span>
        ) : null}
        <span className="ms-auto">{switchesButton}</span>
      </div>
      <p className="text-[12px] text-fg-muted" data-testid="texts-conv-recorded">
        {t('studio:texts.conv.recorded', 'Reading and replying are recorded.')}
      </p>
      {list.isError ? (
        <Alert tone="danger" role="alert" title={t('studio:texts.loadFailed', 'This could not be loaded')} body={failureWords(list.error)} />
      ) : list.data === undefined ? (
        <Skeleton className="h-[360px] w-full" />
      ) : threads.length === 0 && open === null ? (
        <EmptyState
          icon={<MessagesSquare />}
          title={unread ? t('studio:texts.conv.emptyUnread', 'Nothing unread.') : t('studio:texts.conv.empty', 'No conversations yet.')}
          body={t('studio:texts.conv.emptyBody', 'When a customer answers a text, the conversation shows here. Only apps whose replies are on keep them.')}
          data-testid="texts-conv-empty"
        />
      ) : (
        <div className="grid overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow)] md:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <nav aria-label={t('studio:texts.conv.listLabel', 'Conversations')} className={`max-h-[640px] overflow-y-auto border-border md:border-e ${open === null ? '' : 'hidden md:block'}`} data-testid="texts-thread-list">
            {threads.length === 0 ? <p className="px-3.5 py-4 text-[12.5px] text-fg-muted">{t('studio:texts.conv.noMatch', 'No conversation matches.')}</p> : null}
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} names={names} selected={thread.id === open} onOpen={() => setOpen(thread.id)} />
            ))}
          </nav>
          <div className={open === null ? 'hidden md:block' : ''}>
            {open === null ? (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-fg-muted">
                <MessageSquareText aria-hidden className="size-7 text-fg-subtle" />
                {t('studio:texts.conv.pick', 'Choose a conversation to read it.')}
              </div>
            ) : (
              <ThreadPane id={open} names={names} reader={reader} bootstrap={bootstrap} onBack={() => setOpen(null)} />
            )}
          </div>
        </div>
      )}
      {switches ? <RepliesByApp onClose={() => setSwitches(false)} /> : null}
    </div>
  );
}
