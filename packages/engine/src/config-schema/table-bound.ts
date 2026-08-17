// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which page templates are composed from a SINGLE table.
 *
 * Lives in the browser-safe config leaf, not beside the composer that consumes
 * it, because both sides of the feature need it and only one of them can reach
 * the engine root: the server composes with it, and the dashboard's page editor
 * uses it to decide whether to show a table picker at all
 * (`dashboard-no-full-engine` limits the dashboard to this subpath). It is a
 * list of strings with no dependencies, so putting it here costs nothing and
 * removes the second copy that would otherwise drift.
 *
 * The excluded templates are excluded for two different reasons, both real:
 * `page-dashboard` composes from a DOMAIN — a cluster of related tables — and
 * is edited widget by widget in the dashboard builder; `page-builder`,
 * `page-wizard` and `page-settings` are tool surfaces whose renderers ignore
 * the stored body entirely.
 */

export const TABLE_BOUND_TEMPLATES: readonly string[] = [
  'page-crud',
  'page-board',
  'page-calendar',
  'page-scheduler',
  'page-directory',
  'page-master-detail',
  'page-queue-inbox',
  'page-log-viewer',
  'page-files',
  'page-chat',
];

export function isTableBoundTemplate(template: string): boolean {
  return TABLE_BOUND_TEMPLATES.includes(template);
}
