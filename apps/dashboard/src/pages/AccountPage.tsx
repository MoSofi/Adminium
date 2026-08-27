// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/account` (09 §2.3): the session-identity card — who is signed in, with
 * which roles and 2FA state — plus links to its sibling per-user pages,
 * `/account/preferences`, `/account/security` and `/account/notifications`.
 *
 * THE PASSWORD FORM LIVES HERE TOO — `account/PasswordCard.tsx`, the same
 * component `/account/security` mounts. Shared rather than copied, so the
 * two never drift; this page earns it because changing your email here
 * already makes you type that same password.
 *
 * NAME AND EMAIL ARE EDITABLE HERE. `PATCH /api/v1/me` has existed in
 * `routes/me` since M2 with no screen behind it, so both rendered as dead
 * text and the only way to correct a typo'd name was a direct DB write.
 *
 * EMAIL IS A CREDENTIAL, not a profile field, and the form says so: the
 * password prompt appears only once the email is actually dirty. Always-on it
 * would be noise on the far more common name edit, and it would invite
 * password managers to fill — then save — a field that has nothing to do with
 * signing in. The server enforces this independently (`mePatchBody` refuses an
 * email change with no password); this only keeps the UI honest about which
 * of the two fields costs a re-authentication.
 *
 * ROLES AND TWO-FACTOR ARE NOT EDITED HERE, for two different reasons.
 * Roles are an administrative grant, not a self-service preference — a user
 * who could edit their own roles row would be the whole permission model's
 * bypass — so they stay read-only and `/team` owns the change. Two-factor IS
 * the user's to change, but `/account/security` already owns the full
 * enrolment flow (secret, activation, ten recovery codes, disable), and that
 * flow cannot be halved. So the row links there rather than duplicating it:
 * one door per destination, the same rule the avatar menu follows.
 */
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  IconTile,
  Input,
  KeyValueList,
} from '@adminium/ui';

import { bootstrapQuery, type BootstrapData, type SessionUser } from '../app/bootstrap.js';
import { patchMe, type MePatch } from '../account/meApi.js';
import { PasswordCard } from '../account/PasswordCard.js';
import { PageSurface } from '../shell/PageSurface.js';
import { t } from '../i18n/t.js';

/**
 * Which fields the user actually touched, compared against the session user.
 *
 * Email is compared case-insensitively and trimmed because the server
 * lowercases it before storing (`patchMeHandler`) — without that, re-typing
 * your own address in title case reads as a change here, and then demands a
 * password to save something the server would discard as a no-op.
 */
export function profileDiff(
  user: Pick<SessionUser, 'name' | 'email'>,
  draft: { name: string; email: string },
): { name?: string; email?: string } {
  const diff: { name?: string; email?: string } = {};
  const name = draft.name.trim();
  const email = draft.email.trim();
  if (name !== user.name.trim()) diff.name = name;
  if (email.toLowerCase() !== user.email.trim().toLowerCase()) diff.email = email;
  return diff;
}

