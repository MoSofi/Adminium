// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The DDL authoring half of the engine — 35-schema-authoring.md.
 *
 * Everything here is PURE: a desired-state document, its validator, the
 * definition-level diff, the rename pre-application, and the planner. No
 * connection, no Kysely, no SQL string. That is deliberate and it is what
 * makes all three dialects' plans golden-testable from one fixture set with no
 * database in sight (§3.2).
 *
 * The executor — the half that compiles a step into a `CompiledQuery` and runs
 * it — lives in `apps/server/src/schema-ddl/`, for the same reason
 * `install-ddl.ts` lives there rather than in `@adminium/manifest`: applying
 * needs a live connection, and the dep-cruiser matrix does not let this
 * package reach for Kysely.
 */
export * from './edit.js';
export * from './diff-definitions.js';
export * from './rename.js';
export * from './type-map.js';
export * from './steps.js';
export * from './plan.js';
export * from './reserved-words/index.js';
