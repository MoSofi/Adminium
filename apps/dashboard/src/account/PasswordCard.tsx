// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The password-change form, over `POST /api/v1/auth/password/change`.
 *
 * Extracted out of `SecurityPage` so it can render on BOTH `/account` (beside
 * name and email) and `/account/security` — one implementation, two mount
 * points, because both are places a user reasonably looks for it.
 *
 * ITS SUCCESS COPY THEREFORE NAMES NO LOCATION. The original said "revoke
 * them below", which was only true on the security page, where the session
 * list happens to sit underneath. Shared, the same sentence also renders on
 * the account page, which has no session list at all — so it now says what
 * happens without claiming where to go and do it.
 *
 * The `security.password.*` key namespace is deliberately kept through the
 * move: it names the SUBJECT, not the page it happens to render on, and
 * renaming it would churn nine strings across eight locales to say the same
 * thing.
 */
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  IconTile,
  Input,
} from '@adminium/ui';

import { changePassword } from './securityApi.js';
import { t } from '../i18n/t.js';

export function PasswordCard(): ReactNode {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const change = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
    },
  });

  // The mismatch is caught here rather than by the server because the server
  // never sees the confirmation field — it is a typing check, not a rule.
  const mismatch = confirm !== '' && next !== confirm;
  const canSubmit = current !== '' && next !== '' && !mismatch && next === confirm && !change.isPending;

  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <IconTile tone="accent" size="md" icon={<KeyRound />} />
        <h2 className="text-section text-fg">{t('security.password.title', 'Password')}</h2>
      </CardHeader>
      <CardBody>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            change.mutate({ currentPassword: current, newPassword: next });
          }}
        >
          <FormField label={t('security.password.current', 'Current password')} required>
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              data-testid="password-current"
            />
          </FormField>
          <FormField
            label={t('security.password.new', 'New password')}
            required
            helper={t('security.password.helper', 'At least 8 characters.')}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              data-testid="password-new"
            />
          </FormField>
          <FormField
            label={t('security.password.confirm', 'Confirm new password')}
            required
            {...(mismatch
              ? { error: t('security.password.mismatch', 'The two passwords do not match.') }
              : {})}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              data-testid="password-confirm"
            />
          </FormField>

          {change.error === null ? null : (
            <Alert
              role="alert"
              tone="danger"
              title={t('security.password.failed', 'Could not change your password')}
              body={change.error.message}
              data-testid="security-password-error"
            />
          )}
          {change.isSuccess ? (
            <Alert
              role="status"
              tone="pos"
              title={t('security.password.changed', 'Password changed')}
              body={t(
                'security.password.changedBody',
                'Use the new password the next time you sign in. Other devices stay signed in — end those sessions if you want them out.',
              )}
              data-testid="security-password-ok"
            />
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={!canSubmit} loading={change.isPending}>
              {t('security.password.submit', 'Change password')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
