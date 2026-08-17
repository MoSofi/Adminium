// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `boards` family component barrel — the single lazy-import target for this
 * family's definitions, so the registry metadata graph reaches the dnd-kit-heavy
 * kanban components only through a dynamic `import()` boundary (one lazy chunk
 * for the family, 04 §2.3). This is the ONLY place dnd-kit enters the graph;
 * every other family's chunk stays free of it (chunk-budget gate). Mirrors the
 * kpi/charts/feeds `components.ts` convention.
 */
export { KanbanBoardWidget } from './KanbanBoard.js';
export { KanbanSwimlaneGridWidget } from './KanbanSwimlaneGrid.js';
// M7 Wave-4 TAIL — the two §6 widgets that complete the family.
export { BoardCardWidget } from './BoardCard.js';
export { InlineComposeCardWidget } from './InlineComposeCard.js';
