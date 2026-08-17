// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { Button, EmptyState, Spinner } from '@adminium/ui';
import { useMemo, useRef, useState } from 'react';

import {
  detectConversationFields,
  detectConversationFk,
  detectMessageFields,
  displayNameOf,
  filterMessagesRows,
  toChatMessages,
  toConversationRows,
} from './chat-mapping.js';
import { ChatThread } from '../../families/communication/ChatThread.js';
import { ConversationInbox } from '../../families/communication/ConversationInbox.js';
import { chatRowsOf, type ChatMessage } from '../../families/communication/chat-lib.js';
import { WidgetHost, type WidgetDataState } from '../../frame/WidgetHost.js';
import { pageLayoutSchema, queryDescriptorSchema, type PageLayout, type QueryDescriptor } from '../../page-config/index.js';
import type { LayoutItem } from '../../page-config/layout.js';
import type { WidgetEvent } from '../../registry/types.js';
import {
  useDashboardData,
  type DashboardDataAdapter,
  type DashboardDataStates,
} from '../page-dashboard/data-adapter.js';

/**
 * `page-chat` template renderer (09-generated-app.md §7.9; annex §14 — comp:
 * Chat).
 *
 * Renders the stored `config.layout` of a chat archetype page: the required
 * `inbox` slot as a directly-composed `conversation-inbox` over the
 * conversation table (email→name derivation, unread pills, presence), the
 * required `thread` slot as `chat-thread` over the messages child
 * (same-sender bubble runs + day separators come from the widget), and the
 * optional `attachments` / `call` slots via `WidgetHost`.
 *
 * SELECTION → MESSAGES QUERY: picking a conversation raises
 * `onSelectConversation`; the host re-queries the messages binding filtered to
 * that conversation and feeds the result back through `messagesState`.
 * Standalone (stories/demo), the template falls back to the thread instance's
 * own state, client-filtered on the detected conversation FK.
 *
 * SEND: the composer raises `onSendMessage(body, conversationId)` — the host
 * runs the INSERT through the CRUD API (undo + audit); the template
 * optimistically echoes the message and reconciles/rolls back on the returned
 * promise. No transport → the composer is hidden, never a dead button.
 */

export const PAGE_CHAT_TEMPLATE_ID = 'page-chat';

export interface PageChatLabels {
  inboxTitle?: string | undefined;
  selectTitle?: string | undefined;
  selectBody?: string | undefined;
  loadFailed?: string | undefined;
  retry?: string | undefined;
  composerPlaceholder?: string | undefined;
}

