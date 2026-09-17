// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the pages manager says about the project folder this server runs.
 *
 * On a server, pages edited here are kept and flagged until a developer pulls
 * them into the project; the banner gives the exact command. A page changed
 * both here and in the project is a conflict, settled with one of two buttons:
 * keep this server's copy (it stays flagged until pulled), or put the
 * project's copy back. In dev the folder and Studio stay in step by
 * themselves, so only files that could not be applied and pages no file can
 * hold are listed.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { invalidatePages, type PageSummaryDto } from './pagesApi.js';
import {
  NOT_CONFIGURED_REASON,
  resolveProjectFile,
  type PageProjectFlag,
  type ProjectStatusDto,
  type ProjectStatusEntryDto,
} from './projectApi.js';

export function ProjectFlagBadge({ flag }: { flag: PageProjectFlag }) {
  switch (flag) {
    case 'changed':
      return (
        <Badge tone="warn" data-testid="studio-pages-project-flag">
          {t('studio:pages.project.badge.changed', 'Changed on server')}
        </Badge>
      );
    case 'conflict':
      return (
        <Badge tone="danger" data-testid="studio-pages-project-flag">
          {t('studio:pages.project.badge.conflict', 'Conflict')}
        </Badge>
      );
    case 'outside':
      return (
        <Badge tone="neutral" data-testid="studio-pages-project-flag">
          {t('studio:pages.project.badge.outside', 'Not in project')}
        </Badge>
      );
  }
}

function PullCommand() {
  const command = `npm run pull -- --from ${window.location.origin}`;
  return (
    <code
      className="text-body-sm mt-1 block break-all rounded bg-surface-2 px-2 py-1 font-mono text-fg"
      data-testid="studio-pages-pull-command"
    >
      {command}
    </code>
  );
}

interface ProjectFilesPanelProps {
  status: ProjectStatusDto;
  pages: readonly PageSummaryDto[];
}

export function ProjectFilesPanel({ status, pages }: ProjectFilesPanelProps) {
  const client = useQueryClient();
  const resolve = useMutation({
    mutationFn: ({ path, keep }: { path: string; keep: 'server' | 'project' }) =>
      resolveProjectFile(path, keep),
    onSuccess: () => invalidatePages(client),
  });

  const titleOf = (entry: ProjectStatusEntryDto): string =>
    pages.find((page) => page.id === entry.pageId)?.title ?? entry.name;
  const server = status.mode === 'server';
  const changed = status.entries.filter((entry) => entry.status === 'changed-on-server');
  const conflicts = status.entries.filter((entry) => entry.status === 'conflict');
  const invalid = status.entries.filter((entry) => entry.status === 'invalid');
  const onlyHere = status.entries.filter((entry) => entry.status === 'not-in-project');
  const outside = status.outside;
  const notConfigured = outside.some((page) => page.reason === NOT_CONFIGURED_REASON);

  if (
    invalid.length +
      (server ? changed.length + conflicts.length + onlyHere.length : 0) +
      outside.length ===
    0
  ) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="studio-pages-project">
      {invalid.length > 0 ? (
        <Alert
          tone="danger"
          data-testid="studio-pages-project-invalid"
          title={t(
            'studio:pages.project.invalid.title',
            '{count, plural, one {# project file was not applied} other {# project files were not applied}}',
            { count: invalid.length },
          )}
          // `Alert` shows `body` instead of its children, so the list goes in the body.
          body={
            <>
              {t(
                'studio:pages.project.invalid.body',
                'Fix these files. Until then the last good version stays in use.',
              )}
              <ul className="mt-1 list-disc ps-5">
                {invalid.map((entry) => (
                  <li key={entry.path}>
                    <span className="font-mono">{entry.path}</span>: {entry.problems?.[0] ?? ''}
                  </li>
                ))}
              </ul>
            </>
          }
        />
      ) : null}

      {server && changed.length > 0 ? (
        <Alert
          tone="warn"
          data-testid="studio-pages-project-changed"
          title={t(
            'studio:pages.project.changed.title',
            '{count, plural, one {# page was changed on this server} other {# pages were changed on this server}}',
            { count: changed.length },
          )}
          body={
            <>
              {t(
                'studio:pages.project.changed.body',
                'Pull the changes into your project and deploy it, or they stay on this server only:',
              )}
              <PullCommand />
            </>
          }
        />
      ) : null}

      {server && conflicts.length > 0 ? (
        <Alert
          tone="danger"
          data-testid="studio-pages-project-conflicts"
          title={t(
            'studio:pages.project.conflicts.title',
            '{count, plural, one {# page was changed here and in the project} other {# pages were changed here and in the project}}',
            { count: conflicts.length },
          )}
          body={
            <>
              {t(
                'studio:pages.project.conflicts.body',
                'This server keeps its own version until you choose one.',
              )}
              <ul className="mt-2 flex flex-col gap-2">
                {conflicts.map((entry) => (
                  <li key={entry.path} className="flex flex-wrap items-center gap-2">
                    <span className="text-body min-w-0 flex-1 truncate text-fg">
                      {titleOf(entry)}
                    </span>
                    <span className="text-body-sm font-mono text-fg-subtle">{entry.path}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate({ path: entry.path, keep: 'server' })}
                    >
                      {t('studio:pages.project.keepServer', 'Keep server copy')}
                    </Button>
                    <Button
                      size="sm"
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate({ path: entry.path, keep: 'project' })}
                    >
                      {t('studio:pages.project.useProject', 'Use project copy')}
                    </Button>
                  </li>
                ))}
              </ul>
              {resolve.isError ? (
                <p className="text-body-sm mt-2 text-danger" role="alert">
                  {t('studio:pages.project.resolveFailed', 'That could not be changed.')}{' '}
                  {resolve.error instanceof Error ? resolve.error.message : ''}
                </p>
              ) : null}
            </>
          }
        />
      ) : null}

      {(server && onlyHere.length > 0) || outside.length > 0 ? (
        <Alert
          tone="info"
          data-testid="studio-pages-project-outside"
          title={t(
            'studio:pages.project.outside.title',
            '{count, plural, one {# page is not in the project} other {# pages are not in the project}}',
            { count: (server ? onlyHere.length : 0) + outside.length },
          )}
          body={
            <>
              {server && onlyHere.length > 0 ? (
                <>
                  {t(
                    'studio:pages.project.outside.body',
                    'They exist on this server only. Pull them into the project to keep them:',
                  )}
                  <PullCommand />
                </>
              ) : null}
              {notConfigured ? (
                <p className="text-body-sm mt-1">
                  {t(
                    'studio:pages.project.notConfigured',
                    'Some of them belong to a database the project does not list. Add it to adminium.config.ts to keep its pages in the project.',
                  )}
                </p>
              ) : null}
            </>
          }
        />
      ) : null}
    </div>
  );
}
