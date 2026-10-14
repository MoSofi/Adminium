// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/settings/roles` — the roles & permissions editor, and the FIRST consumer of
 * `PermissionMatrix` from `@adminium/ui` (built, tested and storied since the
 * component wave, with zero call sites until now).
 *
 * THREE THINGS THIS SCREEN HAS TO GET RIGHT.
 *
 * 1. **Only grantable permissions are offered.** The rows come from
 *    `GET /permissions/catalog`, which the server authors from meta's
 *    `GRANTABLE_SYSTEM_ACTION_KEYS`, and `catalogPermissions` filters the
 *    reserved keys a second time on the way in (see `rolesApi.ts`). A switch
 *    for a permission nothing enforces is worse than no switch.
 * 2. **Super-admin is a locked column, not a saveable one.**
 *    `PUT /roles/:id/permissions` 409s on that role — its authority is
 *    implicit rather than a set of matrix rows — so the column renders
 *    hard-locked and the save loop never includes it. Its grants are not even
 *    fetched: the reply would be an empty list, which is the truth about the
 *    stored rows and a lie about what the role can do.
 * 3. **Deleting a populated role asks where its members go.** The server 409s
 *    `DELETE /roles/:id` when the role still has members unless `?reassignTo=`
 *    names another role — so the picker is part of the delete flow rather than
 *    an error the admin discovers afterwards.
 *
 * Saving is explicit and PER TOUCHED ROLE: the endpoint is a full-matrix
 * replace, so writing every column on every save would rewrite — and
 * audit-log — matrices nobody edited. `changedRoleIds` decides what ships.
 *
 * Its text is the DEFERRED `roles` namespace (`rolesMessages.ts`), which the
 * route awaits before this renders; `common:` is read only for the shared
 * Save/Cancel/Close words. `i18n/rolesNamespace.test.ts` holds every inline
 * fallback here to the catalogue text.
 */
import { useMutation, useQueries, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Plus, Rows3, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  FormField,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PermissionMatrix,
  SegmentedControl,
  Select,
  Textarea,
  type PermissionGrant,
} from '@adminium/ui';

import { appSectionsOf, bootstrapQuery, hostedAppsOf } from '../app/bootstrap.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { t } from '../i18n/t.js';
import {
  DATA_ACCESS_GRANTS,
  ROLES_QUERY_KEY,
  ROW_ACTIONS,
  peopleQuery,
  putRoleRows,
  reachOf,
  severalOf,
  roleRowsQuery,
  rowLimitsSave,
  rowsPreviewQuery,
  withReach,
  type PersonRef,
  type RoleRowsTable,
  type RowAction,
  type RowLimit,
  type RowReach,
  type RowWay,
  appStaffRows,
  SUPER_ADMIN_SLUG,
  catalogPermissions,
  changedRoleIds,
  createRole,
  deleteRole,
  isPermissionGrant,
  matrixRows,
  narrowDataGrantCount,
  pendingChangeCount,
  permissionCatalogQuery,
  putRoleGrants,
  renameRole,
  roleGrantsQuery,
  rolesQuery,
  toggleGrant,
  type DataAccessGrant,
  type GrantMap,
  type GrantableCatalogEntry,
  type PermissionCategory,
  type RoleListItem,
} from './rolesApi.js';

function categoryLabel(category: PermissionCategory): string {
  switch (category) {
    case 'access':
      return t('roles:category.access', 'Access');
    case 'data':
      return t('roles:category.data', 'Data');
    case 'workspace':
      return t('roles:category.workspace', 'Workspace');
    case 'operations':
      return t('roles:category.operations', 'Operations');
  }
}

/**
 * Row labels, localized by grant string.
 *
 * A switch and not a lookup built from the key, because `adminium/no-dynamic-
 * i18n-key` correctly forbids assembling `roles:permission.` + key: a
 * fabricated key cannot be checked against the 8 bundles and renders as a raw
 * dotted string when it misses. The `default` is the endpoint's own English
 * `label`, which is exactly the fallback its docblock promises — so a grantable
 * key added to `@adminium/meta` after this build still gets a readable row
 * instead of a blank one, and the missing translation is the only thing lost.
 */
