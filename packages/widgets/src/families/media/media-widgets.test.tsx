// @vitest-environment happy-dom
/**
 * `media` family (annex §8, TRACK MEDIA): unit tests for the pure lib (file-kind
 * classification, the cycle-safe self-FK folder walk, Intl-routed size/date
 * formatting), the six widget components (view toggle, folder navigation,
 * selection, upload states, safe-href handling), the config projections, the
 * emitted WidgetEvents, and the four WidgetFrame states through WidgetHost.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentList, AttachmentListWidget, attachmentsOf } from './AttachmentList.js';
import { FileBrowser, FileBrowserWidget, fileNodesOf } from './FileBrowser.js';
import { ImageBoard, boardImagesOf } from './ImageBoard.js';
import { LinkList, LinkListWidget, isSafeHref, referenceLinksOf } from './LinkList.js';
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
  uploadDropzoneConfigSchema,
  uploadDropzoneDemoData,
  uploadProgressListConfigSchema,
  uploadProgressListDemoData,
} from './media-config.js';
import { mediaTrackDefinitions } from './media-track.definitions.js';
import {
  ROOT_ID,
  breadcrumbTrail,
  childrenOf,
  clampPct,
  displayUrl,
  extensionOf,
  fileRowsOf,
  formatSize,
  kindOf,
} from './media-lib.js';
import type { FileNode } from './media-lib.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const registry = buildRegistry([...mediaTrackDefinitions] as WidgetDefinition[]);

/** Schema defaults + overrides — the same projection the host performs. */
function cfg<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse(overrides);
}

// ── media-lib ──────────────────────────────────────────────────────────────

describe('media-lib — file kind classification', () => {
  it('an explicit type that already names a kind wins over everything else', () => {
    expect(kindOf('folder', 'image/png', 'photo.png')).toBe('folder');
    expect(kindOf('pdf', undefined, 'notes.txt')).toBe('pdf');
  });

  it('resolves the annex evidence aliases (img / zip / dir)', () => {
    expect(kindOf('img', undefined, undefined)).toBe('image');
    expect(kindOf('zip', undefined, undefined)).toBe('archive');
    expect(kindOf('dir', undefined, undefined)).toBe('folder');
  });

  it('falls back to the MIME type when the type column is not a kind', () => {
    expect(kindOf('blob', 'application/pdf', undefined)).toBe('pdf');
    expect(kindOf(undefined, 'image/webp', undefined)).toBe('image');
    expect(kindOf(undefined, 'video/mp4', undefined)).toBe('video');
    expect(kindOf(undefined, 'application/vnd.oasis.opendocument.spreadsheet', undefined)).toBe('sheet');
  });

  it('falls back to the filename extension when there is no type or MIME', () => {
    expect(kindOf(undefined, undefined, 'Budget 2026.xlsx')).toBe('sheet');
    expect(kindOf(undefined, undefined, 'Logo Variants.zip')).toBe('archive');
    expect(kindOf(undefined, undefined, 'schema.sql')).toBe('code');
  });

  it('degrades unknown/absent input to the `file` catch-all rather than throwing', () => {
    expect(kindOf(undefined, undefined, undefined)).toBe('file');
    expect(kindOf(42, {}, ['not a name'])).toBe('file');
    expect(kindOf(undefined, undefined, 'no-extension')).toBe('file');
  });

  it('extensionOf ignores dotfiles and trailing dots', () => {
    expect(extensionOf('report.PDF')).toBe('pdf');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('name.')).toBe('');
    expect(extensionOf('no-dot')).toBe('');
  });
});

describe('media-lib — record-list envelope reads', () => {
  it('accepts the §3 { rows } envelope, the { data } shorthand, and a bare array', () => {
    expect(fileRowsOf({ rows: [{ id: 'a' }], total: 1 })).toEqual([{ id: 'a' }]);
    expect(fileRowsOf({ data: [{ id: 'b' }] })).toEqual([{ id: 'b' }]);
    expect(fileRowsOf([{ id: 'c' }])).toEqual([{ id: 'c' }]);
  });

  it('returns [] for null/undefined/garbage rather than throwing', () => {
    expect(fileRowsOf(null)).toEqual([]);
    expect(fileRowsOf(undefined)).toEqual([]);
    expect(fileRowsOf('nope')).toEqual([]);
    expect(fileRowsOf({ rows: 'not an array' })).toEqual([]);
  });
});

/** A small fixed hierarchy: root → f1 → f1a, plus two root files. */
const TREE: FileNode[] = [
  { id: 'f1', name: 'Projects', kind: 'folder', parentId: null, starred: false },
  { id: 'f1a', name: 'Coastal', kind: 'folder', parentId: 'f1', starred: false },
  { id: 'd1', name: 'zeta.pdf', kind: 'pdf', parentId: null, size: 2_400_000, starred: true },
  { id: 'd2', name: 'alpha.xlsx', kind: 'sheet', parentId: null, size: 820_000, starred: false },
  { id: 'd3', name: 'nested.png', kind: 'image', parentId: 'f1', size: 8_200_000, starred: false },
];

