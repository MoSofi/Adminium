// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { MEDIA_DEMO_EPOCH, SMART_FOLDER_FILTERS, mulberry32 } from './media-lib.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

/**
 * `media` family config schemas + deterministic demo generators — PURE module
 * (zod + media-lib only; no React component code, no @adminium/ui, no lucide).
 *
 * WHY THIS EXISTS: the registry metadata graph reaches this family through
 * `media-track.definitions.ts`, which imports the config schemas and `demoData`
 * generators. Those must NOT drag the @adminium/ui-heavy components into the
 * eager registry chunk — the components load only through
 * `lazy(() => import('./media-track-components.js'))` (one lazy chunk per family,
 * 04 §2.3; the boards/kpi/charts `*-config` convention). The component files
 * re-export these symbols so barrel/story/test import points stay stable.
 *
 * FIELD-NAMING CONFIG (04 §5, annex §8): media widgets bind to a `record-list`
 * of rows from a real attachment/file table whose columns are named whatever the
 * source schema calls them. Every widget therefore takes `*Field` config naming
 * which column carries the name/size/mime/modified/url/parent — defaults match
 * the annex's canonical contract, and the auto-instantiation hook (annex §8)
 * fills them from the classifier's `file-ref`/`image-url`/`url` semantics.
 *
 * LABELS: widgets are locale-agnostic (04 §2) — user-visible copy arrives as
 * already-translated strings through config (`emptyTitle`, `browseLabel`, …),
 * with English developer fallbacks. The dashboard fills them from `t('…')`;
 * en-US entries live at `widgets.media.*` in the i18n bundles.
 */

// ── file-browser (annex §8) ─────────────────────────────────────────────────

/**
 * A smart folder in the quick-access rail (annex §8 `smartFolders`). `filter`
 * selects rows the rail counts + shows; `folderId` jumps to a real folder.
 * Closed vocabulary — a rail entry can never smuggle arbitrary predicate code.
 */
export const smartFolderSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  filter: z.enum(SMART_FOLDER_FILTERS).default('all'),
  /** Target folder id when `filter: 'folder'`. */
  folderId: z.string().optional(),
});
export type SmartFolderConfig = z.infer<typeof smartFolderSchema>;

