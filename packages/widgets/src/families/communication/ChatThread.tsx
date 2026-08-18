// SPDX-License-Identifier: AGPL-3.0-only
import { Avatar, EmptyState, Input, Tag } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Paperclip, Send } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { TypingIndicator } from './TypingIndicator.js';
import {
  chatRowsOf,
  fmtClock,
  fmtDaySeparator,
  formatAbsoluteTime,
  groupMessages,
  localeOf,
  sourceOf,
  toChatMessage,
  CHAT_DEMO_EPOCH,
} from './chat-lib.js';
import type { ChatAttachment, ChatBubble, ChatMessage } from './chat-lib.js';
import type { ChatThreadConfig } from './communication-config.js';
import type { WidgetProps } from '../../registry/types.js';

// Config schema + deterministic demo payload live in the pure
// `communication-config` module so the registry metadata graph never eagerly
// pulls this component's @adminium/ui deps (acceptance #3); re-exported here so
// the family barrel, stories, and tests keep one import point per widget.
export { chatThreadConfigSchema, chatThreadDemoData } from './communication-config.js';
export type { ChatThreadConfig };

/**
 * `chat-thread` (annex §9) — grouped message bubbles for one conversation:
 * sender-aware styling, an avatar on the first message of each author-run, a
 * mono timestamp on the last, day separators between day groups, attachment
 * chips, and a composer.
 *
 * RTL IS STRUCTURAL, NOT COSMETIC (10 §5.2 / acceptance #9): own messages align
 * to the INLINE-END edge via `justify-end` — flexbox `flex-end` resolves along
 * the writing direction, so the bubbles genuinely swap sides under `dir="rtl"`
 * rather than merely re-labelling. The asymmetric bubble corner uses the LOGICAL
 * corner utilities (`rounded-ee-*` on own, `rounded-es-*` on other), so the
 * "tail" corner tracks the same edge the bubble is docked to in both directions.
 * There is not one physical `ml-/mr-/left-/right-/rounded-br-` utility in here.
 *
 * Binds to an ordered `record-list` of messages whose author/body/sentAt/
 * attachments columns are named in config. Ports Chat.dc.html (thread).
 */

export interface ChatThreadProps {
  messages: readonly ChatMessage[];
  peerName?: string | undefined;
  peerStatus?: string | undefined;
  peerOnline?: boolean | undefined;
  composer?: boolean | undefined;
  composerPlaceholder?: string | undefined;
  sendLabel?: string | undefined;
  attachments?: boolean | undefined;
  attachLabel?: string | undefined;
  typingIndicator?: boolean | undefined;
  typingLabel?: string | undefined;
  daySeparators?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onSend?: ((body: string) => void) | undefined;
  onAttach?: (() => void) | undefined;
  /** Injectable clock for deterministic "Today"/"Yesterday" separators. */
  now?: number | undefined;
  locale?: string | undefined;
  /** Story/VRT only: render inside an explicit direction context. */
  dir?: 'ltr' | 'rtl' | undefined;
  testId?: string | undefined;
}

