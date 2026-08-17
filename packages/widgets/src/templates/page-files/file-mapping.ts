// SPDX-License-Identifier: AGPL-3.0-only
import { fileBrowserConfigSchema, type FileBrowserConfig } from '../../families/media/media-config.js';
import { fileRowsOf } from '../../families/media/media-lib.js';

/**
 * `page-files` config projection (09-generated-app.md §7.9) — PURE module.
 *
 * The §14 generator's `media.file-shaped-table` candidate stores its column
 * picks as `nameColumn` / `parentColumn` (the classifier vocabulary), while the
 * `file-browser` widget consumes `*Field` naming (`nameField`, `parentField`,
 * `sizeField`, …) with annex-canonical defaults. This module is the single
 * place the two vocabularies meet: explicit config wins, then deterministic
 * detection over the payload's own keys, then the schema defaults.
 */

/** Per-field detection vocabularies, checked in order against the row keys. */
const FILE_FIELD_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  idField: ['id', 'uuid', 'file_id'],
  nameField: ['name', 'file_name', 'filename', 'title', 'display_name', 'label'],
  typeField: ['type', 'file_type', 'kind'],
  mimeField: ['mime', 'mime_type', 'content_type'],
  parentField: ['parentId', 'parent_id', 'folder_id', 'directory_id'],
  sizeField: ['size', 'file_size', 'size_bytes', 'bytes', 'filesize', 'byte_size'],
  modifiedField: ['modified', 'updated_at', 'modified_at', 'uploaded_at', 'created_at'],
  starredField: ['starred', 'is_starred', 'favorite', 'is_favorite', 'favourite', 'pinned'],
  urlField: ['url', 'file_url', 'storage_url', 'href', 'path'],
};

/** Generated-config key → widget-config key (candidates.ts vocabulary). */
const GENERATED_ALIASES: Readonly<Record<string, string>> = {
  nameColumn: 'nameField',
  parentColumn: 'parentField',
  sizeColumn: 'sizeField',
  typeColumn: 'typeField',
  urlColumn: 'urlField',
};

/**
 * Resolve the browser item's stored config + the payload rows into a complete
 * `FileBrowserConfig`. Detection only fills fields the stored config did not
 * set explicitly (under either vocabulary).
 */
export function resolveFileBrowserConfig(
  config: Record<string, unknown>,
  data: unknown,
): FileBrowserConfig {
  const merged: Record<string, unknown> = { ...config };
  for (const [alias, field] of Object.entries(GENERATED_ALIASES)) {
    const value = config[alias];
    if (typeof value === 'string' && value !== '' && merged[field] === undefined) {
      merged[field] = value;
    }
  }

  const keys = new Set<string>();
  for (const row of fileRowsOf(data)) for (const key of Object.keys(row)) keys.add(key);
  for (const [field, candidates] of Object.entries(FILE_FIELD_VOCABULARY)) {
    if (merged[field] !== undefined) continue;
    const hit = candidates.find((name) => keys.has(name));
    if (hit !== undefined) merged[field] = hit;
  }

  const parsed = fileBrowserConfigSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  // A malformed stored config degrades to the annex defaults, never a throw.
  return fileBrowserConfigSchema.parse({});
}

/** True when the resolved starred column actually exists in the payload. */
export function hasStarredColumn(config: FileBrowserConfig, data: unknown): boolean {
  const rows = fileRowsOf(data);
  return rows.some((row) => config.starredField in row);
}
