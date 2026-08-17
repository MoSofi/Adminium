/**
 * File export — the one place `@adminium/widgets` turns what is on screen into
 * a file the browser downloads. Two callers, one policy:
 *
 * - WidgetHost's kebab raster item (labelled "Download" — "Export" is taken by
 *   the queued server run), offered only where the definition sets
 *   `capabilities.exportPng` (04 §2.1). Every chart in `@adminium/charts` is
 *   plain SVG (d3-scale/d3-shape, no canvas), so the raster path serializes
 *   the live node and draws it into a canvas — the package's dependency list
 *   stays closed (01 §2.3, .dependency-cruiser.cjs).
 * - `page-crud`'s bulk Export, whose format vocabulary is `csv`/`json` ONLY:
 *   `xlsx` is in the §3.25 vocabulary but the server rejects it with a 422
 *   (apps/server/src/routes/exports/index.ts — no spreadsheet dependency
 *   exists in this repo), so it is never offered. The selection bar itself
 *   ships one button and hands `csv` (`PageCrud.BULK_EXPORT_FORMAT`); `json`
 *   stays reachable through `CrudApi.export` and the Data exports page.
 *
 * Every entry point here touches the DOM and both callers reach it through a
 * dynamic `import()`: `apps/dashboard`'s entry-chunk ratchet counts the
 * `/p/$slug` route, and a rasterizer nobody has clicked yet has no business
 * in it (apps/dashboard/scripts/check-entry-budget.mjs).
 */

export const TABULAR_EXPORT_FORMATS = ['csv', 'json'] as const;
export type TabularExportFormat = (typeof TABULAR_EXPORT_FORMATS)[number];

/** `json` is JSON-lines, the artifact `export-run` writes (09 §11.2). */
export const EXPORT_EXTENSIONS: Record<TabularExportFormat, string> = { csv: 'csv', json: 'jsonl' };
export const EXPORT_MIME_TYPES: Record<TabularExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/x-ndjson;charset=utf-8',
};

/** Excel mis-decodes unmarked UTF-8 — the same BOM apps/server writes. */
export const EXPORT_BOM = '﻿';

const CRLF = '\r\n';
const CSV_NEEDS_QUOTING = /[",\r\n]/;

/**
 * One value → one RFC 4180 field, mirroring
 * `apps/server/src/data-io/csv.ts` so a browser-side export and a server-side
 * one of the same rows are byte-comparable: quote only on comma/quote/CR/LF,
 * double embedded quotes, null and undefined are the empty field.
 */
export function serializeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  return CSV_NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Header record + one CRLF-terminated record per row, BOM-prefixed. */
export function rowsToCsv(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const record = (values: readonly unknown[]): string => values.map(serializeCsvField).join(',') + CRLF;
  return EXPORT_BOM + record(columns) + rows.map((row) => record(columns.map((column) => row[column]))).join('');
}

/** JSON-lines: one projected object per line, LF-terminated. */
export function rowsToJsonLines(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  return rows
    .map((row) => {
      const projected: Record<string, unknown> = {};
      for (const column of columns) projected[column] = row[column] ?? null;
      return JSON.stringify(projected) + '\n';
    })
    .join('');
}

export function serializeRows(
  format: TabularExportFormat,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  return format === 'csv' ? rowsToCsv(columns, rows) : rowsToJsonLines(columns, rows);
}

/** `public.customers` + `csv` → `public.customers-20260817-1204.csv`. */
export function exportFilename(base: string, extension: string, now: Date = new Date()): string {
  const slug = base.replaceAll(/[^\w.-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'export';
  const stamp = now.toISOString().slice(0, 16).replaceAll(/[-:]/g, '').replace('T', '-');
  return `${slug}-${stamp}.${extension}`;
}

/** Hand a blob to the browser's download manager. */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Safari drops the download when the object URL dies in the click's own
  // task, so the revoke waits for the next one.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadRows(
  format: TabularExportFormat,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
  base: string,
): void {
  const blob = new Blob([serializeRows(format, columns, rows)], { type: EXPORT_MIME_TYPES[format] });
  downloadFile(blob, exportFilename(base, EXPORT_EXTENSIONS[format]));
}

// --- SVG → PNG ---------------------------------------------------------------

/**
 * The presentation properties the clone has to carry inline. An `<img>` built
 * from a data URL renders in its own document, where the page's stylesheet —
 * and therefore every Tailwind class and every `--token` the charts paint
 * with — does not exist; without this the raster comes out as black shapes.
 */
const INLINED_SVG_PROPERTIES = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
  'shape-rendering',
  'visibility',
] as const;

export interface SerializedSvg {
  /** Standalone markup: namespaced, sized, styles inlined. */
  markup: string;
  width: number;
  height: number;
}

/** Laid-out size, falling back to the viewBox when nothing has been measured. */
function svgSize(svg: SVGSVGElement): { width: number; height: number } {
  const rect = svg.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width > 0 && height > 0) return { width, height };
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const [, , boxWidth = 0, boxHeight = 0] = box;
  return {
    width: Number.isFinite(boxWidth) && boxWidth > 0 ? Math.round(boxWidth) : 1,
    height: Number.isFinite(boxHeight) && boxHeight > 0 ? Math.round(boxHeight) : 1,
  };
}

