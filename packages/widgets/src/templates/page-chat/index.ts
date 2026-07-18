/**
 * `page-chat` template (09-generated-app.md §7.9; 04 §10) — the component the
 * dashboard PageRenderer mounts for `template: 'page-chat'` envelopes, plus
 * the pure chat field-mapping helpers its binding and tests share.
 */
export {
  PAGE_CHAT_TEMPLATE_ID,
  PageChat,
  classifyChatItems,
  type PageChatLabels,
  type PageChatProps,
} from './PageChat.js';
export {
  detectConversationFields,
  detectConversationFk,
  detectMessageFields,
  displayNameOf,
  filterMessagesRows,
  toChatMessages,
  toConversationRows,
  type ChatMessageFieldMap,
  type ConversationFieldMap,
} from './chat-mapping.js';
export { demoChatLayout } from './demo-layout.js';
