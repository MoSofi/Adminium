/**
 * `boards` family public surface (annex §6) — the kanban board + swimlane grid
 * components plus their registry metadata. Component code is also reachable
 * through each definition's `lazy()` ref, so the registry still emits one chunk
 * per family (04 §2.3); this barrel is for direct template/story composition and
 * tests. Registry metadata lives in `boards-track.definitions.ts`.
 */
export {
  KanbanBoard,
  KanbanBoardWidget,
  kanbanBoardConfigSchema,
  kanbanBoardDemoData,
  kanbanColumnDefSchema,
  type KanbanBoardConfig,
  type KanbanBoardLabels,
  type KanbanBoardProps,
} from './KanbanBoard.js';
export {
  KanbanSwimlaneGrid,
  KanbanSwimlaneGridWidget,
  decodeCell,
  encodeCell,
  kanbanSwimlaneGridConfigSchema,
  kanbanSwimlaneGridDemoData,
  type KanbanSwimlaneGridConfig,
  type KanbanSwimlaneGridProps,
  type SwimlaneLabels,
} from './KanbanSwimlaneGrid.js';
export {
  BoardCard,
  type BoardCardProps,
} from './BoardCard.js';
export {
  boardRowsOf,
  boardToneOf,
  cardsInCell,
  cardsInColumn,
  humanizeEnum,
  priorityTone,
  resolveColumns,
  resolveLanes,
  sumPoints,
  toBoardCard,
  type BoardCardData,
  type ColumnDef,
  type LaneDef,
} from './board-lib.js';
export {
  defaultBoardAnnouncements,
  type BoardAnnouncements,
  type MoveResult,
} from './board-dnd.js';
export {
  boardsTrackDefinitions,
  kanbanBoardDefinition,
  kanbanSwimlaneGridDefinition,
} from './boards-track.definitions.js';
