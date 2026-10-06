// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What each skill's `references/` folder is produced from.
 *
 * `page` is a docs page under apps/docs/src/content/docs/. It is split by
 * heading into files of 8 KB or less, named `<area>/<page>--<heading>.md`
 * (`flat: true` drops the page from the name, for an area that is one page).
 * `generator` names a table produced from something other than a docs page.
 *
 * Edit this file, then run  pnpm run skills-references.
 */
const PROJECT_PAGES = ['index', 'folder', 'page-files', 'pull-and-check', 'hooks-and-actions', 'pages-and-widgets', 'deploy'];

export default {
  adminium: [
    { area: 'projects', page: 'projects/index.md' },
    { area: 'projects', page: 'projects/apps.md' },
    { area: 'projects', page: 'projects/folder.md' },
    { area: 'cli', page: 'reference/cli.md', flat: true },
  ],
  'adminium-app': [
    { area: 'projects', page: 'projects/apps.md' },
    { area: 'guides', page: 'guides/apps/manifest-by-task.md' },
    { area: 'guides', page: 'guides/apps/sample-data.md' },
    { area: 'guides', page: 'guides/apps/roles-and-staff-access.md' },
    { area: 'guides', page: 'guides/apps/settings.md' },
    { area: 'guides', page: 'guides/apps/orders-with-lines.md' },
    { area: 'guides', page: 'guides/apps/booking-rules.md' },
    { area: 'guides', page: 'guides/apps/timed-moves.md' },
    { area: 'guides', page: 'guides/apps/postings.md' },
    { area: 'guides', page: 'guides/apps/undo-a-status-move.md' },
    { area: 'guides', page: 'guides/apps/shared-menu.md' },
    { area: 'guides', page: 'guides/apps/emails.md' },
    { area: 'guides', page: 'guides/apps/public-access.md' },
    { area: 'install', page: 'self-hosting/installing-apps.md', flat: true },
    { area: 'manifest', page: 'reference/manifest.md', flat: true },
    { area: 'cli', page: 'reference/cli.md', flat: true },
  ],
  'adminium-surface': [
    { area: 'guides', page: 'guides/apps/building-a-side.md' },
    { area: 'guides', page: 'guides/apps/public-access.md' },
    { area: 'guides', page: 'guides/apps/identity-and-own-links.md' },
    { area: 'guides', page: 'guides/apps/public-pictures.md' },
    { area: 'guides', page: 'guides/apps/roles-and-staff-access.md' },
    { area: 'guides', page: 'guides/apps/orders-with-lines.md' },
    { area: 'guides', page: 'guides/apps/booking-rules.md' },
    { area: 'public-api', page: 'guides/public-api/endpoints-and-keys.md', flat: true },
    { area: 'public-api', generator: 'public-routes' },
    { area: 'errors', page: 'reference/errors.md', flat: true },
    { area: 'projects', page: 'projects/apps.md' },
    { area: 'cli', page: 'reference/cli.md', flat: true },
  ],
  'adminium-add-ons': [
    { area: 'guides', page: 'guides/building-on-an-add-on.md' },
    { area: 'guides', page: 'guides/apps/emails.md' },
    { area: 'install', page: 'self-hosting/installing-add-ons.md', flat: true },
    { area: 'catalogue', generator: 'add-on-catalogue' },
    { area: 'cli', page: 'reference/cli.md', flat: true },
  ],
  'adminium-project': [
    ...PROJECT_PAGES.map((name) => ({ area: 'projects', page: `projects/${name}.md` })),
    { area: 'projects', page: 'projects/apps.md' },
    { area: 'cli', page: 'reference/cli.md', flat: true },
  ],
};
