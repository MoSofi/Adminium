// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `lib/export.ts` is the file behind BOTH of the package's export controls —
 * WidgetHost's `capabilities.exportPng` kebab item and page-crud's bulk
 * Export button — and it shipped with no tests at all. Both controls were dead
 * UI before it existed, so these lock the behaviours that make them live:
 * byte-level CSV/JSON-lines compatibility with the server writer, the filename
 * slug (including the ReDoS-safe dash trim it is not allowed to regress into a
 * regex), and the SVG→PNG path's guards.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EXPORT_BOM,
  EXPORT_EXTENSIONS,
  EXPORT_MIME_TYPES,
  TABULAR_EXPORT_FORMATS,
  downloadFile,
  downloadRows,
  exportElementAsPng,
  exportFilename,
  findExportableGraphic,
  rasterizeSvg,
  rowsToCsv,
  rowsToJsonLines,
  serializeCsvField,
  serializeRows,
  serializeSvg,
} from './export.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('format vocabulary', () => {
  /**
   * The 422 guard. `xlsx` is in the §3.25 vocabulary but `POST /exports`
   * rejects it — no spreadsheet dependency exists in this repo — so neither
   * export control may ever offer it. This is the assertion that fails if
   * someone "completes" the vocabulary here.
   */
  it('offers csv and json only — never xlsx', () => {
    expect([...TABULAR_EXPORT_FORMATS]).toEqual(['csv', 'json']);
    expect(TABULAR_EXPORT_FORMATS).not.toContain('xlsx');
    expect(Object.keys(EXPORT_EXTENSIONS)).toEqual(['csv', 'json']);
    expect(Object.keys(EXPORT_MIME_TYPES)).toEqual(['csv', 'json']);
  });

  it('names the json artifact .jsonl, matching the export-run writer', () => {
    expect(EXPORT_EXTENSIONS.json).toBe('jsonl');
    expect(EXPORT_MIME_TYPES.json).toContain('application/x-ndjson');
  });
});

