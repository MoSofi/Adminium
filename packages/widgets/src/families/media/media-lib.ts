// SPDX-License-Identifier: AGPL-3.0-only
import { getFormatters } from '@adminium/i18n';
import type { Tone } from '@adminium/ui';

/**
 * Shared helpers for the `media` family (annex §8) — a deterministic seeded PRNG
 * for `demoData`, the file-kind classifier every media widget colour-codes with,
 * the self-FK folder-hierarchy walk (`file-browser`'s breadcrumb + children), and
 * Intl-routed size/date formatting.
 *
 * PURE module: no JSX, no @adminium/ui component imports — `media-config.ts` (the
 * registry-metadata graph) imports from here, so this file must never drag the
 * component code into the eager chunk (04 §2.3). Icon ELEMENTS live in
 * `media-icons.tsx`.
 *
 * Numeral policy (10-i18n-theming.md §4.2): file sizes and modified dates are
 * *data-context* strings → Latin digits + gregorian, so the mono size/date
 * columns stay `tabular-nums`-aligned in every locale including `ar_EG`. That is
 * `getFormatters`' default `ctx: 'data'`, applied inside the layer — callers pass
 * the PLAIN tag (`latnDataTag` is only for hand-built `Intl.*` instances, and
 * double-applying it here would produce an invalid tag). Month names still
 * localize to the locale's script.
 *
 * Kept framework-light (no i18n provider dependency), like the `feeds`/`calendar`
 * families — widgets render in stories/tests without a wrapper and the dashboard
 * resolves label overrides through @adminium/i18n at the host boundary (04 §2).
 */

/** Mulberry32 — the repo's deterministic seeded PRNG (see feeds/calendar/boards). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick from a non-empty tuple. */
export function pickFrom<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length] as T;
}

/** Fixed demo epoch so `demoData(seed)` is byte-identical across runs (04 §7.7). */
export const MEDIA_DEMO_EPOCH = Date.UTC(2026, 6, 14, 12, 0, 0);

/**
 * Coalesce an empty/whitespace locale to `en-US`. A schema-valid
 * `format.locale: ''` otherwise reaches locale-sensitive Intl calls that throw
 * `RangeError: Incorrect locale information provided` — so widgets normalize the
 * tag once, at the boundary (the calendar-family convention).
 */
export function resolveLocale(locale: string | undefined): string {
  return locale !== undefined && locale.trim() !== '' ? locale : 'en-US';
}

// ── Binding source ──────────────────────────────────────────────────────────

/** The `connectionId` + qualified table a `record-open`/`mutate` event carries. */
export interface BindingSource {
  connectionId: string;
  table: string;
}

/**
 * The event target for a bound widget: `connectionId` + the schema-qualified
 * table name, or `null` when the widget is running on `demoData` (no binding) —
 * an unbound widget must never emit a mutation against a table that isn't there
 * (the tables/CardGallery + boards convention).
 */
export function bindingSourceOf(binding: { connectionId: string; source: { schema?: string | undefined; name: string } } | undefined): BindingSource | null {
  if (binding === undefined) return null;
  const { schema, name } = binding.source;
  return { connectionId: binding.connectionId, table: schema === undefined ? name : `${schema}.${name}` };
}

// ── File kinds ──────────────────────────────────────────────────────────────

/**
 * The colour-coded file kinds the media family renders (File Manager's
 * `ftMeta` vocabulary). `file` is the catch-all for an unrecognised type.
 */