export function ChatThread({
  messages,
  peerName,
  peerStatus,
  peerOnline = false,
  composer = true,
  composerPlaceholder,
  sendLabel,
  attachments = true,
  attachLabel,
  typingIndicator = false,
  typingLabel,
  daySeparators = true,
  emptyTitle,
  emptyBody,
  onSend,
  onAttach,
  now = CHAT_DEMO_EPOCH,
  locale: localeProp,
  dir,
  testId,
}: ChatThreadProps) {
  const t = useMaybeT();
  // `format.locale` is a free-string in the shared config, so '' / 'x-1' are
  // schema-valid and would throw out of every Intl call. Normalize at the edge.
  const locale = localeOf(localeProp);
  const [draft, setDraft] = useState('');
  const groups = groupMessages(messages);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const body = draft.trim();
    if (body === '') return;
    onSend?.(body);
    setDraft('');
  };

  return (
    <div
      data-widget="chat-thread"
      data-testid={testId}
      {...(dir === undefined ? {} : { dir })}
      className="flex h-full flex-col"
    >
      {peerName !== undefined && (
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <Avatar name={peerName} size="md" locale={locale} {...(peerOnline ? { presence: 'pos' as const } : {})} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-body-sm font-bold text-fg">{peerName}</div>
            {peerStatus !== undefined && (
              <div className={`truncate text-caption ${peerOnline ? 'text-pos' : 'text-fg-subtle'}`}>{peerStatus}</div>
            )}
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex-1">
          <EmptyState
            compact
            preset="no-data"
            title={emptyTitle ?? t('ui:widgets.communication.chatThread.emptyTitle', 'No messages yet')}
            body={
              emptyBody ??
              t('ui:widgets.communication.chatThread.emptyBody', 'Messages in this conversation will appear here.')
            }
          />
        </div>
      ) : (
        // A scroll container whose content holds no focusable element is
        // unreachable by keyboard — you can see there is more and cannot get to
        // it (axe `scrollable-region-focusable`, WCAG 2.1.1). `tabIndex={0}`
        // makes the region itself the scroll target; `role="log"` is what a
        // transcript is, and gives the label somewhere to land.
        <div
          data-part="thread-scroll"
          role="log"
          tabIndex={0}
          aria-label={t('ui:widgets.communication.chatThread.transcriptLabel', 'Conversation')}
          className="flex flex-1 flex-col gap-1 overflow-auto p-4"
        >
          {groups.map((group) => (
            <div key={group.key} data-part="day-group" data-day={group.key}>
              {daySeparators && (
                <div data-part="day-separator" className="flex items-center gap-3 py-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="whitespace-nowrap font-mono text-caption font-bold uppercase tracking-wide text-fg-subtle">
                    {fmtDaySeparator(locale, group.date, now)}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              {group.bubbles.map((bubble) => (
                <Bubble
                  key={bubble.id}
                  bubble={bubble}
                  locale={locale}
                  showAttachments={attachments}
                />
              ))}
            </div>
          ))}
          {/* annex §9 places `typing-indicator` as a "child of thread", so the
              embedded row IS that widget's component — one implementation, and
              both already live in this family's single lazy chunk. */}
          <TypingIndicator
            typing={typingIndicator}
            typists={peerName === undefined ? [] : [peerName]}
            locale={locale}
            label={typingLabel ?? t('ui:widgets.communication.chatThread.typingLabel', 'typing…')}
          />
        </div>
      )}

      {composer && (
        <form
          data-part="composer"
          onSubmit={submit}
          className="flex items-center gap-2 border-t border-border/60 p-3"
        >
          {attachments && (
            <button
              type="button"
              data-part="attach-button"
              aria-label={attachLabel ?? t('ui:widgets.communication.chatThread.attachLabel', 'Add attachment')}
              onClick={onAttach}
              className="grid size-8 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg-muted focus-visible:outline-2 focus-visible:outline-accent"
            >
              <Paperclip className="size-4" aria-hidden="true" />
            </button>
          )}
          <Input
            // The accessible name's default ('Message') is deliberately NOT the
            // placeholder's — key proposed as chatThread.composerLabel.
            aria-label={composerPlaceholder ?? t('ui:widgets.communication.chatThread.composerLabel', 'Message')}
            placeholder={composerPlaceholder ?? t('ui:widgets.communication.chatThread.composerPlaceholder', 'Write a message…')}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <button
            type="submit"
            data-part="send-button"
            aria-label={sendLabel ?? t('ui:widgets.communication.chatThread.sendLabel', 'Send')}
            disabled={draft.trim() === ''}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-fg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
          >
            {/* The paper-plane points along the reading direction → mirror it. */}
            <Send className="size-4 rtl:-scale-x-100" aria-hidden="true" />
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * One message bubble. `justify-end` docks own messages to the inline-end edge
 * (mirrors under RTL); the squared "tail" corner is the LOGICAL end-end corner
 * on own bubbles and the end-start corner on incoming ones.
 */
function Bubble({
  bubble,
  locale,
  showAttachments,
}: {
  bubble: ChatBubble;
  locale: string;
  showAttachments: boolean;
}) {
  const own = bubble.own;
  return (
    <div
      data-part="message-row"
      data-own={own ? '' : undefined}
      data-starts-run={bubble.startsRun ? '' : undefined}
      className={`flex items-end gap-2 ${own ? 'justify-end' : 'justify-start'} ${bubble.startsRun ? 'mt-2.5' : 'mt-0.5'}`}
    >
      {!own &&
        (bubble.startsRun ? (
          <Avatar name={bubble.author ?? ''} size="sm" locale={locale} className="mb-0.5" />
        ) : (
          // Keeps the run's bubbles flush with the first one's inline edge.
          <span data-part="avatar-spacer" className="size-6 shrink-0" aria-hidden="true" />
        ))}
      <div
        data-part="message-bubble"
        className={`max-w-[68%] rounded-2xl px-3 py-2 text-body-sm leading-relaxed ${
          own
            ? 'rounded-ee-sm bg-accent text-accent-fg'
            : 'rounded-es-sm border border-border bg-surface text-fg'
        }`}
      >
        {!own && bubble.startsRun && bubble.author !== undefined && (
          <div data-part="message-author" className="mb-0.5 text-caption font-bold text-fg-muted">
            {bubble.author}
          </div>
        )}
        <p className="whitespace-pre-wrap break-words">{bubble.body}</p>
        {showAttachments && bubble.attachments !== undefined && bubble.attachments.length > 0 && (
          <ul data-part="attachment-chips" className="mt-1.5 flex flex-wrap gap-1">
            {bubble.attachments.map((file) => (
              <li key={file.name}>
                <AttachmentChip file={file} own={own} />
              </li>
            ))}
          </ul>
        )}
        {bubble.endsRun && (
          <time
            dateTime={bubble.sentAt}
            title={formatAbsoluteTime(bubble.sentAt, locale)}
            data-part="message-time"
            // No alpha on `text-accent-fg`. `--accent-fg` on `--accent` is
            // gated at >= 4.5:1 by the token contrast check, and dimming it to
            // 70% measured 3.89:1 — the alpha was the whole failure. Hierarchy
            // comes from the 9.5px mono size, which it already had.
            className={`mt-1 block font-mono text-[9.5px] tabular-nums ${
              own ? 'text-end text-accent-fg' : 'text-start text-fg-subtle'
            }`}
          >
            {fmtClock(locale, bubble.sentAt)}
          </time>
        )}
      </div>
    </div>
  );
}

function AttachmentChip({ file, own }: { file: ChatAttachment; own: boolean }) {
  return (
    <Tag
      data-part="attachment-chip"
      tone={own ? 'neutral' : 'accent'}
      className={own ? 'bg-accent-fg/15 text-accent-fg' : ''}
    >
      <Paperclip className="size-2.5" aria-hidden="true" />
      <span className="max-w-[10rem] truncate">{file.name}</span>
      {/* `opacity-70` here dimmed 10px mono text below AA on the accent bubble.
          The chip already reads as secondary from its size and font. */}
      {file.size !== undefined && <span className="font-mono tabular-nums">{file.size}</span>}
    </Tag>
  );
}

function messagesOf(data: unknown, config: ChatThreadConfig): ChatMessage[] {
  return chatRowsOf(data).map((row, index) =>
    toChatMessage(row, index, {
      authorField: config.authorField,
      bodyField: config.bodyField,
      sentAtField: config.sentAtField,
      attachmentsField: config.attachmentsField,
      ownField: config.ownField,
      ...(config.ownAuthor === undefined ? {} : { ownAuthor: config.ownAuthor }),
    }),
  );
}

export function ChatThreadWidget({ config, data, onEvent }: WidgetProps<ChatThreadConfig>) {
  const messages = messagesOf(data, config);
  const source = sourceOf(config.binding);
  return (
    <ChatThread
      messages={messages}
      composer={config.composer}
      attachments={config.attachments}
      typingIndicator={config.typingIndicator}
      daySeparators={config.daySeparators}
      peerOnline={config.peerOnline}
      {...(config.peerName === undefined ? {} : { peerName: config.peerName })}
      {...(config.peerStatus === undefined ? {} : { peerStatus: config.peerStatus })}
      {...(config.composerPlaceholder === undefined ? {} : { composerPlaceholder: config.composerPlaceholder })}
      {...(config.sendLabel === undefined ? {} : { sendLabel: config.sendLabel })}
      {...(config.typingLabel === undefined ? {} : { typingLabel: config.typingLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.format?.referenceTime === undefined ? {} : { now: config.format.referenceTime })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      // Sending is a mutation INTENT — the host runs the INSERT through the CRUD
      // API (with audit + undo); the widget never writes (04 §2.1).
      onSend={(body) => {
        onEvent({
          type: 'mutate',
          intent: 'insert',
          ...(source.connectionId === undefined ? {} : { connectionId: source.connectionId }),
          table: source.table,
          values: { [config.bodyField]: body },
        });
      }}
    />
  );
}
