// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminium/engine` inference entry point — 05-introspection-engine.md §6
 * rules 1–2, the relations a schema implies but never declares.
 *
 * Runs BEFORE classification (`applyInference` → `applyClassification`), not
 * inside it: both classifiers read `model.relations`, and the whole point of
 * inferring a relation is that they should see it.
 */
export {
  applyInference,
  inferJoinTableRelations,
  inferNameRelations,
  inferRelations,
  type InferredRelation,
} from './relations.js';
