import { Breadcrumbs, Checkbox, EmptyState, IconButton, IconTile, MonoText, SegmentedControl } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { LayoutGrid, List, Star } from 'lucide-react';
import { useMemo, useState } from 'react';

import { fileIconFor } from './media-icons.js';
import {
  FILE_KIND_TONE,
  ROOT_ID,
  bindingSourceOf,
  booleanField,
  breadcrumbTrail,
  childrenOf,
  descendantCount,
  fileRowsOf,
  formatCount,
  formatModified,
  formatModifiedFull,
  formatSize,
  kindOf,
  numberField,
  resolveLocale,
  stringField,
} from './media-lib.js';
import type { FileNode, SmartFolderFilter } from './media-lib.js';
import { fileBrowserConfigSchema, fileBrowserDemoData } from './media-config.js';
import type { FileBrowserConfig, SmartFolderConfig } from './media-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { fileBrowserConfigSchema, fileBrowserDemoData };
export type { FileBrowserConfig };

/**
 * `file-browser` (annex §8) — the dual-view file explorer: a responsive tile grid
 * (type-coloured icon chips, hover star toggle, folder-first sort, click-to-open)
 * and a list-table view (Name/Size/Modified/star, mono sizes, em-dash for
 * folders), with a breadcrumb trail walked from the self-FK parent pointers and a
 * quick-access smart-folder rail carrying live counts. Binds to a `record-list`
 * of file/folder rows.
 *
 * NAVIGATION IS LOCAL STATE, NOT A MUTATION: opening a folder re-filters the rows
 * already in the payload (the annex contract is a whole self-FK hierarchy in one
 * `record-list`, the File Manager port's model). Opening a FILE emits a
 * `record-open` event — the host decides whether that previews, downloads, or
 * routes. Starring emits a `mutate` intent; the widget never writes.
 */

export interface FileBrowserProps {
  nodes: readonly FileNode[];
  views?: 'grid' | 'list' | 'both' | undefined;
  defaultView?: 'grid' | 'list' | undefined;
  starrable?: boolean | undefined;
  selectable?: boolean | undefined;
  smartFolders?: readonly SmartFolderConfig[] | undefined;
  typeIconMap?: Record<string, string> | undefined;
  locale?: string | undefined;
  rootLabel?: string | undefined;
  breadcrumbLabel?: string | undefined;
  gridViewLabel?: string | undefined;
  listViewLabel?: string | undefined;
  nameHeader?: string | undefined;
  sizeHeader?: string | undefined;
  modifiedHeader?: string | undefined;
  starLabel?: string | undefined;
  itemsLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  /** Controlled current folder (`ROOT_ID` at the top); omit for local state. */
  folderId?: string | undefined;
  onFolderChange?: ((folderId: string) => void) | undefined;
  onOpenFile?: ((node: FileNode) => void) | undefined;
  onToggleStar?: ((node: FileNode, next: boolean) => void) | undefined;
  onSelectionChange?: ((ids: readonly string[]) => void) | undefined;
  testId?: string | undefined;
}

/** Placeholder for a folder's size cell — folders have no byte size. */
const EM_DASH = '—';