describe('serializeCsvField (RFC 4180, mirroring apps/server/src/data-io/csv.ts)', () => {
  it('leaves plain values unquoted', () => {
    expect(serializeCsvField('Initech')).toBe('Initech');
    expect(serializeCsvField(42)).toBe('42');
    expect(serializeCsvField(0)).toBe('0');
    expect(serializeCsvField(false)).toBe('false');
  });

  it('renders null and undefined as the empty field, not the word', () => {
    expect(serializeCsvField(null)).toBe('');
    expect(serializeCsvField(undefined)).toBe('');
  });

  it('quotes only on comma, quote, CR or LF', () => {
    expect(serializeCsvField('a,b')).toBe('"a,b"');
    expect(serializeCsvField('line\nbreak')).toBe('"line\nbreak"');
    expect(serializeCsvField('carriage\rreturn')).toBe('"carriage\rreturn"');
    // A bare space or semicolon is NOT a quoting trigger.
    expect(serializeCsvField('Stark Industries')).toBe('Stark Industries');
    expect(serializeCsvField('a;b')).toBe('a;b');
  });

  it('doubles embedded quotes', () => {
    expect(serializeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('serializes Dates as ISO and objects as JSON', () => {
    expect(serializeCsvField(new Date('2026-08-17T12:04:05.000Z'))).toBe('2026-08-17T12:04:05.000Z');
    // The JSON carries commas, so it comes back quoted.
    expect(serializeCsvField({ a: 1, b: 2 })).toBe('"{""a"":1,""b"":2}"');
  });
});

describe('rowsToCsv', () => {
  const columns = ['id', 'name', 'mrr'];

  it('emits a BOM, a header record, and one CRLF-terminated record per row', () => {
    const csv = rowsToCsv(columns, [
      { id: 1, name: 'Initech', mrr: '980' },
      { id: 2, name: 'Stark Industries', mrr: '6100' },
    ]);
    expect(csv).toBe(
      `${EXPORT_BOM}id,name,mrr\r\n1,Initech,980\r\n2,Stark Industries,6100\r\n`,
    );
  });

  it('prefixes the UTF-8 BOM so Excel does not mis-decode', () => {
    expect(EXPORT_BOM).toBe('﻿');
    expect(rowsToCsv(['a'], [])).toBe('﻿a\r\n');
  });

  it('projects strictly onto the given columns, blanking absent keys', () => {
    const csv = rowsToCsv(columns, [{ name: 'Orphan', secret: 'not exported' }]);
    expect(csv).toBe(`${EXPORT_BOM}id,name,mrr\r\n,Orphan,\r\n`);
    expect(csv).not.toContain('not exported');
  });

  it('quotes a value containing the delimiter so the record keeps its arity', () => {
    const csv = rowsToCsv(['name'], [{ name: 'Wayne, Bruce' }]);
    expect(csv).toBe(`${EXPORT_BOM}name\r\n"Wayne, Bruce"\r\n`);
  });
});

describe('rowsToJsonLines', () => {
  it('writes one LF-terminated projected object per line', () => {
    const jsonl = rowsToJsonLines(['id', 'name'], [
      { id: 1, name: 'Initech' },
      { id: 2, name: 'Stark' },
    ]);
    expect(jsonl).toBe('{"id":1,"name":"Initech"}\n{"id":2,"name":"Stark"}\n');
    // Every line is independently parseable — that is the point of JSON-lines.
    const lines = jsonl.split('\n').filter((line) => line !== '');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { id: 1, name: 'Initech' },
      { id: 2, name: 'Stark' },
    ]);
  });

  it('normalizes an absent column to null rather than dropping the key', () => {
    expect(rowsToJsonLines(['id', 'email'], [{ id: 1 }])).toBe('{"id":1,"email":null}\n');
  });

  it('drops columns outside the projection', () => {
    expect(rowsToJsonLines(['id'], [{ id: 1, secret: 'nope' }])).toBe('{"id":1}\n');
  });

  it('carries no BOM — it is a pipeline format, not a spreadsheet one', () => {
    expect(rowsToJsonLines(['id'], [{ id: 1 }]).startsWith(EXPORT_BOM)).toBe(false);
  });

  it('is empty for an empty row set (no header line)', () => {
    expect(rowsToJsonLines(['id'], [])).toBe('');
  });
});

describe('serializeRows', () => {
  const columns = ['id'];
  const rows = [{ id: 7 }];

  it('dispatches csv to rowsToCsv and json to rowsToJsonLines', () => {
    expect(serializeRows('csv', columns, rows)).toBe(rowsToCsv(columns, rows));
    expect(serializeRows('json', columns, rows)).toBe(rowsToJsonLines(columns, rows));
  });
});

describe('exportFilename', () => {
  const at = new Date('2026-08-17T12:04:05.000Z');

  it('slugs the table name and stamps it to the minute', () => {
    expect(exportFilename('public.customers', 'csv', at)).toBe('public.customers-20260817-1204.csv');
  });

  it('replaces runs of non-word characters with a single dash', () => {
    expect(exportFilename('my table  name', 'csv', at)).toBe('my-table-name-20260817-1204.csv');
  });

  it('trims leading and trailing dashes but leaves interior runs alone', () => {
    expect(exportFilename('---edge---', 'csv', at)).toBe('edge-20260817-1204.csv');
    // Interior runs are deliberately preserved — the trim is not a collapse.
    expect(exportFilename('a---b', 'csv', at)).toBe('a---b-20260817-1204.csv');
  });

  it('falls back to "export" when nothing survives the slug', () => {
    expect(exportFilename('///', 'csv', at)).toBe('export-20260817-1204.csv');
    expect(exportFilename('', 'csv', at)).toBe('export-20260817-1204.csv');
  });

  it('uses the extension it is handed', () => {
    expect(exportFilename('t', 'jsonl', at)).toBe('t-20260817-1204.jsonl');
    expect(exportFilename('t', 'png', at)).toBe('t-20260817-1204.png');
  });

  /**
   * Regression guard for js/polynomial-redos. The dash trim is an index walk,
   * NOT `.replaceAll(/^-+|-+$/g, '')` — under the regex a base of n trailing
   * dashes costs O(n^2) because `-+$` is retried from every start offset. This
   * asserts both halves of that fix: the result is identical to the regex's,
   * and a pathological input finishes in linear time rather than seconds.
   */
  it('trims a pathological dash run in linear time (no polynomial ReDoS)', () => {
    const pathological = '-'.repeat(80_000);
    const started = performance.now();
    expect(exportFilename(pathological, 'csv', at)).toBe('export-20260817-1204.csv');
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('matches the regex it replaced on ordinary inputs', () => {
    const legacy = (base: string) => base.replaceAll(/[^\w.-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'export';
    for (const base of ['public.customers', '---edge---', 'a---b', '///', '', 'my table  name', '_x_']) {
      expect(exportFilename(base, 'csv', at)).toBe(`${legacy(base)}-20260817-1204.csv`);
    }
  });
});

describe('downloadFile', () => {
  it('clicks a same-document anchor carrying the filename, then revokes the URL', () => {
    vi.useFakeTimers();
    const handed: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      handed.push(blob);
      return 'blob:fake';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
    const click = vi.fn();
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = realCreate(tag);
      if (tag === 'a') {
        (node as HTMLAnchorElement).click = click;
        created.push(node as HTMLAnchorElement);
      }
      return node;
    });

    downloadFile(new Blob(['x'], { type: 'text/csv' }), 'customers.csv');

    const anchor = created[0];
    expect(anchor).toBeDefined();
    expect(anchor?.getAttribute('href')).toBe('blob:fake');
    expect(anchor?.getAttribute('download')).toBe('customers.csv');
    expect(anchor?.rel).toBe('noopener');
    expect(click).toHaveBeenCalledOnce();
    // The anchor does not linger in the document.
    expect(document.querySelector('a')).toBeNull();

    // Safari drops the download if the object URL dies in the click's own
    // task, so the revoke is deferred by one turn — not skipped.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    vi.useRealTimers();
  });
});

describe('downloadRows', () => {
  it('serializes the selection and hands it over with the format-correct name and MIME', async () => {
    const handed: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      handed.push(blob);
      return 'blob:fake';
    });
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }));
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = realCreate(tag);
      if (tag === 'a') {
        (node as HTMLAnchorElement).click = vi.fn();
        created.push(node as HTMLAnchorElement);
      }
      return node;
    });

    downloadRows('csv', ['id', 'name'], [{ id: 1, name: 'Initech' }], 'public.customers');

    const blob = handed[0] as Blob;
    expect(blob.type).toBe(EXPORT_MIME_TYPES.csv);
    expect(await blob.text()).toBe(`${EXPORT_BOM}id,name\r\n1,Initech\r\n`);
    expect(created[0]?.getAttribute('download')).toMatch(/^public\.customers-\d{8}-\d{4}\.csv$/);
  });

  it('writes .jsonl with the ndjson MIME on the json format', async () => {
    const handed: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      handed.push(blob);
      return 'blob:fake';
    });
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }));
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const node = realCreate(tag);
      if (tag === 'a') {
        (node as HTMLAnchorElement).click = vi.fn();
        created.push(node as HTMLAnchorElement);
      }
      return node;
    });

    downloadRows('json', ['id'], [{ id: 1 }], 'public.customers');

    const blob = handed[0] as Blob;
    expect(blob.type).toBe(EXPORT_MIME_TYPES.json);
    expect(await blob.text()).toBe('{"id":1}\n');
    expect(created[0]?.getAttribute('download')).toMatch(/\.jsonl$/);
  });
});

