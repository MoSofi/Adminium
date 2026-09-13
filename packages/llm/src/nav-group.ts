// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How long a nav-group slug may be.
 *
 * It lives here, in the package that VALIDATES a model's response, and is
 * mirrored by `@adminium/meta`'s `0032_nav_group_width.ts`, which is the
 * package that stores it. The two cannot import each other — `@adminium/llm`
 * knows nothing about a database — so the number is written twice and asserted
 * equal by `packages/meta/test/nav-group-width.test.ts`, which is the only
 * place both are in scope.
 *
 * The column was `varchar(12)` until 2026-09-10 and nothing bounded the model's
 * side at all, so a two-word slug — `client-management` — reached PostgreSQL
 * and came back as `value too long for type character varying(12)`, mid-apply,
 * as an unhandled 500.
 */
export const NAV_GROUP_MAX = 48;
