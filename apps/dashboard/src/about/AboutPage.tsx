/**
 * `/about` — the About / version / license screen (M10-T04; v0.5 exit
 * criterion "the About screen shows version/license").
 *
 * Carries the AGPL §13 source offer (01-architecture.md §9.3: an instance
 * satisfies §13 by linking the corresponding source from its About screen), the
 * running version, the meta-store engine, and the self-host update notice.
 *
 * The update notice is gated on `updates.checkEnabled`: when the instance has
 * opted out this page does not even ISSUE the request (`enabled` below), and
 * the server would answer `disabled` without a network call regardless. An
 * opted-out instance therefore makes no outbound call from this screen.
 */
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { ArrowUpCircle, CheckCircle2, ExternalLink, RefreshCw, Scale } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, Button, Card, CardBody, CardHeader, IconTile, KeyValueList } from '@adminium/ui';

import { isDesktopRuntime } from '../lib/desktop-runtime.js';
import { t } from '../i18n/t.js';
import { aboutQuery, updateCheckQuery, type AboutData, type MetaEngine } from './aboutApi.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { PageSurface } from '../shell/PageSurface.js';
import { DesktopAboutSections } from './DesktopAboutSections.js';

/** Display names for the three v1 meta engines (07-meta-store.md). */
function engineLabel(engine: MetaEngine): string {
  switch (engine) {
    case 'postgres':
      return t('about.engine.postgres', 'PostgreSQL');
    case 'mysql':
      return t('about.engine.mysql', 'MySQL / MariaDB');
    case 'sqlite':
      return t('about.engine.sqlite', 'SQLite');
  }
}

function SectionHeader(props: { icon: ReactNode; title: string; description?: string }): ReactNode {
  return (
    <CardHeader className="flex items-start gap-3">
      <IconTile tone="accent" size="md" icon={props.icon} />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-section text-fg">{props.title}</h2>
        {props.description === undefined ? null : (
          <p className="text-body-sm text-fg-muted">{props.description}</p>
        )}
      </div>
    </CardHeader>
  );
}

/**
 * The self-host update notice. Renders nothing when the feed was unreachable —
 * a transient network failure is not news worth a banner.
 */
function UpdateNotice({ about }: { about: AboutData }): ReactNode {
  const check = useQuery({ ...updateCheckQuery(), enabled: about.updates.checkEnabled });

  if (!about.updates.checkEnabled) {
    return (
      <p className="text-body-sm text-fg-muted" data-testid="about-update-optout">
        {t(
          'about.update.disabled',
          'Update checks are off, so this instance never contacts GitHub. Turn them on in Settings to hear about new releases.',
        )}
      </p>
    );
  }

  if (check.data === undefined || check.data.status === 'disabled' || check.data.status === 'unknown') {
    return null;
  }

  if (check.data.status === 'current') {
    return (
      <p className="flex items-center gap-2 text-body-sm text-fg-muted" data-testid="about-update-current">
        <CheckCircle2 className="size-4 text-pos" aria-hidden="true" />
        {t('about.update.current', 'You are on the latest release.')}
      </p>
    );
  }

  const { latest, url } = check.data;
  return (
    <Alert
      tone="info"
      icon={<ArrowUpCircle className="size-[18px]" />}
      data-testid="about-update-available"
      title={t('about.update.available', 'Adminium {version} is available', { version: latest })}
      body={t('about.update.availableBody', 'You are running {version}.', { version: about.version })}
      action={
        <Button asChild variant="soft" size="sm">
          <a href={url} target="_blank" rel="noreferrer noopener">
            {t('about.update.viewRelease', 'View release notes')}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </Button>
      }
    />
  );
}

export function AboutPage(): ReactNode {
  const { data: about } = useSuspenseQuery(aboutQuery());
  // The Electron shell adds §13's desktop-only sections (versions, data dir,
  // secret-storage mode, in-app licence viewers, telemetry, diagnostics) and
  // replaces the self-host GitHub update notice with §11's desktop updater — so
  // the two are mutually exclusive, not stacked. `isDesktopRuntime()` is §4's
  // detection contract; the extra data is native-affordance only.
  const desktop = isDesktopRuntime();

  return (
    <PageSurface width="narrow" className="flex flex-col gap-5">
      {/* Heading and subtitle live in the TOPBAR, not the body: the shell
          renders an <h1> for every route regardless, so a second one here said
          the same thing twice while the shell's copy said "Home". */}
      <PageActions
        title={t('about.title', 'About Adminium')}
        subtitle={t('about.subtitle', 'Version, licence, and where this instance’s source code lives.')}
      />

      {/* The self-host summary. On desktop it is omitted: §13's System card
          below carries the same version/engine facts in fuller form, and showing
          both would print the server version twice. */}
      {desktop ? null : (
        <Card padded={false}>
          <CardBody>
            <KeyValueList
              items={[
                { label: t('about.version', 'Version'), value: about.version, mono: true },
                { label: t('about.license', 'Licence'), value: about.license },
                { label: t('about.metaStore', 'Meta store'), value: engineLabel(about.metaEngine) },
                { label: t('about.node', 'Node.js'), value: about.node, mono: true },
              ]}
            />
          </CardBody>
        </Card>
      )}

      {desktop ? (
        // §13: the shell owns its own AGPL notice (with an in-app licence viewer),
        // its own §11 updater, telemetry, and diagnostics — so the self-host
        // licence + GitHub-update cards below are replaced, not supplemented.
        <DesktopAboutSections about={about} />
      ) : (
        <>
          <Card padded={false}>
            <SectionHeader
              icon={<Scale />}
              title={t('about.licenseCard.title', 'Free and open source')}
              description={t(
                'about.licenseCard.body',
                'Adminium is licensed under the GNU Affero General Public License v3.0. You are free to run, study, modify, and share it. If you offer a modified version to others over a network, the AGPL asks you to offer them its source code too.',
              )}
            />
            <CardBody>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="md">
                  <a href={about.licenseUrl} target="_blank" rel="noreferrer noopener">
                    {t('about.viewLicense', 'Read the licence')}
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </Button>
                {/* The AGPL §13 source offer — this link IS the compliance artifact. */}
                <Button asChild variant="outline" size="md">
                  <a href={about.sourceUrl} target="_blank" rel="noreferrer noopener">
                    {t('about.viewSource', 'Get the source code')}
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card padded={false}>
            <SectionHeader
              icon={<RefreshCw />}
              title={t('about.updates.title', 'Updates')}
              description={t('about.updates.description', 'Whether this instance checks for new releases.')}
            />
            <CardBody>
              <UpdateNotice about={about} />
            </CardBody>
          </Card>
        </>
      )}
    </PageSurface>
  );
}
