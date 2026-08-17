// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Human vocabulary for the 14 page templates.
 *
 * `page-crud` is the reason this exists. Its id humanizes to "Crud", which is
 * developer jargon for a concept the person choosing it thinks of as "a table
 * of records" — and the locale catalogue has ALWAYS called it "Records". The
 * picker was humanizing ids instead of reading those strings, so it showed the
 * jargon while the correct word sat unused in eight locales.
 *
 * WHICH KEY SCHEME: `templates.<localName>.title`, the one already live and
 * already translated. `pageTemplateDefinitions` declares a rival
 * `descriptionKey` of `templates.<camelCaseId>.description` (`templates.pageCrud.…`)
 * that resolves in no bundle and never has. Adopting it would put two naming
 * schemes for the same 14 templates in one namespace — `templates.crud.title`
 * beside `templates.pageCrud.description` — so descriptions are added under the
 * EXISTING local names instead, and the unused declaration stays unused.
 */

/** Template id → the local name its `templates.*` strings are filed under. */
const LOCAL_NAME: Record<string, string> = {
  'page-crud': 'crud',
  'page-dashboard': 'dashboard',
  'page-board': 'board',
  'page-calendar': 'calendar',
  'page-scheduler': 'scheduler',
  'page-directory': 'directory',
  'page-master-detail': 'masterDetail',
  'page-queue-inbox': 'queueInbox',
  'page-log-viewer': 'logViewer',
  'page-files': 'files',
  'page-chat': 'chat',
  'page-builder': 'builder',
  'page-wizard': 'wizard',
  'page-settings': 'settings',
};

/**
 * English fallbacks, mirroring the `templates.<local>.title` bundle values.
 * `t()` requires a fallback and uses it before i18n initialises, so these have
 * to match what the catalogue says or the label flickers on boot.
 */
const TITLE_FALLBACK: Record<string, string> = {
  'page-crud': 'Records',
  'page-dashboard': 'Dashboard',
  'page-board': 'Board',
  'page-calendar': 'Calendar',
  'page-scheduler': 'Scheduler',
  'page-directory': 'Directory',
  'page-master-detail': 'List & detail',
  'page-queue-inbox': 'Queue',
  'page-log-viewer': 'Logs',
  'page-files': 'Files',
  'page-chat': 'Chat',
  'page-builder': 'Builder',
  'page-wizard': 'Wizard',
  'page-settings': 'Settings',
};

/** One line on what the template is FOR — the half a name cannot carry. */
const DESCRIPTION_FALLBACK: Record<string, string> = {
  'page-crud': 'Rows in a searchable table.',
  'page-dashboard': 'Charts and figures you arrange.',
  'page-board': 'Cards in columns by status.',
  'page-calendar': 'Records on a month grid, by date.',
  'page-scheduler': 'A timeline per person.',
  'page-directory': 'People cards and an org chart.',
  'page-master-detail': 'A list, with the record beside it.',
  'page-queue-inbox': 'A work queue with approve and reject.',
  'page-log-viewer': 'Filterable event lines.',
  'page-files': 'Files and folders to browse.',
  'page-chat': 'Threaded conversations.',
  'page-builder': 'A drag-and-drop document canvas.',
  'page-wizard': 'Guided steps to finish a task.',
  'page-settings': 'Preference rows with toggles.',
};

/**
 * The lucide icon that fits each template, used when the admin has not picked
 * one. Mirrors `DEFAULT_ICONS` in the server's `routes/pages/envelope.ts` —
 * the value the server stamps on a page created without an icon — so the
 * preview shows the glyph the page will actually get rather than a generic
 * file. Every name is a real lucide export, pinned by a test.
 */
const DEFAULT_ICON: Record<string, string> = {
  'page-crud': 'table',
  'page-dashboard': 'layout-dashboard',
  'page-board': 'kanban',
  'page-calendar': 'calendar',
  'page-scheduler': 'calendar-clock',
  'page-directory': 'users',
  'page-master-detail': 'panels-top-left',
  'page-queue-inbox': 'inbox',
  'page-log-viewer': 'scroll-text',
  'page-files': 'folder',
  'page-chat': 'message-square',
  'page-builder': 'pen-tool',
  'page-wizard': 'wand-sparkles',
  'page-settings': 'settings',
};

export function templateDefaultIcon(id: string): string {
  return DEFAULT_ICON[id] ?? 'file';
}

export function templateTitleKey(id: string): string {
  const local = LOCAL_NAME[id];
  return local === undefined ? `templates.${id}.title` : `templates.${local}.title`;
}

export function templateDescriptionKey(id: string): string {
  const local = LOCAL_NAME[id];
  return local === undefined ? `templates.${id}.description` : `templates.${local}.description`;
}

export function templateTitleFallback(id: string): string {
  return TITLE_FALLBACK[id] ?? id;
}

export function templateDescriptionFallback(id: string): string {
  return DESCRIPTION_FALLBACK[id] ?? '';
}