export const FILE_KINDS = ['folder', 'pdf', 'sheet', 'image', 'archive', 'doc', 'code', 'video', 'audio', 'file'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/**
 * Smart-folder rail predicates (annex §8 `smartFolders`). Closed vocabulary —
 * a stored config can never smuggle arbitrary predicate code into the rail.
 * `media-config.ts` mirrors this as its Zod enum.
 */
export const SMART_FOLDER_FILTERS = ['all', 'starred', 'recent', 'folder'] as const;
export type SmartFolderFilter = (typeof SMART_FOLDER_FILTERS)[number];

const FILE_KIND_SET: ReadonlySet<string> = new Set(FILE_KINDS);

/** Kind → icon-chip tone (File Manager: folders accent, pdf danger, sheets pos…). */
export const FILE_KIND_TONE: Record<FileKind, Tone> = {
  folder: 'accent',
  pdf: 'danger',
  sheet: 'pos',
  image: 'info',
  archive: 'warn',
  doc: 'accent',
  code: 'info',
  video: 'danger',
  audio: 'warn',
  file: 'neutral',
};

/** Extension → kind. Lowercase, no leading dot. */
const EXTENSION_KIND: Readonly<Record<string, FileKind>> = {
  pdf: 'pdf',
  xls: 'sheet',
  xlsx: 'sheet',
  csv: 'sheet',
  tsv: 'sheet',
  numbers: 'sheet',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  avif: 'image',
  heic: 'image',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  rar: 'archive',
  '7z': 'archive',
  doc: 'doc',
  docx: 'doc',
  rtf: 'doc',
  txt: 'doc',
  md: 'doc',
  key: 'doc',
  ppt: 'doc',
  pptx: 'doc',
  pages: 'doc',
  json: 'code',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  sql: 'code',
  yml: 'code',
  yaml: 'code',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  m4a: 'audio',
  ogg: 'audio',
};

/** MIME top-level type → kind, for the mime-first branch. */
const MIME_KIND: Readonly<Record<string, FileKind>> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'doc',
};

/** Extension of a filename (lowercase, no dot); `''` when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Classify a row into a `FileKind`, in precedence order:
 *   1. an explicit `type` that already names a kind (`'folder'`, `'pdf'`, …),
 *   2. the MIME type (`application/pdf`, `image/png`, `text/*`, …),
 *   3. the filename extension,
 *   4. `file`.
 *
 * Deliberately tolerant (unknown in, `FileKind` out) — rows arrive from an
 * untrusted `record-list` payload whose `type` column is whatever the source
 * table stores.
 */
export function kindOf(type?: unknown, mime?: unknown, name?: unknown): FileKind {
  if (typeof type === 'string') {
    const normalized = type.trim().toLowerCase();
    if (FILE_KIND_SET.has(normalized)) return normalized as FileKind;
    // Common aliases the annex evidence uses ('img', 'zip', 'dir').
    if (normalized === 'img') return 'image';
    if (normalized === 'zip') return 'archive';
    if (normalized === 'dir' || normalized === 'directory') return 'folder';
  }
  if (typeof mime === 'string' && mime.includes('/')) {
    const [top = '', sub = ''] = mime.toLowerCase().split('/');
    if (sub === 'pdf') return 'pdf';
    if (sub.includes('spreadsheet') || sub === 'csv') return 'sheet';
    if (sub.includes('zip') || sub.includes('compressed') || sub.includes('tar')) return 'archive';
    if (sub.includes('word') || sub.includes('presentation') || sub.includes('document')) return 'doc';
    if (sub === 'json' || sub.includes('javascript')) return 'code';
    const byTop = MIME_KIND[top];
    if (byTop !== undefined) return byTop;
  }
  if (typeof name === 'string') {
    const byExtension = EXTENSION_KIND[extensionOf(name)];
    if (byExtension !== undefined) return byExtension;
  }
  return 'file';
}

// ── `record-list` envelope reads ────────────────────────────────────────────

/**
 * A `record-list` envelope's rows. Tolerant of every shape the repo emits: the
 * §3 canonical `{ rows }`, the `{ data }` shorthand the boards/feeds tracks use,
 * and a bare array.
 */
export function fileRowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (typeof data === 'object' && data !== null) {
    const envelope = data as { rows?: unknown; data?: unknown };
    if (Array.isArray(envelope.rows)) return envelope.rows as Record<string, unknown>[];
    if (Array.isArray(envelope.data)) return envelope.data as Record<string, unknown>[];
  }
  return [];
}

