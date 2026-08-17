// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/account` (09 §2.3): the session-identity card — who is signed in, with
 * which roles and 2FA state — plus links to its sibling per-user pages,
 * `/account/preferences` and `/account/notifications`.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { UserRound } from 'lucide-react';
import { Card, CardBody, CardHeader, IconTile, KeyValueList } from '@adminium/ui';

import { bootstrapQuery } from '../app/bootstrap.js';
import { PageSurface } from '../shell/PageSurface.js';
import { t } from '../i18n/t.js';

export function AccountPage() {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const { user, roles } = bootstrap;

  return (
    <PageSurface width="narrow">
      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="accent" size="md" icon={<UserRound />} />
          <div>
            <h2 className="text-section text-fg">{t('account.title', 'Account')}</h2>
            <p className="text-body-sm text-fg-muted">
              {t('account.subtitle', 'The identity of your current session. Manage display preferences and notification settings on their dedicated pages.')}
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <KeyValueList
            items={[
              { label: t('account.name', 'Name'), value: user.name },
              { label: t('account.email', 'Email'), value: user.email, mono: true },
              { label: t('account.roles', 'Roles'), value: roles.join(', ') || '—' },
              {
                label: t('account.twoFactor', 'Two-factor'),
                value: user.totpEnabled ? t('account.on', 'Enabled') : t('account.off', 'Off'),
              },
            ]}
          />
          <p className="mt-4 flex gap-4 text-body-sm">
            <Link to="/account/preferences" className="font-semibold text-accent hover:underline">
              {t('account.preferencesLink', 'Preferences')}
            </Link>
            <Link to="/account/notifications" className="font-semibold text-accent hover:underline">
              {t('account.notificationsLink', 'Notification settings')}
            </Link>
          </p>
        </CardBody>
      </Card>
    </PageSurface>
  );
}