export interface PageChatProps {
  /** The page's `config.layout` document (raw — validated here). */
  layout: unknown;
  /** Transport for bound widgets; absent → demo mode (04 §5.3). */
  adapter?: DashboardDataAdapter | undefined;
  params?: Record<string, unknown> | undefined;
  /** Host/test override — wins over adapter/demo resolution per instance. */
  states?: DashboardDataStates | undefined;
  /** Host-owned messages state for the SELECTED conversation (wins over the thread instance state). */
  messagesState?: WidgetDataState | undefined;
  /** Controlled selection; falls back to the first conversation when unset. */
  selectedConversationId?: string | number | null | undefined;
  onSelectConversation?: ((id: string | number) => void) | undefined;
  /** Send transport (CRUD insert into the messages table). Absent → composer hidden. */
  onSendMessage?: ((body: string, conversationId: string | number | null) => Promise<unknown> | void) | undefined;
  /** Author strings (emails/names) treated as the viewer's own messages. */
  ownAuthors?: readonly string[] | undefined;
  onEvent?: ((instanceId: string, event: WidgetEvent) => void) | undefined;
  /** Injectable clock for timestamps + the optimistic echo (tests). */
  now?: number | undefined;
  locale?: string | undefined;
  labels?: PageChatLabels | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

const EMPTY_LAYOUT: PageLayout = { version: 1, items: [] };

/** Split the layout into the roles this template renders. */
export function classifyChatItems(layout: PageLayout): {
  inbox: LayoutItem | null;
  thread: LayoutItem | null;
  side: LayoutItem[];
} {
  const items = layout.items;
  const inbox =
    items.find((item) => item.widget === 'conversation-inbox') ??
    items.find((item) => item.i === 'inbox') ??
    null;
  const thread =
    items.find((item) => item !== inbox && (item.widget === 'chat-thread' || item.widget === 'ai-chat-panel')) ??
    items.find((item) => item !== inbox && item.i === 'thread') ??
    null;
  const side = items.filter((item) => item !== inbox && item !== thread);
  return { inbox, thread, side };
}

function descriptorOf(item: LayoutItem | null): QueryDescriptor | null {
  if (item === null) return null;
  const parsed = queryDescriptorSchema.safeParse(item.config['binding']);
  return parsed.success ? parsed.data : null;
}

export function PageChat({
  layout,
  adapter,
  params,
  states,
  messagesState,
  selectedConversationId,
  onSelectConversation,
  onSendMessage,
  ownAuthors,
  onEvent,
  now,
  locale,
  labels,
  className,
  testId,
}: PageChatProps) {
  const t = useMaybeT();
  const parsed = useMemo(() => {
    const result = pageLayoutSchema.safeParse(layout);
    if (result.success) return { layout: result.data, invalid: false };
    return { layout: EMPTY_LAYOUT, invalid: true };
  }, [layout]);

  const dataStates = useDashboardData(parsed.layout, adapter, params);
  const stateFor = (instanceId: string): WidgetDataState =>
    states?.[instanceId] ?? dataStates[instanceId] ?? { status: 'loading' };

  const { inbox, thread, side } = useMemo(() => classifyChatItems(parsed.layout), [parsed.layout]);

  // --- conversations -----------------------------------------------------------
  const inboxState = inbox === null ? null : stateFor(inbox.i);
  const conversationRows = useMemo(
    () => (inboxState?.status === 'success' ? chatRowsOf(inboxState.data) : []),
    [inboxState?.status, inboxState?.data],
  );
  const conversationMap = useMemo(() => detectConversationFields(conversationRows), [conversationRows]);
  const conversations = useMemo(
    () => toConversationRows({ rows: conversationRows }, conversationMap),
    [conversationRows, conversationMap],
  );

  // --- selection (controlled or local; defaults to the first conversation) ------
  const [internalSelected, setInternalSelected] = useState<string | number | null>(null);
  const rawSelected = selectedConversationId !== undefined ? selectedConversationId : internalSelected;
  const selected = rawSelected ?? conversations[0]?.id ?? null;
  const selectedRow = conversations.find((row) => row.id === selected) ?? null;

  const select = (id: string | number): void => {
    setInternalSelected(id);
    setPending([]); // echoes belong to the conversation they were sent in
    onSelectConversation?.(id);
  };

  // --- messages ------------------------------------------------------------------
  const threadInstanceState = thread === null ? null : stateFor(thread.i);
  const activeMessagesState = messagesState ?? threadInstanceState;

  const messageRows = useMemo(
    () => (activeMessagesState?.status === 'success' ? chatRowsOf(activeMessagesState.data) : []),
    [activeMessagesState?.status, activeMessagesState?.data],
  );
  const messageMap = useMemo(() => detectMessageFields(messageRows), [messageRows]);
  const conversationFk = useMemo(
    () =>
      detectConversationFk(
        messageRows,
        // The inbox binding names the conversation table; the FK vocabulary
        // seeds from it (`conversations` → `conversation_id`).
        descriptorOf(inbox)?.source.name ?? null,
      ),
    [messageRows, inbox],
  );
  const scopedRows = useMemo(
    () =>
      // Host-fed messagesState is already scoped server-side; the fallback
      // (thread instance state) is the whole child table — scope it here.
      messagesState !== undefined ? messageRows : filterMessagesRows(messageRows, conversationFk, selected),
    [messagesState, messageRows, conversationFk, selected],
  );
  const serverMessages = useMemo(
    () => toChatMessages({ rows: scopedRows }, messageMap, ownAuthors ?? []),
    [scopedRows, messageMap, ownAuthors],
  );

  // --- optimistic echo (09 §7.9 "send appends … optimistic echo") ---------------
  const [pending, setPending] = useState<ChatMessage[]>([]);
  const pendingSeq = useRef(0);
  const messages = useMemo(() => {
    // A pending echo retires the moment the refetched payload carries a copy
    // of the same body. Body-match alone (not own-match): the insert sends no
    // sender column, so the server copy may not be own-attributable — a
    // permanent duplicate would be worse than a rare swallowed echo.
    const alive = pending.filter(
      (echo) => !serverMessages.some((message) => message.body === echo.body),
    );
    return [...serverMessages, ...alive];
  }, [serverMessages, pending]);

  const send = (body: string): void => {
    if (onSendMessage === undefined) return;
    pendingSeq.current += 1;
    const echo: ChatMessage = {
      id: `pending-${String(pendingSeq.current)}`,
      own: true,
      ...(ownAuthors?.[0] === undefined ? {} : { author: displayNameOf(ownAuthors[0]) }),
      body,
      sentAt: new Date(now ?? Date.now()).toISOString(),
    };
    setPending((current) => [...current, echo]);
    const result = onSendMessage(body, selected);
    if (result instanceof Promise) {
      result.catch(() => {
        // Rejected insert → roll the echo back; the host owns the error toast.
        setPending((current) => current.filter((message) => message.id !== echo.id));
      });
    }
  };

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-chat-invalid">
        {t(
          'ui:templates.chat.invalidLayout',
          'This chat page’s stored layout is invalid. Regenerate the page or reset its layout.',
        )}
      </p>
    );
  }

  return (
    <div data-part="page-chat" data-testid={testId} className={`flex h-full min-h-0 gap-4 ${className ?? ''}`}>
      {/* Inbox rail — the manifest's required slot. */}
      <div data-part="chat-inbox" className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {inbox === null ? (
          <EmptyState
            compact
            preset="no-data"
            title={t('ui:templates.chat.noInboxTitle', 'No inbox on this page')}
            body={t('ui:templates.chat.noInboxBody', 'Regenerate the page.')}
          />
        ) : inboxState?.status === 'error' ? (
          <EmptyState
            compact
            tone="danger"
            title={labels?.loadFailed ?? t('ui:templates.chat.conversationsFailed', 'The conversation query failed')}
            body={inboxState.error instanceof Error ? inboxState.error.message : undefined}
            actions={
              inboxState.refetch === undefined ? undefined : (
                <Button size="sm" variant="secondary" onClick={inboxState.refetch}>
                  {labels?.retry ?? t('ui:action.retry', 'Retry')}
                </Button>
              )
            }
          />
        ) : inboxState?.status === 'loading' ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner label={t('ui:templates.chat.loadingConversations', 'Loading conversations')} />
          </div>
        ) : (
          <ConversationInbox
            conversations={conversations}
            selectedId={selected ?? undefined}
            onSelect={select}
            searchable
            {...(now === undefined ? {} : { now })}
            {...(locale === undefined ? {} : { locale })}
            testId="page-chat-inbox"
          />
        )}
      </div>

      {/* Thread pane — the manifest's required slot. */}
      <div data-part="chat-thread-pane" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {thread !== null && thread.widget === 'ai-chat-panel' ? (
          <WidgetHost
            widgetId={thread.widget}
            instanceId={thread.i}
            config={thread.config}
            data={stateFor(thread.i)}
            onEvent={onEvent === undefined ? undefined : (event) => onEvent(thread.i, event)}
          />
        ) : selected === null ? (
          <EmptyState
            preset="no-data"
            title={labels?.selectTitle ?? t('ui:templates.chat.selectTitle', 'Select a conversation')}
            body={labels?.selectBody ?? t('ui:templates.chat.selectBody', 'Pick a conversation from the inbox to read its messages.')}
          />
        ) : activeMessagesState?.status === 'error' ? (
          <EmptyState
            tone="danger"
            title={labels?.loadFailed ?? t('ui:templates.chat.messagesFailed', 'The messages query failed')}
            body={activeMessagesState.error instanceof Error ? activeMessagesState.error.message : undefined}
            actions={
              activeMessagesState.refetch === undefined ? undefined : (
                <Button size="sm" variant="secondary" onClick={activeMessagesState.refetch}>
                  {labels?.retry ?? t('ui:action.retry', 'Retry')}
                </Button>
              )
            }
          />
        ) : activeMessagesState?.status === 'loading' ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <Spinner label={t('ui:templates.chat.loadingMessages', 'Loading messages')} />
          </div>
        ) : (
          <ChatThread
            messages={messages}
            composer={onSendMessage !== undefined}
            attachments
            {...(selectedRow === null ? {} : { peerName: selectedRow.name })}
            {...(selectedRow?.online === undefined ? {} : { peerOnline: selectedRow.online })}
            {...(labels?.composerPlaceholder === undefined ? {} : { composerPlaceholder: labels.composerPlaceholder })}
            {...(now === undefined ? {} : { now })}
            {...(locale === undefined ? {} : { locale })}
            onSend={send}
            testId="page-chat-thread"
          />
        )}
      </div>

      {/* Attachments rail + call slot — optional manifest slots. */}
      {side.length > 0 && (
        <aside data-part="chat-side" className="hidden w-64 shrink-0 flex-col gap-4 xl:flex">
          {side.map((item) => (
            <div key={item.i} className="min-h-40 overflow-hidden rounded-lg border border-border bg-surface">
              <WidgetHost
                widgetId={item.widget}
                instanceId={item.i}
                config={item.config}
                data={stateFor(item.i)}
                onEvent={onEvent === undefined ? undefined : (event) => onEvent(item.i, event)}
              />
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}
