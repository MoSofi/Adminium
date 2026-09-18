// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The `file` field kind, the grid chip, and the generation
 * seeding.
 *
 * THE ASSERTION THAT CARRIES THE MOST WEIGHT is the one about ABSENCE: a
 * column without a `file` block, and a page without a `files` adapter, must
 * render byte-identically to what they rendered before this feature existed.
 * That is D14's whole rule — it is what lets the block ship without moving a
 * single VRT baseline — and it is the kind of promise that quietly stops being
 * true.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CellValue, type ResolvedFile } from '../../families/tables/cells.js';
import { gridColumnSpecSchema, type GridColumnSpec } from '../../families/tables/column-spec.js';
import { FileField } from './FileField.js';
import { controlForColumn } from './field-mapping.js';

afterEach(cleanup);

const column = (over: Partial<GridColumnSpec> = {}): GridColumnSpec =>
  gridColumnSpecSchema.parse({
    name: 'pdf_url',
    label: 'PDF',
    logicalType: 'text',
    semantic: 'file-ref',
    ...over,
  });

const resolved = (over: Partial<ResolvedFile> = {}): ResolvedFile => ({
  id: 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD',
  filename: 'inv-1042.pdf',
  mime: 'application/pdf',
  sizeBytes: 8_412,
  contentPath: '/api/v1/files/file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD/content',
  ...over,
});

describe('controlForColumn — the block is the only trigger (D14)', () => {
  it('returns the attachments look when a column carries a file block', () => {
    expect(controlForColumn(column({ file: { ref: 'url' } }))).toBe('attachments');
  });

  it('does NOT return `file` for the semantic tag alone', () => {
    // `file-ref` and `image-url` have been on every generated page since M5 and
    // drive a `url` input. Honouring the TAG would change how every stored page
    // renders, including pages a person has edited.
    // Unbounded text with no block is a textarea by the rule that predates
    // this feature — the point is only that it is not `file`.
    expect(controlForColumn(column({ semantic: 'file-ref' }))).toBe('textarea');
    expect(controlForColumn(column({ semantic: 'image-url' }))).toBe('url');
  });

  it('leaves the earlier branches alone', () => {
    // A file block cannot claim a column an earlier rule owns — a readonly or
    // server-managed column stays what it was.
    expect(controlForColumn(column({ file: { ref: 'url' }, readOnly: true }))).toBe('readonly');
    expect(controlForColumn(column({ file: { ref: 'url' }, semantic: 'created-at' }))).toBe('hidden');
  });
});

