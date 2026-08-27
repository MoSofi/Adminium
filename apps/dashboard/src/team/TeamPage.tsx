// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/settings/team` — the user directory, and the surface that closes the v1
 * blocker: before it, a self-hosted Adminium could create exactly ONE account
 * during setup and had no API or UI to create a second, while a complete RBAC
 * engine sat unreachable behind that one user.
 *
 * THE INVITE RESULT IS THIS PAGE'S REASON FOR EXISTING.
 *
 * `POST /users` mints an activation token and hands back the path ONCE,
 * whether or not the invite was also emailed (`emailSent` says which). The
 * link is returned either way on purpose: an install with no SMTP configured
 * has no other channel, and one whose relay silently drops the message still
 * needs the fallback.
 * That single reply is the ONLY route a teammate has to the activation screen.
 * So the link renders in a one-time banner in COMPONENT STATE (never the query
 * cache), exactly as `api-keys/ApiKeysPage.tsx` renders its plaintext key, and
 * the "Email it instead" affordance is rendered VISIBLY DISABLED behind
 * `emailSendGate` with its `smtp-not-configured` reason spelled out — §8.2's
 * "never hide, always explain". Nothing on this page ever says or implies that
 * mail went out.
 *
 * The banner survives a failed refetch for the same reason the api-keys one
 * does: the list below can be empty or stale while a real, unrecoverable
 * credential exists, and unmounting the only copy of it would be the worst
 * possible response to a network blip.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailWarning, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmModal,
  EmptyState,
  FormField,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
  SearchInput,
  Select,
  Spinner,
  StatusPill,
  Tag,
} from '@adminium/ui';
import { tagForLocale, type LocaleId } from '@adminium/i18n';

import { bootstrapQuery } from '../app/bootstrap.js';
import { emailSendGate, useCapabilities } from '../app/capabilities.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { t } from '../i18n/t.js';
import { CopyButton } from '../studio/connect/CopyButton.js';
import { rolesQuery, type RoleListItem } from './rolesApi.js';
import {
  EMPTY_USER_FILTERS,
  TEAM_USERS_KEY,
  activationLink,
  createUser,
  deleteUser,
  formatSince,
  formatStamp,
  patchUser,
  resendInvite,
  setUserRoles,
  userStatusTone,
  usersQuery,
  type UserDto,
  type UserFilters,
  type UserInvite,
  type UserStatus,
  type UserStatusPatch,
} from './teamApi.js';

/** Statuses offered in the filter, in the order the directory reads best. */
const STATUS_FILTERS: readonly UserStatus[] = ['active', 'invited', 'suspended'];

function statusLabel(status: UserStatus): string {
  switch (status) {
    case 'active':
      return t('team.status.active', 'Active');
    case 'invited':
      return t('team.status.invited', 'Invited');
    case 'suspended':
      return t('team.status.suspended', 'Suspended');
  }
}

// --- the one-time invite banner ----------------------------------------------

interface InviteResult {
  invite: UserInvite;
  email: string;
}

/**
 * The activation link, once.
 *
 * `origin` comes from the browser rather than the server because a self-host is
 * reached on an address the server cannot know (reverse proxy, LAN address,
 * tunnel) — the origin the admin is looking at right now is by construction one
 * that resolves.
 */
