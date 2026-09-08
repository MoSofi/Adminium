// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-chat` binding (09-generated-app.md §4.1, §7.9): projects the page
 * envelope onto the real `PageChat` template from `@adminium/widgets`.
 *
 * Data: `usePageWidgetStates` batches the inbox/attachments/call bindings.
 * THREAD SELECT → MESSAGES QUERY: the thread's stored descriptor targets the
 * messages child table; on selection the binding re-queries it with a
 * `conversation FK = selected` filter (FK detected from the unfiltered
 * payload's own keys, seeded by the conversation table's name) under
 * `['widget-data', pageId, 'thread', selectedId]`.
 *
 * LIVE: this page SUBSCRIBES to its two tables' widget-data channels (33-T11).
 * The sentence here used to say realtime invalidations refreshed an open
 * thread, and the mapping in `api/realtime.ts` does invalidate the whole
 * `['widget-data']` prefix on such an event — but nothing subscribed to the
 * channel, and the shell listens only to `config-changed` and the user's
 * notifications. So the frames were published to a socket this page was not
 * on: an inbox went quiet while somebody was typing into it, and the only
 * thing that refreshed the thread was the operator's own send invalidating its
 * own key. The subscription is the `PageRecordBinding` pattern — the shared
 * transport reference-counts channels, so two more channels is not a second
 * socket.
 *
 * SEND: the composer's insert runs through the CRUD API against the MESSAGES
 * table (not the page's conversation source) with body + conversation FK,
 * then invalidates the page's widget-data keys and raises the undo toast;
 * the returned promise lets the template roll back its optimistic echo.
 *
 * IT ALSO STAMPS WHO SENT IT (33 §7.3). It did not, and the consequence was
 * visible on the one page that exists to answer somebody: a reply written here
 * came back with no author, so `toChatMessages` could not match it against
 * `ownAuthors` and every staff message rendered on the OTHER side of the
 * thread. Where the table also carries a sender-kind column the send fills
 * that too — on Adminium's own `requiredSchema` it is NOT NULL with no
 * database default, so a send that omitted it would not merely look wrong, it
 * would fail.
 */
import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageChat, detectConversationFk, detectMessageFields, type WidgetDataState } from '@adminium/widgets';
import { qualifiedTableName, streamChannel } from '@adminium/widgets/binding';