function permissionLabel(entry: GrantableCatalogEntry): string {
  switch (entry.key) {
    case 'system:users:manage':
      return t('roles:permission.usersManage', 'Manage users');
    case 'system:roles:manage':
      return t('roles:permission.rolesManage', 'Manage roles and permissions');
    case 'system:api-keys:manage':
      return t('roles:permission.apiKeysManage', 'Manage API keys');
    case 'system:settings:manage':
      return t('roles:permission.settingsManage', 'Manage workspace settings');
    case 'system:audit:read':
      return t('roles:permission.auditRead', 'Read the audit log');
    case 'system:pages:manage':
      return t('roles:permission.pagesManage', 'Create and organize pages');
    case 'system:project:read':
      return t('roles:permission.projectRead', 'Read pages and schema changes for a project pull');
    case 'system:connections:manage':
      return t('roles:permission.connectionsManage', 'Manage database connections');
    case 'system:schema:remap':
      return t('roles:permission.schemaRemap', 'Edit schema labels and overrides');
    case 'system:schema:ddl':
      return t('roles:permission.schemaDdl', 'Create, edit and delete tables');
    case 'system:exports:manage':
      return t('roles:permission.exportsManage', 'Manage everyone’s exports');
    case 'system:imports:manage':
      return t('roles:permission.importsManage', 'Manage everyone’s imports');
    case 'system:reports:manage':
      return t('roles:permission.reportsManage', 'Manage scheduled reports');
    case 'system:llm:run':
      return t('roles:permission.llmRun', 'Run AI assist');
    case 'system:jobs:read':
      return t('roles:permission.jobsRead', 'See all background jobs');
    case 'system:jobs:manage':
      return t('roles:permission.jobsManage', 'Start and cancel background jobs');
    case 'system:manifests:manage':
      return t('roles:permission.manifestsManage', 'Install and manage apps and add-ons');
    case 'system:files:manage':
      return t('roles:permission.filesManage', 'Manage everyone’s files');
    case 'system:storage:manage':
      return t('roles:permission.storageManage', 'Manage storage destinations');
    case 'system:designer:use':
      return t('roles:permission.designerUse', 'Build apps with Adminium Designer');
    default:
      return entry.label;
  }
}

/** Labels for the every-page / every-table rows ({@link DATA_ACCESS_GRANTS}). */
function dataAccessLabel(key: DataAccessGrant): string {
  switch (key) {
    case 'page:*:view':
      return t('roles:data.pagesView', 'See every page');
    case 'table:*:*:read':
      return t('roles:data.read', 'Read records');
    case 'table:*:*:read_pii':
      return t('roles:data.readPii', 'See personal data in records');
    case 'table:*:*:create':
      return t('roles:data.create', 'Create records');
    case 'table:*:*:update':
      return t('roles:data.update', 'Edit records');
    case 'table:*:*:delete':
      return t('roles:data.delete', 'Delete records');
    case 'table:*:*:export':
      return t('roles:data.export', 'Export records');
    case 'table:*:*:import':
      return t('roles:data.import', 'Import records');
    case 'page:*:edit':
      return t('roles:data.pagesEdit', 'Change page layouts');
  }
}

