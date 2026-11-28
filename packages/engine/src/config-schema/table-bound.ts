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
 * is edited widget by widget in the dashboard builder; `page-builder` and
 * `page-wizard` are tool surfaces whose renderers ignore the stored body
 * entirely.
 *
 * `page-settings` is both. With a table it is that table as ONE record (an
 * app's settings row): composed and stored exactly as a records page is
 * ({@link composesAsRecords}), and drawn as its row's form. With none it is
 * the notification settings, whose renderer ignores the body.
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
  'page-settings',
];

/**
 * Templates whose body IS a records page's (`buildCrudEnvelope`): its columns,
 * its form, its detail. `page-settings` draws that body as one record's form.
 */
export const RECORDS_BODY_TEMPLATES: readonly string[] = ['page-crud', 'page-settings'];

export function composesAsRecords(template: string): boolean {
  return RECORDS_BODY_TEMPLATES.includes(template);
}

export function isTableBoundTemplate(template: string): boolean {
  return TABLE_BOUND_TEMPLATES.includes(template);
}