import { createCrudApi } from '../api/crud.js';
import { WIDGET_DATA_KEY_ROOT, fetchWidgetDataBatch } from '../api/widgetData.js';
import { bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { appStreamTransport } from './lmc/stream.js';
import { findItemDescriptor, recordRowsOf, usePageWidgetStates } from './lmc/widgetStates.js';
import type { PageTemplateProps } from './template-types.js';
import { useAppToasts } from './toasts.js';

export function PageChatBinding({ page, adapters }: PageTemplateProps) {
  const { states } = usePageWidgetStates(page);
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const toasts = useAppToasts();
  const queryClient = useQueryClient();

  const thread = useMemo(() => findItemDescriptor(page, ['chat-thread'], 'thread'), [page]);
  const inbox = useMemo(
    () => findItemDescriptor(page, ['conversation-inbox'], 'inbox'),
    [page],
  );

  // Unfiltered first page of the messages child — the detection sample.
  const baseThreadRows = useMemo(() => {
    const state = thread === null ? undefined : states[thread.instanceId];
    return state?.status === 'success' ? recordRowsOf(state.data) : [];
  }, [thread, states]);
  const messageFields = useMemo(() => detectMessageFields(baseThreadRows), [baseThreadRows]);
  const conversationFk = useMemo(
    () => detectConversationFk(baseThreadRows, inbox?.descriptor.source.name ?? page.source.table),
    [baseThreadRows, inbox, page.source.table],
  );

  // --- selection (template auto-selects the first conversation; mirror it) ----
  const firstConversationId = useMemo(() => {
    const state = inbox === null ? undefined : states[inbox.instanceId];
    const rows = state?.status === 'success' ? recordRowsOf(state.data) : [];
    const id = rows[0]?.['id'];
    return typeof id === 'string' || typeof id === 'number' ? id : null;
  }, [inbox, states]);
  const [selected, setSelected] = useState<string | number | null>(null);
  const selectedId = selected ?? firstConversationId;

  // --- the scoped messages query (thread select → messages query) --------------
  const scopedEnabled = thread !== null && conversationFk !== undefined && selectedId !== null;
  const scopedQuery = useQuery({
    queryKey: [WIDGET_DATA_KEY_ROOT, page.id, 'thread', String(selectedId ?? '')] as const,
    enabled: scopedEnabled,
    staleTime: 0,
    queryFn: async () => {
      if (thread === null || conversationFk === undefined) throw new Error('unreachable');
      const descriptor = {
        ...thread.descriptor,
        filters: [
          ...(thread.descriptor.filters ?? []),
          { column: conversationFk, op: 'eq' as const, value: selectedId },
        ],
      };
      return fetchWidgetDataBatch([{ instanceId: thread.instanceId, descriptor }], {});
    },
  });

  const messagesState = useMemo<WidgetDataState | undefined>(() => {
    if (!scopedEnabled || thread === null) return undefined; // template client-filters the base state
    if (scopedQuery.isPending) return { status: 'loading' };
    if (scopedQuery.isError) return { status: 'error', error: scopedQuery.error, refetch: () => void scopedQuery.refetch() };
    const item = scopedQuery.data.get(thread.instanceId);
    if (item === undefined || !item.ok) {
      return {
        status: 'error',
        error: new Error(item?.error?.message ?? 'The messages query failed.'),
        refetch: () => void scopedQuery.refetch(),
      };
    }
    return { status: 'success', data: item.data, isRefetching: scopedQuery.isRefetching };
  }, [scopedEnabled, scopedQuery, thread]);

  /*
   * LIVE THE WAY THE HEADER SAYS: subscribe to the conversations table and the
   * messages table, and invalidate this page's widget-data keys on any write.
   *
   * BOTH, because they answer different halves of the screen: a new message
   * moves the thread, and the same exchange moves the inbox rail's preview,
   * timestamp and unread count — which live on the CONVERSATION row and arrive
   * as a separate write. Subscribing to the thread alone would leave a rail
   * that never re-sorted.
   *
   * INVALIDATE RATHER THAN SPLICE. The frame carries a masked row, and a
   * masked row is not what the thread renders — the widget-data payload is
   * shaped by the page's own descriptor (ordering, limit, the FK filter).
   * Prepending the frame would put a subtly different row in the list from the
   * one a refetch produces. One small refetch per message is the honest cost.
   */
  const liveChannels = useMemo(() => {
    const channels = new Set<string>();
    for (const item of [thread, inbox]) {
      if (item === null) continue;
      channels.add(
        streamChannel(item.descriptor.connectionId, qualifiedTableName(item.descriptor.source)),
      );
    }
    return [...channels];
  }, [thread, inbox]);

  useEffect(() => {
    if (liveChannels.length === 0) return;
    const transport = appStreamTransport();
    const stops = liveChannels.map((channel) =>
      transport.subscribe(channel, () => {
        void queryClient.invalidateQueries({ queryKey: [WIDGET_DATA_KEY_ROOT, page.id] });
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [liveChannels, queryClient, page.id]);

  /*
   * WHAT TO PUT IN THE SENDER-KIND COLUMN, when the table has one.
   *
   * `staff` is what Adminium's own `requiredSchema` declares, and it is the
   * fallback. It is NOT the first choice, because the column is often an enum
   * and an operator's own table may spell the same idea `agent` or `operator`
   * — writing a value the enum does not have would turn a working send into a
   * constraint violation. So the rows already on screen are asked first: if
   * the thread contains a message from the business, whatever word THAT row
   * uses is the word this one uses.
   */
  const ownKindValue = useMemo(() => {
    if (messageFields.senderKind === undefined) return undefined;
    for (const row of baseThreadRows) {
      const value = row[messageFields.senderKind];
      if (typeof value !== 'string') continue;
      if (['staff', 'agent', 'operator'].includes(value.toLowerCase())) return value;
    }
    return 'staff';
  }, [messageFields.senderKind, baseThreadRows]);

  // --- send: CRUD insert into the MESSAGES table (undo + audit) ----------------
  const sendMessage = useCallback(
    async (body: string, conversationId: string | number | null) => {
      if (thread === null) return;
      const crud = createCrudApi(thread.descriptor.connectionId, qualifiedTableName(thread.descriptor.source));
      try {
        const result = await crud.create({
          [messageFields.body ?? 'body']: body,
          ...(conversationFk === undefined || conversationId === null
            ? {}
            : { [conversationFk]: conversationId }),
          /*
           * The signed-in user's e-mail, because that is what `ownAuthors`
           * matches against and what `displayNameOf` turns into a name. Only
           * where a column was detected: inventing one would fail the insert.
           */
          ...(messageFields.author === undefined
            ? {}
            : { [messageFields.author]: bootstrap.user.email }),
          ...(messageFields.senderKind === undefined || ownKindValue === undefined
            ? {}
            : { [messageFields.senderKind]: ownKindValue }),
        });
        adapters.notifyUndoable({
          title: t('chat.messageSent', 'Message sent'),
          undoToken: result.undoToken,
        });
        void queryClient.invalidateQueries({ queryKey: [WIDGET_DATA_KEY_ROOT, page.id] });
        return result;
      } catch (reason) {
        toasts.push({
          variant: 'error',
          title: reason instanceof Error ? reason.message : t('chat.sendFailed', 'The message could not be sent.'),
        });
        throw reason; // the template rolls its optimistic echo back
      }
    },
    [
      thread,
      messageFields.body,
      messageFields.author,
      messageFields.senderKind,
      ownKindValue,
      bootstrap.user.email,
      conversationFk,
      adapters,
      queryClient,
      page.id,
      toasts,
    ],
  );

  return (
    <PageChat
      layout={page.config['layout']}
      states={states}
      {...(messagesState === undefined ? {} : { messagesState })}
      selectedConversationId={selectedId}
      onSelectConversation={(id) => setSelected(id)}
      onSendMessage={sendMessage}
      ownAuthors={[bootstrap.user.email, bootstrap.user.name]}
      onEvent={(instanceId, event) => {
        void instanceId;
        void adapters.onEvent(event);
      }}
    />
  );
}
