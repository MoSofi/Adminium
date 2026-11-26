// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who the preview signs in as (`designer/preview.ts`). `.localhost` is a name
 * nobody can own. Kept apart from the preview's routes so that what only asks
 * "is this the preview user?" (`plugins/auth.ts`, `designer/live-preview.ts`)
 * imports no route.
 */
export const PREVIEW_USER_EMAIL = 'preview@adminium.localhost';
