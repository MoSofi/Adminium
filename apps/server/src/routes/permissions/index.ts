// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Permission catalog: the vocabulary a role editor may offer, served because
 * the dashboard CANNOT read it at the source — `apps/dashboard` has no
 * `@adminium/meta` dependency (dependency-cruiser
 * `dashboard-no-meta-adapters-llm`), so without this endpoint a permissions UI
 * would have to hard-code a second copy of the closed set and drift from it.
 *
 * Built from meta's `GRANTABLE_SYSTEM_ACTION_KEYS` — the closed set MINUS
 * `RESERVED_SYSTEM_ACTION_KEYS` (automations/webhooks/manifests/sql.run), which
 * have no v1 enforcement point. Offering a key nothing checks is misleading
 * security UI, so the reserved four never appear here even though the grammar
 * still parses stored grants that mention them.
 *
 * `label` is an English fallback: the dashboard localizes by `key` and falls
 * back to this when a key has no translation yet.
 *
 * Guarded by `system:roles:manage` — the catalog is only useful to whoever may
 * edit the matrix, and it enumerates the workspace's capability surface.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  GRANTABLE_SYSTEM_ACTION_KEYS,
  type ReservedSystemActionKey,
  type SystemActionKey,
} from '@adminium/meta';

import { PAGE_ACTIONS, PERMISSIONS, TABLE_ACTIONS } from '../../rbac/permissions.js';

/** Grouping for the matrix's row headers — presentation only. */
export const permissionCategory = z.enum(['access', 'data', 'workspace', 'operations']);
export type PermissionCategory = z.infer<typeof permissionCategory>;

export const systemPermissionDto = z.object({
  /** A grant string, e.g. `system:users:manage`. */
  key: z.string(),
  label: z.string(),
  category: permissionCategory,
});
export type SystemPermissionDto = z.infer<typeof systemPermissionDto>;

export const permissionCatalogReply = z.object({
  system: z.array(systemPermissionDto),
  /** `table:<conn>:<table>:<action>` action vocabulary. */
  tableActions: z.array(z.string()),
  /** `page:<pageId>:<action>` action vocabulary. */
  pageActions: z.array(z.string()),
});
export type PermissionCatalogReply = z.infer<typeof permissionCatalogReply>;

type GrantableActionKey = Exclude<SystemActionKey, ReservedSystemActionKey>;

/**
 * Exhaustive by TYPE: a new grantable key that lands without an entry here is
 * a compile error, and a reserved key added here is one too.
 */
const SYSTEM_PERMISSION_META: Record<
  GrantableActionKey,
  { label: string; category: PermissionCategory }
> = {
  'users.manage': { label: 'Manage users', category: 'access' },
  'roles.manage': { label: 'Manage roles and permissions', category: 'access' },
  'api-keys.manage': { label: 'Manage API keys', category: 'access' },
  'settings.manage': { label: 'Manage workspace settings', category: 'workspace' },
  'audit.read': { label: 'Read the audit log', category: 'workspace' },
  'pages.manage': { label: 'Create and organize pages', category: 'workspace' },
  'connections.manage': { label: 'Manage database connections', category: 'data' },
  'schema.remap': { label: 'Edit schema labels and overrides', category: 'data' },
  'schema.ddl': { label: 'Create, edit and delete tables', category: 'data' },
  'exports.manage': { label: "Manage everyone's exports", category: 'data' },
  'imports.manage': { label: "Manage everyone's imports", category: 'data' },
  'reports.manage': { label: 'Manage scheduled reports', category: 'data' },
  'llm.run': { label: 'Run AI assist', category: 'operations' },
  'jobs.read': { label: 'See all background jobs', category: 'operations' },
  'jobs.manage': { label: 'Start and cancel background jobs', category: 'operations' },
  // `operations` rather than `workspace`: installing an add-on runs its
  // server half in this process, which is closer to "start a job" than
  // to "change a setting" — exists precisely to stop it riding on
  // `settings.manage`.
  'manifests.manage': { label: 'Install and manage apps and add-ons', category: 'operations' },
  // `files.manage` is `data` — it is about other people's records'
  // attachments, beside the exports/imports rows it mirrors. `storage.manage`
  // is `workspace`: it configures where the whole instance writes bytes and
  // holds a credential, which is infrastructure rather than data.
  'files.manage': { label: "Manage everyone's files", category: 'data' },
  'storage.manage': { label: 'Manage storage destinations', category: 'workspace' },
  // `operations` beside the jobs rows: a rule is work the instance
  // performs on its own, and the two pages it gates are read as "what is this
  // deployment doing" rather than "how is this workspace configured".
  'automations.manage': { label: 'Manage automations and their logs', category: 'operations' },
  // `workspace` beside `pages.manage`: it reads the pages and schema
  // customizations a project folder holds.
  'project.read': { label: 'Read pages and schema changes for a project pull', category: 'workspace' },
  // `operations` beside `llm.run`: this is a model doing work on request, not
  // a setting. It is a key of its own because it is what sends a page's
  // documents and readable rows to a third-party model, which an operator may
  // want to withhold from a role that still administers the provider.
  'assistant.use': { label: 'Use the page assistant', category: 'operations' },
};

/** `users.manage` → `system:users:manage` (spells the dot as a colon). */
function grantStringFor(key: GrantableActionKey): string {
  const dot = key.indexOf('.');
  return `system:${key.slice(0, dot)}:${key.slice(dot + 1)}`;
}

export const permissionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/permissions/catalog',
    {
      preHandler: app.rbac.require(PERMISSIONS.rolesManage),
      schema: { response: { 200: permissionCatalogReply } },
    },
    async () => ({
      system: GRANTABLE_SYSTEM_ACTION_KEYS.map((key) => ({
        key: grantStringFor(key),
        ...SYSTEM_PERMISSION_META[key],
      })),
      tableActions: [...TABLE_ACTIONS],
      pageActions: [...PAGE_ACTIONS],
    }),
  );
};
