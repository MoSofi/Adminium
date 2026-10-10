// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard's own places: the screens that are not a page of the
 * workspace's data — Studio, Settings, the account screens.
 *
 * WHY A TABLE HERE. The dashboard's router is code in another package and is
 * not data anything can read at run time; the server has no list of its
 * screens. The assistant is asked "where do I change the invoice numbering"
 * and must answer with a place that exists and that this person can open, so
 * the places are written down once, here, with what each is FOR.
 *
 * WHAT KEEPS IT TRUE. `scripts/check-assistant-places.mjs` (a preflight and CI
 * gate) reads the dashboard's two routers and fails when a path here is not a
 * route, or when its `guard` is not the guard that route's screen is wrapped
 * in. A screen that is renamed or moved fails the gate; it does not become a
 * dead link in an answer.
 *
 * `guard` is the dashboard's own:
 *   - `none`    anyone signed in to the dashboard;
 *   - `studio`  the Admin and Super Admin roles (`studio/studioAccess.ts`);
 *   - a key     the one `system:` permission the screen's guard names.
 *
 * English, like everything a model is told. It answers in the person's language.
 */

export type AssistantPlaceGuard =
  | 'none'
  | 'studio'
  | 'users.manage'
  | 'roles.manage'
  | 'connections.manage'
  | 'automations.manage'
  | 'api-keys.manage'
  | 'manifests.manage'
  | 'audit.read'
  | 'storage.manage'
  | 'pages.manage'
  | 'llm.run';

export interface AssistantPlace {
  /** The route's path, exactly as the dashboard's router spells it. */
  path: string;
  guard: AssistantPlaceGuard;
  /** What the screen is called. */
  name: string;
  /** What is done there, in the words a person would ask with. */
  what: string;
}

/** The role slugs the dashboard's plain Studio guard lets in. */
export const STUDIO_ROLE_SLUGS: readonly string[] = ['admin', 'super-admin'];

export const ASSISTANT_PLACES: readonly AssistantPlace[] = Object.freeze([
  { path: '/', guard: 'none', name: 'Home', what: 'The start page of the dashboard.' },
  { path: '/account', guard: 'none', name: 'Account', what: 'Your own account: your name and details.' },
  { path: '/account/preferences', guard: 'none', name: 'Preferences', what: 'Your own language, theme and display preferences.' },
  { path: '/account/notifications', guard: 'none', name: 'Notification settings', what: 'Which notifications you get, and how.' },
  { path: '/account/security', guard: 'none', name: 'Security', what: 'Your password and how you sign in.' },
  { path: '/email-templates', guard: 'none', name: 'Email templates', what: 'The emails this workspace sends: their subject, wording, layout and languages.' },
  { path: '/report-builder', guard: 'none', name: 'Report builder', what: 'Build, edit and run reports made of figures, charts and tables.' },
  { path: '/automations', guard: 'automations.manage', name: 'Automations', what: 'Rules that act when a row is created, changed or on a schedule: send an email, change a field, call a webhook. Create, edit, switch on or off.' },
  { path: '/workflow-logs', guard: 'automations.manage', name: 'Automation runs', what: 'What each automation rule did and when, and why a run failed.' },
  { path: '/files', guard: 'studio', name: 'Files', what: 'The files uploaded to this workspace.' },
  { path: '/audit', guard: 'audit.read', name: 'Audit log', what: 'Who changed what and when, across the workspace.' },
  { path: '/settings/team', guard: 'users.manage', name: 'Team', what: 'Invite people, remove them, and choose each person\'s roles.' },
  { path: '/settings/roles', guard: 'roles.manage', name: 'Roles', what: 'What each role may view, create, change and delete, table by table and column by column; who may use the assistant.' },
  { path: '/settings/defaults', guard: 'none', name: 'Global defaults', what: 'Workspace-wide appearance and language defaults.' },
  { path: '/settings/translations', guard: 'none', name: 'Languages & translations', what: 'Change any wording in the product, choose which languages people can pick, add a language.' },
  { path: '/studio', guard: 'connections.manage', name: 'Data connections', what: 'Connect a database, rename, pause or delete a connection, read its schema again, its regional settings (currency, time zone).' },
  { path: '/studio/pages', guard: 'pages.manage', name: 'Pages', what: 'Create, edit, reorder, hide and delete pages; a page\'s columns, filters, layout and place in the sidebar.' },
  { path: '/studio/documents', guard: 'manifests.manage', name: 'Document mappings', what: 'Which table and columns an invoice or other document is drawn from, and its numbering.' },
  { path: '/studio/lists', guard: 'studio', name: 'Lists', what: 'The answers a column accepts (option lists), named once and used from anywhere.' },
  { path: '/studio/settings', guard: 'studio', name: 'Workspace settings', what: 'The workspace\'s own settings: its name and branding, email sending (SMTP), sign-in rules, retention, and the doors to the other Studio screens.' },
  { path: '/studio/settings/ai', guard: 'llm.run', name: 'AI settings', what: 'The AI provider and model, the assistant\'s name, whether it may read rows, and the daily allowance per person.' },
  { path: '/studio/settings/project', guard: 'studio', name: 'Project', what: 'The project folder this server runs, and the code it loaded.' },
  { path: '/studio/public-api', guard: 'api-keys.manage', name: 'Public API', what: 'Endpoints and keys that let your own customer or staff pages read this database, through a scope you define.' },
  { path: '/studio/apps', guard: 'manifests.manage', name: 'Hosted apps', what: 'Install, update and remove apps; where each app\'s screens appear, their names and their domains.' },
  { path: '/studio/add-ons', guard: 'manifests.manage', name: 'Add-ons', what: 'Install, update, switch off and set up add-ons: extra capabilities for the workspace and its apps.' },
  { path: '/studio/storage', guard: 'storage.manage', name: 'Storage', what: 'Where this instance keeps uploaded files, exports and other stored bytes.' },
  { path: '/help', guard: 'none', name: 'Help', what: 'Articles on how the product works.' },
  { path: '/changelog', guard: 'none', name: 'What is new', what: 'What changed in each version.' },
  { path: '/about', guard: 'none', name: 'About', what: 'The version that is running, and its licences.' },
]);