function inlineComputedStyles(source: Element, clone: Element): void {
  const view = source.ownerDocument.defaultView;
  if (view === null) return;
  const sources = [source, ...source.querySelectorAll('*')];
  const clones = [clone, ...clone.querySelectorAll('*')];
  for (const [index, node] of sources.entries()) {
    const target = clones[index];
    if (target === undefined) continue;
    const computed = view.getComputedStyle(node);
    let declarations = '';
    for (const property of INLINED_SVG_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value !== '') declarations += `${property}:${value};`;
    }
    if (declarations !== '') target.setAttribute('style', (target.getAttribute('style') ?? '') + declarations);
  }
}

/** Live `<svg>` → standalone markup an `<img>` can load. */
export function serializeSvg(svg: SVGSVGElement): SerializedSvg {
  const { width, height } = svgSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (clone.getAttribute('viewBox') === null) clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  return { markup: new XMLSerializer().serializeToString(clone), width, height };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('The chart SVG could not be decoded.')));
    image.src = source;
  });
}

export interface RasterizeOptions {
  /** Device-pixel multiplier; 2 keeps the PNG crisp when pasted at 1×. */
  scale?: number | undefined;
  /** Painted under the chart — a transparent PNG is unreadable in a doc. */
  background?: string | undefined;
}

export async function rasterizeSvg(serialized: SerializedSvg, options: RasterizeOptions = {}): Promise<Blob> {
  const scale = options.scale ?? 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(serialized.width * scale));
  canvas.height = Math.max(1, Math.round(serialized.height * scale));
  const context = canvas.getContext('2d');
  if (context === null || typeof canvas.toBlob !== 'function') {
    throw new Error('This browser cannot rasterize charts (no 2D canvas).');
  }
  // `encodeURIComponent` rather than base64: the markup carries whatever text
  // the data does, and `btoa` throws on anything outside Latin-1.
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized.markup)}`);
  if (options.background !== undefined) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('PNG encoding failed.'));
      else resolve(blob);
    }, 'image/png');
  });
}

/** The exportable graphic inside a widget body: its first `<svg>`. */
export function findExportableGraphic(root: Element | null | undefined): SVGSVGElement | null {
  return root?.querySelector('svg') ?? null;
}

/** Opaque card background, so the PNG reads the same as the card did. */
function backgroundOf(root: Element): string | undefined {
  const view = root.ownerDocument.defaultView;
  if (view === null) return undefined;
  const color = view.getComputedStyle(root).backgroundColor;
  return color === '' || color === 'transparent' || color.startsWith('rgba(0, 0, 0, 0') ? undefined : color;
}

/**
 * Rasterize the graphic inside `root` and hand the PNG to the browser.
 * Throws when the widget has nothing to rasterize or the environment has no
 * canvas — the caller decides how loud that is.
 */
export async function exportElementAsPng(root: Element, base: string): Promise<void> {
  const svg = findExportableGraphic(root);
  if (svg === null) throw new Error('This widget has no graphic to export.');
  const background = backgroundOf(root);
  const blob = await rasterizeSvg(serializeSvg(svg), background === undefined ? {} : { background });
  downloadFile(blob, exportFilename(base, 'png'));
}
