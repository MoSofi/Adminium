// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The file field and the grid's file chip, drawn
 * (38-files-library-and-attachments.md 38-T05; closes 27-T50).
 *
 * ─── Why these did not exist ───────────────────────────────────────────────
 *
 * 37 shipped `FileField` and the grid chip and neither was ever drawn in
 * Storybook: `families/tables/demo-data.ts` has no file column, `DataGrid`'s
 * stories carry no `file` block, and no story anywhere referenced the chip. So
 * two things were true at once — the a11y sweep reported zero violations for
 * this feature, and it had never rendered a pixel of it (27-T50, 27-T58's
 * second half). A baseline over nothing is not a baseline.
 *
 * `tags: ['vrt']` opts these into the Playwright matrix
 * (packages/ui/vrt/vrt.spec.ts): {light,dark} × {ltr,rtl}. Baselines are
 * Linux-only — capture with `pnpm vrt:update` in the CI container.
 *
 * ─── What each story is for ────────────────────────────────────────────────
 *
 * `SingleFile` is the REGRESSION guard: 37's control, unchanged, so a diff
 * here means the list work moved something it should not have.
 * `MultipleFiles` and `MultipleAtCap` are 38's new control in its two
 * interesting states. `GridChips` draws the cell in all three of its shapes —
 * a thumbnail, a chip, and a list with its `+N` badge — because those are what
 * a row actually shows and none had ever been screenshotted.
 *
 * NO TRANSPORT IS WIRED. `upload` is a promise that never settles, which is
 * exactly right for a screenshot: the control renders its resting state, and
 * nothing here depends on a server.
 */
import type { ReactNode } from 'react';

import { CellValue, type ResolvedFile } from '../../families/tables/cells.js';
import { gridColumnSpecSchema, type GridColumnSpec } from '../../families/tables/column-spec.js';
import { FileField } from './FileField.js';

const meta = {
  title: 'Templates/Page CRUD/Files',
  tags: ['vrt'],
};
export default meta;

const column = (over: Partial<GridColumnSpec> = {}): GridColumnSpec =>
  gridColumnSpecSchema.parse({
    name: 'attachments',
    label: 'Attachments',
    logicalType: 'text',
    semantic: 'file-ref',
    ...over,
  });

const file = (id: string, filename: string, over: Partial<ResolvedFile> = {}): ResolvedFile => ({
  id,
  filename,
  mime: 'application/pdf',
  sizeBytes: 8_412,
  contentPath: `/api/v1/files/${id}/content`,
  ...over,
});

const A = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD';
const B = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCE';
const C = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCF';

/** Never settles — the field's resting state is what is being drawn. */
const pending = () => new Promise<never>(() => undefined);

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Frame({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex max-w-lg flex-col gap-5 bg-surface p-4 text-fg">{children}</div>;
}

/** 37's single-value control. A diff here is a regression, not a change. */
export function SingleFile(): ReactNode {
  const spec = column({ name: 'pdf_url', label: 'PDF', file: { ref: 'url' } });
  return (
    <Frame>
      <Row label="Empty">
        <FileField column={spec} value={null} onChange={() => undefined} upload={pending as never} />
      </Row>
      <Row label="Holding a file">
        <FileField
          column={spec}
          value={A}
          onChange={() => undefined}
          upload={pending as never}
          resolved={file(A, 'invoice-1042.pdf')}
        />
      </Row>
      <Row label="Holding a value nothing resolved (a foreign link)">
        <FileField
          column={spec}
          value="https://someone-elses-cdn.example.com/legacy.pdf"
          onChange={() => undefined}
          upload={pending as never}
          resolved={null}
        />
      </Row>
    </Frame>
  );
}

/** 38's list control (D19). */
export function MultipleFiles(): ReactNode {
  const spec = column({ file: { ref: 'id', multiple: true } });
  const resolvedByRef = new Map<string, ResolvedFile | null>([
    [A, file(A, 'contract.pdf')],
    [B, file(B, 'receipt.pdf', { sizeBytes: 240_000 })],
    [C, null],
  ]);
  return (
    <Frame>
      <Row label="Empty">
        <FileField column={spec} value={null} onChange={() => undefined} upload={pending as never} />
      </Row>
      <Row label="Three entries, one of them unresolved">
        <FileField
          column={spec}
          value={JSON.stringify([A, B, C])}
          onChange={() => undefined}
          upload={pending as never}
          resolvedByRef={resolvedByRef}
        />
      </Row>
    </Frame>
  );
}

/** At `maxCount`: Add is disabled and the reason is on screen, not implied. */
export function MultipleAtCap(): ReactNode {
  const spec = column({ file: { ref: 'id', multiple: true, maxCount: 2 } });
  return (
    <Frame>
      <Row label="At the cap">
        <FileField
          column={spec}
          value={JSON.stringify([A, B])}
          onChange={() => undefined}
          upload={pending as never}
          resolvedByRef={
            new Map<string, ResolvedFile | null>([
              [A, file(A, 'contract.pdf')],
              [B, file(B, 'receipt.pdf')],
            ])
          }
        />
      </Row>
    </Frame>
  );
}

/**
 * The grid cell, in the three shapes a row can show (37 D24, 38 D20).
 *
 * The thumbnail is a real data URI rather than a network image: the dashboard's
 * CSP is `default-src 'self'` and a story that fetched a remote image would
 * screenshot a broken icon in CI.
 *
 * NOTE THE TRAILING `#`, which is load-bearing. `FileCell` renders the inline
 * thumbnail as `src={`${file.contentPath}?inline=1`}` — correct for the server
 * path it always holds in production, and fatal to a data URI, because the
 * appended `?inline=1` is parsed as part of the base64 payload and the decode
 * fails. Terminating the URI with `#` puts the suffix in the FRAGMENT, which a
 * data URI ignores. Without it this story screenshots the broken icon the
 * paragraph above says it exists to avoid — which is how it was first captured.
 *
 * The pixels are a two-tone check rather than 37's 1×1 transparent pixel: at
 * `size-10` with `object-cover`, a transparent source renders as an empty
 * bordered box, indistinguishable in a screenshot from a thumbnail that failed
 * to draw. A baseline has to be able to tell those apart.
 */
export function GridChips(): ReactNode {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAHElEQVR42mNQTX4NR7df/YMjBipKIHOQFVFRAgCJtIbBdZZjDAAAAABJRU5ErkJggg==#';
  const single = column({ name: 'pdf_url', file: { ref: 'id' } });
  const image = column({ name: 'logo_url', file: { ref: 'id', inline: true } });
  const list = column({ file: { ref: 'id', multiple: true } });
  return (
    <Frame>
      <Row label="A chip">
        <CellValue
          column={single}
          row={{ pdf_url: A }}
          context={{ files: new Map([[A, file(A, 'invoice-1042.pdf')]]) }}
        />
      </Row>
      <Row label="An inline thumbnail (small raster image)">
        <CellValue
          column={image}
          row={{ logo_url: B }}
          context={{
            files: new Map([
              [B, file(B, 'logo.png', { mime: 'image/png', sizeBytes: 12_000, contentPath: PNG })],
            ]),
          }}
        />
      </Row>
      <Row label="A list: the first file and a count of the rest">
        <CellValue
          column={list}
          row={{ attachments: JSON.stringify([A, B, C]) }}
          context={{
            files: new Map([
              [A, file(A, 'contract.pdf')],
              [B, file(B, 'receipt.pdf')],
              [C, file(C, 'terms.pdf')],
            ]),
          }}
        />
      </Row>
    </Frame>
  );
}
