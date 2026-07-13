/**
 * PageRenderer STUB (09-T03 lands in M4 Wave B). Resolves the slug against
 * the bootstrap nav tree (unknown slug → branded 404 with NO server round
 * trip, 09 §2.3), fetches the page document, and renders a "template not yet
 * implemented" card showing the fetched PageConfig JSON so Wave A end-to-end
 * flows are inspectable. Wave B replaces the card with template resolution
 * (validate → migrate → mount per 09 §4.1).
 */
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { FileCode2 } from 'lucide-react';
import { Card, CardBody, CardHeader, IconTile, MonoText, Skeleton } from '@adminium/ui';

import { bootstrapQuery, findNavItemBySlug } from '../app/bootstrap.js';
import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { NotFoundPage } from '../states/NotFoundPage.js';
import { pageQuery } from './pageQuery.js';

export function PageRenderer() {
  const params = useParams({ strict: false });
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const item = findNavItemBySlug(bootstrap.nav, slug);

  if (item === null) return <NotFoundPage />;
  return <PageStub pageId={item.pageId} title={t(item.labelKey, item.fallback)} />;
}

function PageStub({ pageId, title }: { pageId: string; title: string }) {
  const page = useQuery(pageQuery(pageId));
  const pagesApiMissing = page.error instanceof ApiError && page.error.status === 404;

  return (
    <div className="mx-auto max-w-page p-6">
      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="accent" size="md" icon={<FileCode2 />} />
          <div className="min-w-0">
            <h2 className="truncate text-section text-fg">{title}</h2>
            <p className="text-body-sm text-fg-muted">
              {t('page.stub', 'Template not yet implemented — the rendering pipeline lands in Wave B (09-T03).')}
            </p>
          </div>
        </CardHeader>
        <CardBody>
          {page.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ) : page.isError ? (
            <p className="text-body-sm text-fg-muted">
              {pagesApiMissing
                ? t('page.apiMissing', 'GET /api/v1/pages/:pageId is not available yet (M4 Wave B) — showing the nav entry only.')
                : t('page.error', 'Could not load this page’s config.')}
              <MonoText className="ms-2 text-caption text-fg-subtle">{pageId}</MonoText>
            </p>
          ) : (
            <pre className="nb-scroll max-h-[60vh] overflow-auto rounded-md bg-surface-2 p-4 font-mono text-[11.5px] leading-relaxed text-fg">
              {JSON.stringify(page.data, null, 2)}
            </pre>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
