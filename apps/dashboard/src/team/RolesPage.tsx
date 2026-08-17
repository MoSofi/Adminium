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
 */
import { useMutation, useQueries, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FormField,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PermissionMatrix,
  Select,
  Textarea,
  type PermissionGrant,
} from '@adminium/ui';

import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { t } from '../i18n/t.js';
import {
  ROLES_QUERY_KEY,
  SUPER_ADMIN_SLUG,
  catalogPermissions,
  changedRoleIds,
  createRole,
  deleteRole,
  isPermissionGrant,
  matrixRows,
  pendingChangeCount,
  permissionCatalogQuery,
  putRoleGrants,
  renameRole,
  roleGrantsQuery,
  rolesQuery,
  toggleGrant,
  type GrantMap,
  type GrantableCatalogEntry,
  type PermissionCategory,
  type RoleListItem,
} from './rolesApi.js';

function categoryLabel(category: PermissionCategory): string {
  switch (category) {
    case 'access':
      return t('roles.category.access', 'Access');
    case 'data':
      return t('roles.category.data', 'Data');
    case 'workspace':
      return t('roles.category.workspace', 'Workspace');
    case 'operations':
      return t('roles.category.operations', 'Operations');
  }
}

/**
 * Row labels, localized by grant string.
 *
 * A switch and not a lookup built from the key, because `adminium/no-dynamic-
 * i18n-key` correctly forbids assembling `t('roles.permission.' + key)`: a
 * fabricated key cannot be checked against the 8 bundles and renders as a raw
 * dotted string when it misses. The `default` is the endpoint's own English
 * `label`, which is exactly the fallback its docblock promises — so a grantable
 * key added to `@adminium/meta` after this build still gets a readable row
 * instead of a blank one, and the missing translation is the only thing lost.
 */
