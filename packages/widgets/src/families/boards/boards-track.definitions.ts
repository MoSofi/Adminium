import { lazy } from 'react';

import {
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

export const boardsTrackDefinitions: readonly WidgetDefinition[] = [
  kanbanBoardDefinition,
  kanbanSwimlaneGridDefinition,
];
