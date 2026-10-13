// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The board, for the project UI kit's `Board`: the kanban component and the
 * shapes it takes, apart from the widget registry. Imported only through a
 * dynamic `import()`, so drag-and-drop loads with the first board drawn.
 */
export { KanbanBoard, type KanbanBoardProps, type KanbanBoardLabels } from './families/boards/KanbanBoard.js';
export { InlineComposeCard, type InlineComposeCardProps } from './families/boards/InlineComposeCard.js';
export type { BoardAddRefusal } from './families/boards/board-dnd.js';
export type { BoardCardAction, BoardCardData, BoardCardLine, ColumnDef } from './families/boards/board-lib.js';