function InviteBanner({ result, onDismiss }: { result: InviteResult; onDismiss: () => void }): ReactNode {
  const { flags, resolved } = useCapabilities();
  const gate = emailSendGate(flags);
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);
  const [now] = useState(() => Date.now());

  const link = activationLink(window.location.origin, result.invite.activationPath);
  const expires = formatStamp(result.invite.expiresAt, localeTag);
  const expiresIn = formatSince(result.invite.expiresAt, localeTag, now);

  return (
    <Card data-testid="team-invite-banner">
      <CardHeader className="justify-between flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-section text-fg">{t('team.invite.created.title', 'Invitation created')}</h2>
          <p className="text-body-sm text-fg-muted">
            {t(
              'team.invite.created.body',
              'Send this link to {email} yourself. It is shown once — Adminium stores only a hash of it, so if you lose it you will have to delete the invitation and issue a new one.',
              { email: result.email },
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t('common.dismiss', 'Dismiss')}
        </Button>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 p-3">
          <MonoText className="min-w-0 flex-1 break-all text-body-sm" data-testid="team-invite-link">
            {link}
          </MonoText>
          <CopyButton
            value={link}
            label={t('team.invite.copyLink', 'Copy link')}
            copiedLabel={t('team.invite.copied', 'Copied')}
          />
        </div>

        {expires === null ? null : (
          <p className="text-body-sm text-fg-subtle">
            {expiresIn === null
              ? t('team.invite.expires', 'The link expires {at}.', { at: expires })
              : t('team.invite.expiresRelative', 'The link expires {at} ({relative}).', {
                  at: expires,
                  relative: expiresIn,
                })}
          </p>
        )}

        {/*
          §8.2's email row, rendered rather than hidden. The button is here so
          the absence has a shape the admin can see and a sentence that explains
          it; `resolved` guards the CLAIM — a failed /system/info probe must not
          tell an operator with a working relay that they have no mail server.
        */}
        <Alert
          tone="warn"
          icon={<MailWarning />}
          title={t('team.invite.noEmail.title', 'Adminium did not email this link')}
          body={
            resolved && gate.reason === 'smtp-not-configured'
              ? t(
                  'team.invite.noEmail.smtp',
                  'No SMTP server is configured on this instance, so there is nothing to send mail with. Share the link over a channel you already trust.',
                )
              : t(
                  'team.invite.noEmail.unknown',
                  'Adminium could not check whether this instance can send mail. Share the link over a channel you already trust.',
                )
          }
          action={
            <Button variant="secondary" size="sm" disabled data-testid="team-invite-email">
              {t('team.invite.emailIt', 'Email the invitation')}
            </Button>
          }
        />
      </CardBody>
    </Card>
  );
}

// --- invite dialog -----------------------------------------------------------

interface InviteDialogProps {
  open: boolean;
  roles: readonly RoleListItem[];
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: { email: string; name: string; roleIds?: string[] }) => void;
}