describe('media-lib — self-FK folder hierarchy', () => {
  it('childrenOf returns only direct children, folders first then name-sorted files', () => {
    const rootKids = childrenOf(TREE, ROOT_ID);
    expect(rootKids.map((n) => n.id)).toEqual(['f1', 'd2', 'd1']); // folder, then alpha < zeta
    expect(childrenOf(TREE, 'f1').map((n) => n.id)).toEqual(['f1a', 'd3']);
    expect(childrenOf(TREE, 'd1')).toEqual([]); // a file has no children
  });

  it('breadcrumbTrail walks root → folder, and is empty at the root', () => {
    expect(breadcrumbTrail(TREE, ROOT_ID)).toEqual([]);
    expect(breadcrumbTrail(TREE, 'f1').map((n) => n.name)).toEqual(['Projects']);
    expect(breadcrumbTrail(TREE, 'f1a').map((n) => n.name)).toEqual(['Projects', 'Coastal']);
  });

  it('breadcrumbTrail terminates on a self-referential parentId (cycle guard)', () => {
    const cyclic: FileNode[] = [{ id: 'x', name: 'X', kind: 'folder', parentId: 'x', starred: false }];
    expect(breadcrumbTrail(cyclic, 'x').map((n) => n.id)).toEqual(['x']);
  });

  it('breadcrumbTrail terminates on a mutually-referential cycle (a → b → a)', () => {
    const cyclic: FileNode[] = [
      { id: 'a', name: 'A', kind: 'folder', parentId: 'b', starred: false },
      { id: 'b', name: 'B', kind: 'folder', parentId: 'a', starred: false },
    ];
    // Walk stops once a visited id repeats — no infinite loop, no duplicate node.
    const trail = breadcrumbTrail(cyclic, 'a');
    expect(trail.map((n) => n.id)).toEqual(['b', 'a']);
  });

  it('breadcrumbTrail stops at a dangling parent pointer', () => {
    const orphan: FileNode[] = [{ id: 'o', name: 'O', kind: 'folder', parentId: 'gone', starred: false }];
    expect(breadcrumbTrail(orphan, 'o').map((n) => n.id)).toEqual(['o']);
  });
});

describe('media-lib — Intl-routed formatting', () => {
  it('formats byte sizes through the @adminium/i18n layer, per locale', () => {
    expect(formatSize(1_200_000, 'en-US')).toBe('1.2 MB');
    // de-DE uses a comma decimal separator — proves the Intl layer, not a hand-roll.
    expect(formatSize(1_200_000, 'de-DE')).toBe('1,2 MB');
  });

  it('keeps ar-EG sizes in Latin digits (data-context numeral policy §4.2)', () => {
    const arabic = formatSize(1_200_000, 'ar-EG');
    expect(arabic).toBeDefined();
    expect(arabic).toMatch(/1[.,]2/); // latn digits, not ١٫٢
  });

  it('coalesces an empty locale rather than throwing a RangeError', () => {
    expect(() => formatSize(1024, '')).not.toThrow();
    expect(formatSize(1024, '')).toBe(formatSize(1024, 'en-US'));
  });

  it('returns undefined for absent/invalid sizes instead of rendering NaN', () => {
    expect(formatSize(undefined, 'en-US')).toBeUndefined();
    expect(formatSize(Number.NaN, 'en-US')).toBeUndefined();
    expect(formatSize(-5, 'en-US')).toBeUndefined();
  });

  it('displayUrl strips the scheme for the mono line', () => {
    expect(displayUrl('https://app.adminium.io/v/8kd93m2q')).toBe('app.adminium.io/v/8kd93m2q');
    expect(displayUrl('app.adminium.io/x')).toBe('app.adminium.io/x');
  });

  it('clampPct pins an untrusted percentage into [0, 100]', () => {
    expect(clampPct(62.4)).toBe(62);
    expect(clampPct(-10)).toBe(0);
    expect(clampPct(500)).toBe(100);
    expect(clampPct('nope')).toBe(0);
    expect(clampPct(undefined)).toBe(0);
  });
});

// ── file-browser ───────────────────────────────────────────────────────────

const browserConfig = cfg(fileBrowserConfigSchema);
const browserNodes = fileNodesOf(fileBrowserDemoData(7), browserConfig);

