import { lazy } from 'react';

import {
  boardCardConfigSchema,
  boardCardDemoData,
  inlineComposeCardConfigSchema,
  inlineComposeCardDemoData,
  kanbanBoardConfigSchema,
  kanbanBoardDemoData,
  kanbanSwimlaneGridConfigSchema,
  kanbanSwimlaneGridDemoData,
} from './boards-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * `boards` family registry metadata (annex §6; M7-T03 / 04-T10). Metadata only —
 * the dnd-kit-heavy widget components load through the `boards-track-components`
 * barrel via `lazy(() => import(...))`, so the family stays in ONE lazy chunk and
 * the registry metadata never eagerly pulls dnd-kit into a sibling family's
 * bundle (04 §2.3; chunk-budget gate). The GREEN LOOP spreads
 * `boardsTrackDefinitions` into the registry map. Widget ids match the annex
 * catalog exactly (acceptance #1).
 *
 * `placement: 'page'` — both kanban widgets fill the page body (annex "full page
 * body"). `capabilities.editsData` — a committed card move is an UPDATE mutation
 * the host runs through the CRUD API (with undo + audit).
 */

export const kanbanBoardDefinition: WidgetDefinition = defineWidget({
  id: 'kanban-board',
  family: 'boards',
  component: lazy(() =>
    import('./boards-track-components.js').then((m) => ({ default: m.KanbanBoardWidget })),
  ),
  configSchema: kanbanBoardConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 8, minH: 10, defaultW: 12, defaultH: 16 }, // annex "min 8×5" → h = 5×2
  placement: 'page',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: kanbanBoardDemoData,
  descriptionKey: 'widgets.boards.kanbanBoard.description',
});

export const kanbanSwimlaneGridDefinition: WidgetDefinition = defineWidget({
  id: 'kanban-swimlane-grid',
  family: 'boards',
  component: lazy(() =>
    import('./boards-track-components.js').then((m) => ({ default: m.KanbanSwimlaneGridWidget })),
  ),
  configSchema: kanbanSwimlaneGridConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 8, minH: 12, defaultW: 12, defaultH: 18 }, // annex "full page body"
  placement: 'page',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: kanbanSwimlaneGridDemoData,
  descriptionKey: 'widgets.boards.kanbanSwimlaneGrid.description',
});

// ── M7 Wave-4 TAIL — the two §6 widgets that complete the family ───────────

export const boardCardDefinition: WidgetDefinition = defineWidget({
  id: 'board-card',
  family: 'boards',
  component: lazy(() => import('./boards-track-components.js').then((m) => ({ default: m.BoardCardWidget }))),
  configSchema: boardCardConfigSchema,
  // annex §6: "single record {title, tag, pct?, points?, priority?, owner, due?,
  // budget?}" — the `record` shape, whose envelope is `{ row }`.
  dataContract: 'record',
  sizing: { minW: 3, minH: 4, defaultW: 3, defaultH: 4 }, // annex "child of board"
  placement: 'inline', // a card is composed into a column, never grid-placed
  skeleton: 'card',
  demoData: boardCardDemoData,
  descriptionKey: 'widgets.boards.boardCard.description',
});

export const inlineComposeCardDefinition: WidgetDefinition = defineWidget({
  id: 'inline-compose-card',
  family: 'boards',
  component: lazy(() => import('./boards-track-components.js').then((m) => ({ default: m.InlineComposeCardWidget }))),
  configSchema: inlineComposeCardConfigSchema,
  // annex §6: "transient draft → INSERT with defaults" — a draft IS `form-state`.
  dataContract: 'form-state',
  sizing: { minW: 3, minH: 3, defaultW: 4, defaultH: 4 }, // annex "child of column"
  placement: 'inline',
  skeleton: 'card',
  // Add emits a `mutate` INSERT intent; the host runs it through the CRUD API
  // with the column's defaults — the widget never writes.
  capabilities: { editsData: true },
  demoData: inlineComposeCardDemoData,
  descriptionKey: 'widgets.boards.inlineComposeCard.description',
});

export const boardsTrackDefinitions: readonly WidgetDefinition[] = [
  kanbanBoardDefinition,
  kanbanSwimlaneGridDefinition,
  boardCardDefinition,
  inlineComposeCardDefinition,
];