describe('FileField', () => {
  it('falls back to the plain input with no upload adapter', () => {
    render(<FileField column={column({ file: { ref: 'url' } })} value="" onChange={() => undefined} />);
    // No transport ⇒ exactly the control this column had before its block.
    expect(document.querySelector('[data-part="file-field-fallback"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /choose a file/i })).toBeNull();
  });

  it('uploads on selection, reports progress, and hands back the SERVER’s ref', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    let report: ((fraction: number) => void) | null = null;
    const upload = vi.fn(async ({ onProgress }: { onProgress: (fraction: number) => void }) => {
      report = onProgress;
      onProgress(0.5);
      return { ref: 'https://admin.example.com/api/v1/files/file_X/content', file: resolved() };
    });

    render(
      <FileField
        column={column({ file: { ref: 'url' } })}
        value=""
        onChange={onChange}
        upload={upload as never}
      />,
    );

    const picker = document.querySelector('input[type="file"]');
    expect(picker).not.toBeNull();
    await user.upload(picker as HTMLInputElement, new File(['%PDF-1.7'], 'inv.pdf', { type: 'application/pdf' }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('https://admin.example.com/api/v1/files/file_X/content');
    });
    expect(report).not.toBeNull();
    // The upload happens BEFORE Save (see the component header): the form now
    // holds a plain text value like any other field.
    expect(upload).toHaveBeenCalledOnce();
  });

  it('refuses an over-size file before a byte leaves the browser', async () => {
    const user = userEvent.setup();
    const upload = vi.fn();
    render(
      <FileField
        column={column({ file: { ref: 'url' } })}
        value=""
        onChange={() => undefined}
        upload={upload as never}
        maxBytes={4}
      />,
    );
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['%PDF-1.7 and more'], 'big.pdf', { type: 'application/pdf' }),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    // Courtesy, not the boundary — but it must not spend the request.
    expect(upload).not.toHaveBeenCalled();
  });

  it('surfaces a failed upload and lets the same file be retried', async () => {
    const user = userEvent.setup();
    const upload = vi.fn().mockRejectedValue(new Error('That file type is not accepted: image/png.'));
    render(
      <FileField column={column({ file: { ref: 'url' } })} value="" onChange={() => undefined} upload={upload as never} />,
    );
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(picker, new File(['x'], 'logo.png', { type: 'image/png' }));

    expect((await screen.findByRole('alert')).textContent).toContain('not accepted');
    // The picker's value is cleared on change, so choosing the SAME file again
    // still fires — without that the retry path is dead.
    await user.upload(picker, new File(['x'], 'logo.png', { type: 'image/png' }));
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('clears the column when the value is removed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FileField
        column={column({ file: { ref: 'url' } })}
        value="https://admin.example.com/api/v1/files/file_X/content"
        onChange={onChange}
        upload={vi.fn() as never}
        resolved={resolved()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /remove file/i }));
    // `null`, not '': the reconcile hook reads a cleared value as "trash the
    // file this column used to name".
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows an unresolved value verbatim rather than hiding it', () => {
    render(
      <FileField
        column={column({ file: { ref: 'url' } })}
        value="https://someone-elses-cdn.example.com/legacy.pdf"
        onChange={() => undefined}
        upload={vi.fn() as never}
        resolved={null}
      />,
    );
    // A foreign URL in a file column is still the column's value, and the
    // column's value is the truth.
    expect(screen.getByText('https://someone-elses-cdn.example.com/legacy.pdf')).toBeTruthy();
  });
});

describe('the grid chip', () => {
  const row = { pdf_url: 'https://admin.example.com/api/v1/files/file_X/content' };

  it('renders today’s plain link when nothing resolved', () => {
    const { container } = render(
      <CellValue column={column({ semantic: 'url', file: { ref: 'url' } })} row={row} context={{}} />,
    );
    // An unresolved value is a foreign URL or an unreadable file, and both look
    // the same from here — exactly what the column rendered before.
    expect(container.querySelector('[data-part="cell-url"]')).not.toBeNull();
    expect(container.querySelector('[data-part="cell-file"]')).toBeNull();
  });

  it('renders a chip with the filename and size once resolved', () => {
    const { container } = render(
      <CellValue
        column={column({ file: { ref: 'url' } })}
        row={row}
        context={{ files: new Map([[row.pdf_url, resolved()]]) }}
      />,
    );
    const chip = container.querySelector('[data-part="cell-file"]');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('href')).toBe('/api/v1/files/file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD/content');
    expect(chip?.textContent).toContain('inv-1042.pdf');
    expect(container.querySelector('[data-part="cell-file-size"]')?.textContent).toBe('8.2 KB');
  });

  it('renders a SAME-ORIGIN thumbnail for a small inline image, and a chip past the cap', () => {
    const image = resolved({ filename: 'logo.png', mime: 'image/png', sizeBytes: 12_000 });
    const spec = column({ name: 'logo_url', file: { ref: 'url', inline: true } });
    const imageRow = { logo_url: row.pdf_url };

    const small = render(
      <CellValue column={spec} row={imageRow} context={{ files: new Map([[row.pdf_url, image]]) }} />,
    );
    const img = small.container.querySelector('img');
    expect(img).not.toBeNull();
    // NEVER a destination's public URL: the dashboard's CSP is
    // `default-src 'self'` and a cross-origin <img> is blocked outright (D24).
    expect(img?.getAttribute('src')).toBe(`${image.contentPath}?inline=1`);
    expect(img?.getAttribute('loading')).toBe('lazy');

    const large = render(
      <CellValue
        column={spec}
        row={imageRow}
        context={{
          files: new Map([[row.pdf_url, { ...image, sizeBytes: 12_000_000 }]]),
          thumbnailMaxBytes: 2_097_152,
        }}
      />,
    );
    // There is no server-side resizing (D39), so the cap is what stops a 40 px
    // box from downloading twelve megabytes.
    expect(large.container.querySelector('img')).toBeNull();
    expect(large.container.querySelector('[data-part="cell-file"]')).not.toBeNull();
  });

  it('ignores resolved files on a column with NO block', () => {
    const { container } = render(
      <CellValue
        column={column({ semantic: 'url' })}
        row={row}
        context={{ files: new Map([[row.pdf_url, resolved()]]) }}
      />,
    );
    // The block is the only trigger. A page that never opted in renders
    // byte-identically even when the host resolved the value anyway.
    expect(container.querySelector('[data-part="cell-file"]')).toBeNull();
    expect(container.querySelector('[data-part="cell-url"]')).not.toBeNull();
  });
});