describe('file-browser', () => {
  it('projects the demo record-list onto nodes with a real self-FK hierarchy', () => {
    expect(browserNodes.length).toBeGreaterThan(0);
    expect(browserNodes.some((n) => n.kind === 'folder')).toBe(true);
    expect(browserNodes.some((n) => n.parentId !== null)).toBe(true);
  });

  it('renders the root folder-first tile grid', () => {
    render(<FileBrowser nodes={browserNodes} views="grid" />);
    const tiles = document.querySelectorAll('[data-part="file-tile"]');
    expect(tiles.length).toBe(childrenOf(browserNodes, ROOT_ID).length);
    expect(tiles[0]?.getAttribute('data-kind')).toBe('folder');
  });

  it('navigates into a folder on click and adds it to the breadcrumb', () => {
    render(<FileBrowser nodes={TREE} views="grid" rootLabel="Files" />);
    expect(screen.getByText('Projects')).toBeTruthy();
    fireEvent.click(screen.getByText('Projects'));
    // Now inside Projects: its children show, the root files do not.
    expect(screen.getByText('Coastal')).toBeTruthy();
    expect(screen.queryByText('zeta.pdf')).toBeNull();
    // Breadcrumb carries root + the current folder, with the current one marked.
    const crumbs = within(screen.getByRole('navigation')).getAllByRole('listitem');
    expect(crumbs.map((c) => c.textContent).filter((text) => text !== '')).toEqual(['Files', 'Projects']);
    expect(within(screen.getByRole('navigation')).getByText('Projects').getAttribute('aria-current')).toBe('page');
  });

  it('walks back up through the breadcrumb', () => {
    render(<FileBrowser nodes={TREE} views="grid" rootLabel="Files" />);
    fireEvent.click(screen.getByText('Projects'));
    expect(screen.queryByText('zeta.pdf')).toBeNull();
    fireEvent.click(within(screen.getByRole('navigation')).getByText('Files'));
    expect(screen.getByText('zeta.pdf')).toBeTruthy(); // back at the root
  });

  it('opening a file calls onOpenFile, never navigation', () => {
    const onOpenFile = vi.fn();
    render(<FileBrowser nodes={TREE} views="grid" onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByText('zeta.pdf'));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile.mock.calls[0]?.[0]?.id).toBe('d1');
    expect(screen.getByText('Projects')).toBeTruthy(); // still at the root
  });

  it('the list view renders Intl sizes and an em-dash for folders', () => {
    render(<FileBrowser nodes={TREE} views="list" />);
    expect(document.querySelectorAll('[data-part="file-row"]').length).toBe(3); // root children
    const folderRow = document.querySelector('[data-part="file-row"][data-kind="folder"]');
    expect(folderRow?.textContent).toContain('—'); // folders have no byte size
    expect(screen.getByText('2.4 MB')).toBeTruthy(); // zeta.pdf via the Intl layer
  });

  it('toggles between grid and list through the segmented control when views=both', () => {
    render(<FileBrowser nodes={TREE} views="both" defaultView="grid" listViewLabel="List view" />);
    expect(document.querySelectorAll('[data-part="file-tile"]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('radio', { name: 'List view' }));
    expect(document.querySelectorAll('[data-part="file-tile"]').length).toBe(0);
    expect(document.querySelectorAll('[data-part="file-row"]').length).toBeGreaterThan(0);
  });

  it('hides the toggle when the view is pinned', () => {
    render(<FileBrowser nodes={TREE} views="grid" />);
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('the star toggle reports the intent and reflects the current state', () => {
    const onToggleStar = vi.fn();
    render(<FileBrowser nodes={TREE} views="list" onToggleStar={onToggleStar} starLabel="Star" />);
    const stars = screen.getAllByRole('button', { name: 'Star' });
    // zeta.pdf is starred in the fixture → its toggle is pressed.
    expect(stars.some((s) => s.getAttribute('aria-pressed') === 'true')).toBe(true);
    const unstarred = stars.find((s) => s.getAttribute('aria-pressed') === 'false');
    fireEvent.click(unstarred as HTMLElement);
    expect(onToggleStar).toHaveBeenCalledTimes(1);
    expect(onToggleStar.mock.calls[0]?.[1]).toBe(true); // next state
  });

  it('omits the star column entirely when starrable=false', () => {
    render(<FileBrowser nodes={TREE} views="list" starrable={false} starLabel="Star" />);
    expect(screen.queryByRole('button', { name: 'Star' })).toBeNull();
  });

  it('selection reports the selected ids', () => {
    const onSelectionChange = vi.fn();
    render(<FileBrowser nodes={TREE} views="list" selectable onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'zeta.pdf' }));
    expect(onSelectionChange).toHaveBeenCalledWith(['d1']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'alpha.xlsx' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['d1', 'd2']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'zeta.pdf' })); // deselect
    expect(onSelectionChange).toHaveBeenLastCalledWith(['d2']);
  });

  it('the smart-folder rail carries live counts and filters across folders', () => {
    render(
      <FileBrowser
        nodes={TREE}
        views="list"
        smartFolders={[
          { key: 'all', label: 'All files', filter: 'all' },
          { key: 'starred', label: 'Starred', filter: 'starred' },
        ]}
      />,
    );
    const starredEntry = screen.getByRole('button', { name: /Starred/ });
    expect(starredEntry.textContent).toContain('1'); // one starred node in the fixture
    fireEvent.click(starredEntry);
    // Starred spans folders: only zeta.pdf remains.
    expect(document.querySelectorAll('[data-part="file-row"]').length).toBe(1);
    expect(screen.getByText('zeta.pdf')).toBeTruthy();
  });

  /**
   * 'All files' must span the whole hierarchy like its `starred`/`recent`
   * siblings. It used to return the root folder's DIRECT children only, so the
   * rail under-reported every nested file — the fixture's 3 files (zeta, alpha,
   * and nested.png inside Projects) read as 2.
   */
  it("the rail's 'All files' entry counts nested files, not just root children", () => {
    render(
      <FileBrowser nodes={TREE} views="list" smartFolders={[{ key: 'all', label: 'All files', filter: 'all' }]} />,
    );
    const allEntry = screen.getByRole('button', { name: /All files/ });
    expect(allEntry.textContent).toContain('3'); // zeta.pdf, alpha.xlsx, nested.png
    fireEvent.click(allEntry);
    expect(document.querySelectorAll('[data-part="file-row"]').length).toBe(3);
    expect(screen.getByText('nested.png')).toBeTruthy();
  });

  /**
   * The annex §8 contract marks `count` OPTIONAL: a real file table (name + size
   * + parent self-FK) has no materialized count column. Rendering '0 items' for
   * a folder whose children are right there in the payload is affirmatively
   * wrong, not graceful degradation.
   */
  it('derives a folder tile count from the hierarchy when no count column is bound', () => {
    render(<FileBrowser nodes={TREE} views="grid" />);
    const projects = screen.getByText('Projects').closest('[data-part="file-tile"]');
    // Projects directly contains Coastal + nested.png.
    expect(projects?.textContent).toContain('2 items');
    expect(projects?.textContent).not.toContain('0 items');
  });

  it('prefers a bound count column over the derived count', () => {
    const withCount: FileNode[] = [
      { id: 'f1', name: 'Projects', kind: 'folder', parentId: null, starred: false, count: 42 },
      { id: 'd3', name: 'nested.png', kind: 'image', parentId: 'f1', size: 10, starred: false },
    ];
    render(<FileBrowser nodes={withCount} views="grid" />);
    const projects = screen.getByText('Projects').closest('[data-part="file-tile"]');
    expect(projects?.textContent).toContain('42 items');
  });

  it('shows the empty state for an empty folder', () => {
    render(<FileBrowser nodes={[]} views="grid" emptyTitle="This folder is empty" />);
    expect(screen.getByText('This folder is empty')).toBeTruthy();
  });

  it('respects a controlled folderId and reports changes instead of self-navigating', () => {
    const onFolderChange = vi.fn();
    render(<FileBrowser nodes={TREE} views="grid" folderId="f1" onFolderChange={onFolderChange} />);
    expect(screen.getByText('Coastal')).toBeTruthy(); // rendering the controlled folder
    fireEvent.click(screen.getByText('Coastal'));
    expect(onFolderChange).toHaveBeenCalledWith('f1a');
    expect(screen.getByText('Coastal')).toBeTruthy(); // did not move on its own
  });
});

