/**
 * Track COMM `communication` family stories (annex §9): the conversation inbox,
 * chat thread, and AI assist panel loaded variants, the four WidgetFrame states
 * through WidgetHost (acceptance #4), and light/dark × LTR/RTL matrices with
 * REAL geometry mirroring (acceptance #9 — the RTL frames set `dir="rtl"` so the
 * logical `justify-end` + `rounded-ee-*` genuinely swap the bubbles to the other
 * edge and re-corner them, rather than a bare attribute on unmirrored markup).
 *
 * Widgets resolve through a LOCAL registry override so the stories work before
 * the green loop merges the definitions into the global map. Payloads are the
 * same seeded generators `demoData` uses, and every relative/day label is pinned
 * to `CHAT_DEMO_EPOCH` so VRT captures are byte-deterministic (04-T17).
 */
import type { ReactNode } from 'react';

import { AiChatPanel, aiChatPanelDemoData } from './AiChatPanel.js';
import { ChatThread, chatThreadDemoData } from './ChatThread.js';
import { ConversationInbox, conversationInboxDemoData } from './ConversationInbox.js';
import { CHAT_DEMO_EPOCH, toChatMessage } from './chat-lib.js';
import type { ChatMessage } from './chat-lib.js';
import {
  aiChatPanelDefinition,
  chatThreadDefinition,
  conversationInboxDefinition,
} from './communication-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([
  conversationInboxDefinition,
  chatThreadDefinition,
  aiChatPanelDefinition,
] as WidgetDefinition[]);

const meta = { title: 'Widgets/Communication' };
export default meta;

type Status = 'success' | 'loading' | 'error';

/** Pin every clock-derived label so the frames are byte-deterministic. */
const PINNED = { format: { referenceTime: CHAT_DEMO_EPOCH, locale: 'en-US' } };

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
) {
  return (
    <div className="h-[32rem] w-full">
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={{ ...PINNED, ...config }}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('COMM_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

/** Messages for the direct (non-host) matrices — the same seeded payload. */
function threadModel(seed: number): ChatMessage[] {
  return chatThreadDemoData(seed).rows.map((row, index) =>
    toChatMessage(row, index, {
      authorField: 'author',
      bodyField: 'body',
      sentAtField: 'sentAt',
      attachmentsField: 'attachments',
      ownField: 'own',
    }),
  );
}

const inboxConfig = { title: 'Messages', searchable: true };
const threadConfig = { title: 'Morgan Lee', peerName: 'Morgan Lee', peerStatus: 'Active now', peerOnline: true };
const aiConfig = {
  title: 'Ask Adminium',
  assistantName: 'Adminium AI',
  providerLabel: 'claude-opus-4-5',
  suggestions: ['Which tables have no primary key?', 'Summarise the orders table.'],
};

export const ConversationInboxStory = {
  name: 'conversation-inbox',
  render: () => host('conversation-inbox', 's-inbox', inboxConfig, conversationInboxDemoData(7)),
};

export const ChatThreadStory = {
  name: 'chat-thread',
  render: () => host('chat-thread', 's-thread', threadConfig, chatThreadDemoData(7)),
};

export const AiChatPanelStory = {
  name: 'ai-chat-panel',
  render: () => host('ai-chat-panel', 's-ai', aiConfig, aiChatPanelDemoData(7)),
};

/**
 * The exit-criterion surface: inbox + thread side by side, the way the
 * generator composes a conversations+messages table pair (annex §14).
 */
export const InboxAndThread = {
  name: 'conversation-inbox + chat-thread (the chat page)',
  render: () => (
    <Frame>
      <div className="flex h-[32rem] gap-4">
        <div className="w-[20rem] shrink-0">{host('conversation-inbox', 'p-inbox', inboxConfig, conversationInboxDemoData(7))}</div>
        <div className="min-w-0 flex-1">{host('chat-thread', 'p-thread', threadConfig, chatThreadDemoData(7))}</div>
      </div>
    </Frame>
  ),
};

/** All four WidgetFrame states (loaded · skeleton · empty · error). */
export const States = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('chat-thread', 'st-loaded', threadConfig, chatThreadDemoData(7))}
        {host('chat-thread', 'st-skeleton', threadConfig, undefined, 'loading')}
        {host(
          'chat-thread',
          'st-empty',
          { ...threadConfig, emptyState: { titleKey: 'No messages yet' } },
          { data: [], total: 0 },
        )}
        {host('chat-thread', 'st-error', threadConfig, undefined, 'error')}
      </div>
    </Frame>
  ),
};