/**
 * The `multiple` column.
 *
 * The owner's ask was "upload the files", plural, so a column holds a JSON
 * array of references and the field edits the list. Two things are easy to get
 * wrong here and both are silent: the value shape (a bare string where an
 * array belongs, or `'[]'` where `null` belongs), and the resolve keying —
 * chips are keyed by each ENTRY, not by the whole stored value, so a list
 * column handed only `resolved` would render every file as unresolved.
 */
describe('a multiple file column', () => {
  const listColumn = column({ file: { ref: 'id', multiple: true } });
  const A = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD';
  const B = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCE';

  const uploadOf = (...refs: string[]) => {
    let call = 0;
    return vi.fn(async ({ file }: { file: File }) => {
      const ref = refs[call++] ?? A;
      return { ref, file: resolved({ id: ref, filename: file.name }) };
    });
  };

  it('appends two picks into ONE array value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const upload = uploadOf(A, B);
    render(
      <FileField column={listColumn} value={null} onChange={onChange} upload={upload as never} />,
    );

    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, [
      new File(['%PDF-1.7'], 'one.pdf', { type: 'application/pdf' }),
      new File(['%PDF-1.7'], 'two.pdf', { type: 'application/pdf' }),
    ]);

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    // ONE change for the whole selection: calling per file would build the
    // second value from a `value` prop that had not re-rendered.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(JSON.stringify([A, B]));
  });

  it('accepts a multiple picker rather than one file at a time', () => {
    render(<FileField column={listColumn} value={null} onChange={vi.fn()} upload={vi.fn() as never} />);
    expect(document.querySelector('input[type="file"]')?.hasAttribute('multiple')).toBe(true);
  });

  it('renders one chip per entry, keyed by the entry and not by the whole value', () => {
    render(
      <FileField
        column={listColumn}
        value={JSON.stringify([A, B])}
        onChange={vi.fn()}
        upload={vi.fn() as never}
        resolvedByRef={
          new Map([
            [A, resolved({ id: A, filename: 'one.pdf' })],
            [B, resolved({ id: B, filename: 'two.pdf' })],
          ])
        }
      />,
    );
    expect(screen.getByText(/one\.pdf/)).toBeTruthy();
    expect(screen.getByText(/two\.pdf/)).toBeTruthy();
  });

  it('removes one entry and keeps the rest', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FileField
        column={listColumn}
        value={JSON.stringify([A, B])}
        onChange={onChange}
        upload={vi.fn() as never}
        resolvedByRef={
          new Map([
            [A, resolved({ id: A, filename: 'one.pdf' })],
            [B, resolved({ id: B, filename: 'two.pdf' })],
          ])
        }
      />,
    );
    await user.click(screen.getByRole('button', { name: /remove one\.pdf/i }));
    expect(onChange).toHaveBeenCalledWith(JSON.stringify([B]));
  });

  it('writes NULL when the last entry goes, never "[]"', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FileField
        column={listColumn}
        value={JSON.stringify([A])}
        onChange={onChange}
        upload={vi.fn() as never}
        resolvedByRef={new Map([[A, resolved({ id: A, filename: 'one.pdf' })]])}
      />,
    );
    await user.click(screen.getByRole('button', { name: /remove one\.pdf/i }));
    // The reconcile hook reads a cleared value as "trash what this column used
    // to name"; `'[]'` would be a second spelling of the same state.
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('reads a single legacy value as a list of one', () => {
    // A column made `multiple` after it already held one plain reference. No
    // migration runs, so the old value has to keep rendering.
    render(
      <FileField
        column={listColumn}
        value={A}
        onChange={vi.fn()}
        upload={vi.fn() as never}
        resolvedByRef={new Map([[A, resolved({ id: A, filename: 'legacy.pdf' })]])}
      />,
    );
    expect(screen.getByText(/legacy\.pdf/)).toBeTruthy();
  });

  it('stops offering Add at the cap and says why', () => {
    render(
      <FileField
        column={column({ file: { ref: 'id', multiple: true, maxCount: 2 } })}
        value={JSON.stringify([A, B])}
        onChange={vi.fn()}
        upload={vi.fn() as never}
      />,
    );
    expect(screen.getByRole('button', { name: /add files/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/at most 2 file/i)).toBeTruthy();
  });

  it('uploads only what fits, rather than spending requests it will refuse', async () => {
    const user = userEvent.setup();
    const upload = uploadOf(A, B);
    render(
      <FileField
        column={column({ file: { ref: 'id', multiple: true, maxCount: 1 } })}
        value={null}
        onChange={vi.fn()}
        upload={upload as never}
      />,
    );
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, [
      new File(['%PDF-1.7'], 'one.pdf', { type: 'application/pdf' }),
      new File(['%PDF-1.7'], 'two.pdf', { type: 'application/pdf' }),
    ]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('alert')).textContent).toMatch(/at most 1 file/i);
  });

  it('still renders the plain input with no transport', () => {
    // D14's absence rule holds for list columns too.
    render(<FileField column={listColumn} value={null} onChange={vi.fn()} />);
    expect(document.querySelector('[data-part="file-field-fallback"]')).not.toBeNull();
  });
});