// --- SVG → PNG ---------------------------------------------------------------

function mountSvg(markup: string): SVGSVGElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.append(host);
  return host.querySelector('svg') as SVGSVGElement;
}

describe('findExportableGraphic', () => {
  it('returns the first svg inside the frame', () => {
    const svg = mountSvg('<svg viewBox="0 0 100 50"><rect /></svg>');
    expect(findExportableGraphic(svg.parentElement)).toBe(svg);
  });

  it('is null-safe and returns null when the widget has no graphic', () => {
    expect(findExportableGraphic(null)).toBeNull();
    expect(findExportableGraphic(undefined)).toBeNull();
    const host = document.createElement('div');
    host.innerHTML = '<p>a table, not a chart</p>';
    expect(findExportableGraphic(host)).toBeNull();
  });
});

describe('serializeSvg', () => {
  it('produces standalone, namespaced markup sized from the viewBox when nothing is laid out', () => {
    const svg = mountSvg('<svg viewBox="0 0 320 180"><rect width="10" height="10" /></svg>');
    const serialized = serializeSvg(svg);
    // happy-dom lays nothing out (getBoundingClientRect is 0×0), so the
    // viewBox fallback is what runs here.
    expect(serialized.width).toBe(320);
    expect(serialized.height).toBe(180);
    expect(serialized.markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(serialized.markup).toContain('width="320"');
    expect(serialized.markup).toContain('height="180"');
  });

  it('never returns a zero dimension, even with no viewBox and no layout', () => {
    const serialized = serializeSvg(mountSvg('<svg><rect /></svg>'));
    expect(serialized.width).toBeGreaterThan(0);
    expect(serialized.height).toBeGreaterThan(0);
    // A missing viewBox is synthesized so the <img> has an aspect ratio.
    expect(serialized.markup).toContain('viewBox=');
  });

  it('does not mutate the live node it serializes', () => {
    const svg = mountSvg('<svg viewBox="0 0 100 50"><rect /></svg>');
    serializeSvg(svg);
    expect(svg.getAttribute('xmlns')).toBeNull();
    expect(svg.getAttribute('width')).toBeNull();
  });

  it('carries the graphic content through', () => {
    const serialized = serializeSvg(mountSvg('<svg viewBox="0 0 10 10"><text>Revenue</text></svg>'));
    expect(serialized.markup).toContain('Revenue');
  });
});

describe('rasterizeSvg', () => {
  const serialized = { markup: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', width: 10, height: 10 };

  it('throws a legible error when the environment has no 2D canvas', async () => {
    // happy-dom's getContext('2d') is null — exactly the guard's target.
    await expect(rasterizeSvg(serialized)).rejects.toThrow(/cannot rasterize/i);
  });

  it('draws at 2× by default and resolves the encoded PNG blob', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const context = { drawImage, fillRect, fillStyle: '' };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (cb: (b: Blob) => void) => cb(png) };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : realCreate(tag),
    );
    const sources: string[] = [];
    vi.stubGlobal(
      'Image',
      class {
        listeners: Record<string, () => void> = {};
        addEventListener(event: string, handler: () => void) {
          this.listeners[event] = handler;
        }
        set src(value: string) {
          sources.push(value);
          queueMicrotask(() => this.listeners['load']?.());
        }
      },
    );

    await expect(rasterizeSvg(serialized)).resolves.toBe(png);
    // scale: 2 — a 1× PNG is soft when pasted into a doc.
    expect(canvas.width).toBe(20);
    expect(canvas.height).toBe(20);
    expect(drawImage).toHaveBeenCalledOnce();
    // No background requested → nothing painted under the chart.
    expect(fillRect).not.toHaveBeenCalled();
    // URL-encoded, not base64: btoa throws on non-Latin-1 label text.
    expect(sources[0]).toContain('data:image/svg+xml;charset=utf-8,');
    expect(sources[0]).toContain(encodeURIComponent('<svg'));
  });

  it('paints the requested background under the chart and honours an explicit scale', async () => {
    const fillRect = vi.fn();
    const context = { drawImage: vi.fn(), fillRect, fillStyle: '' };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (cb: (b: Blob) => void) => cb(new Blob([], { type: 'image/png' })),
    };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : realCreate(tag),
    );
    vi.stubGlobal(
      'Image',
      class {
        listeners: Record<string, () => void> = {};
        addEventListener(event: string, handler: () => void) {
          this.listeners[event] = handler;
        }
        set src(_value: string) {
          queueMicrotask(() => this.listeners['load']?.());
        }
      },
    );

    await rasterizeSvg(serialized, { scale: 1, background: 'rgb(255, 255, 255)' });

    expect(canvas.width).toBe(10);
    expect(context.fillStyle).toBe('rgb(255, 255, 255)');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 10, 10);
  });

  it('rejects when the SVG cannot be decoded', async () => {
    const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: vi.fn() };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : realCreate(tag),
    );
    vi.stubGlobal(
      'Image',
      class {
        listeners: Record<string, () => void> = {};
        addEventListener(event: string, handler: () => void) {
          this.listeners[event] = handler;
        }
        set src(_value: string) {
          queueMicrotask(() => this.listeners['error']?.());
        }
      },
    );

    await expect(rasterizeSvg(serialized)).rejects.toThrow(/could not be decoded/i);
  });

  it('rejects when the encoder yields no blob', async () => {
    const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : realCreate(tag),
    );
    vi.stubGlobal(
      'Image',
      class {
        listeners: Record<string, () => void> = {};
        addEventListener(event: string, handler: () => void) {
          this.listeners[event] = handler;
        }
        set src(_value: string) {
          queueMicrotask(() => this.listeners['load']?.());
        }
      },
    );

    await expect(rasterizeSvg(serialized)).rejects.toThrow(/PNG encoding failed/i);
  });
});