function ProfileCard({ user }: { user: SessionUser }): ReactNode {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');

  const save = useMutation({
    mutationFn: (patch: MePatch) => patchMe(patch),
    onSuccess: (fresh) => {
      // Seed rather than invalidate: the reply is the same `authUserView` the
      // bootstrap payload carries, so the topbar avatar and the menu's
      // name/email header update on this tick instead of after a refetch of
      // the whole nav tree. `staleTime: Infinity` means nothing re-fetches it
      // on its own, so a stale name would otherwise survive until reload.
      queryClient.setQueryData<BootstrapData>(bootstrapQuery().queryKey, (prev) =>
        prev === undefined ? prev : { ...prev, user: fresh },
      );
      setName(fresh.name);
      setEmail(fresh.email);
      setPassword('');
    },
  });

  const diff = profileDiff(user, { name, email });
  const emailChanged = diff.email !== undefined;
  const dirty = diff.name !== undefined || emailChanged;
  // A blank name would pass this guard and fail the server's `min(1)`; catching
  // it here keeps the error next to the field instead of in a red banner.
  const nameEmpty = name.trim() === '';
  const canSubmit = dirty && !nameEmpty && (!emailChanged || password !== '') && !save.isPending;

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<UserRound />} />
        <div>
          <h2 className="text-section text-fg">{t('account.title', 'Account')}</h2>
          <p className="text-body-sm text-fg-muted">
            {t(
              'account.subtitle',
              'The identity of your current session. Manage display preferences and notification settings on their dedicated pages.',
            )}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            save.mutate({ ...diff, ...(emailChanged ? { password } : {}) });
          }}
        >
          <FormField
            label={t('account.name', 'Name')}
            required
            {...(nameEmpty ? { error: t('account.nameRequired', 'Enter your name.') } : {})}
          >
            <Input
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              data-testid="account-name"
            />
          </FormField>

          <FormField
            label={t('account.email', 'Email')}
            required
            helper={t('account.emailHelper', 'Used to sign in. Changing it needs your password.')}
          >
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="account-email"
            />
          </FormField>

          {emailChanged ? (
            <FormField
              label={t('account.confirmPassword', 'Current password')}
              required
              helper={t(
                'account.confirmPasswordHelper',
                'Confirm it is you before your sign-in address changes.',
              )}
            >
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                data-testid="account-password"
              />
            </FormField>
          ) : null}

          {save.error === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              title={t('account.saveFailed', 'Could not save your profile')}
              body={save.error.message}
              data-testid="account-error"
            />
          )}
          {save.isSuccess && !dirty ? (
            <Alert
              role="status"
              tone="pos"
              title={t('account.saved', 'Profile updated')}
              body={t(
                'account.savedBody',
                'Your new details are in use across this workspace. If you changed your email, sign in with the new address from now on.',
              )}
              data-testid="account-saved"
            />
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setName(user.name);
                setEmail(user.email);
                setPassword('');
                save.reset();
              }}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit} loading={save.isPending}>
              {t('account.save', 'Save changes')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function AccessCard({ user, roles }: { user: SessionUser; roles: readonly string[] }): ReactNode {
  return (
    <Card>
      {/* Heading and subtitle wrapped as one block: they are a unit, and the
          slot's own `gap-3` is meant to separate siblings, not a title from
          its own caption. */}
      <CardHeader>
        <div>
          <h2 className="text-section text-fg">{t('account.accessTitle', 'Access')}</h2>
          <p className="text-body-sm text-fg-muted">
            {t('account.accessSubtitle', 'What this account may do, and how it proves who it is.')}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <KeyValueList
          items={[
            {
              label: t('account.roles', 'Roles'),
              value: roles.join(', ') || '—',
            },
            {
              label: t('account.twoFactor', 'Two-factor'),
              value: (
                <span className="inline-flex items-center gap-2">
                  <Badge tone={user.totpEnabled ? 'pos' : 'neutral'}>
                    {user.totpEnabled ? t('account.on', 'Enabled') : t('account.off', 'Off')}
                  </Badge>
                  <Link to="/account/security" className="font-semibold text-accent hover:underline">
                    {user.totpEnabled
                      ? t('account.manageTwoFactor', 'Manage')
                      : t('account.setUpTwoFactor', 'Set up')}
                  </Link>
                </span>
              ),
            },
          ]}
        />
        <p className="mt-3 text-caption text-fg-subtle">
          {t(
            'account.rolesHelper',
            'Roles are granted by an administrator and cannot be changed from your own account.',
          )}
        </p>
        <p className="mt-4 flex flex-wrap gap-4 text-body-sm">
          <Link to="/account/preferences" className="font-semibold text-accent hover:underline">
            {t('account.preferencesLink', 'Preferences')}
          </Link>
          <Link to="/account/security" className="font-semibold text-accent hover:underline">
            {t('account.securityLink', 'Password & sessions')}
          </Link>
          <Link to="/account/notifications" className="font-semibold text-accent hover:underline">
            {t('account.notificationsLink', 'Notification settings')}
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}

export function AccountPage() {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const { user, roles } = bootstrap;

  return (
    <PageSurface width="page" className="flex flex-col gap-5">
      {/* Keyed on the user id so a sign-out/sign-in inside one mounted shell
          re-seeds the draft state instead of showing the previous user's
          name in the inputs. */}
      <ProfileCard key={user.id} user={user} />
      <PasswordCard />
      <AccessCard user={user} roles={roles} />
    </PageSurface>
  );
}