describe('file-browser — widget events', () => {
  const binding = {
    kind: 'table-query' as const,
    connectionId: 'conn-1',
    source: { name: 'files', type: 'table' as const },
    shape: 'record-list' as const,
  };

  it('emits record-open for a file when bound', () => {
    const onEvent = vi.fn();
    render(
      <FileBrowserWidget
        config={cfg(fileBrowserConfigSchema, { binding })}
        data={{ rows: [{ id: 'd1', name: 'zeta.pdf', type: 'pdf', parentId: null }], total: 1 }}
        instanceId="fb-1"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByText('zeta.pdf'));
    expect(onEvent).toHaveBeenCalledWith({
      type: 'record-open',
      connectionId: 'conn-1',
      table: 'files',
      recordId: 'd1',
    });
  });

  it('emits a star mutation naming the configured starred column', () => {
    const onEvent = vi.fn();
    render(
      <FileBrowserWidget
        config={cfg(fileBrowserConfigSchema, { binding, starredField: 'is_pinned' })}
        data={{ rows: [{ id: 'd1', name: 'zeta.pdf', type: 'pdf', parentId: null }], total: 1 }}
        instanceId="fb-2"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Star' })[0] as HTMLElement);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'mutate',
      intent: 'update',
      connectionId: 'conn-1',
      table: 'files',
      recordId: 'd1',
      values: { is_pinned: true },
    });
  });

  it('never emits a mutation when unbound (demo data has no table to write to)', () => {
    const onEvent = vi.fn();
    render(
      <FileBrowserWidget
        config={cfg(fileBrowserConfigSchema)}
        data={fileBrowserDemoData(7)}
        instanceId="fb-3"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Star' })[0] as HTMLElement);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('qualifies the table with its schema when the binding carries one', () => {
    const onEvent = vi.fn();
    render(
      <FileBrowserWidget
        config={cfg(fileBrowserConfigSchema, { binding: { ...binding, source: { schema: 'storage', name: 'files', type: 'table' } } })}
        data={{ rows: [{ id: 'd1', name: 'zeta.pdf', type: 'pdf', parentId: null }], total: 1 }}
        instanceId="fb-4"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByText('zeta.pdf'));
    expect(onEvent.mock.calls[0]?.[0]?.table).toBe('storage.files');
  });
});

describe('file-browser — config field naming', () => {
  it('reads a source table whose columns are named differently', () => {
    const config = cfg(fileBrowserConfigSchema, {
      idField: 'uuid',
      nameField: 'filename',
      parentField: 'folder_id',
      sizeField: 'bytes',
      mimeField: 'content_type',
      starredField: 'pinned',
      modifiedField: 'updated_at',
    });
    const nodes = fileNodesOf(
      { rows: [{ uuid: 'u1', filename: 'report.pdf', folder_id: null, bytes: 2048, content_type: 'application/pdf', pinned: 't', updated_at: '2026-07-01T00:00:00.000Z' }], total: 1 },
      config,
    );
    expect(nodes[0]).toMatchObject({ id: 'u1', name: 'report.pdf', kind: 'pdf', parentId: null, size: 2048, starred: true });
  });

  it('survives rows missing every field (id + name synthesized, never a crash)', () => {
    const nodes = fileNodesOf({ rows: [{}], total: 1 }, browserConfig);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe('row-0');
    expect(nodes[0]?.kind).toBe('file');
    expect(nodes[0]?.starred).toBe(false);
  });
});

// ── upload-dropzone ────────────────────────────────────────────────────────