export function FileBrowser({
  nodes,
  views = 'both',
  defaultView = 'grid',
  starrable = true,
  selectable = false,
  smartFolders,
  typeIconMap,
  locale,
  rootLabel,
  breadcrumbLabel,
  gridViewLabel,
  listViewLabel,
  nameHeader,
  sizeHeader,
  modifiedHeader,
  starLabel,
  itemsLabel,
  emptyTitle,
  emptyBody,
  folderId,
  onFolderChange,
  onOpenFile,
  onToggleStar,
  onSelectionChange,
  testId,
}: FileBrowserProps) {
  const t = useMaybeT();
  const resolvedRootLabel = rootLabel ?? t('ui:widgets.media.root', 'Files');
  const resolvedBreadcrumbLabel = breadcrumbLabel ?? t('ui:widgets.media.breadcrumb', 'Breadcrumb');
  const resolvedGridViewLabel = gridViewLabel ?? t('ui:widgets.media.gridView', 'Grid view');
  const resolvedListViewLabel = listViewLabel ?? t('ui:widgets.media.listView', 'List view');
  const resolvedNameHeader = nameHeader ?? t('ui:widgets.media.nameHeader', 'Name');
  const resolvedSizeHeader = sizeHeader ?? t('ui:widgets.media.sizeHeader', 'Size');
  const resolvedModifiedHeader = modifiedHeader ?? t('ui:widgets.media.modifiedHeader', 'Modified');
  const resolvedItemsLabel = itemsLabel ?? t('ui:widgets.media.items', 'items');
  const tag = resolveLocale(locale);
  const [localFolder, setLocalFolder] = useState<string>(ROOT_ID);
  const [view, setView] = useState<'grid' | 'list'>(views === 'both' ? defaultView : views);
  const [smartKey, setSmartKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);

  const current = folderId ?? localFolder;
  const effectiveView = views === 'both' ? view : views;

  const collator = useMemo(() => new Intl.Collator(tag, { numeric: true }), [tag]);

  const smart = smartFolders?.find((entry) => entry.key === smartKey);
  const trail = useMemo(() => breadcrumbTrail(nodes, current), [nodes, current]);

  /**
   * The rows on screen. A smart folder REPLACES the hierarchy view with a flat
   * filtered list (the File Manager rail's semantics: "Starred" spans folders);
   * otherwise it is the current folder's direct children, folders first.
   */
  const visible = useMemo(() => {
    if (smart !== undefined && smart.filter !== 'folder') {
      return flatFilter(nodes, smart.filter, collator);
    }
    const target = smart?.filter === 'folder' && smart.folderId !== undefined ? smart.folderId : current;
    return childrenOf(nodes, target, collator);
  }, [nodes, smart, current, collator]);

  const navigate = (next: string): void => {
    setSmartKey(null);
    if (folderId === undefined) setLocalFolder(next);
    onFolderChange?.(next);
  };

  const openNode = (node: FileNode): void => {
    if (node.kind === 'folder') navigate(node.id);
    else onOpenFile?.(node);
  };

  const toggleSelected = (id: string): void => {
    const next = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
    setSelected(next);
    onSelectionChange?.(next);
  };

  const crumbs = [
    { label: resolvedRootLabel, onClick: () => navigate(ROOT_ID) },
    ...trail.map((node) => ({ label: node.name, onClick: () => navigate(node.id) })),
  ];

  return (
    <div data-widget="file-browser" data-testid={testId} className="flex h-full min-h-0 flex-col">
      {/* Chrome: breadcrumb trail + the grid/list toggle. */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Breadcrumbs items={crumbs} label={resolvedBreadcrumbLabel} className="flex-1" />
        {views === 'both' && (
          <SegmentedControl
            value={effectiveView}
            onValueChange={(next) => setView(next === 'list' ? 'list' : 'grid')}
            options={[
              { value: 'grid', ariaLabel: resolvedGridViewLabel, icon: <LayoutGrid className="size-4" /> },
              { value: 'list', ariaLabel: resolvedListViewLabel, icon: <List className="size-4" /> },
            ]}
          />
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {smartFolders !== undefined && smartFolders.length > 0 && (
          <nav className="w-48 shrink-0 space-y-0.5 overflow-auto border-e border-border p-2" aria-label={resolvedRootLabel}>
            {smartFolders.map((entry) => {
              const active = entry.key === smartKey;
              const count = flatFilter(nodes, entry.filter, collator, entry.folderId).length;
              return (
                <button
                  key={entry.key}
                  type="button"
                  data-part="smart-folder"
                  data-active={active ? '' : undefined}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setSmartKey(active ? null : entry.key)}
                  className={
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm font-semibold ' +
                    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ' +
                    (active ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-surface-2 hover:text-fg')
                  }
                >
                  <span className="flex-1 text-start">{entry.label ?? entry.key}</span>
                  <MonoText className="text-caption text-fg-subtle">{formatCount(count, tag)}</MonoText>
                </button>
              );
            })}
          </nav>
        )}

        <div className="min-w-0 flex-1 overflow-auto">
          {visible.length === 0 ? (
            <EmptyState
              compact
              preset="no-data"
              title={emptyTitle ?? t('ui:widgets.media.fileBrowser.emptyTitle', 'This folder is empty')}
              body={emptyBody ?? t('ui:widgets.media.fileBrowser.emptyBody', 'Upload files or create a folder to get started.')}
            />
          ) : effectiveView === 'grid' ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3.5 p-4">
              {visible.map((node) => (
                <li key={node.id} className="relative">
                  <button
                    type="button"
                    data-part="file-tile"
                    data-kind={node.kind}
                    onClick={() => openNode(node)}
                    className={
                      'group flex w-full flex-col rounded-lg border border-border bg-surface p-4 text-start ' +
                      'transition-shadow duration-150 hover:border-border-strong hover:shadow-md ' +
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
                    }
                  >
                    <IconTile
                      size="lg"
                      tone={FILE_KIND_TONE[node.kind]}
                      icon={fileIconFor(node.kind, undefined, node.name, typeIconMap)}
                    />
                    <span className="mt-3 truncate text-body-sm font-bold text-fg">{node.name}</span>
                    <span className="mt-0.5 truncate text-caption text-fg-subtle">{metaLine(node, nodes, tag, resolvedItemsLabel)}</span>
                  </button>
                  {starrable && <StarToggle node={node} label={starLabel} onToggle={onToggleStar} className="absolute end-3 top-3" />}
                  {selectable && (
                    <span className="absolute start-3 top-3">
                      <Checkbox
                        checked={selected.includes(node.id)}
                        onCheckedChange={() => toggleSelected(node.id)}
                        aria-label={node.name}
                      />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <table data-part="file-table" className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border text-caption font-bold uppercase tracking-wide text-fg-subtle">
                  {selectable && <th scope="col" className="w-10 px-4 py-2.5" />}
                  <th scope="col" className="px-4 py-2.5 text-start">{resolvedNameHeader}</th>
                  <th scope="col" className="w-28 px-4 py-2.5 text-start">{resolvedSizeHeader}</th>
                  <th scope="col" className="w-32 px-4 py-2.5 text-start">{resolvedModifiedHeader}</th>
                  {starrable && <th scope="col" className="w-12 px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {visible.map((node) => (
                  <tr key={node.id} data-part="file-row" data-kind={node.kind} className="border-b border-border hover:bg-surface-2">
                    {selectable && (
                      <td className="px-4 py-2.5">
                        <Checkbox
                          checked={selected.includes(node.id)}
                          onCheckedChange={() => toggleSelected(node.id)}
                          aria-label={node.name}
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => openNode(node)}
                        className={
                          'flex w-full min-w-0 items-center gap-3 text-start ' +
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
                        }
                      >
                        <IconTile
                          size="sm"
                          tone={FILE_KIND_TONE[node.kind]}
                          icon={fileIconFor(node.kind, undefined, node.name, typeIconMap)}
                        />
                        <span className="truncate text-body-sm font-semibold text-fg">{node.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <MonoText className="text-body-sm text-fg-muted">
                        {node.kind === 'folder' ? EM_DASH : (formatSize(node.size, tag) ?? EM_DASH)}
                      </MonoText>
                    </td>
                    <td className="px-4 py-2.5 text-body-sm text-fg-muted">
                      {node.modified === undefined ? (
                        EM_DASH
                      ) : (
                        <time dateTime={node.modified} title={formatModifiedFull(node.modified, tag)}>
                          {formatModified(node.modified, tag) ?? EM_DASH}
                        </time>
                      )}
                    </td>
                    {starrable && (
                      <td className="px-4 py-2.5">
                        <StarToggle node={node} label={starLabel} onToggle={onToggleStar} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The hover star toggle. Optimistic-free: the widget renders `node.starred` and
 * reports the intent — the host owns the write (04 §2, `capabilities.editsData`).
 */
function StarToggle({
  node,
  label,
  onToggle,
  className,
}: {
  node: FileNode;
  label?: string | undefined;
  onToggle?: ((node: FileNode, next: boolean) => void) | undefined;
  className?: string | undefined;
}) {
  const t = useMaybeT();
  return (
    <IconButton
      size="sm"
      data-part="star-toggle"
      data-starred={node.starred ? '' : undefined}
      aria-pressed={node.starred}
      label={label ?? t('ui:widgets.media.star', 'Star')}
      onClick={() => onToggle?.(node, !node.starred)}
      className={`${node.starred ? 'text-warn' : 'text-fg-subtle'} ${className ?? ''}`}
    >
      <Star className="size-3.5" {...(node.starred ? { fill: 'currentColor' } : {})} />
    </IconButton>
  );
}

/**
 * Tile sub-label: "12 items" for a folder, "2.4 MB · Sep 12" for a file.
 *
 * `count` is OPTIONAL in the annex §8 contract — a real file table (name + size
 * + parent self-FK) has no materialized count column — so a folder with no
 * `countField` binding falls back to counting its children in the payload's own
 * self-FK hierarchy rather than asserting a false "0 items".
 */
function metaLine(
  node: FileNode,
  nodes: readonly FileNode[],
  locale: string,
  itemsLabel: string,
): string {
  if (node.kind === 'folder') {
    return `${formatCount(node.count ?? descendantCount(nodes, node.id), locale)} ${itemsLabel}`;
  }
  return [formatSize(node.size, locale), formatModified(node.modified, locale)].filter((part) => part !== undefined).join(' · ');
}

/** Rows for a smart-folder rail entry (also drives its live count). */
function flatFilter(
  nodes: readonly FileNode[],
  filter: SmartFolderFilter,
  collator: Intl.Collator,
  folderId?: string | undefined,
): FileNode[] {
  if (filter === 'folder') return childrenOf(nodes, folderId ?? ROOT_ID, collator);
  if (filter === 'starred') return nodes.filter((node) => node.starred);
  if (filter === 'recent') {
    return [...nodes]
      .filter((node) => node.kind !== 'folder' && node.modified !== undefined)
      .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
      .slice(0, 8);
  }
  // 'all' spans the WHOLE hierarchy, like its `starred`/`recent` siblings — the
  // rail's "All files · N" must not stop at the root folder's direct children.
  return nodes
    .filter((node) => node.kind !== 'folder')
    .sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Project an untrusted `record-list` onto `FileNode`s using the config's field
 * naming. Rows without a usable id are dropped (a React key must be stable);
 * everything else degrades to a sensible default rather than throwing.
 */
export function fileNodesOf(data: unknown, config: FileBrowserConfig): FileNode[] {
  return fileRowsOf(data)
    .map((row, index): FileNode | null => {
      const id = stringField(row, config.idField) ?? `row-${index}`;
      const name = stringField(row, config.nameField) ?? id;
      const rawParent = row[config.parentField];
      return {
        id,
        name,
        kind: kindOf(row[config.typeField], row[config.mimeField], name),
        parentId: typeof rawParent === 'string' && rawParent !== '' ? rawParent : null,
        size: numberField(row, config.sizeField),
        count: numberField(row, config.countField),
        modified: stringField(row, config.modifiedField),
        starred: booleanField(row, config.starredField),
        url: stringField(row, config.urlField),
      };
    })
    .filter((node): node is FileNode => node !== null);
}

export function FileBrowserWidget({ config, data, onEvent }: WidgetProps<FileBrowserConfig>) {
  const nodes = fileNodesOf(data, config);
  const source = bindingSourceOf(config.binding);
  return (
    <FileBrowser
      nodes={nodes}
      views={config.views}
      defaultView={config.defaultView}
      starrable={config.starrable}
      selectable={config.selectable}
      {...(config.smartFolders === undefined ? {} : { smartFolders: config.smartFolders })}
      {...(config.typeIconMap === undefined ? {} : { typeIconMap: config.typeIconMap })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.rootLabel === undefined ? {} : { rootLabel: config.rootLabel })}
      {...(config.breadcrumbLabel === undefined ? {} : { breadcrumbLabel: config.breadcrumbLabel })}
      {...(config.gridViewLabel === undefined ? {} : { gridViewLabel: config.gridViewLabel })}
      {...(config.listViewLabel === undefined ? {} : { listViewLabel: config.listViewLabel })}
      {...(config.nameHeader === undefined ? {} : { nameHeader: config.nameHeader })}
      {...(config.sizeHeader === undefined ? {} : { sizeHeader: config.sizeHeader })}
      {...(config.modifiedHeader === undefined ? {} : { modifiedHeader: config.modifiedHeader })}
      {...(config.starLabel === undefined ? {} : { starLabel: config.starLabel })}
      {...(config.itemsLabel === undefined ? {} : { itemsLabel: config.itemsLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      onOpenFile={(node) => {
        // Bound → let the host open the record (preview/download/route is its
        // call); unbound demo data → the row's own url is the only target.
        if (source !== null) {
          onEvent({ type: 'record-open', connectionId: source.connectionId, table: source.table, recordId: node.id });
        } else if (node.url !== undefined) {
          onEvent({ type: 'drill-through', href: node.url });
        }
      }}
      onToggleStar={(node, next) => {
        if (source === null) return; // unbound: nothing to write to
        onEvent({
          type: 'mutate',
          intent: 'update',
          connectionId: source.connectionId,
          table: source.table,
          recordId: node.id,
          values: { [config.starredField]: next },
        });
      }}
    />
  );
}
