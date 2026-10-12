// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The board, for the project UI kit's `Board`: the kanban component and the
 * shapes it takes, apart from the widget registry. Imported only through a
 * dynamic `import()`, so drag-and-drop loads with the first board drawn.
 */
export { KanbanBoard, type KanbanBoardProps, type KanbanBoardLabels } from './families/boards/KanbanBoard.js';
export type { BoardCardData, ColumnDef } from './families/boards/board-lib.js';
