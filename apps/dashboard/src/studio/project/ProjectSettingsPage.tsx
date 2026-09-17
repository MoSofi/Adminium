// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Settings → Project, for super admins.
 *
 * What the server knows about the project folder it runs: where the folder
 * is, which Adminium runs it, the hooks and actions it loaded, its own pages
 * and widgets, the files that did not load, the hook errors since it started,
 * the page and schema files, and what was changed on this server. Everything
 * here is read-only; the project changes in its own folder.
 *
 * File names, labels, table names and error messages come from the project and
 * are shown as they are.
 */

import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { getFormatters } from '@adminium/i18n';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  KeyValueList,
  MonoText,
  Spinner,
} from '@adminium/ui';

import { bootstrapQuery } from '../../app/bootstrap.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import type { ProjectFileStatus } from '../pages/projectApi.js';
import { projectOverviewQuery, type ProjectOverviewDto } from './projectOverviewApi.js';

const SUPER_ADMIN_ROLE = 'super-admin';

function formatters() {
  return getFormatters(getI18nInstance()?.language ?? 'en-US');
}

function permissionLabel(permission: ProjectOverviewDto['actions'][number]['permission']): string {
  switch (permission) {
    case 'read':
      return t('studio:project.permission.read', 'View');
    case 'create':
      return t('studio:project.permission.create', 'Add');
    case 'update':
      return t('studio:project.permission.update', 'Edit');
    case 'delete':
      return t('studio:project.permission.delete', 'Delete');
  }
}

function statusBadge(status: ProjectFileStatus): { tone: 'warn' | 'danger' | 'neutral' | 'info'; label: string } {
  switch (status) {
    case 'changed-on-server':
      return { tone: 'warn', label: t('studio:project.status.changed', 'Changed on this server') };
    case 'conflict':
      return { tone: 'danger', label: t('studio:project.status.conflict', 'Conflict') };
    case 'not-in-project':
      return { tone: 'neutral', label: t('studio:project.status.outside', 'Not in the project') };
    case 'pending':
      return { tone: 'info', label: t('studio:project.status.pending', 'Not applied yet') };
    case 'invalid':
      return { tone: 'danger', label: t('studio:project.status.invalid', 'Not valid') };
  }
}

function groupLabel(group: string): string {
  switch (group) {
    case 'workspace':
      return t('nav.group.workspace', 'Workspace');
    case 'library':
      return t('nav.group.library', 'Library');
    case 'planning':
      return t('nav.group.planning', 'Planning');
    case 'people':
      return t('nav.group.people', 'People');
    case 'account':
      return t('nav.group.account', 'Account');
    default:
      return group;
  }
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <Card padded={false}>
      <CardHeader className="flex items-center gap-2 px-4 py-3">
        <h2 className="text-section text-fg">{title}</h2>
        {count === undefined ? null : <Badge tone="neutral">{count}</Badge>}
      </CardHeader>
      <CardBody className="p-0">{children}</CardBody>
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-body-sm text-fg-subtle">{children}</p>;
}

function Row({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <li
      data-testid={testId}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3 last:border-b-0"
    >
      {children}
    </li>
  );
}