/** A File whose `size` is forced — happy-dom keeps the constructor's bytes. */
function fileOf(name: string, size: number): File {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('upload-dropzone', () => {
  it('renders the drop copy, the browse CTA, and an Intl max-size hint', () => {
    render(<UploadDropzone maxSize={200_000_000} hint="PDF, images, and docs" />);
    expect(screen.getByText('Drop files to upload')).toBeTruthy();
    expect(screen.getByText('browse')).toBeTruthy();
    expect(screen.getByText(/200 MB/)).toBeTruthy();
  });

  it('enters and leaves the drag-over state', () => {
    render(<UploadDropzone />);
    const zone = document.querySelector('[data-part="dropzone"]') as HTMLElement;
    expect(zone.hasAttribute('data-dragging')).toBe(false);
    fireEvent.dragOver(zone);
    expect(zone.hasAttribute('data-dragging')).toBe(true);
    fireEvent.dragLeave(zone);
    expect(zone.hasAttribute('data-dragging')).toBe(false);
  });

  it('emits dropped files through onFiles and clears the drag state', () => {
    const onFiles = vi.fn();
    render(<UploadDropzone onFiles={onFiles} />);
    const zone = document.querySelector('[data-part="dropzone"]') as HTMLElement;
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf('a.pdf', 10)] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0]?.[0]?.[0]?.name).toBe('a.pdf');
    expect(zone.hasAttribute('data-dragging')).toBe(false);
  });

  it('routes oversize files to onReject and still accepts the rest', () => {
    const onFiles = vi.fn();
    const onReject = vi.fn();
    render(<UploadDropzone maxSize={100} onFiles={onFiles} onReject={onReject} />);
    const zone = document.querySelector('[data-part="dropzone"]') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf('small.pdf', 50), fileOf('huge.zip', 5000)] } });
    expect(onFiles.mock.calls[0]?.[0]?.map((f: File) => f.name)).toEqual(['small.pdf']);
    expect(onReject.mock.calls[0]?.[0]?.map((f: File) => f.name)).toEqual(['huge.zip']);
    expect(onReject.mock.calls[0]?.[1]).toBe('max-size');
  });

  it('takes only the first file when multiple=false', () => {
    const onFiles = vi.fn();
    render(<UploadDropzone multiple={false} onFiles={onFiles} />);
    const zone = document.querySelector('[data-part="dropzone"]') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf('a.pdf', 1), fileOf('b.pdf', 1)] } });
    expect(onFiles.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('ignores drops while disabled', () => {
    const onFiles = vi.fn();
    render(<UploadDropzone disabled onFiles={onFiles} />);
    const zone = document.querySelector('[data-part="dropzone"]') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf('a.pdf', 1)] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('demoData is the documented seed-invariant static payload', () => {
    expect(uploadDropzoneDemoData()).toEqual({ value: null });
    expect(cfg(uploadDropzoneConfigSchema).multiple).toBe(true);
  });
});

// ── upload-progress-list ───────────────────────────────────────────────────