export function RolesPage(): ReactNode {
  const queryClient = useQueryClient();
  const { data: roles } = useSuspenseQuery(rolesQuery());
  const { data: catalog } = useSuspenseQuery(permissionCatalogQuery());

  // Locked columns are excluded from the fetch, not just from the save — see
  // rule 2 in the header.
  const editableRoles = useMemo(
    () => roles.filter((role) => role.slug !== SUPER_ADMIN_SLUG),
    [roles],
  );

  const grantQueries = useQueries({
    queries: editableRoles.map((role) => roleGrantsQuery(role.id)),
  });

  /** What the server currently holds — the matrix `baseline` and the diff origin. */
  const baseline: GrantMap = useMemo(() => {
    const map: Record<string, PermissionGrant[]> = {};
    editableRoles.forEach((role, index) => {
      const data = grantQueries[index]?.data;
      // An unparseable stored grant is dropped rather than cast: it has no row
      // in the matrix, so keeping it would show as a permanent phantom diff on
      // a cell that does not exist.
      if (data !== undefined) map[role.id] = data.filter(isPermissionGrant);
    });
    return map;
  }, [editableRoles, grantQueries]);

  /**
   * Unsaved edits, or `null` for "nothing touched".
   *
   * An overlay rather than a copy synced by effect: with a copy, every refetch
   * races the user's clicks and either clobbers an edit or strands the baseline
   * one save behind. `null` means the screen simply renders the server's answer.
   */
  const [draft, setDraft] = useState<GrantMap | null>(null);
  const grants = draft ?? baseline;

  /*
   * Pages & records FIRST: it is what decides whether a new teammate sees
   * anything at all, and until these rows existed no screen could grant it —
   * a built-in role's access could only be changed through the API.
   */
  // The installed apps, named as the sidebar names them.
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const installedApps = useMemo(() => {
    if (bootstrap === undefined) return [];
    const byKey = new Map<string, string>();
    for (const app of hostedAppsOf(bootstrap)) if (app.instance === undefined) byKey.set(app.appKey, app.label);
    for (const section of appSectionsOf(bootstrap)) byKey.set(section.appKey, section.label);
    return [...byKey].map(([key, label]) => ({ key, label }));
  }, [bootstrap]);
  const permissions = useMemo(() => {
    const dataCategory = t('roles:category.records', 'Pages & records');
    const appCategory = t('roles:category.apps', 'Apps');
    return [
      ...DATA_ACCESS_GRANTS.map((key) => ({ key, label: dataAccessLabel(key), category: dataCategory })),
      ...appStaffRows(installedApps, baseline).map((row) => ({
        key: row.key,
        label:
          row.app === null
            ? t('roles:apps.every', 'Open every app’s staff screens')
            : t('roles:apps.one', 'Open {app}’s staff screens', { app: row.app.label }),
        category: appCategory,
      })),
      ...matrixRows(catalogPermissions(catalog), permissionLabel, (entry) => categoryLabel(entry.category)),
    ];
  }, [catalog, installedApps, baseline]);
  const narrowGrants = useMemo(() => narrowDataGrantCount(baseline), [baseline]);
  const changed = useMemo(() => changedRoleIds(grants, baseline), [grants, baseline]);
  const pending = useMemo(() => pendingChangeCount(grants, baseline), [grants, baseline]);

  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<RoleListItem | null>(null);
  const [deleting, setDeleting] = useState<RoleListItem | null>(null);
  const [limiting, setLimiting] = useState<RoleListItem | null>(null);

  const loading = grantQueries.some((query) => query.isPending);
  const grantsFailed = grantQueries.some((query) => query.isError);

  const save = useMutation({
    mutationFn: async (roleIds: readonly string[]): Promise<void> => {
      // Sequential, not Promise.all: each PUT writes its own audit row, and a
      // partial failure has to leave the earlier roles saved and say so rather
      // than resolving a race in an unspecified order.
      for (const roleId of roleIds) {
        await putRoleGrants(roleId, grants[roleId] ?? []);
      }
    },
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
    onError: async () => {
      // Whatever DID land is now the truth; re-reading it means the remaining
      // dirty dots are exactly the roles still unsaved. The draft is kept so a
      // retry does not cost the admin their work.
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });

  const create = useMutation({
    mutationFn: createRole,
    onSuccess: async () => {
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });

  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) => renameRole(input.id, { name: input.name }),
    onSuccess: async () => {
      setRenaming(null);
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });

  const remove = useMutation({
    mutationFn: (input: { id: string; reassignTo: string | null }) =>
      deleteRole(input.id, input.reassignTo),
    onSuccess: async () => {
      setDeleting(null);
      // A deleted role's draft column would otherwise linger as a diff against
      // a baseline that no longer has the role at all.
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <PageActions
        title={t('roles:title', 'Roles & permissions')}
        subtitle={t('roles:subtitle', 'What each role may do. A user gets the union of every role they hold.')}
      >
        <Button
          iconLeft={<Plus className="size-4" />}
          onClick={() => setCreateOpen(true)}
          data-testid="roles-create"
        >
          {t('roles:createButton', 'New role')}
        </Button>
      </PageActions>

      {grantsFailed ? (
        <Alert
          role="alert"
          tone="danger"
          data-testid="roles-grants-error"
          title={t('roles:loadFailed.title', 'Some permissions could not be read')}
          body={t(
            'roles:loadFailed.body',
            'The matrix below is incomplete, so saving it would clear permissions that are simply not loaded. Reload before making changes.',
          )}
        />
      ) : null}

      <Card padded={false}>
        <CardHeader className="justify-between flex flex-wrap items-center gap-3">
          <h2 className="text-section flex-1 text-fg">{t('roles:matrix.title', 'Permissions')}</h2>
          <span className="text-body-sm text-fg-subtle" data-testid="roles-pending">
            {pending === 0
              ? t('roles:matrix.noChanges', 'No pending changes')
              : t(
                  'roles:matrix.pending',
                  '{count, plural, one {# pending change} other {# pending changes}}',
                  { count: pending },
                )}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending === 0 || save.isPending}
            onClick={() => setDraft(null)}
          >
            {t('roles:matrix.discard', 'Discard')}
          </Button>
          <Button
            size="sm"
            disabled={pending === 0 || grantsFailed}
            loading={save.isPending}
            onClick={() => save.mutate(changed)}
            data-testid="roles-save"
          >
            {t('common.save', 'Save')}
          </Button>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {save.error === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              className="mb-4"
              title={t('roles:saveFailed.title', 'Could not save every role')}
              body={save.error.message}
            />
          )}
          {permissions.length === 0 ? (
            <EmptyState
              compact
              preset="no-data"
              icon={<ShieldCheck />}
              title={t('roles:matrix.empty.title', 'No permissions to show')}
              body={t(
                'roles:matrix.empty.body',
                'This instance reported no grantable permissions at all, which should not happen — reload, and if it persists check the server log.',
              )}
            />
          ) : (
            <>
              {narrowGrants === 0 ? null : (
                <p className="mb-3 text-body-sm text-fg-muted" data-testid="roles-narrow-grants">
                  {t(
                    'roles:data.narrow',
                    '{count, plural, one {# grant} other {# grants}} on a single page or table also apply, on top of the rows below. Saving keeps them.',
                    { count: narrowGrants },
                  )}
                </p>
              )}
              <PermissionMatrix
                data-testid="roles-matrix"
                label={t('roles:matrix.label', 'Role permissions')}
                rowHeader={t('roles:matrix.rowHeader', 'Permission')}
                roles={roles.map((role) => ({
                  id: role.id,
                  name: role.name,
                  locked: role.slug === SUPER_ADMIN_SLUG,
                }))}
                permissions={permissions}
                grants={grants}
                baseline={baseline}
                disabled={loading || save.isPending}
                onChange={({ roleId, permissionKey, granted }) => {
                  setDraft(toggleGrant(grants, roleId, permissionKey, granted));
                }}
              />
            </>
          )}
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <h2 className="text-section text-fg">{t('roles:list.title', 'Roles')}</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm" data-testid="roles-table">
              <thead>
                <tr className="border-b border-border text-micro uppercase text-fg-subtle">
                  <th scope="col" className="px-4 py-2 text-start font-bold">
                    {t('roles:column.name', 'Role')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-bold">
                    {t('roles:column.members', 'Members')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-bold">
                    {t('roles:column.actions', 'Actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold text-fg">{role.name}</span>
                        {role.description === null ? null : (
                          <span className="truncate text-caption text-fg-subtle">{role.description}</span>
                        )}
                        {role.partsOff === true ? (
                          <span className="truncate text-caption text-fg-subtle" data-part="parts-off">
                            {t('roles:partsOff', 'Its part of the app is switched off: it gives nothing until that part is on.')}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted">
                      {t('roles:memberCount', '{count, plural, one {# user} other {# users}}', {
                        count: role.memberCount,
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          // A save of the rows writes the role's grants as the server holds them: with boxes ticked and not yet
                          // saved it would be working from one set and the matrix from another, and one would undo the other.
                          disabled={role.slug === SUPER_ADMIN_SLUG || changed.length > 0}
                          title={
                            role.slug === SUPER_ADMIN_SLUG
                              ? t('roles:rows.locked', 'Super Admin reaches every row.')
                              : changed.length > 0
                                ? t('roles:rows.saveFirst', 'Save or discard the permission changes first.')
                                : undefined
                          }
                          onClick={() => setLimiting(role)}
                          data-testid={`roles-rows-${role.slug}`}
                        >
                          {t('roles:rows.action', 'Rows')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRenaming(role)}>
                          {t('roles:action.rename', 'Rename')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={role.isBuiltin}
                          title={
                            role.isBuiltin
                              ? t('roles:builtinLocked', 'Built-in roles cannot be deleted.')
                              : undefined
                          }
                          onClick={() => setDeleting(role)}
                        >
                          {t('roles:action.delete', 'Delete')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <CreateRoleDialog
        open={createOpen}
        busy={create.isPending}
        error={create.error === null ? null : create.error.message}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) create.reset();
        }}
        onSubmit={(body) => create.mutate(body)}
      />

      {renaming === null ? null : (
        <RenameRoleDialog
          key={renaming.id}
          role={renaming}
          busy={rename.isPending}
          error={rename.error === null ? null : rename.error.message}
          onClose={() => {
            setRenaming(null);
            rename.reset();
          }}
          onSubmit={(name) => rename.mutate({ id: renaming.id, name })}
        />
      )}

      {limiting === null ? null : (
        <RoleRowsDialog
          key={limiting.id}
          role={limiting}
          onClose={() => setLimiting(null)}
          onSaved={async () => {
            setLimiting(null);
            // The matrix's own draft was read before the limits changed the role's grants.
            setDraft(null);
            await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
          }}
        />
      )}

      {deleting === null ? null : (
        <DeleteRoleDialog
          key={deleting.id}
          role={deleting}
          targets={roles.filter((role) => role.id !== deleting.id)}
          busy={remove.isPending}
          error={remove.error === null ? null : remove.error.message}
          onClose={() => {
            setDeleting(null);
            remove.reset();
          }}
          onConfirm={(reassignTo) => remove.mutate({ id: deleting.id, reassignTo })}
        />
      )}
    </PageSurface>
  );
}

// --- dialogs -----------------------------------------------------------------

function CreateRoleDialog(props: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: { name: string; description?: string }) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const canSubmit = name.trim() !== '' && !props.busy;

  return (
    <Modal
      open={props.open}
      size="sm"
      onOpenChange={(next) => {
        if (!next) {
          setName('');
          setDescription('');
        }
        props.onOpenChange(next);
      }}
    >
      <ModalHeader
        icon={<ShieldCheck />}
        title={t('roles:create.title', 'New role')}
        subtitle={t('roles:create.description', 'A new role starts with no permissions at all.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <form
          id="create-role"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            const trimmed = description.trim();
            props.onSubmit({
              name: name.trim(),
              ...(trimmed === '' ? {} : { description: trimmed }),
            });
          }}
        >
          <FormField label={t('roles:create.name', 'Name')} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('roles:create.namePlaceholder', 'e.g. Support agent')}
              maxLength={80}
              autoFocus
            />
          </FormField>
          <FormField label={t('roles:create.descriptionLabel', 'Description')}>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
            />
          </FormField>
          {props.error === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              title={t('roles:create.failed', 'Could not create the role')}
              body={props.error}
            />
          )}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={() => props.onOpenChange(false)} disabled={props.busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" form="create-role" disabled={!canSubmit} loading={props.busy}>
          {t('roles:create.submit', 'Create role')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function RenameRoleDialog(props: {
  role: RoleListItem;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}): ReactNode {
  const [name, setName] = useState(props.role.name);
  const canSubmit = name.trim() !== '' && !props.busy;

  return (
    <Modal open size="sm" onOpenChange={(next) => { if (!next) props.onClose(); }}>
      <ModalHeader
        icon={<ShieldCheck />}
        title={t('roles:rename.title', 'Rename role')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <form
          id="rename-role"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) props.onSubmit(name.trim());
          }}
        >
          <FormField label={t('roles:create.name', 'Name')} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoFocus
            />
          </FormField>
          {props.error === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              className="mt-4"
              title={t('roles:rename.failed', 'Could not rename the role')}
              body={props.error}
            />
          )}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={props.onClose} disabled={props.busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" form="rename-role" disabled={!canSubmit} loading={props.busy}>
          {t('common.save', 'Save')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * Delete, with the reassignment picker the server's 409 demands.
 *
 * The picker is shown only when the role actually has members, and it is
 * REQUIRED in that case rather than defaulted: silently dropping a team into
 * whichever role happened to sort first is exactly the kind of invisible
 * privilege change this whole screen exists to make visible.
 */
function DeleteRoleDialog(props: {
  role: RoleListItem;
  targets: readonly RoleListItem[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reassignTo: string | null) => void;
}): ReactNode {
  const [reassignTo, setReassignTo] = useState('');
  const needsReassign = props.role.memberCount > 0;
  const canConfirm = (!needsReassign || reassignTo !== '') && !props.busy;

  return (
    <Modal open size="sm" onOpenChange={(next) => { if (!next) props.onClose(); }}>
      <ModalHeader
        tone="danger"
        icon={<Trash2 />}
        title={t('roles:delete.title', 'Delete role')}
        subtitle={t('roles:delete.description', 'The role and its permission rows are removed.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4">
        <p className="text-body-sm text-fg">
          {needsReassign
            ? t(
                'roles:delete.hasMembers',
                '“{name}” still has {count, plural, one {# member} other {# members}}. Choose the role they move to — Adminium will not leave an account with no role.',
                { name: props.role.name, count: props.role.memberCount },
              )
            : t('roles:delete.noMembers', 'Nobody holds “{name}”, so nothing moves.', {
                name: props.role.name,
              })}
        </p>

        {needsReassign ? (
          <FormField label={t('roles:delete.reassignTo', 'Move members to')} required>
            <Select
              value={reassignTo}
              onChange={(event) => setReassignTo(event.target.value)}
              data-testid="roles-reassign"
            >
              <option value="">{t('roles:delete.reassignPlaceholder', 'Choose a role…')}</option>
              {props.targets.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        {props.error === null ? null : (
          <Alert
            role="alert"
            tone="danger"
            title={t('roles:delete.failed', 'Could not delete the role')}
            body={props.error}
          />
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={props.onClose} disabled={props.busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button
          variant="destructive"
          disabled={!canConfirm}
          loading={props.busy}
          onClick={() => props.onConfirm(needsReassign ? reassignTo : null)}
          data-testid="roles-delete-confirm"
        >
          {t('roles:delete.confirm', 'Delete role')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// --- which rows a role reaches -------------------------------------------------

function rowActionLabel(action: RowAction): string {
  switch (action) {
    case 'read':
      return t('roles:rows.actionLabel.read', 'Read');
    case 'update':
      return t('roles:rows.actionLabel.update', 'Change');
    case 'delete':
      return t('roles:rows.actionLabel.delete', 'Delete');
  }
}

function wayText(way: RowWay): string {
  switch (way.kind) {
    case 'person':
      return t('roles:rows.way.person', 'the person in {column}', { column: way.label });
    case 'listing': {
      const listed = way.dated
        ? t('roles:rows.way.listingDated', 'anyone listed for it in {table} on the day', { table: way.label })
        : t('roles:rows.way.listing', 'anyone listed for it in {table}', { table: way.label });
      const when = way.when;
      if (when === undefined) return listed;
      // Counts only while a column of the listing holds a value: said in the same sentence, after who is listed.
      const holds =
        when.in !== undefined
          ? t('roles:rows.way.whileIn', 'while {column} is {values}', { column: when.label, values: anyOf(when.in) })
          : when.isNull === true
            ? t('roles:rows.way.whileEmpty', 'while {column} is empty', { column: when.label })
            : t('roles:rows.way.whileSet', 'while {column} is filled in', { column: when.label });
      return `${listed}, ${holds}`;
    }
    case 'parent':
      return t('roles:rows.way.parent', 'whoever reaches its {table}', { table: way.label });
  }
}

/** "A or B": joined as the reader's language joins a choice. */
function anyOf(parts: readonly string[]): string {
  const locale = typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en';
  try {
    return new Intl.ListFormat(locale, { type: 'disjunction' }).format(parts);
  } catch {
    return parts.join(', ');
  }
}

/**
 * How the table says whose a row is, every way of it. A table reached through
 * its parent says so in the same words, never as "Follows: Deal": it keeps a
 * limit of its own, which the controls under it set (the owner's ruling).
 */
function belongsText(table: RoleRowsTable): string {
  return t('roles:rows.belongs', 'A row belongs to {ways}.', { ways: anyOf(table.ways.map(wayText)) });
}

/** One way a row is this person's, as the sentence says it: "Owner is this person". */
function wayIs(way: RowWay): string {
  switch (way.kind) {
    case 'person':
      return t('roles:rows.wayIs.person', '{column} is this person', { column: way.label });
    case 'listing':
      return way.dated
        ? t('roles:rows.wayIs.listingDated', 'this person is listed in {table} on the day', { table: way.label })
        : t('roles:rows.wayIs.listing', 'this person is listed in {table}', { table: way.label });
    case 'parent':
      return t('roles:rows.wayIs.parent', 'this person reaches its {table}', { table: way.label });
  }
}

/**
 * A reach in words, never as a code, and in the design's sentences: the
 * table and the column that decide it are named ("Only rows of Deals where
 * Owner is this person."). A table whose rows are somebody's in more than one
 * way names every way, so the sentence is never narrower than the rule.
 */
export function reachSentence(table: Pick<RoleRowsTable, 'label' | 'ways'>, reach: RowReach | null): string {
  const only = table.ways.length === 1 ? table.ways[0] : undefined;
  if (reach === null) {
    return only?.kind === 'person'
      ? t('roles:rows.sentence.allWho', 'Every row of {table}, whoever {column} is.', { table: table.label, column: only.label })
      : t('roles:rows.sentence.all', 'Every row of {table}.', { table: table.label });
  }
  const ways = anyOf(table.ways.map(wayIs));
  const parts = [
    reach.reach === 'all'
      ? t('roles:rows.sentence.allWhile', 'Every row of {table}', { table: table.label })
      : reach.reach === 'own'
        ? t('roles:rows.sentence.only', 'Only rows of {table} where {ways}', { table: table.label, ways })
        : only !== undefined
          ? t('roles:rows.sentence.onlyTeam', 'Only rows of {table} where {ways}, or someone in a team they lead', { table: table.label, ways })
          : t('roles:rows.sentence.onlyTeamWays', 'Only rows of {table} where {ways}, or the same for someone in a team they lead', { table: table.label, ways }),
    ...(reach.unowned === true ? [t('roles:rows.sentence.unowned', 'and rows nobody owns yet')] : []),
    ...(reach.while === undefined
      ? []
      : [t('roles:rows.sentence.while', 'only while {column} is {values}', { column: reach.while.column, values: anyOf(reach.while.in.map(String)) })]),
    ...(reach.by === undefined ? [] : [t('roles:rows.sentence.by', 'and only the ones {column} names them in', { column: reach.by })]),
  ];
  return `${parts.join(', ')}.`;
}

/**
 * Which rows one role reaches, table by table: every row, the person's own,
 * or their own and their team's — for reading, changing and deleting, each
 * on its own. Only tables that say whose their rows are can be limited, and
 * only for an action the role holds. Tried as a chosen person, each table
 * says how many rows that person would see, before anything is saved.
 */
function RoleRowsDialog(props: { role: RoleListItem; onClose: () => void; onSaved: () => Promise<void> }): ReactNode {
  const { role } = props;
  const rows = useQuery(roleRowsQuery(role.id));
  const grants = useQuery(roleGrantsQuery(role.id));
  const people = useQuery(peopleQuery());
  const [draft, setDraft] = useState<Record<string, RowLimit | null>>({});
  const [personId, setPersonId] = useState('');
  const person = people.data?.find((one) => one.id === personId) ?? null;
  const tables = rows.data?.tables ?? [];
  const limitOf = (table: RoleRowsTable): RowLimit | null => (table.ref in draft ? (draft[table.ref] ?? null) : table.limit);
  const body = grants.data === undefined ? null : rowLimitsSave(grants.data, tables, draft);
  const dirty = body !== null && Object.keys(body.rows).length > 0;

  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      if (body === null) return;
      // The grants as they are NOW, not as they were when the dialog opened: a save sends the whole list, and one read
      // minutes ago would take back whatever another admin has ticked since.
      const fresh = await queryClient.fetchQuery({ ...roleGrantsQuery(role.id), staleTime: 0 });
      await putRoleRows(role.id, rowLimitsSave(fresh, tables, draft));
    },
    onSuccess: props.onSaved,
  });

  const set = (table: RoleRowsTable, action: RowAction, reach: RowReach | null): void => {
    setDraft((held) => ({ ...held, [table.ref]: withReach(limitOf(table), action, reach) }));
  };

  return (
    <Modal open size="lg" onOpenChange={(next) => { if (!next) props.onClose(); }}>
      <ModalHeader
        icon={<Rows3 />}
        title={t('roles:rows.title', 'Which rows “{role}” reaches', { role: role.name })}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4">
        <p className="text-body-sm text-fg-muted">
          {t(
            'roles:rows.intro',
            'A role reaches every row of a table it may open, unless it is limited here. A limit holds for a person only when every role that gives them the table is limited.',
          )}
        </p>
        {rows.isError ? (
          <Alert role="alert" tone="danger" title={t('roles:rows.loadFailed', 'The tables could not be read.')} body={rows.error.message} />
        ) : rows.isPending ? null : tables.length === 0 ? (
          <EmptyState
            compact
            preset="no-data"
            icon={<Rows3 />}
            title={t('roles:rows.empty.title', 'Nothing to limit')}
            body={t('roles:rows.empty.body', 'No table this role may open says whose its rows are.')}
          />
        ) : (
          <>
            <FormField label={t('roles:rows.tryAs', 'Try it as')}>
              <Select value={personId} onChange={(event) => setPersonId(event.target.value)} data-testid="roles-rows-person">
                <option value="">{t('roles:rows.tryAsNone', 'Nobody')}</option>
                {(people.data ?? []).map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.sample ? t('roles:rows.samplePerson', '{name} (sample)', { name: one.name }) : one.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <ul className="flex flex-col gap-3" data-testid="roles-rows-tables">
              {tables.map((table) => (
                <RoleRowsTableCard
                  key={table.ref}
                  roleId={role.id}
                  table={table}
                  limit={limitOf(table)}
                  person={person}
                  severalConnections={new Set(tables.map((one) => one.connectionId)).size > 1}
                  disabled={save.isPending}
                  onChange={(action, reach) => set(table, action, reach)}
                />
              ))}
            </ul>
          </>
        )}
        {save.error === null ? null : (
          <Alert role="alert" tone="danger" title={t('roles:rows.failed', 'Could not save the row limits')} body={save.error.message} />
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={props.onClose} disabled={save.isPending}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()} data-testid="roles-rows-save">
          {t('common.save', 'Save')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function RoleRowsTableCard(props: {
  roleId: string;
  table: RoleRowsTable;
  limit: RowLimit | null;
  person: PersonRef | null;
  severalConnections: boolean;
  disabled: boolean;
  onChange: (action: RowAction, reach: RowReach | null) => void;
}): ReactNode {
  const { table, limit, person } = props;
  const read = severalOf(limit, 'read') ?? reachOf(limit, 'read');
  const preview = useQuery({
    ...rowsPreviewQuery({ roleId: props.roleId, table, userId: person?.id ?? '', reach: read }),
    enabled: person !== null && !table.private && table.granted.read,
  });
  return (
    <li className="rounded-lg border border-border p-3" data-testid={`roles-rows-table-${table.tableId}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-body font-semibold text-fg">{table.label}</h3>
        {props.severalConnections ? <span className="text-caption text-fg-subtle">{table.connectionName}</span> : null}
      </div>
      {table.private ? (
        <p className="mt-1 text-body-sm text-fg-muted">
          {t('roles:rows.private', 'Read by the people each row belongs to, and by nobody else. There is nothing to choose.')}
        </p>
      ) : (
        <>
          <p className="mt-1 text-body-sm text-fg-muted">{belongsText(table)}</p>
          <div className="mt-3 flex flex-col gap-3">
            {ROW_ACTIONS.filter((action) => table.granted[action]).map((action) => {
              const reach = reachOf(limit, action);
              const label = rowActionLabel(action);
              const several = severalOf(limit, action);
              // Several reaches the app wrote, any one enough: said in words and kept as written; there is nothing to pick.
              if (several !== null) {
                return (
                  <div key={action} className="flex flex-col gap-1" data-testid={`roles-rows-${table.tableId}-${action}-several`}>
                    <span className="text-body-sm font-semibold text-fg">{label}</span>
                    <p className="text-caption text-fg-muted">{t('roles:rows.several', 'Any one of these is enough. The app set them, and they are kept as it wrote them.')}</p>
                    <ul className="flex list-disc flex-col gap-0.5 ps-5 text-caption text-fg-subtle" data-testid={`roles-rows-${table.tableId}-${action}-sentence`}>
                      {several.map((one, n) => (
                        <li key={n}>{reachSentence(table, one)}</li>
                      ))}
                    </ul>
                  </div>
                );
              }
              return (
                <div key={action} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="w-16 text-body-sm font-semibold text-fg">{label}</span>
                    <SegmentedControl
                      aria-label={t('roles:rows.reachLabel', '{action}: which rows', { action: label })}
                      value={reach === null || reach.reach === 'all' ? 'all' : reach.reach}
                      disabled={props.disabled}
                      options={[
                        // "Only the ones a column names them in" is the app's own narrowing, and every row has no such thing: not offered over it.
                        { value: 'all', label: t('roles:rows.reach.all', 'All rows'), disabled: reach?.by !== undefined },
                        { value: 'team', label: t('roles:rows.reach.team', 'Their team’s') },
                        { value: 'own', label: t('roles:rows.reach.own', 'Their own') },
                      ]}
                      onValueChange={(value) => {
                        // "Only while…" is a condition the app wrote: choosing every row keeps it (every row, only while), never drops it unsaid.
                        if (value === 'all') props.onChange(action, reach?.while === undefined ? null : { reach: 'all', while: reach.while });
                        else if (value === 'own' || value === 'team') props.onChange(action, { ...(reach ?? {}), reach: value });
                      }}
                      data-testid={`roles-rows-${table.tableId}-${action}`}
                    />
                    {reach === null ? null : (
                      <label className="flex items-center gap-2 text-body-sm text-fg">
                        <Checkbox
                          checked={reach.unowned === true}
                          disabled={props.disabled}
                          onCheckedChange={(checked) => {
                            const { unowned: _unowned, ...rest } = reach;
                            props.onChange(action, checked === true ? { ...rest, unowned: true } : rest);
                          }}
                        />
                        {t('roles:rows.unowned', 'and rows nobody owns yet')}
                      </label>
                    )}
                  </div>
                  <p className="text-caption text-fg-subtle" data-testid={`roles-rows-${table.tableId}-${action}-sentence`}>
                    {reachSentence(table, reach)}
                  </p>
                </div>
              );
            })}
          </div>
          {!table.own && limit !== null ? (
            <p className="mt-2 text-caption text-fg-subtle">
              {t('roles:rows.widened', 'This role opens the table through a wider permission. Saving a limit also gives it this table by name.')}
            </p>
          ) : null}
          {person === null || preview.data === undefined ? null : (
            <div className="mt-3 flex flex-col gap-1 text-body-sm" data-testid={`roles-rows-${table.tableId}-count`}>
              <p className="text-fg">
                {t('roles:rows.count', '{name} would see {reached} of {total} rows of {table}.', { name: person.name, reached: preview.data.reached, total: preview.data.total, table: table.label })}
              </p>
              {preview.data.capped ? (
                <p className="text-fg-muted">{t('roles:rows.capped', 'This person leads more people than one reach holds, so not all of their team is counted.')}</p>
              ) : null}
              {preview.data.liftedBy.length === 0 || read === null ? null : (
                <p className="text-warn" role="status">
                  {t('roles:rows.lifted', '{name} also holds {roles}, which gives every row. This limit does not hold for them.', {
                    name: person.name,
                    roles: preview.data.liftedBy.join(', '),
                  })}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

