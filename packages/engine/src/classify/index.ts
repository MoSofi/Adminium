/**
 * `@adminium/engine` classification entry point — 05-introspection-engine.md
 * §§6–8 (05-T07 column semantics + PII layer, 05-T08 table shapes).
 *
 * Everything here is pure and deterministic: same model in, same
 * classification out — a requirement inherited by `generate()` (05 §9).
 */
import type { DatabaseModel } from '../schema-model.js';
import { classifyTable, type ClassifiedTable } from './tables.js';

export { nameTokens, normalizeName } from './names.js';
export { detectPii, type PiiContext, type PiiResult } from './pii.js';
export {
  buildColumnClassifyContext,
  checkBounds,
  classifyColumn,
  classifyTableColumns,
  COLUMN_RULE_IDS,
  PEOPLE_TABLE_RE,
  WORKFLOW_VALUE_RE,
  type ClassifiedColumn,
  type ColumnClassifyContext,
  type PairAssignment,
} from './columns.js';
export {
  classifyTable,
  detectJoinTable,
  isPreHiddenTable,
  selectDisplayColumn,
  selectNaturalKey,
  TABLE_SHAPE_KINDS,
  type ClassifiedTable,
  type JoinTableResult,
  type TableShape,
  type TableShapeKind,
} from './tables.js';

/** Full classification result for a model, sorted by tableId for stability. */
export interface ClassifiedModel {
  /** `${schema}.${name}` of the source model, for traceability. */
  modelName: string;
  tables: ClassifiedTable[];
}

/** Classify every table + column of a model. Pure; does not mutate `model`. */
export function classifyModel(model: DatabaseModel): ClassifiedModel {
  const tables = [...model.tables]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((table) => classifyTable(model, table));
  return { modelName: model.name, tables };
}

/**
 * Return a NEW model with `ColumnModel.semantics` / `TableModel.semantics`
 * filled from the classifier. Existing non-heuristic semantics (LLM or
 * Studio overrides — `source: 'llm' | 'override'`) are preserved: overrides
 * always win (05 §7).
 */
export function applyClassification(model: DatabaseModel): DatabaseModel {
  const classified = new Map(classifyModel(model).tables.map((t) => [t.tableId, t]));
  return {
    ...model,
    tables: model.tables.map((table) => {
      const result = classified.get(table.id);
      if (result === undefined) return table;
      const byColumn = new Map(result.columns.map((c) => [c.column, c]));
      return {
        ...table,
        semantics: table.semantics ?? result.semantics,
        columns: table.columns.map((column) => {
          if (column.semantics !== null && column.semantics.source !== 'heuristic') {
            return column;
          }
          const columnResult = byColumn.get(column.name);
          return columnResult === undefined
            ? column
            : { ...column, semantics: columnResult.semantics };
        }),
      };
    }),
  };
}
