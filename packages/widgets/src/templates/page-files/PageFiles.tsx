// SPDX-License-Identifier: AGPL-3.0-only
import { Button, Drawer, DrawerBody, DrawerHeader, EmptyState, IconTile, KeyValueList, KeyValueRow, MonoText, Spinner } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useMemo, useState } from 'react';

import { hasStarredColumn, resolveFileBrowserConfig } from './file-mapping.js';
import { FileBrowser, fileNodesOf } from '../../families/media/FileBrowser.js';
import { UploadDropzone } from '../../families/media/UploadDropzone.js';
import { UploadProgressList, type UploadJob } from '../../families/media/UploadProgressList.js';
import { fileIconFor } from '../../families/media/media-icons.js';
import {
  FILE_KIND_TONE,
  bindingSourceOf,
  formatModifiedFull,
  formatSize,
  type FileNode,
} from '../../families/media/media-lib.js';
import type { SmartFolderConfig } from '../../families/media/media-config.js';
import { WidgetHost, type WidgetDataState } from '../../frame/WidgetHost.js';
import { pageLayoutSchema, queryDescriptorSchema, type PageLayout, type QueryDescriptor } from '../../page-config/index.js';
import type { LayoutItem } from '../../page-config/layout.js';
import type { WidgetEvent } from '../../registry/types.js';
import {
  useDashboardData,
  type DashboardDataAdapter,
  type DashboardDataStates,
} from '../page-dashboard/data-adapter.js';

/**
 * `page-files` template renderer (09-generated-app.md §7.9; annex §14 — comp:
 * File Manager).
 *
 * Renders the stored `config.layout` of a files archetype page: the required
 * `browser` slot as a directly-composed `file-browser` (families/media) over
 * the real parent-pointer hierarchy — dual grid/list view, computed
 * breadcrumbs, smart-folder rail with live counts — plus the `usage` slot
 * (`usage-meter` quota) and any `smart-folders` slot widget via `WidgetHost`,
 * and the manifest's `upload` band (`upload-dropzone` + `upload-progress-list`).
 *
 * PREVIEW: opening a file swaps in a detail drawer (name, kind, size,
 * modified, link, raw fields) — route-controllable through `previewNodeId` /
 * `onPreviewNodeChange`, the `page-crud` detail idiom.
 *
 * UPLOADS: the dropzone renders per the manifest, but there is NO server
 * upload surface yet (08 §2.11 — no files routes). Without an `onUpload`
 * handler it renders disabled with an honest hint; the host enables it the
 * moment a transport exists and feeds `uploadJobs` back into the progress
 * list. Star toggles emit `mutate` intents only when the payload actually
 * carries a starred-ish column — the widget never writes.
 */

export const PAGE_FILES_TEMPLATE_ID = 'page-files';

export interface PageFilesLabels {
  previewTitle?: string | undefined;
  close?: string | undefined;
  kind?: string | undefined;
  size?: string | undefined;
  modified?: string | undefined;
  link?: string | undefined;
  openLink?: string | undefined;
  allFiles?: string | undefined;
  recent?: string | undefined;
  starred?: string | undefined;
  uploadsUnavailable?: string | undefined;
  loadFailed?: string | undefined;
  retry?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
}

