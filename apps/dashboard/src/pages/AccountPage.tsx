/**
 * `/account/*` placeholder (09 §2.3): the real profile / notification
 * settings / scheduled reports pages are seeded universal pages rendered by
 * `page-settings` templates (Wave B, 09-T18). Shows the session identity so
 * the route is verifiably session-bound meanwhile.
 */
import { useSuspenseQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { Card, CardBody, CardHeader, IconTile, KeyValueList } from '@adminium/ui';

import { bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';

export function AccountPage() {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const { user, roles } = bootstrap;

  return (
    <div className="mx-auto max-w-narrow p-6">
      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="accent" size="md" icon={<UserRound />} />
          <div>
            <h2 className="text-section text-fg">{t('account.title', 'Account')}</h2>
            <p className="text-body-sm text-fg-muted">
              {t('account.stub', 'Profile and preference pages arrive as seeded settings pages in Wave B (09-T18).')}
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
        </CardBody>
      </Card>
    </div>
  );
}