function Overview({ overview, onOpenPages }: { overview: ProjectOverviewDto; onOpenPages: () => void }) {
  const numbers = formatters();
  return (
    <>
      <KeyValueList
        items={[
          { label: t('studio:project.folder', 'Folder'), value: overview.root, mono: true },
          { label: t('studio:project.version', 'Adminium'), value: overview.version, mono: true },
          {
            label: t('studio:project.mode.label', 'Runs as'),
            value:
              overview.mode === 'dev'
                ? t('studio:project.mode.dev', 'Development: the folder and Studio stay in step')
                : t('studio:project.mode.server', 'Server: the folder changes only with a deploy'),
          },
          {
            label: t('studio:project.code.label', 'Project code'),
            value: !overview.codeEnabled
              ? t('studio:project.code.disabled', 'Not loaded: the desktop app never runs project code')
              : overview.loadedAt === null
                ? t('studio:project.code.none', 'None loaded')
                : t('studio:project.code.loaded', 'Loaded {when}', { when: numbers.relative(overview.loadedAt) }),
          },
        ]}
      />

      {overview.problems.length === 0 ? null : (
        <Alert
          tone="danger"
          title={t('studio:project.problems.title', '{count, plural, one {# file did not load} other {# files did not load}}', {
            count: overview.problems.length,
          })}
          body={
            <>
              <p>{t('studio:project.problems.body', 'Fix these files. The rest of the project code is running.')}</p>
              <ul className="mt-2 flex flex-col gap-1">
                {overview.problems.map((problem) => (
                  <li key={problem.source}>
                    <MonoText>{problem.source}</MonoText> {problem.message}
                  </li>
                ))}
              </ul>
            </>
          }
        />
      )}

      <Section title={t('studio:project.actions.title', 'Actions')} count={overview.actions.length}>
        {overview.actions.length === 0 ? (
          <Empty>
            {t('studio:project.actions.empty', 'No actions. A file in actions/ puts a button on records.')}
          </Empty>
        ) : (
          <ul>
            {overview.actions.map((action) => (
              <Row key={action.id} testId={`project-overview-action-${action.id}`}>
                <span className="text-body text-fg">{action.label}</span>
                <MonoText className="text-caption text-fg-subtle">{action.source}</MonoText>
                <span className="text-body-sm text-fg-muted">
                  {action.database} · {action.table}
                </span>
                <Badge tone="neutral">
                  {action.bulk
                    ? t('studio:project.actions.bulk', 'One or more records')
                    : t('studio:project.actions.single', 'One record')}
                </Badge>
                <Badge tone="info">
                  {t('studio:project.actions.needs', 'Needs: {permission}', { permission: permissionLabel(action.permission) })}
                </Badge>
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('studio:project.hooks.title', 'Hooks')} count={overview.hooks.length}>
        {overview.hooks.length === 0 ? (
          <Empty>{t('studio:project.hooks.empty', 'No hooks. A file in hooks/ runs code when records change.')}</Empty>
        ) : (
          <ul>
            {overview.hooks.map((hook) => (
              <Row key={hook.source} testId={`project-overview-hook-${hook.source}`}>
                <MonoText className="text-body-sm text-fg">{hook.source}</MonoText>
                <span className="text-body-sm text-fg-muted">
                  {hook.database} · {hook.table}
                </span>
                {hook.events.map((event) => (
                  <Badge key={event} tone="neutral">
                    {event}
                  </Badge>
                ))}
                {hook.onImport ? (
                  <Badge tone="accent">{t('studio:project.hooks.onImport', 'Also for CSV imports')}</Badge>
                ) : null}
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('studio:project.pages.title', 'Pages')} count={overview.pages.length}>
        {overview.pages.length === 0 ? (
          <Empty>{t('studio:project.pages.empty', 'No pages. A .tsx file in pages/ adds a page of your own.')}</Empty>
        ) : (
          <ul>
            {overview.pages.map((page) => (
              <Row key={page.slug} testId={`project-overview-page-${page.slug}`}>
                <Link
                  to="/p/$slug"
                  params={{ slug: page.slug }}
                  className="text-body font-medium text-accent hover:underline"
                >
                  {page.title}
                </Link>
                <MonoText className="text-caption text-fg-subtle">{page.source}</MonoText>
                <Badge tone="neutral">{groupLabel(page.group)}</Badge>
                {page.hidden ? (
                  <Badge tone="info">{t('studio:project.pages.hidden', 'Not in the sidebar')}</Badge>
                ) : null}
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('studio:project.widgets.title', 'Widgets')} count={overview.widgets.length}>
        {overview.widgets.length === 0 ? (
          <Empty>
            {t('studio:project.widgets.empty', 'No widgets. A file in widgets/ adds a table cell or a dashboard card.')}
          </Empty>
        ) : (
          <ul>
            {overview.widgets.map((widget) => (
              <Row key={widget.id} testId={`project-overview-widget-${widget.id}`}>
                <MonoText className="text-body-sm text-fg">{widget.id}</MonoText>
                <MonoText className="text-caption text-fg-subtle">{widget.source}</MonoText>
                <Badge tone="neutral">
                  {widget.kind === 'cell'
                    ? t('studio:project.widgets.cell', 'Table cell')
                    : t('studio:project.widgets.card', 'Dashboard card')}
                </Badge>
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('studio:project.failures.title', 'Hook errors')} count={overview.hookFailures.length}>
        {overview.hookFailures.length === 0 ? (
          <Empty>{t('studio:project.failures.empty', 'No hook has failed since the server started.')}</Empty>
        ) : (
          <ul>
            {overview.hookFailures.map((failure) => (
              <Row key={`${String(failure.at)}-${failure.source}-${failure.event}`}>
                <span className="text-body-sm text-fg-subtle">{numbers.dateTime(failure.at)}</span>
                <MonoText className="text-body-sm text-fg">{failure.source}</MonoText>
                <Badge tone="neutral">{failure.event}</Badge>
                <span className="text-body-sm text-fg-muted">
                  {failure.database} · {failure.table}
                </span>
                <span className="w-full text-body-sm text-danger">{failure.message}</span>
              </Row>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('studio:project.changes.title', 'Changed on this server')} count={overview.changes.length}>
        {overview.changes.length === 0 ? (
          <Empty>
            {t('studio:project.changes.empty', 'Every page and schema file matches this server.')}
          </Empty>
        ) : (
          <>
            <ul>
              {overview.changes.map((entry) => {
                const badge = statusBadge(entry.status);
                return (
                  <Row key={entry.path}>
                    <MonoText className="text-body-sm text-fg">{entry.path}</MonoText>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </Row>
                );
              })}
            </ul>
            <div className="border-t border-border px-4 py-3">
              <Button size="sm" variant="secondary" onClick={onOpenPages}>
                {t('studio:project.changes.open', 'Resolve in Pages')}
              </Button>
            </div>
          </>
        )}
      </Section>

      <Section title={t('studio:project.files.title', 'Files')}>
        <KeyValueList
          className="rounded-none border-0"
          items={[
            {
              label: t('studio:project.files.pages', 'Page files'),
              value: t('studio:project.files.count', '{count, plural, one {# file} other {# files}}', {
                count: overview.files.pages.length,
              }),
            },
            {
              label: t('studio:project.files.schema', 'Schema files'),
              value: overview.files.schema.length === 0 ? '—' : overview.files.schema.join(', '),
              mono: overview.files.schema.length > 0,
            },
          ]}
        />
      </Section>
    </>
  );
}

export interface ProjectSettingsPageProps {
  onOpenPages: () => void;
}

export function ProjectSettingsPage({ onOpenPages }: ProjectSettingsPageProps): ReactNode {
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const isSuperAdmin = bootstrap.roles.includes(SUPER_ADMIN_ROLE);
  const overview = useQuery({ ...projectOverviewQuery(), enabled: isSuperAdmin });

  let body: ReactNode;
  if (!isSuperAdmin) {
    body = (
      <Alert
        tone="info"
        title={t('studio:settingsHub.superAdminOnlyTitle', 'Super admin required')}
        body={t('studio:project.superAdminOnly', 'Only a super admin can see the project this server runs.')}
      />
    );
  } else if (overview.isPending) {
    body = (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  } else if (overview.isError) {
    body = (
      <Alert
        tone="danger"
        title={t('studio:project.loadFailed', 'The project could not be loaded')}
        body={overview.error instanceof Error ? overview.error.message : undefined}
      />
    );
  } else if (overview.data === null) {
    body = (
      <Alert
        tone="info"
        title={t('studio:project.none.title', 'This server runs no project')}
        body={t(
          'studio:project.none.body',
          'A project is a folder made with `npx @adminiumjs/adminium new`. Its pages, hooks and actions show here when the server runs it.',
        )}
      />
    );
  } else {
    body = <Overview overview={overview.data} onOpenPages={onOpenPages} />;
  }

  return (
    <PageSurface width="page" className="flex flex-col gap-4" testId="studio-project">
      <PageActions
        title={t('studio:project.title', 'Project')}
        subtitle={t('studio:project.subtitle', 'The project folder this server runs, and the code it loaded.')}
        backTo="/studio/settings"
      />
      {body}
    </PageSurface>
  );
}