describe('exportElementAsPng', () => {
  it('refuses a widget that has no graphic', async () => {
    const host = document.createElement('div');
    host.innerHTML = '<table><tbody><tr><td>no chart here</td></tr></tbody></table>';
    document.body.append(host);
    await expect(exportElementAsPng(host, 'Revenue')).rejects.toThrow(/no graphic to export/i);
  });

  it('rasterizes the frame’s svg and downloads it as a stamped .png', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (cb: (b: Blob) => void) => cb(png) };
    const anchors: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    const host = realCreate('div');
    host.innerHTML = '<svg viewBox="0 0 200 100"><rect /></svg>';
    document.body.append(host);

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return canvas as unknown as HTMLCanvasElement;
      const node = realCreate(tag);
      if (tag === 'a') {
        (node as HTMLAnchorElement).click = vi.fn();
        anchors.push(node as HTMLAnchorElement);
      }
      return node;
    });
    const handed: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      handed.push(blob);
      return 'blob:png';
    });
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }));
    vi.stubGlobal(
      'Image',
      class {
        listeners: Record<string, () => void> = {};
        addEventListener(event: string, handler: () => void) {
          this.listeners[event] = handler;
        }
        set src(_value: string) {
          queueMicrotask(() => this.listeners['load']?.());
        }
      },
    );

    await exportElementAsPng(host, 'Revenue by region');

    expect(createObjectURL).toHaveBeenCalledWith(png);
    expect(anchors[0]?.getAttribute('download')).toMatch(/^Revenue-by-region-\d{8}-\d{4}\.png$/);
  });
});