export interface PageFilesProps {
  /** The page's `config.layout` document (raw — validated here). */
  layout: unknown;
  /** Transport for bound widgets; absent → demo mode (04 §5.3). */
  adapter?: DashboardDataAdapter | undefined;
  params?: Record<string, unknown> | undefined;
  /** Host/test override — wins over adapter/demo resolution per instance. */
  states?: DashboardDataStates | undefined;
  /** Route-controlled preview node (child route `/r/$recordId`). */
  previewNodeId?: string | null | undefined;
  onPreviewNodeChange?: ((nodeId: string | null) => void) | undefined;
  /** Upload transport — absent renders the dropzone disabled (no server surface yet). */
  onUpload?: ((files: readonly File[]) => void) | undefined;
  /** Host-driven upload job rows for the progress list. */
  uploadJobs?: readonly UploadJob[] | undefined;
  onRetryUpload?: ((job: UploadJob) => void) | undefined;
  /** Widget events (record-open, mutate star toggles) bubble here. */
  onEvent?: ((instanceId: string, event: WidgetEvent) => void) | undefined;
  locale?: string | undefined;
  labels?: PageFilesLabels | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

const EMPTY_LAYOUT: PageLayout = { version: 1, items: [] };

const RAIL_WIDGET_IDS = new Set(['link-list', 'schema-tree']);
const UPLOAD_WIDGET_IDS = new Set(['upload-dropzone', 'upload-progress-list']);

/** Split the layout into the roles this template renders. */
export function classifyFilesItems(layout: PageLayout): {
  browser: LayoutItem | null;
  usage: LayoutItem | null;
  rail: LayoutItem | null;
  rest: LayoutItem[];
} {
  const items = layout.items;
  const browser =
    items.find((item) => item.widget === 'file-browser') ??
    items.find((item) => item.i === 'browser') ??
    null;
  const usage =
    items.find((item) => item !== browser && (item.widget === 'usage-meter' || item.i === 'usage')) ?? null;
  const rail =
    items.find(
      (item) => item !== browser && item !== usage && (item.i === 'smart-folders' || RAIL_WIDGET_IDS.has(item.widget)),
    ) ?? null;
  const rest = items.filter(
    (item) => item !== browser && item !== usage && item !== rail && !UPLOAD_WIDGET_IDS.has(item.widget),
  );
  return { browser, usage, rail, rest };
}

function descriptorOf(item: LayoutItem | null): QueryDescriptor | null {
  if (item === null) return null;
  const parsed = queryDescriptorSchema.safeParse(item.config['binding']);
  return parsed.success ? parsed.data : null;
}

export function PageFiles({
  layout,
  adapter,
  params,
  states,
  previewNodeId,
  onPreviewNodeChange,
  onUpload,
  uploadJobs,
  onRetryUpload,
  onEvent,
  locale,
  labels,
  className,
  testId,
}: PageFilesProps) {
  const t = useMaybeT();
  const parsed = useMemo(() => {
    const result = pageLayoutSchema.safeParse(layout);
    if (result.success) return { layout: result.data, invalid: false };
    return { layout: EMPTY_LAYOUT, invalid: true };
  }, [layout]);

  const dataStates = useDashboardData(parsed.layout, adapter, params);
  const stateFor = (instanceId: string): WidgetDataState =>
    states?.[instanceId] ?? dataStates[instanceId] ?? { status: 'loading' };

  const { browser, usage, rail, rest } = useMemo(() => classifyFilesItems(parsed.layout), [parsed.layout]);
  const browserState = browser === null ? null : stateFor(browser.i);
  const browserData = browserState?.status === 'success' ? browserState.data : undefined;

  const browserConfig = useMemo(
    () => resolveFileBrowserConfig(browser?.config ?? {}, browserData),
    [browser?.config, browserData],
  );
  const nodes = useMemo(() => fileNodesOf(browserData, browserConfig), [browserData, browserConfig]);
  const starrable = useMemo(
    () => hasStarredColumn(browserConfig, browserData),
    [browserConfig, browserData],
  );
  const source = useMemo(() => {
    const descriptor = descriptorOf(browser);
    return descriptor === null ? null : bindingSourceOf(descriptor);
  }, [browser]);

  const smartFolders = useMemo<readonly SmartFolderConfig[]>(() => {
    if (browserConfig.smartFolders !== undefined && browserConfig.smartFolders.length > 0) {
      return browserConfig.smartFolders;
    }
    return [
      { key: 'all', label: labels?.allFiles ?? t('ui:templates.files.allFiles', 'All files'), filter: 'all' },
      { key: 'recent', label: labels?.recent ?? t('ui:templates.files.recent', 'Recent'), filter: 'recent' },
      ...(starrable
        ? [{ key: 'starred', label: labels?.starred ?? t('ui:templates.files.starred', 'Starred'), filter: 'starred' as const }]
        : []),
    ];
  }, [browserConfig.smartFolders, starrable, labels?.allFiles, labels?.recent, labels?.starred, t]);

  // --- preview drawer (route-controllable, the page-crud detail idiom) --------
  const [internalPreviewId, setInternalPreviewId] = useState<string | null>(null);
  const previewId = previewNodeId !== undefined ? previewNodeId : internalPreviewId;
  const setPreviewId = (next: string | null): void => {
    setInternalPreviewId(next);
    onPreviewNodeChange?.(next);
  };
  const previewNode = useMemo(
    () => (previewId === null ? null : (nodes.find((node) => node.id === previewId) ?? null)),
    [previewId, nodes],
  );

  if (parsed.invalid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-files-invalid">
        {t(
          'ui:templates.files.invalidLayout',
          'This files page’s stored layout is invalid. Regenerate the page or reset its layout.',
        )}
      </p>
    );
  }

