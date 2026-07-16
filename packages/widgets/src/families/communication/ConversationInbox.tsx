import { Avatar, CountBadge, EmptyState, SearchInput } from '@adminium/ui';
import { Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  boolField,
  chatRowsOf,
  fmtCount,
  formatAbsoluteTime,
  formatRelativeTime,
  localeOf,
  numberField,
  sourceOf,
  stringField,
} from './chat-lib.js';
import type { ConversationInboxConfig } from './communication-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure
// `communication-config` module so the registry metadata graph never eagerly
// pulls this component's @adminium/ui deps (acceptance #3); re-exported here so
// the family barrel, stories, and tests keep one import point per widget.
export { conversationInboxConfigSchema, conversationInboxDemoData } from './communication-config.js';
export type { ConversationInboxConfig };

/**
 * `conversation-inbox` (annex §9) — selectable conversation rows: avatar with a
 * presence dot, name, relative time, last-message preview (bold when unread),
 * and an unread count pill. Selecting a row clears its unread state and emits
 * `onSelect(id)`, which the page wires to a sibling `chat-thread` (annex §14:
 * conversations + messages tables → an inbox + thread page).
 *
 * The selected row is marked by a `border-s-2` accent rail + accent-soft tint —
 * a LOGICAL inline-start border, so it moves to the right edge under `dir="rtl"`
 * (10 §5.2). Ports designs/Chat.dc.html (conversation list pane).
 */

export interface ConversationRow {
  id: string | number;
  name: string;
  preview?: string | undefined;
  /** ISO 8601 timestamp of the last message. */
  ts?: string | undefined;
  unread?: number | undefined;
  online?: boolean | undefined;
  group?: boolean | undefined;
}