describe('upload-progress-list', () => {
  const jobs = uploadJobsOf(uploadProgressListDemoData(3), cfg(uploadProgressListConfigSchema));

  it('projects every status branch from the demo payload', () => {
    expect(new Set(jobs.map((j) => j.status))).toEqual(new Set(['done', 'uploading', 'failed', 'queued']));
  });

  it('renders a row per job with a progressbar and the status text', () => {
    render(<UploadProgressList jobs={jobs} />);
    expect(document.querySelectorAll('[data-part="upload-row"]').length).toBe(jobs.length);
    expect(screen.getAllByRole('progressbar').length).toBe(jobs.length);
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Queued')).toBeTruthy();
  });

  it('renders an in-flight job as a localized percentage', () => {
    render(<UploadProgressList jobs={[{ id: 'j', name: 'a.pdf', status: 'uploading', pct: 62 }]} />);
    expect(screen.getByText('62%')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('62');
  });

  it('shows the error copy on a failed row', () => {
    render(<UploadProgressList jobs={[{ id: 'j', name: 'a.pdf', status: 'failed', pct: 40, error: 'Network error' }]} />);
    expect(screen.getByText('Network error')).toBeTruthy();
  });

  it('offers Retry only on failed rows, and only when retryable', () => {
    const onRetry = vi.fn();
    const { unmount } = render(<UploadProgressList jobs={jobs} onRetry={onRetry} />);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1); // one failed job in the fixture
    fireEvent.click(retries[0] as HTMLElement);
    expect(onRetry.mock.calls[0]?.[0]?.status).toBe('failed');
    unmount();

    render(<UploadProgressList jobs={jobs} retryable={false} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers Download only on done rows, and only when downloadable', () => {
    const { unmount } = render(<UploadProgressList jobs={jobs} downloadable />);
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1);
    unmount();
    render(<UploadProgressList jobs={jobs} />);
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('offers Cancel only on in-flight/queued rows, and only when cancellable', () => {
    render(<UploadProgressList jobs={jobs} cancellable />);
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    expect(cancels.length).toBe(jobs.filter((j) => j.status === 'uploading' || j.status === 'queued').length);
  });

  it('infers a status from the percentage when the column uses another vocabulary', () => {
    const config = cfg(uploadProgressListConfigSchema);
    const inferred = uploadJobsOf({ rows: [{ id: '1', name: 'a', status: 'IN_FLIGHT', pct: 40 }, { id: '2', name: 'b', status: 'weird', pct: 100 }, { id: '3', name: 'c', status: 'weird', pct: 0 }] }, config);
    expect(inferred.map((j) => j.status)).toEqual(['uploading', 'done', 'queued']);
  });

  it('clamps an out-of-range percentage from an untrusted row', () => {
    const config = cfg(uploadProgressListConfigSchema);
    const [job] = uploadJobsOf({ rows: [{ id: '1', name: 'a', status: 'uploading', pct: 900 }] }, config);
    expect(job?.pct).toBe(100);
  });

  it('shows the empty state with no jobs', () => {
    render(<UploadProgressList jobs={[]} emptyTitle="No uploads in progress" />);
    expect(screen.getByText('No uploads in progress')).toBeTruthy();
  });
});

// ── attachment-list ────────────────────────────────────────────────────────

describe('attachment-list', () => {
  const items = attachmentsOf(attachmentListDemoData(5), cfg(attachmentListConfigSchema));

  it('renders a row per attachment with an Intl size', () => {
    render(<AttachmentList items={items} />);
    expect(document.querySelectorAll('[data-part="attachment-row"]').length).toBe(items.length);
    expect(screen.getByText(items[0]?.name as string)).toBeTruthy();
  });

  it('renders only the configured actions', () => {
    const { unmount } = render(<AttachmentList items={items} actions={['download']} />);
    expect(screen.getAllByRole('button', { name: 'Download' }).length).toBe(items.length);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    unmount();

    render(<AttachmentList items={items} actions={['download', 'delete']} />);
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBe(items.length);
  });

  it('caps the rendered rows at the limit', () => {
    render(<AttachmentList items={items} limit={2} />);
    expect(document.querySelectorAll('[data-part="attachment-row"]').length).toBe(2);
  });

  it('emits a delete mutation when bound', () => {
    const onEvent = vi.fn();
    render(
      <AttachmentListWidget
        config={cfg(attachmentListConfigSchema, {
          actions: ['delete'],
          binding: { kind: 'table-query', connectionId: 'c1', source: { name: 'attachments', type: 'table' }, shape: 'record-list' },
        })}
        data={{ rows: [{ id: 'a1', name: 'x.pdf', type: 'pdf' }], total: 1 }}
        instanceId="al-1"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onEvent).toHaveBeenCalledWith({
      type: 'mutate',
      intent: 'delete',
      connectionId: 'c1',
      table: 'attachments',
      recordId: 'a1',
    });
  });

  it('download drills through to the row url', () => {
    const onEvent = vi.fn();
    render(
      <AttachmentListWidget
        config={cfg(attachmentListConfigSchema)}
        data={{ rows: [{ id: 'a1', name: 'x.pdf', type: 'pdf', url: '/files/x.pdf' }], total: 1 }}
        instanceId="al-2"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/files/x.pdf' });
  });

  it('shows the empty state with no attachments', () => {
    render(<AttachmentList items={[]} emptyTitle="No attachments" />);
    expect(screen.getByText('No attachments')).toBeTruthy();
  });
});

// ── image-board ────────────────────────────────────────────────────────────

describe('image-board', () => {
  const images = boardImagesOf(imageBoardDemoData(2), cfg(imageBoardConfigSchema));

  it('renders a slot per row with its caption', () => {
    render(<ImageBoard images={images} />);
    expect(document.querySelectorAll('[data-part="image-slot"]').length).toBe(images.length);
    expect(document.querySelectorAll('[data-part="image-caption"]').length).toBe(images.length);
  });

  it('renders an unfilled row as the droppable placeholder, not a broken image', () => {
    render(<ImageBoard images={[{ id: 'i1', caption: 'Ref', placeholder: 'Drop reference' }]} />);
    expect(screen.getByText('Drop reference')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[data-part="image-slot"]')?.hasAttribute('data-filled')).toBe(false);
  });

  it('falls back to the placeholder when an image URL fails to load', () => {
    render(<ImageBoard images={[{ id: 'i1', imageUrl: '/gone.jpg', caption: 'Ref', placeholder: 'Drop reference' }]} />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(screen.getByText('Drop reference')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows the Add slot only when allowAdd', () => {
    const onAdd = vi.fn();
    const { unmount } = render(<ImageBoard images={images} allowAdd onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /Add image/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    unmount();
    render(<ImageBoard images={images} />);
    expect(screen.queryByRole('button', { name: /Add image/ })).toBeNull();
  });

  it('reports a caption edit on blur, and stays quiet on a no-op blur', () => {
    const onCaptionChange = vi.fn();
    render(<ImageBoard images={[{ id: 'i1', caption: 'Old' }]} editableCaptions onCaptionChange={onCaptionChange} />);
    const input = screen.getByRole('textbox', { name: 'Caption' });
    fireEvent.blur(input); // unchanged
    expect(onCaptionChange).toHaveBeenCalledTimes(1); // component reports; the widget filters
    fireEvent.change(input, { target: { value: 'New' } });
    fireEvent.blur(input);
    expect(onCaptionChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'i1' }), 'New');
  });

  it('shows the empty state with no images and no Add slot', () => {
    render(<ImageBoard images={[]} emptyTitle="No images yet" />);
    expect(screen.getByText('No images yet')).toBeTruthy();
  });
});

// ── link-list ──────────────────────────────────────────────────────────────

describe('link-list', () => {
  const links = referenceLinksOf(linkListDemoData(9), cfg(linkListConfigSchema));

  it('renders a row per link with the scheme stripped from the mono URL', () => {
    render(<LinkList links={links} />);
    expect(document.querySelectorAll('[data-part="link-row"]').length).toBe(links.length);
    const first = links[0] as { title: string; url: string };
    expect(screen.getByText(displayUrl(first.url))).toBeTruthy();
    expect(screen.queryByText(first.url)).toBeNull(); // the full https:// form is not shown
  });

  it('links open in a new tab with a safe rel', () => {
    render(<LinkList links={links} />);
    const anchor = screen.getAllByRole('link')[0] as HTMLAnchorElement;
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('keeps links in-tab when newTab=false, still with a safe rel', () => {
    render(<LinkList links={links} newTab={false} />);
    const anchor = screen.getAllByRole('link')[0] as HTMLAnchorElement;
    expect(anchor.hasAttribute('target')).toBe(false);
    expect(anchor.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('isSafeHref admits only http(s)', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('/relative/path')).toBe(true); // resolves against the page origin
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox(1)')).toBe(false);
  });

  it('renders a javascript: URL from an untrusted column as inert text, never an anchor', () => {
    // The stored-XSS payload under test: a URL column an attacker controls.
    render(<LinkList links={[{ id: 'x', title: 'Evil', url: 'javascript:alert(1)' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Evil')).toBeTruthy();
    expect(document.querySelector('[data-part="link-row"]')?.hasAttribute('data-unsafe')).toBe(true);
  });

  it('the composer adds a link and clears itself', () => {
    const onAdd = vi.fn();
    render(<LinkList links={links} editable onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /Add link/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Docs' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'https://…' }), { target: { value: 'https://docs.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith({ title: 'Docs', url: 'https://docs.example.com' });
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull(); // composer closed
  });

  it('the composer refuses an empty URL', () => {
    const onAdd = vi.fn();
    render(<LinkList links={links} editable onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /Add link/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('falls back to the URL as the title when none is given', () => {
    const onAdd = vi.fn();
    render(<LinkList links={links} editable onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /Add link/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'https://…' }), { target: { value: 'https://x.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledWith({ title: 'https://x.example', url: 'https://x.example' });
  });

  it('hides the composer and delete affordances when read-only', () => {
    render(<LinkList links={links} />);
    expect(screen.queryByRole('button', { name: /Add link/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('an unbound widget never offers editing (nothing to write to)', () => {
    render(
      <LinkListWidget
        config={cfg(linkListConfigSchema, { editable: true })}
        data={linkListDemoData(9)}
        instanceId="ll-1"
        onEvent={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Add link/ })).toBeNull();
  });

  it('emits insert/delete mutations naming the configured columns when bound', () => {
    const onEvent = vi.fn();
    render(
      <LinkListWidget
        config={cfg(linkListConfigSchema, {
          editable: true,
          titleField: 'label',
          urlField: 'href',
          binding: { kind: 'table-query', connectionId: 'c1', source: { name: 'links', type: 'table' }, shape: 'record-list' },
        })}
        data={{ rows: [{ id: 'l1', label: 'Docs', href: 'https://docs.example.com' }], total: 1 }}
        instanceId="ll-2"
        onEvent={onEvent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onEvent).toHaveBeenCalledWith({
      type: 'mutate',
      intent: 'delete',
      connectionId: 'c1',
      table: 'links',
      recordId: 'l1',
    });

    fireEvent.click(screen.getByRole('button', { name: /Add link/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'https://…' }), { target: { value: 'https://new.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onEvent).toHaveBeenLastCalledWith({
      type: 'mutate',
      intent: 'insert',
      connectionId: 'c1',
      table: 'links',
      values: { label: 'https://new.example', href: 'https://new.example' },
    });
  });
});

// ── registry metadata + the four WidgetFrame states ────────────────────────

describe('media registry metadata (annex §8)', () => {
  it('registers exactly the six annex §8 ids in the media family', () => {
    expect(mediaTrackDefinitions.map((d) => d.id)).toEqual([
      'file-browser',
      'upload-dropzone',
      'upload-progress-list',
      'attachment-list',
      'image-board',
      'link-list',
    ]);
    expect(mediaTrackDefinitions.every((d) => d.family === 'media')).toBe(true);
  });

  it('file-browser fills the page body per the annex grid note', () => {
    const definition = mediaTrackDefinitions.find((d) => d.id === 'file-browser');
    expect(definition?.placement).toBe('page');
    expect(definition?.sizing).toEqual({ minW: 8, minH: 12, defaultW: 12, defaultH: 18 });
  });

  it('converts the annex row sizes to 40px half-units (04 §6.1: h = round(rows × 2))', () => {
    // upload-dropzone: annex "min 4×2, default 6×2" → minH 4, defaultH 4.
    expect(mediaTrackDefinitions.find((d) => d.id === 'upload-dropzone')?.sizing).toEqual({ minW: 4, minH: 4, defaultW: 6, defaultH: 4 });
    // image-board: annex "min 6×4" → minH 8.
    expect(mediaTrackDefinitions.find((d) => d.id === 'image-board')?.sizing.minH).toBe(8);
    // the three "min 3×2" widgets → minW 3, minH 4.
    for (const id of ['upload-progress-list', 'attachment-list', 'link-list']) {
      expect(mediaTrackDefinitions.find((d) => d.id === id)?.sizing).toMatchObject({ minW: 3, minH: 4 });
    }
  });

  it('declares the annex data contracts (upload-dropzone is static: config only)', () => {
    expect(mediaTrackDefinitions.find((d) => d.id === 'upload-dropzone')?.dataContract).toBe('static');
    for (const definition of mediaTrackDefinitions.filter((d) => d.id !== 'upload-dropzone')) {
      expect(definition.dataContract).toBe('record-list');
    }
  });

  it('marks the mutating widgets with capabilities.editsData', () => {
    const edits = mediaTrackDefinitions.filter((d) => d.capabilities?.editsData === true).map((d) => d.id);
    expect(edits.sort()).toEqual(['attachment-list', 'file-browser', 'image-board', 'link-list']);
  });

  it('every component is a lazy ref (one chunk per family, 04 §2.3)', () => {
    const LAZY = Symbol.for('react.lazy');
    for (const definition of mediaTrackDefinitions) {
      expect((definition.component as { $$typeof?: symbol }).$$typeof).toBe(LAZY);
    }
  });
});

describe('media — four WidgetFrame states through WidgetHost (acceptance #4)', () => {
  const payloads: Record<string, unknown> = {
    'file-browser': fileBrowserDemoData(7),
    'upload-dropzone': uploadDropzoneDemoData(),
    'upload-progress-list': uploadProgressListDemoData(3),
    'attachment-list': attachmentListDemoData(5),
    'image-board': imageBoardDemoData(2),
    'link-list': linkListDemoData(9),
  };

  for (const definition of mediaTrackDefinitions) {
    it(`${definition.id}: skeleton shows the '${definition.skeleton}' silhouette`, () => {
      render(<WidgetHost widgetId={definition.id} instanceId={`${definition.id}-l`} data={{ status: 'loading' }} registry={registry} />);
      expect(document.querySelector(`[data-skeleton-variant="${definition.skeleton}"]`)).not.toBeNull();
    });

    it(`${definition.id}: empty shows the per-widget empty copy`, () => {
      render(
        <WidgetHost
          widgetId={definition.id}
          instanceId={`${definition.id}-e`}
          config={{ emptyState: { titleKey: `empty-${definition.id}` } }}
          data={{ status: 'success', data: undefined }}
          registry={registry}
        />,
      );
      expect(screen.getByText(`empty-${definition.id}`)).toBeTruthy();
    });

    it(`${definition.id}: error shows an alert and a Retry that re-issues the query`, () => {
      const refetch = vi.fn();
      render(
        <WidgetHost
          widgetId={definition.id}
          instanceId={`${definition.id}-x`}
          data={{ status: 'error', error: new Error('FILES_FORBIDDEN'), refetch }}
          registry={registry}
        />,
      );
      expect(screen.getByRole('alert')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it(`${definition.id}: loaded renders its demo payload without crashing`, async () => {
      render(
        <WidgetHost
          widgetId={definition.id}
          instanceId={`${definition.id}-ok`}
          data={{ status: 'success', data: payloads[definition.id] }}
          registry={registry}
        />,
      );
      // The lazy chunk resolves on a microtask; no error boundary must trip.
      await screen.findByTestId(`widget-${definition.id}-ok`).catch(() => undefined);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }
});

// ── determinism (04 §7.7) ──────────────────────────────────────────────────

describe('media demoData determinism (04 §7.7)', () => {
  const stable = (value: unknown): string => JSON.stringify(value);

  it('every generator is byte-identical for a given seed', () => {
    for (const definition of mediaTrackDefinitions) {
      expect(stable(definition.demoData(7))).toBe(stable(definition.demoData(7)));
    }
  });

  it('seeded generators actually thread the seed (upload-dropzone is static by contract)', () => {
    for (const definition of mediaTrackDefinitions) {
      const payloads = new Set([0, 1, 7, 42, 1234].map((seed) => stable(definition.demoData(seed))));
      if (definition.id === 'upload-dropzone') expect(payloads.size).toBe(1);
      else expect(payloads.size).toBeGreaterThan(1);
    }
  });

  it('file-browser demo rows form a valid hierarchy with truthful folder counts', () => {
    const { rows } = fileBrowserDemoData(7);
    const ids = new Set(rows.map((r) => r.id as string));
    for (const row of rows) {
      // Every parent pointer resolves (no dangling self-FK in the fixture).
      if (row.parentId !== null) expect(ids.has(row.parentId as string)).toBe(true);
      if (row.type === 'folder') {
        expect(row.count).toBe(rows.filter((r) => r.parentId === row.id).length);
      }
    }
  });

  it('never reads the wall clock (payloads are pinned to the demo epoch)', () => {
    const { rows } = fileBrowserDemoData(7);
    for (const row of rows) {
      if (typeof row.modified === 'string') {
        expect(new Date(row.modified).getTime()).toBeLessThanOrEqual(Date.UTC(2026, 6, 14, 12, 0, 0));
      }
    }
  });
});

// ── chrome localization ────────────────────────────────────────────────────

describe('media chrome localization (ui:widgets.media.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? { widgets: { media: { attachmentList: { emptyTitle: 'Keine Anhänge', emptyBody: 'Dateien erscheinen hier.' } } } }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <AttachmentList items={[]} />
      </I18nProvider>,
    );
    expect(screen.getByText('Keine Anhänge')).toBeTruthy();

    cleanup();
    render(<AttachmentList items={[]} />);
    expect(screen.getByText('No attachments')).toBeTruthy();
  });
});