  return (
    <div data-part="page-files" data-testid={testId} className={`flex h-full min-h-0 flex-col gap-4 ${className ?? ''}`}>
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Optional smart-folders slot widget (link-list / schema-tree). */}
        {rail !== null && (
          <aside data-part="files-rail" className="hidden w-56 shrink-0 overflow-hidden rounded-lg border border-border bg-surface lg:block">
            <WidgetHost
              widgetId={rail.widget}
              instanceId={rail.i}
              config={rail.config}
              data={stateFor(rail.i)}
              onEvent={onEvent === undefined ? undefined : (event) => onEvent(rail.i, event)}
            />
          </aside>
        )}

        {/* The browser — the manifest's required slot. */}
        <div data-part="files-browser" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
          {browser === null ? (
            <EmptyState
              preset="no-data"
              title={labels?.emptyTitle ?? t('ui:templates.files.missingSlotTitle', 'No file browser on this page')}
              body={t('ui:templates.files.missingSlotBody', 'The stored layout has no browser slot. Regenerate the page.')}
            />
          ) : browserState?.status === 'error' ? (
            <EmptyState
              tone="danger"
              title={labels?.loadFailed ?? t('ui:templates.files.loadFailed', 'The file query failed')}
              body={browserState.error instanceof Error ? browserState.error.message : undefined}
              actions={
                browserState.refetch === undefined ? undefined : (
                  <Button size="sm" variant="secondary" onClick={browserState.refetch}>
                    {labels?.retry ?? t('ui:action.retry', 'Retry')}
                  </Button>
                )
              }
            />
          ) : browserState?.status === 'loading' ? (
            <div className="flex flex-1 items-center justify-center py-16">
              <Spinner label={t('ui:templates.files.loading', 'Loading files')} />
            </div>
          ) : (
            <FileBrowser
              nodes={nodes}
              views={browserConfig.views}
              defaultView={browserConfig.defaultView}
              starrable={starrable}
              smartFolders={smartFolders}
              {...(browserConfig.typeIconMap === undefined ? {} : { typeIconMap: browserConfig.typeIconMap })}
              {...(locale === undefined ? {} : { locale })}
              {...(browserConfig.emptyTitle === undefined ? {} : { emptyTitle: browserConfig.emptyTitle })}
              {...(browserConfig.emptyBody === undefined ? {} : { emptyBody: browserConfig.emptyBody })}
              onOpenFile={(node) => setPreviewId(node.id)}
              onToggleStar={(node, next) => {
                if (source === null || !starrable) return;
                onEvent?.(browser.i, {
                  type: 'mutate',
                  intent: 'update',
                  connectionId: source.connectionId,
                  table: source.table,
                  recordId: node.id,
                  values: { [browserConfig.starredField]: next },
                });
              }}
              testId="page-files-browser"
            />
          )}
        </div>

