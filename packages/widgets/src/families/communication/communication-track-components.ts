/**
 * `communication` family component barrel — the single lazy-import target for
 * this track's definitions, so the registry's metadata graph reaches the
 * @adminium/ui-heavy widget components only through a dynamic `import()`
 * boundary (one lazy chunk for the family, 04 §2.3). Mirrors the
 * kpi/charts/feeds/boards `*-components.ts` convention.
 */
export { AiChatPanelWidget } from './AiChatPanel.js';
export { CallWidgetWidget } from './CallWidget.js';
export { ChatThreadWidget } from './ChatThread.js';
export { ConversationInboxWidget } from './ConversationInbox.js';
export { TypingIndicatorWidget } from './TypingIndicator.js';