describe('the grid chip for a list column', () => {
  const A = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD';
  const B = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCE';
  const C = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCF';
  const spec = column({ file: { ref: 'id', multiple: true } });

  it('shows the first file and counts the rest, naming them on hover', () => {
    const { container } = render(
      <CellValue
        column={spec}
        row={{ pdf_url: JSON.stringify([A, B, C]) }}
        context={{
          files: new Map([
            [A, resolved({ id: A, filename: 'one.pdf' })],
            [B, resolved({ id: B, filename: 'two.pdf' })],
            [C, resolved({ id: C, filename: 'three.pdf' })],
          ]),
        }}
      />,
    );
    expect(container.querySelector('[data-part="cell-file"]')?.textContent).toContain('one.pdf');
    const more = container.querySelector('[data-part="cell-file-more"]');
    expect(more?.textContent).toBe('+2');
    // A row is one line high; the names the badge stands for have to be
    // reachable without opening the record.
    expect(more?.getAttribute('title')).toBe('two.pdf, three.pdf');
  });

  it('shows no badge for a list of one', () => {
    const { container } = render(
      <CellValue
        column={spec}
        row={{ pdf_url: JSON.stringify([A]) }}
        context={{ files: new Map([[A, resolved({ id: A, filename: 'one.pdf' })]]) }}
      />,
    );
    expect(container.querySelector('[data-part="cell-file"]')).not.toBeNull();
    expect(container.querySelector('[data-part="cell-file-more"]')).toBeNull();
  });

  it('falls through to the old rendering when nothing in the list resolved', () => {
    const { container } = render(
      <CellValue
        column={column({ semantic: 'url', file: { ref: 'id', multiple: true } })}
        row={{ pdf_url: JSON.stringify(['https://someone-elses-cdn.example.com/x.pdf']) }}
        context={{ files: new Map() }}
      />,
    );
    expect(container.querySelector('[data-part="cell-file-list"]')).toBeNull();
    expect(container.querySelector('[data-part="cell-url"]')).not.toBeNull();
  });
});
