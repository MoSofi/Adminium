import { lazy } from 'react';

import {
  aiChatPanelConfigSchema,
  aiChatPanelDemoData,
  callWidgetConfigSchema,
  callWidgetDemoData,
  chatThreadConfigSchema,
  chatThreadDemoData,
  conversationInboxConfigSchema,
  conversationInboxDemoData,
  typingIndicatorConfigSchema,
  typingIndicatorDemoData,
} from './communication-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * Track COMM contribution to the `communication` family (annex §9) — the
 * conversation+message pair that closes the M7 Wave-3 exit criterion "a chat for
 * conversation+message pairs", plus the LLM assist panel shell.
 *
 * Metadata only — the @adminium/ui-heavy widget components load through the
 * `communication-track-components` barrel via `lazy(() => import(...))`, so the
 * family stays in one lazy chunk and the registry metadata never eagerly pulls
 * component code (04 §2.3; the kpi/charts/feeds/boards convention). The GREEN
 * LOOP spreads `communicationTrackDefinitions` into the registry map. Widget ids
 * match the annex catalog exactly (acceptance #1).
 *
 * Sizing converts the annex's row counts to the grid's 40px HALF-row units
 * (04 §6.1 — `minH = round(annexRows × 2)`).
 */

export const conversationInboxDefinition: WidgetDefinition = defineWidget({
  id: 'conversation-inbox',
  family: 'communication',
  component: lazy(() =>
    import('./communication-track-components.js').then((m) => ({ default: m.ConversationInboxWidget })),
  ),
  configSchema: conversationInboxConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 3, minH: 10, defaultW: 4, defaultH: 12 }, // annex min 3×5 (left pane)
  placement: 'grid',
  skeleton: 'list',
  demoData: conversationInboxDemoData,
  descriptionKey: 'widgets.communication.conversationInbox.description',
});

export const chatThreadDefinition: WidgetDefinition = defineWidget({
  id: 'chat-thread',
  family: 'communication',
  component: lazy(() => import('./communication-track-components.js').then((m) => ({ default: m.ChatThreadWidget }))),
  configSchema: chatThreadConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 6, minH: 10, defaultW: 8, defaultH: 14 }, // annex main pane, min 6×5
  placement: 'grid',
  skeleton: 'list',
  // The composer emits an `insert` intent; the host runs it through the CRUD
  // API (audit + undo). The widget itself never writes.
  capabilities: { editsData: true },
  demoData: chatThreadDemoData,
  descriptionKey: 'widgets.communication.chatThread.description',
});

export const aiChatPanelDefinition: WidgetDefinition = defineWidget({
  id: 'ai-chat-panel',
  family: 'communication',
  component: lazy(() => import('./communication-track-components.js').then((m) => ({ default: m.AiChatPanelWidget }))),
  configSchema: aiChatPanelConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 10, defaultW: 4, defaultH: 12 }, // annex min 4×5, default rail 4×6
  placement: 'grid',
  skeleton: 'list',
  capabilities: { editsData: true },
  demoData: aiChatPanelDemoData,
  descriptionKey: 'widgets.communication.aiChatPanel.description',
});

export const typingIndicatorDefinition: WidgetDefinition = defineWidget({
  id: 'typing-indicator',
  family: 'communication',
  component: lazy(() =>
    import('./communication-track-components.js').then((m) => ({ default: m.TypingIndicatorWidget })),
  ),
  configSchema: typingIndicatorConfigSchema,
  // annex §9: "boolean per conversation" — the §3 `boolean-map` shape, keyed by
  // conversation id (`isEmptyByShape` reads `entries`, so an unbound instance
  // routes to the empty state rather than sitting silently idle).
  dataContract: 'boolean-map',
  sizing: { minW: 2, minH: 1, defaultW: 3, defaultH: 1 }, // annex "child of thread"
  placement: 'inline',
  skeleton: 'list',
  demoData: typingIndicatorDemoData,
  descriptionKey: 'widgets.communication.typingIndicator.description',
});

export const callWidgetDefinition: WidgetDefinition = defineWidget({
  id: 'call-widget',
  family: 'communication',
  component: lazy(() => import('./communication-track-components.js').then((m) => ({ default: m.CallWidgetWidget }))),
  configSchema: callWidgetConfigSchema,
  // annex §9: "{kind, peer, state}" — one row, i.e. the §3 `record` shape.
  dataContract: 'record',
  // annex "modal overlay"; the sizing is what `page-chat`'s optional `call`
  // slot (3×6) reserves, so a host that grid-places it instead still fits.
  sizing: { minW: 3, minH: 6, defaultW: 3, defaultH: 6 },
  placement: 'overlay',
  skeleton: 'card',
  // Accept/decline are `mutate` intents on the call row — the host runs them
  // through the CRUD API (audit + undo). The widget itself never writes.
  capabilities: { editsData: true },
  demoData: callWidgetDemoData,
  descriptionKey: 'widgets.communication.callWidget.description',
});

export const communicationTrackDefinitions: readonly WidgetDefinition[] = [
  conversationInboxDefinition,
  chatThreadDefinition,
  typingIndicatorDefinition,
  aiChatPanelDefinition,
  callWidgetDefinition,
];