export interface ConversationInboxProps {
  conversations: readonly ConversationRow[];
  /** Controlled selection; falls back to the first row when unset. */
  selectedId?: string | number | undefined;
  onSelect?: ((id: string | number) => void) | undefined;
  presence?: boolean | undefined;
  groupChats?: boolean | undefined;
  searchable?: boolean | undefined;
  searchLabel?: string | undefined;
  searchPlaceholder?: string | undefined;
  clearUnreadOnSelect?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  noMatchesTitle?: string | undefined;
  /** Injectable clock for deterministic relative timestamps. */
  now?: number | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

export function ConversationInbox({
  conversations,
  selectedId,
  onSelect,
  presence = true,
  groupChats = true,
  searchable = false,
  searchLabel,
  searchPlaceholder,
  clearUnreadOnSelect = true,
  emptyTitle,
  emptyBody,
  noMatchesTitle,
  now,
  locale: localeProp,
  testId,
}: ConversationInboxProps) {
  // `format.locale` is a free-string in the shared config, so '' / 'x-1' are
  // schema-valid and would throw out of every Intl call (and out of
  // toLocaleLowerCase below). Normalize once, at the boundary.
  const locale = localeOf(localeProp);
  const [query, setQuery] = useState('');
  // Uncontrolled selection + locally-cleared unread ids: the widget owns its
  // interaction state; the host learns about it through `onSelect`.
  const [internalId, setInternalId] = useState<string | number | undefined>(undefined);
  const [readIds, setReadIds] = useState<ReadonlySet<string | number>>(new Set());

  const activeId = selectedId ?? internalId ?? conversations[0]?.id;

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    if (needle === '') return conversations;
    return conversations.filter(
      (row) =>
        row.name.toLocaleLowerCase(locale).includes(needle) ||
        (row.preview ?? '').toLocaleLowerCase(locale).includes(needle),
    );
  }, [conversations, query, locale]);

  if (conversations.length === 0) {
    return (
      <EmptyState
        compact
        preset="all-caught-up"
        title={emptyTitle ?? 'No conversations'}
        body={emptyBody ?? 'Conversations will appear here as messages arrive.'}
      />
    );
  }

  const select = (id: string | number): void => {
    if (selectedId === undefined) setInternalId(id);
    if (clearUnreadOnSelect) setReadIds((previous) => new Set(previous).add(id));
    onSelect?.(id);
  };

  return (
    <div data-widget="conversation-inbox" data-testid={testId} className="flex h-full flex-col">
      {searchable && (
        <div className="border-b border-border/60 p-3">
          <SearchInput
            aria-label={searchLabel ?? 'Search conversations'}
            placeholder={searchPlaceholder ?? 'Search conversations…'}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onClear={() => setQuery('')}
            clearLabel={searchLabel ?? 'Search conversations'}
          />
        </div>
      )}
      {visible.length === 0 ? (
        <EmptyState
          compact
          preset="no-matches"
          title={noMatchesTitle ?? 'No conversations match'}
          body={emptyBody ?? undefined}
        />
      ) : (
        <ul className="flex-1 overflow-auto">
          {visible.map((row) => {
            const selected = row.id === activeId;
            const unread = readIds.has(row.id) ? 0 : (row.unread ?? 0);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  data-part="conversation-row"
                  data-conversation-id={String(row.id)}
                  data-selected={selected ? '' : undefined}
                  data-unread={unread > 0 ? '' : undefined}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => select(row.id)}
                  className={`flex w-full items-center gap-3 border-s-2 px-3 py-3 text-start transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                    selected ? 'border-s-accent bg-accent-soft' : 'border-s-transparent hover:bg-surface-2/60'
                  }`}
                >
                  <Avatar
                    name={row.name}
                    size="lg"
                    locale={locale}
                    {...(presence && row.online === true ? { presence: 'pos' as const } : {})}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      {groupChats && row.group === true && (
                        <Users data-part="group-glyph" className="size-3 shrink-0 text-fg-subtle" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-body-sm font-bold text-fg">{row.name}</span>
                      {row.ts !== undefined && (
                        <time
                          dateTime={row.ts}
                          title={formatAbsoluteTime(row.ts, locale)}
                          className="shrink-0 whitespace-nowrap font-mono text-caption tabular-nums text-fg-subtle"
                        >
                          {formatRelativeTime(row.ts, { locale, ...(now === undefined ? {} : { now }) })}
                        </time>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span
                        data-part="conversation-preview"
                        className={`min-w-0 flex-1 truncate text-caption ${
                          unread > 0 ? 'font-bold text-fg' : 'font-medium text-fg-muted'
                        }`}
                      >
                        {row.preview ?? ''}
                      </span>
                      {unread > 0 && (
                        <CountBadge active data-part="unread-pill" className="shrink-0">
                          {fmtCount(locale, unread)}
                        </CountBadge>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function conversationsOf(data: unknown, config: ConversationInboxConfig): ConversationRow[] {
  return chatRowsOf(data).map((row, index) => {
    const preview = stringField(row, config.previewField);
    const ts = stringField(row, config.sentAtField);
    return {
      id: (row['id'] as string | number | undefined) ?? index,
      name: stringField(row, config.nameField) ?? '',
      ...(preview === undefined ? {} : { preview }),
      ...(ts === undefined ? {} : { ts }),
      unread: numberField(row, config.unreadField),
      online: boolField(row, config.onlineField),
      group: boolField(row, config.groupField),
    };
  });
}

export function ConversationInboxWidget({ config, data, onEvent }: WidgetProps<ConversationInboxConfig>) {
  const conversations = conversationsOf(data, config);
  const source = sourceOf(config.binding);
  return (
    <ConversationInbox
      conversations={conversations}
      presence={config.presence}
      groupChats={config.groupChats}
      searchable={config.searchable}
      clearUnreadOnSelect={config.clearUnreadOnSelect}
      {...(config.searchLabel === undefined ? {} : { searchLabel: config.searchLabel })}
      {...(config.searchPlaceholder === undefined ? {} : { searchPlaceholder: config.searchPlaceholder })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.format?.referenceTime === undefined ? {} : { now: config.format.referenceTime })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      onSelect={(id) => {
        // Selection is a record-open intent: the page host focuses the sibling
        // chat-thread on this conversation (annex §14 inbox + thread pairing).
        onEvent({
          type: 'record-open',
          ...(source.connectionId === undefined ? {} : { connectionId: source.connectionId }),
          table: source.table,
          recordId: id,
        });
      }}
    />
  );
}
