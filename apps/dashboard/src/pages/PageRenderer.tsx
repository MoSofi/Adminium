/**
 * PageRenderer — the runtime config interpreter (09-generated-app.md §4.1):
 *
 *   GET /api/v1/pages/:pageId → migrate + Zod-validate (src/api/pages.ts)
 *     → resolve `template` against the page-template registry
 *     → mount the template with its data adapters (CrudApi / DashboardData)
 *     → WidgetEvents: record-open → hrefForRecord navigation, drill-through →
 *       href navigation, mutate → CRUD call + undo toast + cache invalidation.
 *
 * Never-crash rules (§3.1): unknown slug → branded 404 (no server round trip);
 * `v` too new → "config too new" card; invalid envelope → invalid-config card;
 * unknown/not-yet-shipped template → unknown-template card; a throwing
 * template degrades to an error card via WidgetErrorBoundary. Page-level API
 * 403/404/5xx render the matching system state *inside* the content outlet —
 * shell and nav stay usable (§6.1).
 */
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useParams, useRouter } from '@tanstack/react-router';
import { FileQuestion, PackageOpen, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardBody, CardHeader, IconTile, MonoText, Skeleton } from '@adminium/ui';
import { WidgetErrorBoundary, isDeletePreview, type WidgetEvent } from '@adminium/widgets';
import type { PageEnvelope } from '@adminium/engine/config';

import { createCrudApi, type BoundCrudApi, type CrudMutationResult } from '../api/crud.js';
import { pageQuery } from '../api/pages.js';
import { useDashboardData } from '../api/widgetData.js';
import { bootstrapQuery, findNavItemBySlug } from '../app/bootstrap.js';
import { hrefForPage, hrefForRecord } from '../app/links.js';
import { requestIdForError, stateIdForError } from '../app/query.js';
import { t } from '../i18n/t.js';
import { NotFoundPage } from '../states/NotFoundPage.js';
import { StatePage } from '../states/StatePage.js';
import { resolvePageTemplate, type PageTemplateAdapters, type PageTemplateComponent } from './templates.js';
import { useUndoToast } from './toasts.js';

export function PageRenderer() {
  const params = useParams({ strict: false });
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const recordId = typeof params.recordId === 'string' ? params.recordId : undefined;
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const item = findNavItemBySlug(bootstrap.nav, slug);

  // Unknown slug → branded 404 with NO pages round trip (09 §2.3).
  if (item === null) return <NotFoundPage />;
  return <PageDocument key={item.pageId} pageId={item.pageId} slug={slug} recordId={recordId} />;
}

function PageDocument({ pageId, slug, recordId }: { pageId: string; slug: string; recordId?: string | undefined }) {
  const page = useQuery(pageQuery(pageId));

  if (page.isPending) return <PageSkeleton />;
  if (page.isError) {
    // Page-scoped failure: system state inside the outlet, shell stays usable.
    return (
      <StatePage
        stateId={stateIdForError(page.error)}
        requestId={requestIdForError(page.error)}
        fullPage={false}
        onRetry={() => void page.refetch()}
      />
    );
  }

  const result = page.data;
  if (result.status === 'too-new') {
    return (
      <PageMessageCard
        icon={<ShieldAlert />}
        title={t('page.tooNew.title', 'This page needs a newer Adminium')}
        body={t(
          'page.tooNew.body',
          `This page was saved with config version ${String(result.v)}, but this build understands up to version ${String(result.latest)}. Upgrade Adminium to open it.`,
        )}
        detail={pageId}
      />
    );
  }
  if (result.status === 'invalid') {
    return (
      <PageMessageCard
        icon={<ShieldAlert />}
        title={t('page.invalid.title', 'This page’s configuration is invalid')}
        body={t('page.invalid.body', 'The stored page document failed validation and cannot be rendered.')}
        detail={result.issues.slice(0, 5).join('\n')}
      />
    );
  }

  return (
    <TemplateMount
      page={result.page}
      slug={slug}
      recordId={recordId}
      canEditLayout={result.canEditLayout}
    />
  );
}

type TemplateResolution =
  | { phase: 'resolving' }
  | { phase: 'resolved'; component: PageTemplateComponent | null };