function permissionLabel(entry: GrantableCatalogEntry): string {
  switch (entry.key) {
    case 'system:users:manage':
      return t('roles.permission.usersManage', 'Manage users');
    case 'system:roles:manage':
      return t('roles.permission.rolesManage', 'Manage roles and permissions');
    case 'system:api-keys:manage':
      return t('roles.permission.apiKeysManage', 'Manage API keys');
    case 'system:settings:manage':
      return t('roles.permission.settingsManage', 'Manage workspace settings');
    case 'system:audit:read':
      return t('roles.permission.auditRead', 'Read the audit log');
    case 'system:pages:manage':
      return t('roles.permission.pagesManage', 'Create and organize pages');
    case 'system:connections:manage':
      return t('roles.permission.connectionsManage', 'Manage database connections');
    case 'system:schema:remap':
      return t('roles.permission.schemaRemap', 'Edit schema labels and overrides');
    case 'system:exports:manage':
      return t('roles.permission.exportsManage', 'Manage everyone’s exports');
    case 'system:imports:manage':
      return t('roles.permission.importsManage', 'Manage everyone’s imports');
    case 'system:reports:manage':
      return t('roles.permission.reportsManage', 'Manage scheduled reports');
    case 'system:llm:run':
      return t('roles.permission.llmRun', 'Run AI assist');
    case 'system:jobs:read':
      return t('roles.permission.jobsRead', 'See all background jobs');
    case 'system:jobs:manage':
      return t('roles.permission.jobsManage', 'Start and cancel background jobs');
    default:
      return entry.label;
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

  const permissions = useMemo(
    () => matrixRows(catalogPermissions(catalog), permissionLabel, (entry) => categoryLabel(entry.category)),
    [catalog],
  );
  const changed = useMemo(() => changedRoleIds(grants, baseline), [grants, baseline]);
  const pending = useMemo(() => pendingChangeCount(grants, baseline), [grants, baseline]);

  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<RoleListItem | null>(null);
  const [deleting, setDeleting] = useState<RoleListItem | null>(null);

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
    <PageSurface className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageActions
        title={t('roles.title', 'Roles & permissions')}
        subtitle={t('roles.subtitle', 'What each role may do. A user gets the union of every role they hold.')}
      >
        <Button
          iconLeft={<Plus className="size-4" />}
          onClick={() => setCreateOpen(true)}
          data-testid="roles-create"
        >
          {t('roles.createButton', 'New role')}
        </Button>
      </PageActions>

      {grantsFailed ? (
        <Alert
          role="alert"
          tone="danger"
          data-testid="roles-grants-error"
          title={t('roles.loadFailed.title', 'Some permissions could not be read')}
          body={t(
            'roles.loadFailed.body',
            'The matrix below is incomplete, so saving it would clear permissions that are simply not loaded. Reload before making changes.',
          )}
        />
      ) : null}

      <Card padded={false}>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <h2 className="text-section flex-1 text-fg">{t('roles.matrix.title', 'Permissions')}</h2>
          <span className="text-body-sm text-fg-subtle" data-testid="roles-pending">
            {pending === 0
              ? t('roles.matrix.noChanges', 'No pending changes')
              : t(
                  'roles.matrix.pending',
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
            {t('roles.matrix.discard', 'Discard')}
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
              title={t('roles.saveFailed.title', 'Could not save every role')}
              body={save.error.message}
            />
          )}
          {permissions.length === 0 ? (
            <EmptyState
              compact
              preset="no-data"
              icon={<ShieldCheck />}
              title={t('roles.matrix.empty.title', 'No permissions to show')}
              body={t(
                'roles.matrix.empty.body',
                'This instance reported no grantable permissions at all, which should not happen — reload, and if it persists check the server log.',
              )}
            />
          ) : (
            <PermissionMatrix
              data-testid="roles-matrix"
              label={t('roles.matrix.label', 'Role permissions')}
              rowHeader={t('roles.matrix.rowHeader', 'Permission')}
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
          )}
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader>
          <h2 className="text-section text-fg">{t('roles.list.title', 'Roles')}</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm" data-testid="roles-table">
              <thead>
                <tr className="border-b border-border text-micro uppercase text-fg-subtle">
                  <th scope="col" className="px-4 py-2 text-start font-bold">
                    {t('roles.column.name', 'Role')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-bold">
                    {t('roles.column.members', 'Members')}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-bold">
                    {t('roles.column.actions', 'Actions')}
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
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted">
                      {t('roles.memberCount', '{count, plural, one {# user} other {# users}}', {
                        count: role.memberCount,
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setRenaming(role)}>
                          {t('roles.action.rename', 'Rename')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={role.isBuiltin}
                          title={
                            role.isBuiltin
                              ? t('roles.builtinLocked', 'Built-in roles cannot be deleted.')
                              : undefined
                          }
                          onClick={() => setDeleting(role)}
                        >
                          {t('roles.action.delete', 'Delete')}
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
        title={t('roles.create.title', 'New role')}
        subtitle={t('roles.create.description', 'A new role starts with no permissions at all.')}
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
          <FormField label={t('roles.create.name', 'Name')} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('roles.create.namePlaceholder', 'e.g. Support agent')}
              maxLength={80}
              autoFocus
            />
          </FormField>
          <FormField label={t('roles.create.descriptionLabel', 'Description')}>
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
              title={t('roles.create.failed', 'Could not create the role')}
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
          {t('roles.create.submit', 'Create role')}
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
        title={t('roles.rename.title', 'Rename role')}
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
          <FormField label={t('roles.create.name', 'Name')} required>
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
              title={t('roles.rename.failed', 'Could not rename the role')}
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
        title={t('roles.delete.title', 'Delete role')}
        subtitle={t('roles.delete.description', 'The role and its permission rows are removed.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4">
        <p className="text-body-sm text-fg">
          {needsReassign
            ? t(
                'roles.delete.hasMembers',
                '“{name}” still has {count, plural, one {# member} other {# members}}. Choose the role they move to — Adminium will not leave an account with no role.',
                { name: props.role.name, count: props.role.memberCount },
              )
            : t('roles.delete.noMembers', 'Nobody holds “{name}”, so nothing moves.', {
                name: props.role.name,
              })}
        </p>

        {needsReassign ? (
          <FormField label={t('roles.delete.reassignTo', 'Move members to')} required>
            <Select
              value={reassignTo}
              onChange={(event) => setReassignTo(event.target.value)}
              data-testid="roles-reassign"
            >
              <option value="">{t('roles.delete.reassignPlaceholder', 'Choose a role…')}</option>
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
            title={t('roles.delete.failed', 'Could not delete the role')}
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
          {t('roles.delete.confirm', 'Delete role')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
