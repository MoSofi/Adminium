// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `project-page` template: a page written by hand in the project folder,
 * `pages/<slug>.tsx` (49-developer-projects.md §6.3).
 *
 * The server keeps a page row for it, so it has a sidebar place, an address
 * and the same view grants as any page. The row names the built file
 * (`config.file`); the bootstrap payload says where that file is. Loading it
 * installs the host runtime first, then the page renders with this app's
 * React, inside `TemplateMount`'s error boundary. The `project` messages load
 * with it (`projectMessages.ts`).
 */

import { useSuspenseQuery } from '@tanstack/react-query';
import { FileCode2, PackageOpen } from 'lucide-react';
import { Suspense, createElement, useMemo, type ComponentType, type ReactNode } from 'react';
import { Skeleton } from '@adminium/ui';

import { bootstrapQuery } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import type { PageTemplateProps } from '../pages/template-types.js';
import { projectPageFor } from './bootstrapProject.js';
import { ProjectMessageCard } from './MessageCard.js';
import { ProjectPageContext } from './pageConfig.js';
import { useProjectMessages } from './projectMessages.js';
import { checkDefinition, useProjectModule } from './useProjectModule.js';

function PageBodySkeleton() {
  return (
    <div className="flex flex-col gap-4" data-testid="project-page-loading">
      <Skeleton className="h-7 w-1/3" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function ProjectPageBinding(props: PageTemplateProps): ReactNode {
  return (
    <Suspense fallback={<PageBodySkeleton />}>
      <ProjectPageBody {...props} />
    </Suspense>
  );
}

function ProjectPageBody({
  page,
  recordId,
  canCreate,
  canUpdate,
  canDelete,
  canAttach,
  canUnmask,
  currency,
}: PageTemplateProps): ReactNode {
  useProjectMessages();
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const file = typeof page.config['file'] === 'string' ? page.config['file'] : null;
  const entry = file === null ? null : projectPageFor(bootstrap, file);
  const source = `pages/${file ?? '?'}.tsx`;
  const loaded = useProjectModule(entry, (value) => checkDefinition(value, source, 'definePage'));
  const context = useMemo(
    () => ({
      slug: file ?? '',
      pageId: page.id,
      source: page.source,
      recordId,
      table: { canCreate, canUpdate, canDelete, canAttach, canUnmask, currency },
    }),
    [file, page.id, page.source, recordId, canCreate, canUpdate, canDelete, canAttach, canUnmask, currency],
  );

  if (entry === null) {
    return (
      <ProjectMessageCard
        icon={<FileCode2 />}
        title={t('project:page.missing.title', 'This page is not in the running build')}
        body={t(
          'project:page.missing.body',
          'Its code comes from the project folder. Build the project again, or restart Adminium, to load it.',
        )}
        detail={source}
      />
    );
  }
  if (loaded.status === 'loading') return <PageBodySkeleton />;
  if (loaded.status === 'failed') {
    return (
      <ProjectMessageCard
        icon={<PackageOpen />}
        title={t('project:page.failed.title', 'This page’s code did not load')}
        body={loaded.error.message}
        detail={source}
        onRetry={loaded.retry}
      />
    );
  }
  return (
    <ProjectPageContext.Provider value={context}>
      <Suspense fallback={<PageBodySkeleton />}>
        {createElement(loaded.definition.component as unknown as ComponentType<{ slug: string }>, { slug: file ?? '' })}
      </Suspense>
    </ProjectPageContext.Provider>
  );
}