function InviteDialog({ open, roles, busy, error, onOpenChange, onSubmit }: InviteDialogProps): ReactNode {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const canSubmit = email.trim() !== '' && name.trim() !== '' && !busy;

  return (
    <Modal
      open={open}
      size="md"
      onOpenChange={(next) => {
        if (!next) {
          setEmail('');
          setName('');
          setRoleIds([]);
        }
        onOpenChange(next);
      }}
    >
      <ModalHeader
        icon={<UserPlus />}
        title={t('team.inviteDialog.title', 'Invite a teammate')}
        subtitle={t(
          'team.inviteDialog.description',
          'Adminium creates the account and gives you a one-time activation link to pass on.',
        )}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <form
          id="invite-teammate"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            // `roleIds` is omitted rather than sent empty: any role at all in
            // the body makes the route additionally require
            // `system:roles:manage`, so a users-only admin inviting nobody to
            // any role must not be 403'd for a field they never filled in.
            onSubmit({
              email: email.trim(),
              name: name.trim(),
              ...(roleIds.length === 0 ? {} : { roleIds }),
            });
          }}
        >
          <FormField label={t('team.inviteDialog.email', 'Email')} required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('team.inviteDialog.emailPlaceholder', 'name@example.com')}
              maxLength={320}
              autoFocus
            />
          </FormField>

          <FormField label={t('team.inviteDialog.name', 'Name')} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('team.inviteDialog.namePlaceholder', 'e.g. Dana Osei')}
              maxLength={120}
            />
          </FormField>

          <FormField
            label={t('team.inviteDialog.roles', 'Roles')}
            helper={t(
              'team.inviteDialog.rolesHelper',
              'Pick the least-privileged role that lets them do their job. You can change this later.',
            )}
          >
            <RoleCheckboxes idPrefix="invite" roles={roles} selected={roleIds} onChange={setRoleIds} />
          </FormField>

          {error === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              title={t('team.inviteDialog.failed', 'Could not create the invitation')}
              body={error}
              data-testid="team-invite-error"
            />
          )}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" form="invite-teammate" disabled={!canSubmit} loading={busy}>
          {t('team.inviteDialog.submit', 'Create invitation')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function RoleCheckboxes(props: {
  idPrefix: string;
  roles: readonly RoleListItem[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}): ReactNode {
  if (props.roles.length === 0) {
    return (
      <p className="text-body-sm text-fg-muted">
        {t('team.roles.unavailable', 'Roles are not visible to your account, so none can be assigned here.')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {props.roles.map((role) => {
        const id = `${props.idPrefix}-role-${role.id}`;
        const checked = props.selected.includes(role.id);
        return (
          <div key={role.id} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(next) => {
                props.onChange(
                  next
                    ? [...props.selected, role.id]
                    : props.selected.filter((entry) => entry !== role.id),
                );
              }}
            />
            <Label htmlFor={id} className="text-body-sm text-fg">
              {role.name}
            </Label>
          </div>
        );
      })}
    </div>
  );
}

// --- per-row role editor -----------------------------------------------------

function RolesDialog(props: {
  user: UserDto;
  roles: readonly RoleListItem[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (roleIds: string[]) => void;
}): ReactNode {
  const [selected, setSelected] = useState<string[]>(props.user.roles.map((role) => role.id));

  return (
    <Modal open size="sm" onOpenChange={(next) => { if (!next) props.onClose(); }}>
      <ModalHeader
        icon={<ShieldCheck />}
        title={t('team.rolesDialog.title', 'Roles for {name}', { name: props.user.name })}
        subtitle={t('team.rolesDialog.description', 'A user gets the union of every role they hold.')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <RoleCheckboxes
          idPrefix={`user-${props.user.id}`}
          roles={props.roles}
          selected={selected}
          onChange={setSelected}
        />
        {props.error === null ? null : (
          <Alert
            role="alert"
            tone="danger"
            className="mt-4"
            title={t('team.rolesDialog.failed', 'Could not change the roles')}
            body={props.error}
          />
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={props.onClose} disabled={props.busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button loading={props.busy} onClick={() => props.onSave(selected)}>
          {t('common.save', 'Save')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// --- page --------------------------------------------------------------------

export function TeamPage(): ReactNode {
  const queryClient = useQueryClient();
  const { data: bootstrap } = useQuery(bootstrapQuery());
  const [filters, setFilters] = useState<UserFilters>(EMPTY_USER_FILTERS);
  // NOT a suspense query, and the invite banner is the reason. A suspense hook
  // re-suspends whenever the query key changes, so a single keystroke in the
  // search box would throw this component to the route's fallback, unmount it,
  // and take the one-time activation link — which nothing can reissue — down
  // with it. The list owns its own pending and error states instead, which also
  // keeps a failed refetch from hiding a credential the admin is still holding.
  const users = useInfiniteQuery(usersQuery(filters));
  // Tolerant, like the api-keys page: `GET /roles` needs `system:roles:manage`
  // while this page needs `system:users:manage`, so an admin holding only the
  // latter gets a working directory. The role CHIPS do not depend on it — the
  // list route embeds `user.roles` for exactly this reason — so a 403 costs
  // only the pickers, which are the controls that same 403 would refuse anyway.
  const roles = useQuery({ ...rolesQuery(), retry: false });

  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingRoles, setEditingRoles] = useState<UserDto | null>(null);
  const [removing, setRemoving] = useState<UserDto | null>(null);

  const localeTag = tagForLocale((bootstrap?.prefs.locale ?? 'en_US') as LocaleId);
  // Captured once per mount: a per-render Date.now() makes every relative
  // stamp a new value and the page impossible to snapshot.
  const [now] = useState(() => Date.now());

  const roleList = roles.data ?? [];
  // `system:roles:manage` is what PUT /users/:id/roles additionally requires,
  // and a failed `GET /roles` is the only signal this page has for it. Better
  // to render the control disabled with the picker empty than to open a dialog
  // whose Save can only ever 403.
  const mayEditRoles = roles.isSuccess;
  const rows = useMemo(() => users.data?.pages.flatMap((page) => page.users) ?? [], [users.data]);
  // Whole-directory tallies, not page-scoped — so paging does not change them.
  const counts = users.data?.pages[0]?.counts ?? null;

  const create = useMutation({
    // THE ACTIVATION LINK NEVER BECOMES MUTATION DATA — same structural rule as
    // the api-keys plaintext: `useMutation` keeps whatever the mutationFn
    // resolves to, for the page lifetime plus gcTime, in the devtools Mutations
    // tab and in anything that serialises the QueryClient. `reset()` in
    // `onSuccess` does not help (the success state is dispatched after the
    // callbacks). The only durable fix is not to hand the secret over.
    mutationFn: async (body: {
      email: string;
      name: string;
      roleIds?: string[];
    }): Promise<{ id: string }> => {
      const reply = await createUser(body);
      setInvite({ invite: reply.invite, email: reply.user.email });
      return { id: reply.user.id };
    },
    onSuccess: async () => {
      setInviteOpen(false);
      await queryClient.invalidateQueries({ queryKey: TEAM_USERS_KEY });
    },
  });

  const resend = useMutation({
    mutationFn: async (user: UserDto): Promise<{ id: string }> => {
      const reply = await resendInvite(user.id);
      setInvite({ invite: reply.invite, email: user.email });
      return { id: user.id };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TEAM_USERS_KEY });
    },
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: UserStatusPatch }) =>
      patchUser(input.id, { status: input.status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TEAM_USERS_KEY });
    },
  });

  const saveRoles = useMutation({
    mutationFn: (input: { id: string; roleIds: string[] }) => setUserRoles(input.id, input.roleIds),
    onSuccess: async () => {
      setEditingRoles(null);
      await queryClient.invalidateQueries({ queryKey: TEAM_USERS_KEY });
    },
  });

  // THE HARD DELETE, deliberately. `DELETE /users/:id` without `?permanent`
  // suspends — which is what the per-row Suspend control already does through
  // PATCH — so a Remove that quietly suspended would be a second button for
  // the first button's job, and the directory would still list the account the
  // admin believes they removed. Spending the flag here makes the two controls
  // mean two different things, and the confirm copy says what the extra one
  // costs (prefs, sessions and reset tokens CASCADE; `settings.updated_by`
  // goes NULL, so the workspace loses the record of who changed what).
  const remove = useMutation({
    mutationFn: (user: UserDto) => deleteUser(user.id, true),
    onSuccess: async () => {
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: TEAM_USERS_KEY });
    },
  });

  const filtered = filters.q !== '' || filters.status !== '' || filters.roleId !== '';

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      <PageActions
        title={t('team.title', 'Team')}
        subtitle={t('team.subtitle', 'Who has an account on this Adminium, and what each of them can do.')}
      >
        <Button
          iconLeft={<UserPlus className="size-4" />}
          onClick={() => setInviteOpen(true)}
          data-testid="team-invite"
        >
          {t('team.inviteButton', 'Invite teammate')}
        </Button>
      </PageActions>

      {invite === null ? null : <InviteBanner result={invite} onDismiss={() => setInvite(null)} />}

      <Card padded={false}>
        <CardHeader className="justify-between flex flex-wrap items-center gap-3">
          <SearchInput
            className="min-w-52 flex-1"
            value={filters.q}
            placeholder={t('team.search', 'Search name or email')}
            aria-label={t('team.search', 'Search name or email')}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
            onClear={() => setFilters({ ...filters, q: '' })}
            clearLabel={t('common.clearSearch', 'Clear search')}
          />
          <Select
            wrapperClassName="w-40"
            value={filters.status}
            aria-label={t('team.filterStatus', 'Filter by status')}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value as UserStatus | '' })
            }
          >
            <option value="">{t('team.filterStatusAny', 'Any status')}</option>
            {STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </Select>
          <Select
            wrapperClassName="w-44"
            value={filters.roleId}
            disabled={roleList.length === 0}
            aria-label={t('team.filterRole', 'Filter by role')}
            onChange={(event) => setFilters({ ...filters, roleId: event.target.value })}
          >
            <option value="">{t('team.filterRoleAny', 'Any role')}</option>
            {roleList.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>

          {/* Whole-directory tallies from the reply, so they keep telling the
              truth while a filter narrows the rows below them. */}
          {counts === null ? null : (
            <span className="w-full text-body-sm text-fg-subtle" data-testid="team-counts">
              {t(
                'team.counts',
                '{active} active · {invited} invited · {suspended} suspended',
                { active: counts.active, invited: counts.invited, suspended: counts.suspended },
              )}
            </span>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {users.isPending ? (
            <div className="flex items-center justify-center gap-2 p-8 text-body-sm text-fg-muted">
              <Spinner size="sm" />
              {t('common.loading', 'Loading')}
            </div>
          ) : users.isError ? (
            <div className="p-4">
              <Alert
                role="alert"
                tone="danger"
                data-testid="team-list-error"
                title={t('team.listFailed.title', 'Could not load the directory')}
                body={users.error.message}
                action={
                  <Button variant="secondary" size="sm" onClick={() => void users.refetch()}>
                    {t('common.retry', 'Retry')}
                  </Button>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              preset={filtered ? 'no-matches' : 'no-data'}
              icon={<Users />}
              title={
                filtered
                  ? t('team.empty.filtered.title', 'No one matches these filters')
                  : t('team.empty.title', 'Only you have an account')
              }
              body={
                filtered
                  ? t('team.empty.filtered.body', 'Clear the filters to see the whole directory.')
                  : t('team.empty.body', 'Invite a teammate to give them their own sign-in and role.')
              }
              data-testid="team-empty"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm" data-testid="team-table">
                <thead>
                  <tr className="border-b border-border text-micro uppercase text-fg-subtle">
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('team.column.person', 'Person')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('team.column.status', 'Status')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('team.column.roles', 'Roles')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-start font-bold">
                      {t('team.column.lastSeen', 'Last seen')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-end font-bold">
                      {t('team.column.actions', 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      localeTag={localeTag}
                      now={now}
                      busy={setStatus.isPending || resend.isPending}
                      mayEditRoles={mayEditRoles}
                      rolesRefused={roles.isError}
                      onEditRoles={() => setEditingRoles(user)}
                      onResend={() => resend.mutate(user)}
                      onToggleSuspended={() =>
                        setStatus.mutate({
                          id: user.id,
                          status: user.status === 'suspended' ? 'active' : 'suspended',
                        })
                      }
                      onRemove={() => setRemoving(user)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {users.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={users.isFetchingNextPage}
            onClick={() => void users.fetchNextPage()}
            data-testid="team-load-more"
          >
            {t('team.loadMore', 'Load more')}
          </Button>
        </div>
      ) : null}

      <InviteDialog
        open={inviteOpen}
        roles={roleList}
        busy={create.isPending}
        error={create.error === null ? null : create.error.message}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) create.reset();
        }}
        onSubmit={(body) => create.mutate(body)}
      />

      {editingRoles === null ? null : (
        <RolesDialog
          key={editingRoles.id}
          user={editingRoles}
          roles={roleList}
          busy={saveRoles.isPending}
          error={saveRoles.error === null ? null : saveRoles.error.message}
          onClose={() => {
            setEditingRoles(null);
            saveRoles.reset();
          }}
          onSave={(roleIds) => saveRoles.mutate({ id: editingRoles.id, roleIds })}
        />
      )}

      {removing === null ? null : (
        <ConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          data-testid="team-remove-confirm"
          title={t('team.remove.title', 'Delete account permanently')}
          body={t(
            'team.remove.body',
            'This erases {name}’s account, their preferences and their sign-in sessions, and blanks their name from the record of settings they changed. Suspending instead keeps all of it and only stops them signing in. This cannot be undone.',
            { name: removing.name },
          )}
          confirmWord={removing.email}
          promptLabel={t('team.remove.prompt', 'Type “{email}” to confirm', { email: removing.email })}
          confirmLabel={t('team.remove.confirm', 'Delete permanently')}
          cancelLabel={t('common.cancel', 'Cancel')}
          closeLabel={t('common.close', 'Close')}
          busy={remove.isPending}
          onConfirm={async () => {
            await remove.mutateAsync(removing);
          }}
        />
      )}
    </PageSurface>
  );
}

function UserRow(props: {
  user: UserDto;
  localeTag: string;
  now: number;
  busy: boolean;
  /** `PUT /users/:id/roles` also requires `system:roles:manage`. */
  mayEditRoles: boolean;
  /** The role list came back 403/failed — the only signal we have for WHY. */
  rolesRefused: boolean;
  onEditRoles: () => void;
  onResend: () => void;
  onToggleSuspended: () => void;
  onRemove: () => void;
}): ReactNode {
  const { user } = props;
  const lastSeen = formatSince(user.lastLoginAt, props.localeTag, props.now);
  const lastSeenExact = formatStamp(user.lastLoginAt, props.localeTag);

  return (
    <tr className="border-b border-border/60 last:border-0" data-testid="team-row">
      <td className="px-4 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-fg">{user.name}</span>
          <span className="truncate text-caption text-fg-subtle">{user.email}</span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <StatusPill status={user.status} tone={userStatusTone(user.status)}>
            {statusLabel(user.status)}
          </StatusPill>
          {user.totpEnabled ? (
            <Badge tone="pos" title={t('team.twoFactorOn', 'Two-factor authentication is on')}>
              {t('team.twoFactorShort', '2FA')}
            </Badge>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-2.5">
        {user.roles.length === 0 ? (
          <span className="text-fg-subtle">{t('team.noRoles', 'No roles')}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {user.roles.map((role) => (
              <Tag key={role.id}>{role.name}</Tag>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 text-fg-muted">
        {lastSeen === null ? (
          <span className="text-fg-subtle">{t('team.neverSignedIn', 'Never signed in')}</span>
        ) : (
          <span title={lastSeenExact ?? undefined}>{lastSeen}</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={props.busy || !props.mayEditRoles}
            // Only claim the reason once we actually have one: a still-loading
            // role list is disabled too, and telling that admin they lack a
            // permission they hold is worse than saying nothing.
            title={
              props.rolesRefused
                ? t('team.rolesLocked', 'Changing roles needs the “Manage roles” permission.')
                : undefined
            }
            onClick={props.onEditRoles}
          >
            {t('team.action.roles', 'Roles')}
          </Button>
          {user.status === 'invited' ? (
            <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onResend}>
              {t('team.action.resend', 'New link')}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onToggleSuspended}>
            {user.status === 'suspended'
              ? t('team.action.reactivate', 'Reactivate')
              : t('team.action.suspend', 'Suspend')}
          </Button>
          <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onRemove}>
            {t('team.action.remove', 'Delete')}
          </Button>
        </div>
      </td>
    </tr>
  );
}
