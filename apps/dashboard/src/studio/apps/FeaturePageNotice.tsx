// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The address of an app's page whose feature waits on an add-on (bootstrap's
 * `featurePages`): the page is not in the sidebar, and a bookmark to it lands
 * here — on what it needs and where to get it — rather than on a 404 or a page
 * that cannot work.
 *
 * Whoever manages apps is sent to the app's settings page, whose Add-ons card
 * installs and connects the add-on; everyone else is told whom to ask.
 */
import { use } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Card, CardBody, CardHeader, IconTile, MonoText } from '@adminium/ui';
import { ArrowRight, Puzzle } from 'lucide-react';

import { bootstrapQuery, holdsSystemAction, type FeaturePage } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { studioMessagesReady } from '../studioMessages.js';

export function FeaturePageNotice({ page }: { page: FeaturePage }) {
  // Rendered on `/p/…`, outside the Studio routes that load the console's messages.
  use(studioMessagesReady());
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const manager = holdsSystemAction(bootstrap, 'manifests.manage');
  return (
    <PageSurface width="page">
      <Card data-testid="feature-page-notice">
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="info" size="md" icon={<Puzzle />} />
          <h2 className="min-w-0 truncate text-section text-fg">
            {t('studio:featurePage.title', '{page} needs an add-on', { page: t(page.labelKey, page.fallback) })}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <p className="text-body-sm text-fg-muted">
            {t(
              'studio:featurePage.body',
              'This page works only with {count, plural, one {an add-on} other {add-ons}} this app does not have here yet, so it is not in the sidebar. It comes back once {count, plural, one {it is} other {they are}} installed and connected to the app.',
              { count: page.needs.length },
            )}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {page.needs.map((key) => (
              <li key={key}>
                <MonoText className="rounded-md bg-surface-3 px-1.5 py-0.5 text-xs">{key}</MonoText>
              </li>
            ))}
          </ul>
          {manager && page.appKey != null ? (
            <Link
              to="/studio/apps/$key"
              params={{ key: page.appKey }}
              className="inline-flex items-center gap-1.5 self-start text-body-sm font-bold text-accent"
            >
              {t('studio:featurePage.open', 'Open the app’s settings')}
              <ArrowRight aria-hidden className="size-4 rtl:-scale-x-100" />
            </Link>
          ) : (
            <p className="text-body-sm text-fg-subtle">
              {t('studio:featurePage.ask', 'Someone who manages apps can install it.')}
            </p>
          )}
        </CardBody>
      </Card>
    </PageSurface>
  );
}
