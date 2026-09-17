// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GeneratedPage` (49-developer-projects.md §6.2): renders a page config held
 * in code, such as the constant `adminium eject` writes, with the same
 * templates a generated page uses.
 *
 * It mounts the template itself rather than through `PageRenderer`'s
 * `TemplateMount`: the project page around it already has the page gutter,
 * and the renderer every page loads stays as small as it was. The adapters
 * and the template registry come from the page it is in (`pageHost.ts`).
 *
 * A config for the page's own table (an ejected page's) also gets what the
 * page's own template would: the record route, and the person's write
 * permissions on that table, which the server worked out for the page.
 */

import { useSuspenseQuery } from '@tanstack/react-query';
import { FileQuestion, PackageOpen, ShieldAlert } from 'lucide-react';
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Skeleton } from '@adminium/ui';
import { WidgetErrorBoundary } from '@adminium/widgets';
import type { PageEnvelope } from '@adminium/engine/config';
import type { GeneratedPageProps } from '@adminium/server/ui';

import { parsePageDocument } from '../../api/pages.js';
import { bootstrapQuery } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';
import { PageHostContext, type PageHost } from '../../pages/pageHost.js';
import type { PageTemplateComponent } from '../../pages/template-types.js';
import { projectOf } from '../bootstrapProject.js';
import { ProjectMessageCard } from '../MessageCard.js';
import { toLocalPageEnvelope, useProjectPage, type ProjectPageInfo } from '../pageConfig.js';

type TemplateLoad =
  | { status: 'loading' }
  | { status: 'ready'; Template: PageTemplateComponent | null }
  | { status: 'failed'; error: Error };

/** Whether a config is for the table of the page it is drawn in. */
function isOwnTable(page: PageEnvelope, info: ProjectPageInfo | null): info is ProjectPageInfo {
  const source = info?.source;
  return (
    source !== undefined &&
    source.table !== null &&
    source.table === page.source.table &&
    source.connectionId === page.source.connectionId
  );
}

function EmbeddedTemplate({
  host,
  page,
  info,
}: {
  host: PageHost;
  page: PageEnvelope;
  info: ProjectPageInfo | null;
}): ReactNode {
  const [load, setLoad] = useState<TemplateLoad>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const adapters = host.usePageAdapters(page, info?.slug ?? '');
  const own = isOwnTable(page, info);
  const recordId = own ? info.recordId : undefined;
  const templateId = recordId === undefined ? page.template : (host.detailTemplateOf(page) ?? page.template);

  // As `TemplateMount` does: `resolvePageTemplate` forgets a failed load, so
  // Retry (a new `attempt`) fetches it again.
  useEffect(() => {
    let alive = true;
    setLoad({ status: 'loading' });
    host.resolvePageTemplate(templateId).then(
      (Template) => {
        if (alive) setLoad({ status: 'ready', Template });
      },
      (error: unknown) => {
        if (alive) setLoad({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) });
      },
    );
    return () => {
      alive = false;
    };
  }, [host, templateId, attempt]);

  if (load.status === 'loading') {
    return (
      <div className="flex flex-col gap-4" data-testid="generated-page-loading">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (load.status === 'failed') {
    return (
      <RenderErrorCard error={load.error} template={templateId} onRetry={() => setAttempt((value) => value + 1)} />
    );
  }
  const { Template } = load;
  if (Template === null) {
    return (
      <ProjectMessageCard
        icon={<FileQuestion />}
        title={t('page.unknownTemplate.title', 'Unknown page template')}
        body={t(
          'page.unknownTemplate.body',
          'This page uses a template this build doesn’t recognize. It may come from a newer Adminium or an extension that isn’t installed.',
        )}
        detail={templateId}
      />
    );
  }
  return <Template page={page} adapters={adapters} {...(own ? { ...info.table, recordId } : {})} />;
}

function RenderErrorCard({ error, template, onRetry }: { error: Error; template: string; onRetry: () => void }) {
  return (
    <ProjectMessageCard
      icon={<PackageOpen />}
      title={t('page.renderError.title', 'This page failed to render')}
      body={error.message}
      detail={template}
      onRetry={onRetry}
    />
  );
}

export function GeneratedPage({ page }: GeneratedPageProps): ReactNode {
  const host = useContext(PageHostContext);
  if (host === null) throw new Error('GeneratedPage renders inside an Adminium page.');
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const projectPage = useProjectPage();
  const pageId = projectPage?.pageId ?? 'page_proj_inline';
  const databases = projectOf(bootstrap)?.databases;

  // The page this config is drawn in lends it its id, which saved views and the
  // like are kept under.
  const result = useMemo(() => {
    const local = toLocalPageEnvelope(page, databases ?? {}, pageId);
    if (!local.ok) return { status: 'invalid' as const, issues: local.problems };
    return parsePageDocument(local.envelope);
  }, [page, databases, pageId]);

  if (result.status !== 'ok') {
    return (
      <ProjectMessageCard
        icon={<ShieldAlert />}
        title={t('page.invalid.title', 'This page’s configuration is invalid')}
        body={t('page.invalid.body', 'The stored page document failed validation and cannot be rendered.')}
        detail={
          result.status === 'invalid'
            ? result.issues.slice(0, 5).join('\n')
            : `v${String(result.v)} > v${String(result.latest)}`
        }
      />
    );
  }
  const template = result.page.template;
  return (
    <WidgetErrorBoundary
      fallback={(error, reset) => <RenderErrorCard error={error} template={template} onRetry={reset} />}
    >
      <EmbeddedTemplate host={host} page={result.page} info={projectPage} />
    </WidgetErrorBoundary>
  );
}