function TemplateMount({
  page,
  slug,
  recordId,
  canEditLayout,
}: {
  page: PageEnvelope;
  slug: string;
  recordId?: string | undefined;
  canEditLayout?: boolean | undefined;
}) {
  const [resolution, setResolution] = useState<TemplateResolution>({ phase: 'resolving' });

  useEffect(() => {
    let alive = true;
    setResolution({ phase: 'resolving' });
    void resolvePageTemplate(page.template).then((component) => {
      if (alive) setResolution({ phase: 'resolved', component });
    });
    return () => {
      alive = false;
    };
  }, [page.template]);

  const adapters = usePageAdapters(page, slug);

  if (resolution.phase === 'resolving') return <PageSkeleton />;
  const Template = resolution.component;
  if (Template === null) {
    // Unknown template id — forward compatibility per 09 §3.1: degrade, never crash.
    return (
      <PageMessageCard
        icon={<FileQuestion />}
        title={t('page.unknownTemplate.title', 'Unknown page template')}
        body={t(
          'page.unknownTemplate.body',
          'This page uses a template this build doesn’t recognize. It may come from a newer Adminium or an extension that isn’t installed.',
        )}
        detail={page.template}
      />
    );
  }

  return (
    <WidgetErrorBoundary
      fallback={(error, reset) => (
        <PageMessageCard
          icon={<PackageOpen />}
          title={t('page.renderError.title', 'This page failed to render')}
          body={error.message}
          detail={page.template}
          action={
            <button
              type="button"
              className="text-body-sm font-bold text-accent hover:underline"
              onClick={reset}
            >
              {t('common.retry', 'Retry')}
            </button>
          }
        />
      )}
    >
      <Template page={page} adapters={adapters} recordId={recordId} canEditLayout={canEditLayout} />
    </WidgetErrorBoundary>
  );
}

/** Data adapters + the WidgetEvent sink (09 §4.1) for one mounted page. */
function usePageAdapters(page: PageEnvelope, slug: string): PageTemplateAdapters {
  const router = useRouter();
  const queryClient = useQueryClient();
  const notifyUndoable = useUndoToast();

  const crud: BoundCrudApi | null = useMemo(() => {
    const { connectionId, table } = page.source;
    return connectionId !== null && table !== null ? createCrudApi(connectionId, table) : null;
  }, [page.source]);

  const dashboard = useDashboardData(page);
  const hasLayout = page.kind === 'dashboard';

  const openRecord = useCallback(
    (recordId: string | null) => {
      router.history.push(recordId === null ? hrefForPage(slug) : hrefForRecord(slug, recordId));
    },
    [router, slug],
  );

  const invalidateAfterMutation = useCallback(() => {
    if (crud !== null) {
      void queryClient.invalidateQueries({ queryKey: ['data', crud.connectionId, crud.table] });
    }
    void queryClient.invalidateQueries({ queryKey: ['widget-data'] });
  }, [queryClient, crud]);

  const onEvent = useCallback(
    (event: WidgetEvent) => {
      if (event.type === 'drill-through') {
        router.history.push(event.href);
        return;
      }
      if (event.type === 'record-open') {
        // Widgets never navigate directly — the host maps record-open to the
        // canonical record href (09 §2.3 navigation helpers).
        openRecord(String(event.recordId));
        return;
      }
      // mutate intent (04 §2.1): run through the CRUD API with undo + audit.
      if (crud === null) return;
      const run = async (): Promise<CrudMutationResult> => {
        if (event.intent === 'insert') return crud.create(event.values ?? {});
        if (event.intent === 'update') return crud.update(String(event.recordId), event.values ?? {});
        const deleted = await crud.remove(String(event.recordId), { confirm: true });
        return isDeletePreview(deleted) ? { data: null, undoToken: null } : deleted;
      };
      // Return the promise so optimistic widgets (kanban boards) can roll back
      // a rejected move; the host's own toast/invalidation chain runs alongside.
      const promise = run();
      promise
        .then((result) => {
          invalidateAfterMutation();
          notifyUndoable({
            title:
              event.intent === 'insert'
                ? t('mutation.created', 'Record created')
                : event.intent === 'update'
                  ? t('mutation.updated', 'Record updated')
                  : t('mutation.deleted', 'Record deleted'),
            undoToken: result.undoToken,
            onUndone: invalidateAfterMutation,
          });
        })
        .catch(() => {
          // Failed mutations surface through the template's own form/error
          // handling; the host-level fallback stays silent here.
        });
      return promise;
    },
    [router, openRecord, crud, invalidateAfterMutation, notifyUndoable],
  );

  return useMemo<PageTemplateAdapters>(
    () => ({ crud, dashboard: hasLayout ? dashboard : null, onEvent, openRecord, notifyUndoable }),
    [crud, hasLayout, dashboard, onEvent, openRecord, notifyUndoable],
  );
}

// --- chrome ------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-page p-6" data-testid="page-skeleton">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

function PageMessageCard({
  icon,
  title,
  body,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  detail?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-page p-6">
      <Card>
        <CardHeader className="flex items-center gap-3">
          <IconTile tone="warn" size="md" icon={icon} />
          <h2 className="min-w-0 truncate text-section text-fg">{title}</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <p className="whitespace-pre-line text-body-sm text-fg-muted">{body}</p>
          {detail === undefined ? null : (
            <MonoText className="text-caption text-fg-subtle">{detail}</MonoText>
          )}
          {action}
        </CardBody>
      </Card>
    </div>
  );
}
