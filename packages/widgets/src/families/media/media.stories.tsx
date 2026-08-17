// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACK MEDIA `media` family stories (annex §8): each widget's loaded variant,
 * the four WidgetFrame states through WidgetHost (acceptance #4), and
 * light/dark × LTR/RTL matrices with REAL geometry mirroring (acceptance #9 —
 * the RTL frames set `dir="rtl"` so the logical breadcrumb chevrons, the
 * icon-then-name rows, the star's `end-3` corner, and the link arrow genuinely
 * flip; a bare attribute would prove nothing). Widgets resolve through a LOCAL
 * registry override so the stories work before the green loop merges the
 * definitions into the global map. Payloads are the same seeded generators
 * `demoData` uses.
 */
import type { ReactNode } from 'react';

import { AttachmentList, attachmentsOf } from './AttachmentList.js';
import { FileBrowser, fileNodesOf } from './FileBrowser.js';
import { ImageBoard, boardImagesOf } from './ImageBoard.js';
import { LinkList, referenceLinksOf } from './LinkList.js';
import { UploadDropzone } from './UploadDropzone.js';
import { UploadProgressList, uploadJobsOf } from './UploadProgressList.js';
import {
  attachmentListConfigSchema,
  attachmentListDemoData,
  fileBrowserConfigSchema,
  fileBrowserDemoData,
  imageBoardConfigSchema,
  imageBoardDemoData,
  linkListConfigSchema,
  linkListDemoData,
  uploadProgressListConfigSchema,
  uploadProgressListDemoData,
} from './media-config.js';
import { mediaTrackDefinitions } from './media-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([...mediaTrackDefinitions] as WidgetDefinition[]);

const meta = { title: 'Widgets/Media' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
) {
  return (
    <div className="h-96 w-full">
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('FILES_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

/** Schema defaults + overrides — the same projection the host performs. */
function parse<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse(overrides);
}

const SMART_FOLDERS = [
  { key: 'all', label: 'All files', filter: 'all' as const },
  { key: 'starred', label: 'Starred', filter: 'starred' as const },
  { key: 'recent', label: 'Recent', filter: 'recent' as const },
];

const browserConfig = { title: 'Files', smartFolders: SMART_FOLDERS };

// ── Per-widget loaded variants ─────────────────────────────────────────────

export const FileBrowserStory = {
  name: 'file-browser',
  render: () => host('file-browser', 's-browser', browserConfig, fileBrowserDemoData(7)),
};

export const UploadDropzoneStory = {
  name: 'upload-dropzone',
  render: () =>
    host('upload-dropzone', 's-dropzone', { title: 'Upload', accept: '.pdf,.png', maxSize: 200_000_000 }, { value: null }),
};

export const UploadProgressListStory = {
  name: 'upload-progress-list',
  render: () =>
    host('upload-progress-list', 's-progress', { title: 'Uploads', downloadable: true, cancellable: true }, uploadProgressListDemoData(3)),
};

export const AttachmentListStory = {
  name: 'attachment-list',
  render: () =>
    host('attachment-list', 's-attach', { title: 'Files', actions: ['download', 'delete'] }, attachmentListDemoData(5)),
};

export const ImageBoardStory = {
  name: 'image-board',
  render: () => host('image-board', 's-images', { title: 'Images', allowAdd: true }, imageBoardDemoData(2)),
};

export const LinkListStory = {
  name: 'link-list',
  render: () => host('link-list', 's-links', { title: 'Reference Links' }, linkListDemoData(9)),
};

// ── Four WidgetFrame states (acceptance #4) ────────────────────────────────

/** file-browser: loaded · skeleton · empty · error. */
export const States = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('file-browser', 'st-loaded', browserConfig, fileBrowserDemoData(7))}
        {host('file-browser', 'st-skeleton', browserConfig, undefined, 'loading')}
        {host('file-browser', 'st-empty', { ...browserConfig, emptyState: { titleKey: 'This folder is empty' } }, { rows: [], total: 0 })}
        {host('file-browser', 'st-error', browserConfig, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/** attachment-list: the same four states for the rail-sized widget. */
export const AttachmentStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('attachment-list', 'as-loaded', { title: 'Files' }, attachmentListDemoData(5))}
        {host('attachment-list', 'as-skeleton', { title: 'Files' }, undefined, 'loading')}
        {host('attachment-list', 'as-empty', { title: 'Files', emptyState: { titleKey: 'No attachments' } }, { rows: [], total: 0 })}
        {host('attachment-list', 'as-error', { title: 'Files' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

/** upload-progress-list: every job status branch (done · uploading · failed · queued). */
export const UploadStates = {
  render: () => (
    <Frame>
      <div className="grid grid-cols-2 gap-4">
        {host('upload-progress-list', 'us-loaded', { title: 'Uploads', downloadable: true }, uploadProgressListDemoData(3))}
        {host('upload-progress-list', 'us-skeleton', { title: 'Uploads' }, undefined, 'loading')}
        {host('upload-progress-list', 'us-empty', { title: 'Uploads', emptyState: { titleKey: 'No uploads in progress' } }, { rows: [], total: 0 })}
        {host('upload-progress-list', 'us-error', { title: 'Uploads' }, undefined, 'error')}
      </div>
    </Frame>
  ),
};

// ── light/dark × LTR/RTL with real mirroring (acceptance #9) ───────────────

/**
 * file-browser in both views. The RTL frames genuinely mirror: the breadcrumb
 * chevrons flip, the smart-folder rail moves to the right edge (`border-e`), the
 * icon-then-name rows reverse, and the star toggle's `end-3` corner swaps.
 */
export const FileBrowserThemeAndDirectionMatrix = {
  render: () => {
    const config = parse(fileBrowserConfigSchema, { smartFolders: SMART_FOLDERS });
    const nodes = fileNodesOf(fileBrowserDemoData(7), config);
    const browser = (view: 'grid' | 'list') => (
      <div className="h-96 rounded-lg border border-border bg-surface">
        <FileBrowser nodes={nodes} views={view} smartFolders={SMART_FOLDERS} />
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{browser('grid')}</Frame>
        <Frame dir="rtl">{browser('grid')}</Frame>
        <Frame dark dir="ltr">{browser('list')}</Frame>
        <Frame dark dir="rtl">{browser('list')}</Frame>
      </div>
    );
  },
};

/** The upload pair + attachment rail across both themes and both directions. */
export const UploadThemeAndDirectionMatrix = {
  render: () => {
    const jobs = uploadJobsOf(uploadProgressListDemoData(3), parse(uploadProgressListConfigSchema, { downloadable: true }));
    const items = attachmentsOf(attachmentListDemoData(5), parse(attachmentListConfigSchema, { actions: ['download', 'delete'] }));
    const row = () => (
      <div className="grid grid-cols-3 gap-4">
        <div className="h-48 rounded-lg border border-border bg-surface">
          <UploadDropzone accept=".pdf,.png" maxSize={200_000_000} hint="PDF, images, and docs" />
        </div>
        <div className="h-48 overflow-hidden rounded-lg border border-border bg-surface">
          <UploadProgressList jobs={jobs} downloadable cancellable />
        </div>
        <div className="h-48 overflow-hidden rounded-lg border border-border bg-surface">
          <AttachmentList items={items} actions={['download', 'delete']} />
        </div>
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{row()}</Frame>
        <Frame dir="rtl">{row()}</Frame>
        <Frame dark dir="ltr">{row()}</Frame>
        <Frame dark dir="rtl">{row()}</Frame>
      </div>
    );
  },
};

/** image-board + link-list — the link row's arrow mirrors under RTL. */
export const BoardAndLinksThemeAndDirectionMatrix = {
  render: () => {
    const images = boardImagesOf(imageBoardDemoData(2), parse(imageBoardConfigSchema));
    const links = referenceLinksOf(linkListDemoData(9), parse(linkListConfigSchema));
    const row = () => (
      <div className="grid grid-cols-2 gap-4">
        <div className="h-96 overflow-hidden rounded-lg border border-border bg-surface">
          <ImageBoard images={images} allowAdd />
        </div>
        <div className="h-96 overflow-hidden rounded-lg border border-border bg-surface">
          <LinkList links={links} editable />
        </div>
      </div>
    );
    return (
      <div className="flex flex-col gap-4">
        <Frame dir="ltr">{row()}</Frame>
        <Frame dir="rtl">{row()}</Frame>
        <Frame dark dir="ltr">{row()}</Frame>
        <Frame dark dir="rtl">{row()}</Frame>
      </div>
    );
  },
};

// ── Interaction stories ────────────────────────────────────────────────────

/**
 * Folder navigation: click the first folder tile, then walk back up via the
 * breadcrumb. `play` drives it so the self-FK trail is a live regression.
 */
export const FolderNavigationInteraction = {
  name: 'file-browser (folder navigation)',
  render: () => {
    const nodes = fileNodesOf(fileBrowserDemoData(7), parse(fileBrowserConfigSchema));
    return (
      <Frame>
        <div className="h-96 rounded-lg border border-border bg-surface">
          <FileBrowser nodes={nodes} views="grid" />
        </div>
      </Frame>
    );
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const folder = canvasElement.querySelector<HTMLElement>('[data-part="file-tile"][data-kind="folder"]');
    folder?.click();
    const rootCrumb = canvasElement.querySelector<HTMLElement>('nav[aria-label] a');
    rootCrumb?.click();
  },
};

/** The dropzone's drag-over state — the accent border/background branch. */
export const DropzoneDragOver = {
  name: 'upload-dropzone (drag-over)',
  render: () => (
    <Frame>
      <div className="h-48 w-96 rounded-lg border border-border bg-surface">
        <UploadDropzone accept=".pdf,.png" maxSize={200_000_000} hint="PDF, images, and docs" />
      </div>
    </Frame>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const zone = canvasElement.querySelector<HTMLElement>('[data-part="dropzone"]');
    zone?.dispatchEvent(new DragEvent('dragover', { bubbles: true }));
  },
};