        {/* Usage + any remaining stat widgets stack on the side column. */}
        {(usage !== null || rest.length > 0) && (
          <aside data-part="files-side" className="hidden w-64 shrink-0 flex-col gap-4 md:flex">
            {[...(usage === null ? [] : [usage]), ...rest].map((item) => (
              <div key={item.i} className="min-h-28">
                <WidgetHost
                  widgetId={item.widget}
                  instanceId={item.i}
                  config={item.config}
                  data={stateFor(item.i)}
                  onEvent={onEvent === undefined ? undefined : (event) => onEvent(item.i, event)}
                />
              </div>
            ))}
          </aside>
        )}
      </div>

      {/* Upload band — manifest `upload` slot (09 §7.9). */}
      <div data-part="files-upload" className="grid shrink-0 gap-4 md:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <UploadDropzone
            disabled={onUpload === undefined}
            {...(locale === undefined ? {} : { locale })}
            hint={
              onUpload === undefined
                ? (labels?.uploadsUnavailable ??
                  t('ui:templates.files.uploadsUnavailable', 'Uploads are not available on this page yet.'))
                : undefined
            }
            onFiles={(files) => onUpload?.(files)}
            testId="page-files-dropzone"
          />
        </div>
        {uploadJobs !== undefined && uploadJobs.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <UploadProgressList
              jobs={uploadJobs}
              retryable={onRetryUpload !== undefined}
              {...(locale === undefined ? {} : { locale })}
              onRetry={(job) => onRetryUpload?.(job)}
              testId="page-files-progress"
            />
          </div>
        )}
      </div>

      {/* Preview drawer — browse/list/preview surface over the CRUD row. */}
      <Drawer open={previewNode !== null} onOpenChange={(open) => !open && setPreviewId(null)} size="md">
        <DrawerHeader
          title={previewNode?.name ?? labels?.previewTitle ?? t('ui:templates.files.previewTitle', 'File')}
          closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
        />
        <DrawerBody>
          {previewNode !== null && (
            <FilePreview node={previewNode} locale={locale} labels={labels} />
          )}
        </DrawerBody>
      </Drawer>
    </div>
  );
}

function FilePreview({
  node,
  locale,
  labels,
}: {
  node: FileNode;
  locale?: string | undefined;
  labels?: PageFilesLabels | undefined;
}) {
  const t = useMaybeT();
  return (
    <div data-part="file-preview" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconTile size="lg" tone={FILE_KIND_TONE[node.kind]} icon={fileIconFor(node.kind, undefined, node.name)} />
        <div className="min-w-0">
          <div className="truncate text-body-sm font-bold text-fg">{node.name}</div>
          <MonoText className="text-caption text-fg-subtle">{node.id}</MonoText>
        </div>
      </div>
      <KeyValueList>
        <KeyValueRow label={labels?.kind ?? t('ui:templates.files.kindLabel', 'Kind')}>{node.kind}</KeyValueRow>
        <KeyValueRow label={labels?.size ?? t('ui:widgets.media.sizeHeader', 'Size')} mono>
          {node.kind === 'folder' ? '—' : (formatSize(node.size, locale) ?? '—')}
        </KeyValueRow>
        <KeyValueRow label={labels?.modified ?? t('ui:widgets.media.modifiedHeader', 'Modified')} mono>
          {node.modified === undefined ? '—' : formatModifiedFull(node.modified, locale)}
        </KeyValueRow>
        {node.url !== undefined && (
          <KeyValueRow label={labels?.link ?? t('ui:templates.files.linkLabel', 'Link')} mono>
            <a
              href={node.url}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
              data-part="file-preview-link"
            >
              {labels?.openLink ?? node.url}
            </a>
          </KeyValueRow>
        )}
      </KeyValueList>
    </div>
  );
}