/** Read a string-ish field off an untrusted row (numbers coerce; else undefined). */
export function stringField(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[field];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Read a finite-number field off an untrusted row (numeric strings coerce). */
export function numberField(row: Record<string, unknown>, field: string): number | undefined {
  const value = row[field];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** Read a boolean-ish field (`true`, `1`, `'true'`, `'t'`, `'yes'`). */
export function booleanField(row: Record<string, unknown>, field: string): boolean {
  const value = row[field];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return ['true', 't', 'yes', 'y', '1'].includes(value.toLowerCase());
  return false;
}

// ── Folder hierarchy (self-FK) ──────────────────────────────────────────────

/** A normalized file/folder node — the shape every media widget renders from. */
export interface FileNode {
  id: string;
  name: string;
  kind: FileKind;
  /** Self-FK to the containing folder; `null` at the root. */
  parentId: string | null;
  /** Bytes. Folders have none. */
  size?: number | undefined;
  /** Child count, for folders. */
  count?: number | undefined;
  /** ISO 8601 last-modified timestamp. */
  modified?: string | undefined;
  starred: boolean;
  url?: string | undefined;
}

/** The root sentinel id — `file-browser`'s "current folder" when at the top. */
export const ROOT_ID = '__root__';

/** Direct children of `folderId`, folders first then files, each name-sorted. */
export function childrenOf(nodes: readonly FileNode[], folderId: string, collator?: Intl.Collator): FileNode[] {
  const parent = folderId === ROOT_ID ? null : folderId;
  const compare = collator ?? new Intl.Collator('en-US', { numeric: true });
  return nodes
    .filter((node) => (node.parentId ?? null) === parent)
    .sort((a, b) => {
      const folderDelta = (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1);
      return folderDelta !== 0 ? folderDelta : compare.compare(a.name, b.name);
    });
}

/**
 * Root → `folderId` breadcrumb chain (excluding the root sentinel), walked up the
 * self-FK pointers. **Cycle-safe**: a self-referential or mutually-referential
 * `parentId` (a corrupt row, or a legitimately cyclic self-FK the engine cannot
 * forbid) would otherwise spin forever — visited ids terminate the walk.
 */
export function breadcrumbTrail(nodes: readonly FileNode[], folderId: string): FileNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: FileNode[] = [];
  const seen = new Set<string>();
  let cursor: string | null = folderId === ROOT_ID ? null : folderId;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (node === undefined) break;
    chain.unshift(node);
    cursor = node.parentId ?? null;
  }
  return chain;
}

/**
 * How many items a folder directly contains — the grid tile's "12 items" when
 * the bound table has no materialized count column (annex §8 marks `count`
 * optional). Direct children only, matching the file-manager convention.
 */
export function descendantCount(nodes: readonly FileNode[], folderId: string): number {
  return nodes.filter((node) => (node.parentId ?? null) === folderId).length;
}

// ── Intl-routed formatting ──────────────────────────────────────────────────

/** Localized byte size ("1.2 MB"), Latin digits (data context). */
export function formatSize(bytes: number | undefined, locale?: string): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  return getFormatters(resolveLocale(locale)).bytes(bytes);
}

/** Localized short modified date ("Sep 12"), Latin digits (data context). */
export function formatModified(iso: string | undefined, locale?: string): string | undefined {
  const date = parseIso(iso);
  return date === null ? undefined : getFormatters(resolveLocale(locale)).date(date, 'medium');
}

/** Localized absolute timestamp for the `title` tooltip on a modified cell. */
export function formatModifiedFull(iso: string | undefined, locale?: string): string | undefined {
  const date = parseIso(iso);
  return date === null ? undefined : getFormatters(resolveLocale(locale)).dateTime(date);
}

/** Parse an ISO timestamp, `null` when absent or unparseable (untrusted rows). */
function parseIso(iso: string | undefined): Date | null {
  if (iso === undefined) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Localized item count ("12 items" is composed by the caller from config copy). */
export function formatCount(value: number, locale?: string): string {
  return getFormatters(resolveLocale(locale)).number(value);
}

/**
 * Strip the scheme from a URL for the mono display line (`link-list` renders
 * `app.adminium.io/v/8kd93m2q`, never `https://app.adminium.io/…`). Falsy /
 * scheme-less input passes through unchanged.
 */
export function displayUrl(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
}

/**
 * Percent clamped to `[0, 100]` and rounded — `upload-progress-list` renders an
 * untrusted `pct` from a job row straight into a bar width.
 */
export function clampPct(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}