export const fileBrowserConfigSchema = widgetSharedConfigSchema.extend({
  /** Which view(s) the browser offers; `both` shows the grid/list toggle. */
  views: z.enum(['grid', 'list', 'both']).default('both'),
  /** Initial view when `views: 'both'`. */
  defaultView: z.enum(['grid', 'list']).default('grid'),
  /** Remap a raw `type` value onto another kind's glyph (annex §8). */
  typeIconMap: z.record(z.string(), z.string()).optional(),
  /** Show the hover star toggle (annex §8 `starrable`). */
  starrable: z.boolean().default(true),
  /** Quick-access rail entries with live counts; omitted → no rail. */
  smartFolders: z.array(smartFolderSchema).optional(),
  /** Allow selecting rows/tiles (checkbox column + selection count). */
  selectable: z.boolean().default(false),
  // Field naming — which column carries what (04 §5).
  idField: z.string().default('id'),
  nameField: z.string().default('name'),
  typeField: z.string().default('type'),
  mimeField: z.string().default('mime'),
  parentField: z.string().default('parentId'),
  sizeField: z.string().default('size'),
  countField: z.string().default('count'),
  modifiedField: z.string().default('modified'),
  starredField: z.string().default('starred'),
  urlField: z.string().default('url'),
  /** Root breadcrumb label ("Files"). */
  rootLabel: z.string().optional(),
  breadcrumbLabel: z.string().optional(),
  gridViewLabel: z.string().optional(),
  listViewLabel: z.string().optional(),
  nameHeader: z.string().optional(),
  sizeHeader: z.string().optional(),
  modifiedHeader: z.string().optional(),
  starLabel: z.string().optional(),
  itemsLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type FileBrowserConfig = z.infer<typeof fileBrowserConfigSchema>;

const FOLDER_NAMES = ['Projects', 'Design Assets', 'Contracts', 'Site Photos', 'Reports', 'Archive'] as const;
const CHILD_FOLDER_NAMES = ['Coastal Beach House', 'Lakeside Villa', 'Hillside Cabin', 'Harbour Loft'] as const;
const FILE_NAMES = [
  { name: 'Q3 Report.pdf', type: 'pdf', size: 2_400_000 },
  { name: 'Budget 2026.xlsx', type: 'sheet', size: 820_000 },
  { name: 'Brand Guide.pdf', type: 'pdf', size: 5_100_000 },
  { name: 'Kickoff Deck.key', type: 'doc', size: 18_000_000 },
  { name: 'Logo Variants.zip', type: 'archive', size: 42_000_000 },
  { name: 'Hero Render.png', type: 'image', size: 8_200_000 },
  { name: 'Moodboard.png', type: 'image', size: 3_700_000 },
  { name: 'Floor Plan - Rev C.pdf', type: 'pdf', size: 5_100_000 },
  { name: 'Project Timeline.xlsx', type: 'sheet', size: 340_000 },
  { name: 'Walkthrough.mp4', type: 'video', size: 128_000_000 },
  { name: 'schema.sql', type: 'code', size: 24_000 },
  { name: 'Site Notes.md', type: 'doc', size: 8_400 },
] as const;

/** ISO timestamp `days` before the fixed demo epoch (never `Date.now()`). */
function daysBeforeEpoch(days: number): string {
  return new Date(MEDIA_DEMO_EPOCH - days * 86_400_000).toISOString();
}

/**
 * Deterministic `record-list` of file/folder rows with a self-FK hierarchy
 * (04 §7.7) — three root folders, each with a couple of children, plus root
 * files, so the breadcrumb walk and the folder-first sort both have something to
 * chew on. Canonical §3 `{ rows, total }` envelope.
 */
export function fileBrowserDemoData(seed: number): { rows: Record<string, unknown>[]; total: number } {
  const random = mulberry32(seed || 1);
  const rows: Record<string, unknown>[] = [];

  const rootFolders = FOLDER_NAMES.slice(0, 3 + Math.floor(random() * 2));
  rootFolders.forEach((name, index) => {
    rows.push({
      id: `folder-${index + 1}`,
      name,
      type: 'folder',
      parentId: null,
      count: 0, // backfilled below from the real child count
      modified: daysBeforeEpoch(2 + Math.floor(random() * 20)),
      starred: false,
    });
  });

  // Children of the first folder — gives the breadcrumb a second level.
  const firstFolderId = 'folder-1';
  const childCount = 1 + Math.floor(random() * 2);
  for (let index = 0; index < childCount; index += 1) {
    rows.push({
      id: `folder-child-${index + 1}`,
      name: CHILD_FOLDER_NAMES[index] ?? `Subfolder ${index + 1}`,
      type: 'folder',
      parentId: firstFolderId,
      count: 0,
      modified: daysBeforeEpoch(1 + Math.floor(random() * 14)),
      starred: false,
    });
  }

  // Walk FILE_NAMES from a seeded offset rather than sampling with replacement:
  // `fileCount` never exceeds the catalogue, so every filename stays unique and
  // the browser never shows two identical names in one folder.
  const fileCount = 6 + Math.floor(random() * 4);
  const nameOffset = Math.floor(random() * FILE_NAMES.length);
  for (let index = 0; index < fileCount; index += 1) {
    const file = FILE_NAMES[(nameOffset + index) % FILE_NAMES.length] as (typeof FILE_NAMES)[number];
    // Two thirds at the root, the rest inside the first folder.
    const parentId = random() < 0.66 ? null : firstFolderId;
    rows.push({
      id: `file-${index + 1}`,
      name: file.name,
      type: file.type,
      parentId,
      size: Math.round(file.size * (0.6 + random() * 0.8)),
      modified: daysBeforeEpoch(Math.floor(random() * 30)),
      starred: random() < 0.25,
      url: `/files/${file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`,
    });
  }

  // Backfill folder child counts so the tile meta ("12 items") is truthful.
  for (const row of rows) {
    if (row.type !== 'folder') continue;
    row.count = rows.filter((candidate) => candidate.parentId === row.id).length;
  }

  return { rows, total: rows.length };
}

// ── upload-dropzone (annex §8) ──────────────────────────────────────────────

export const uploadDropzoneConfigSchema = widgetSharedConfigSchema.extend({
  /** Comma-separated `accept` for the file input (".pdf,.png" / "image/*"). */
  accept: z.string().optional(),
  /** Max size per file, in bytes — rendered in the hint and enforced on pick. */
  maxSize: z.number().int().positive().optional(),
  multiple: z.boolean().default(true),
  disabled: z.boolean().default(false),
  dropTitle: z.string().optional(),
  browsePrefix: z.string().optional(),
  browseLabel: z.string().optional(),
  hint: z.string().optional(),
});
export type UploadDropzoneConfig = z.infer<typeof uploadDropzoneConfigSchema>;

/**
 * `upload-dropzone` has NO data contract (annex §8: "none (emits files);
 * constraints from config") — it is a `static`-shape widget whose entire payload
 * is its config. `demoData` is therefore intentionally SEED-INVARIANT: there is
 * no sample to draw. Registered as such in `qa/determinism.test.ts`'s
 * `SEED_INVARIANT_IDS`, which asserts every seed yields byte-identical output —
 * so a future "seeded" rewrite of this generator fails the gate rather than
 * silently drifting.
 */
export function uploadDropzoneDemoData(): { value: null } {
  return { value: null };
}

// ── upload-progress-list (annex §8) ─────────────────────────────────────────

/** Job status vocabulary (annex §8: %, Done, Failed/Retry). */
export const UPLOAD_STATUSES = ['queued', 'uploading', 'done', 'failed'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const uploadProgressListConfigSchema = widgetSharedConfigSchema.extend({
  /** Show a Retry action on failed rows (annex §8 `retryable`). */
  retryable: z.boolean().default(true),
  /** Show a Download action on done rows (annex §8 `downloadable`). */
  downloadable: z.boolean().default(false),
  /** Allow cancelling an in-flight row. */
  cancellable: z.boolean().default(false),
  // Field naming (04 §5) — generalizes to export-queue jobs.
  idField: z.string().default('id'),
  nameField: z.string().default('name'),
  pctField: z.string().default('pct'),
  statusField: z.string().default('status'),
  errorField: z.string().default('error'),
  typeField: z.string().default('type'),
  mimeField: z.string().default('mime'),
  /** Column carrying a finished job's artefact link (the Download action target). */
  urlField: z.string().default('url'),
  doneLabel: z.string().optional(),
  failedLabel: z.string().optional(),
  queuedLabel: z.string().optional(),
  retryLabel: z.string().optional(),
  downloadLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type UploadProgressListConfig = z.infer<typeof uploadProgressListConfigSchema>;

const JOB_NAMES = [
  'Q4 Report.pdf',
  'Hero Render.png',
  'Contract - signed.pdf',
  'customers-export.csv',
  'Walkthrough.mp4',
  'Logo Variants.zip',
  'schema-dump.sql',
] as const;

/**
 * Deterministic job `record-list` (04 §7.7) covering every status branch so the
 * loaded state always exercises the done / in-flight / failed / queued rows.
 */
export function uploadProgressListDemoData(seed: number): { rows: Record<string, unknown>[]; total: number } {
  const random = mulberry32(seed || 1);
  const statuses: UploadStatus[] = ['done', 'uploading', 'failed', 'queued', 'uploading'];
  const nameOffset = Math.floor(random() * JOB_NAMES.length);
  const rows = statuses.map((status, index) => ({
    id: `job-${index + 1}`,
    name: JOB_NAMES[(nameOffset + index) % JOB_NAMES.length] as string,
    status,
    pct: status === 'done' ? 100 : status === 'queued' ? 0 : Math.floor(random() * 90) + 5,
    error: status === 'failed' ? 'Network error — the connection dropped mid-upload.' : undefined,
    url: status === 'done' ? `/uploads/job-${index + 1}` : undefined,
  }));
  return { rows, total: rows.length };
}

// ── attachment-list (annex §8) ──────────────────────────────────────────────

/** Row actions the list may reveal on hover (annex §8 `actions`). */
export const ATTACHMENT_ACTIONS = ['download', 'delete'] as const;

export const attachmentListConfigSchema = widgetSharedConfigSchema.extend({
  actions: z.array(z.enum(ATTACHMENT_ACTIONS)).default(['download']),
  typeIconMap: z.record(z.string(), z.string()).optional(),
  idField: z.string().default('id'),
  nameField: z.string().default('name'),
  sizeField: z.string().default('size'),
  typeField: z.string().default('type'),
  mimeField: z.string().default('mime'),
  urlField: z.string().default('url'),
  /** Cap the rows rendered (a detail-page rail, not a full browser). */
  limit: z.number().int().min(1).max(50).default(8),
  downloadLabel: z.string().optional(),
  deleteLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type AttachmentListConfig = z.infer<typeof attachmentListConfigSchema>;

const ATTACHMENT_FILES = [
  { name: 'Site Survey.pdf', type: 'pdf', size: 2_100_000 },
  { name: 'Material Costs.xlsx', type: 'sheet', size: 640_000 },
  { name: 'Elevation Sketches.png', type: 'image', size: 3_700_000 },
  { name: 'Permit Application.pdf', type: 'pdf', size: 1_200_000 },
  { name: 'Reference Photos.zip', type: 'archive', size: 24_000_000 },
  { name: 'Meeting Notes.md', type: 'doc', size: 6_200 },
] as const;

/** Deterministic attachment `record-list` (04 §7.7). */
export function attachmentListDemoData(seed: number): { rows: Record<string, unknown>[]; total: number } {
  const random = mulberry32(seed || 1);
  const count = 4 + Math.floor(random() * 3);
  const rows = Array.from({ length: count }, (_, index) => {
    const file = ATTACHMENT_FILES[index % ATTACHMENT_FILES.length] as (typeof ATTACHMENT_FILES)[number];
    return {
      id: `att-${index + 1}`,
      name: file.name,
      type: file.type,
      size: Math.round(file.size * (0.5 + random())),
      url: `/attachments/att-${index + 1}`,
    };
  });
  return { rows, total: rows.length };
}

// ── image-board (annex §8) ──────────────────────────────────────────────────

export const imageBoardConfigSchema = widgetSharedConfigSchema.extend({
  columns: z.number().int().min(1).max(6).default(2),
  editableCaptions: z.boolean().default(false),
  /** Show the trailing "Add image" droppable slot. */
  allowAdd: z.boolean().default(false),
  idField: z.string().default('id'),
  imageField: z.string().default('imageUrl'),
  captionField: z.string().default('caption'),
  placeholderField: z.string().default('placeholder'),
  addLabel: z.string().optional(),
  captionLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ImageBoardConfig = z.infer<typeof imageBoardConfigSchema>;

const IMAGE_CAPTIONS = [
  'Living room — textured wool bouclé',
  'Ottoman — natural oak base',
  'Kitchen — matte stone worktop',
  'Bedroom — linen headboard',
  'Hallway — brushed brass fittings',
  'Terrace — weathered teak decking',
] as const;

/**
 * Deterministic moodboard `record-list` (04 §7.7). Some slots are EMPTY (no
 * `imageUrl`) on purpose — the annex's droppable placeholder slot is a first-class
 * state, so demo/VRT captures must show it.
 */
export function imageBoardDemoData(seed: number): { rows: Record<string, unknown>[]; total: number } {
  const random = mulberry32(seed || 1);
  const count = 4 + Math.floor(random() * 3);
  const rows = Array.from({ length: count }, (_, index) => {
    const filled = random() < 0.7;
    return {
      id: `img-${index + 1}`,
      imageUrl: filled ? `/media/reference-${index + 1}.jpg` : undefined,
      caption: IMAGE_CAPTIONS[index % IMAGE_CAPTIONS.length],
      placeholder: 'Drop reference',
    };
  });
  return { rows, total: rows.length };
}

// ── link-list (annex §8) ────────────────────────────────────────────────────

export const linkListConfigSchema = widgetSharedConfigSchema.extend({
  /** Editable variant: inline add-composer + hover delete (annex §8). */
  editable: z.boolean().default(false),
  idField: z.string().default('id'),
  titleField: z.string().default('title'),
  urlField: z.string().default('url'),
  /** Open links in a new tab (`rel="noreferrer"` is always applied). */
  newTab: z.boolean().default(true),
  addLabel: z.string().optional(),
  titlePlaceholder: z.string().optional(),
  urlPlaceholder: z.string().optional(),
  submitLabel: z.string().optional(),
  deleteLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type LinkListConfig = z.infer<typeof linkListConfigSchema>;

const DEMO_LINKS = [
  { title: 'Material supplier catalogue', url: 'https://supply.example.com/catalogue/interior' },
  { title: 'Planning portal — application', url: 'https://planning.example.gov/apps/8kd93m2q' },
  { title: 'Shared drive — site photos', url: 'https://drive.example.com/folders/site-photos' },
  { title: 'Contractor quote (v3)', url: 'https://quotes.example.com/q/4821' },
  { title: 'Colour reference board', url: 'https://refs.example.com/boards/palette' },
] as const;

/** Deterministic reference-link `record-list` (04 §7.7). */
export function linkListDemoData(seed: number): { rows: Record<string, unknown>[]; total: number } {
  const random = mulberry32(seed || 1);
  const count = 3 + Math.floor(random() * 3);
  const start = Math.floor(random() * DEMO_LINKS.length);
  const rows = Array.from({ length: count }, (_, index) => {
    const link = DEMO_LINKS[(start + index) % DEMO_LINKS.length] as (typeof DEMO_LINKS)[number];
    return { id: `link-${index + 1}`, title: link.title, url: link.url };
  });
  return { rows, total: rows.length };
}
