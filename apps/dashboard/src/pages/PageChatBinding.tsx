/**
 * `page-chat` binding (09-generated-app.md §4.1, §7.9): projects the page
 * envelope onto the real `PageChat` template from `@adminium/widgets`.
 *
 * Data: `usePageWidgetStates` batches the inbox/attachments/call bindings.
 * THREAD SELECT → MESSAGES QUERY: the thread's stored descriptor targets the
 * messages child table; on selection the binding re-queries it with a
 * `conversation FK = selected` filter (FK detected from the unfiltered
 * payload's own keys, seeded by the conversation table's name) under
 * `['widget-data', pageId, 'thread', selectedId]` — realtime `widget-data:*`
 * invalidations refetch it, which is what refreshes an open thread live.
 *
 * SEND: the composer's insert runs through the CRUD API against the MESSAGES
 * table (not the page's conversation source) with body + conversation FK,
 * then invalidates the page's widget-data keys and raises the undo toast;
 * the returned promise lets the template roll back its optimistic echo.
 */
import { useSuspenseQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { PageChat, detectConversationFk, detectMessageFields, type WidgetDataState } from '@adminium/widgets';
import { qualifiedTableName } from '@adminium/widgets/binding';

import { createCrudApi } from '../api/crud.js';
import { WIDGET_DATA_KEY_ROOT, fetchWidgetDataBatch } from '../api/widgetData.js';
import { bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
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
    [thread, messageFields.body, conversationFk, adapters, queryClient, page.id, toasts],
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
