/**
 * `communication` family public surface (annex §9) — the standalone chat
 * components plus the Track-COMM registry metadata. Component code is also
 * reachable through each definition's `lazy()` ref, so the registry still emits
 * one chunk per family (04 §2.3); this barrel is for direct template/story
 * composition and tests. Registry metadata lives in
 * `communication-track.definitions.ts`.
 */
export {
  AiChatPanel,
  AiChatPanelWidget,
  aiChatPanelConfigSchema,
  aiChatPanelDemoData,
  type AiChatPanelConfig,
  type AiChatPanelProps,
  type AiTurn,
} from './AiChatPanel.js';
export {
  ChatThread,
  ChatThreadWidget,
  chatThreadConfigSchema,
  chatThreadDemoData,
  type ChatThreadConfig,
  type ChatThreadProps,
} from './ChatThread.js';
export {
  ConversationInbox,
  ConversationInboxWidget,
  conversationInboxConfigSchema,
  conversationInboxDemoData,
  type ConversationInboxConfig,
  type ConversationInboxProps,
  type ConversationRow,
} from './ConversationInbox.js';
export {
  CHAT_DEMO_EPOCH,
  attachmentsOf,
  chatRowsOf,
  fmtClock,
  fmtCount,
  fmtDaySeparator,
  groupMessages,
  isoDayOf,
  localeOf,
  sortBySentAt,
  sourceOf,
  toChatMessage,
  type ChatAttachment,
  type ChatBubble,
  type ChatDayGroup,
  type ChatMessage,
} from './chat-lib.js';
export {
  aiChatPanelDefinition,
  chatThreadDefinition,
  communicationTrackDefinitions,
  conversationInboxDefinition,
} from './communication-track.definitions.js';
