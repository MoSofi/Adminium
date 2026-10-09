// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Code tab's file list as rows: each group's files, with the folders
 * their labels name. A label is the server's (`customer/pages/Menu.tsx`,
 * `dashboard/pages/orders.json`, `design.md`); the side's own name at its
 * front is the group's heading, so it is not said again in the rows.
 */
import type { DesignerFile, DesignerFileGroup, DesignerFiles } from '../api.js';

export type TreeRow =
  | { kind: 'file'; key: string; name: string; depth: number; file: DesignerFile }
  | { kind: 'folder'; key: string; name: string; depth: number; open: boolean };

/** A label's parts under its group: `customer/pages/Menu.tsx` is `pages`, `Menu.tsx`. */
export function partsOf(group: DesignerFileGroup, label: string): string[] {
  const parts = label.split('/');
  return group !== 'settings' && parts.length > 1 && parts[0] === group ? parts.slice(1) : parts;
}

/** What the bar says of the open file: the side, each folder, the file. A settings file is its name alone. */
export function crumbsOf(group: DesignerFileGroup, label: string): string[] {
  return group === 'settings' ? [label] : label.split('/');
}

/** A file's name alone. */
export function nameOf(label: string): string {
  return label.slice(label.lastIndexOf('/') + 1);
}

interface Folder {
  files: { name: string; file: DesignerFile }[];
  folders: Map<string, Folder>;
  /** What came first, a file or a folder, in the order the server listed them. */
  order: ({ file: number } | { folder: string })[];
}

const empty = (): Folder => ({ files: [], folders: new Map(), order: [] });

/**
 * A group's rows. A folder at the first level starts open and a deeper one
 * closed; `toggled` holds the folders a person has turned the other way.
 */
export function treeRows(group: DesignerFileGroup, files: readonly DesignerFile[], toggled: ReadonlySet<string>): TreeRow[] {
  const root = empty();
  for (const file of files) {
    const parts = partsOf(group, file.label);
    let at = root;
    for (const part of parts.slice(0, -1)) {
      let next = at.folders.get(part);
      if (next === undefined) {
        next = empty();
        at.folders.set(part, next);
        at.order.push({ folder: part });
      }
      at = next;
    }
    at.order.push({ file: at.files.length });
    at.files.push({ name: parts.at(-1) ?? file.label, file });
  }
  const rows: TreeRow[] = [];
  const walk = (folder: Folder, depth: number, prefix: string): void => {
    for (const entry of folder.order) {
      if ('file' in entry) {
        const { name, file } = folder.files[entry.file] as { name: string; file: DesignerFile };
        rows.push({ kind: 'file', key: file.path, name, depth, file });
        continue;
      }
      const key = `${prefix}/${entry.folder}`;
      const open = (depth === 0) !== toggled.has(key);
      rows.push({ kind: 'folder', key, name: entry.folder, depth, open });
      if (open) walk(folder.folders.get(entry.folder) as Folder, depth + 1, key);
    }
  };
  walk(root, 0, group);
  return rows;
}

/** The folders a file sits in, as `treeRows` keys them: what must be open for its row to show. */
export function foldersOf(group: DesignerFileGroup, label: string): string[] {
  const parts = partsOf(group, label).slice(0, -1);
  return parts.map((_, index) => `${group}/${parts.slice(0, index + 1).join('/')}`);
}

/** The file shown first: the customer side's own `App.tsx`, else the first one listed. */
export function firstFile(list: DesignerFiles): DesignerFile | null {
  const customer = list.groups.find((group) => group.key === 'customer')?.files.find((file) => file.label === 'customer/App.tsx');
  return customer ?? list.groups.find((group) => group.files.length > 0)?.files[0] ?? null;
}

export function findFile(list: DesignerFiles | undefined, path: string | null): { group: DesignerFileGroup; file: DesignerFile } | null {
  if (list === undefined || path === null) return null;
  for (const group of list.groups) {
    const file = group.files.find((entry) => entry.path === path);
    if (file !== undefined) return { group: group.key, file };
  }
  return null;
}