export const InboxStates = {
  name: 'conversation-inbox (four states)',
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('conversation-inbox', 'is-loaded', inboxConfig, conversationInboxDemoData(7))}
        {host('conversation-inbox', 'is-skeleton', inboxConfig, undefined, 'loading')}
        {host(
          'conversation-inbox',
          'is-empty',
          { ...inboxConfig, emptyState: { titleKey: 'No conversations' } },
          { data: [], total: 0 },
        )}
        {host('conversation-inbox', 'is-error', inboxConfig, undefined, 'error')}
      </div>
    </Frame>
  ),
};

export const AiChatPanelStates = {
  name: 'ai-chat-panel (four states)',
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('ai-chat-panel', 'as-loaded', aiConfig, aiChatPanelDemoData(7))}
        {host('ai-chat-panel', 'as-skeleton', aiConfig, undefined, 'loading')}
        {host('ai-chat-panel', 'as-empty', { ...aiConfig, emptyState: { titleKey: 'Ask about your data' } }, { data: [], total: 0 })}
        {host('ai-chat-panel', 'as-error', aiConfig, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/**
 * The panel with no provider configured — the shell's fifth, LLM-specific state
 * (the M6 layer is server-owned; this widget never calls a provider).
 */
export const AiChatPanelNoProvider = {
  name: 'ai-chat-panel (configure a provider)',
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('ai-chat-panel', 'np-light', { ...aiConfig, providerConfigured: false, configureHref: '/studio/settings/ai' }, { data: [], total: 0 })}
      </div>
    </Frame>
  ),
};

/**
 * Light × dark × LTR × RTL — the RTL frames genuinely mirror: own bubbles swap
 * to the opposite edge and their squared tail corner follows, because both are
 * expressed with logical properties (`justify-end`, `rounded-ee-sm`).
 */
export const ThreadThemeAndDirectionMatrix = {
  name: 'chat-thread (light/dark × LTR/RTL — bubbles mirror)',
  render: () => {
    const messages = threadModel(7);
    const thread = (dir: 'ltr' | 'rtl') => (
      <div className="h-[26rem]">
        <ChatThread
          messages={messages}
          dir={dir}
          peerName="Morgan Lee"
          peerStatus="Active now"
          peerOnline
          typingIndicator
          now={CHAT_DEMO_EPOCH}
        />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{thread('ltr')}</Frame>
        <Frame dir="rtl">{thread('rtl')}</Frame>
        <Frame dark dir="ltr">{thread('ltr')}</Frame>
        <Frame dark dir="rtl">{thread('rtl')}</Frame>
      </div>
    );
  },
};

export const InboxThemeAndDirectionMatrix = {
  name: 'conversation-inbox (light/dark × LTR/RTL — selection rail mirrors)',
  render: () => {
    const conversations = conversationInboxDemoData(7).rows as never[];
    const inbox = (dir: 'ltr' | 'rtl') => (
      <div dir={dir} className="h-[24rem] w-[20rem] rounded-lg border border-border bg-surface">
        <ConversationInbox conversations={conversations} searchable selectedId="c2" now={CHAT_DEMO_EPOCH} />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{inbox('ltr')}</Frame>
        <Frame dir="rtl">{inbox('rtl')}</Frame>
        <Frame dark dir="ltr">{inbox('ltr')}</Frame>
        <Frame dark dir="rtl">{inbox('rtl')}</Frame>
      </div>
    );
  },
};

export const AiChatPanelThemeAndDirectionMatrix = {
  name: 'ai-chat-panel (light/dark × LTR/RTL)',
  render: () => {
    const turns = aiChatPanelDemoData(7).rows.map((row) => ({
      id: row['id'] as string,
      role: row['role'] as 'user' | 'assistant',
      body: row['body'] as string,
      sentAt: row['sentAt'] as string,
    }));
    const panel = (dir: 'ltr' | 'rtl') => (
      <div className="h-[26rem] w-[22rem] rounded-lg border border-border bg-surface">
        <AiChatPanel
          turns={turns}
          dir={dir}
          assistantName="Adminium AI"
          providerLabel="claude-opus-4-5"
          suggestions={['Summarise the orders table.']}
        />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{panel('ltr')}</Frame>
        <Frame dir="rtl">{panel('rtl')}</Frame>
        <Frame dark dir="ltr">{panel('ltr')}</Frame>
        <Frame dark dir="rtl">{panel('rtl')}</Frame>
      </div>
    );
  },
};

/**
 * Composer interaction: type a draft and submit it. `play` drives it so the
 * story is a live regression of the send path (draft trimmed, cleared on send).
 */
export const ComposerInteraction = {
  name: 'chat-thread (composer send)',
  render: () => (
    <Frame>
      <div className="h-[26rem]">
        <ChatThread messages={threadModel(2)} onSend={() => {}} now={CHAT_DEMO_EPOCH} />
      </div>
    </Frame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('[data-part="composer"] input');
    const form = canvasElement.querySelector<HTMLFormElement>('[data-part="composer"]');
    if (input === null || form === null) return;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'On it — sending the revised plan now.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  },
};
