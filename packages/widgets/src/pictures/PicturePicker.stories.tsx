// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture column's field and the picker it opens, in the states a person
 * meets: empty, holding a picture, a picture no longer there, a link to
 * another site, several pictures at the most a record takes; and the picker's
 * two tabs (a kind the column does not take dimmed with its reason), its empty
 * and failed states.
 *
 * `tags: ['vrt']` opts these into the Playwright matrix ({light,dark} ×
 * {ltr,rtl}). Nothing is fetched: the pictures are drawn from inline SVG, and
 * an upload never settles, so each story is its resting state.
 */
import type { ReactNode } from 'react';

import type { ResolvedFile } from '../families/tables/cells.js';
import { gridColumnSpecSchema, type GridColumnSpec } from '../families/tables/column-spec.js';
import { FileField } from '../templates/page-crud/FileField.js';
import type { PictureChooser } from './PictureField.js';
import { PicturePicker, type PickerItem } from './PicturePicker.js';

const meta = {
  title: 'Templates/Page CRUD/Pictures',
  tags: ['vrt'],
};
export default meta;

const PICTURES = ['png', 'jpeg', 'webp', 'gif'];
const column = (over: Partial<GridColumnSpec> = {}): GridColumnSpec =>
  gridColumnSpecSchema.parse({ name: 'photo', label: 'Photo', logicalType: 'text', file: { ref: 'id', accept: PICTURES, maxBytes: 2 * 1024 * 1024 }, ...over });

/** A flat picture of one colour: what a tile and a thumbnail draw, with no request. */
const swatch = (fill: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${fill}"/><circle cx="44" cy="22" r="10" fill="#ffffff" fill-opacity="0.55"/></svg>`)}`;

const id = (n: number): string => `file_01M1Q2R3S4T5V6W7X8Y9Z0AB${String(n).padStart(2, '0')}`;
const file = (n: number, filename: string, fill: string, over: Partial<ResolvedFile> = {}): ResolvedFile => ({ id: id(n), filename, mime: 'image/jpeg', sizeBytes: 243_712, contentPath: swatch(fill), ...over });
const item = (n: number, filename: string, fill: string, recordLabel?: string, over: Partial<PickerItem> = {}): PickerItem => ({
  ...file(n, filename, fill),
  ...(recordLabel === undefined ? {} : { recordLabel }),
  ...over,
});

const USED = [item(1, 'wings.jpg', '#c2410c', 'Spicy wings'), item(2, 'burger.jpg', '#a16207', 'Classic burger'), item(3, 'fries.jpg', '#ca8a04', 'Loaded fries'), item(4, 'salad.jpg', '#15803d', 'Garden salad'), item(5, 'soup.jpg', '#b91c1c', 'Tomato soup')];
const LIBRARY = [item(6, 'crispy-hero.jpg', '#7c3aed'), item(7, 'menu-draft.pdf', '#64748b', undefined, { mime: 'application/pdf', sizeBytes: 1_200_000 })];

const pending = () => new Promise<never>(() => undefined);
const chooser: PictureChooser = { pageTitle: 'Dishes', tableLabel: 'Dishes', usedIn: async () => USED, library: async () => LIBRARY, copy: pending as never };

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Frame({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex max-w-xl flex-col gap-6 bg-surface p-4 text-fg">{children}</div>;
}

/** The field's states: empty, a picture, gone, a link to another site. */
export function PictureFieldStates(): ReactNode {
  const spec = column();
  return (
    <Frame>
      <Row label="Empty">
        <FileField variant="picture" column={spec} value={null} onChange={() => undefined} upload={pending as never} choose={chooser} />
      </Row>
      <Row label="Holding a picture">
        <FileField variant="picture" column={spec} value={id(1)} resolved={file(1, 'wings.jpg', '#c2410c')} onChange={() => undefined} upload={pending as never} choose={chooser} />
      </Row>
      <Row label="A picture no longer there">
        <FileField variant="picture" column={spec} value={id(9)} resolved={null} onChange={() => undefined} upload={pending as never} choose={chooser} />
      </Row>
      <Row label="A link to another site">
        <FileField variant="picture" column={spec} value="https://img.example.net/dishes/wings-2019.jpg" resolved={null} onChange={() => undefined} upload={pending as never} choose={chooser} />
      </Row>
      <Row label="No chooser: upload only">
        <FileField variant="picture" column={spec} value={null} onChange={() => undefined} upload={pending as never} />
      </Row>
    </Frame>
  );
}

/** A column that holds several pictures, at the most a record takes. */
export function PictureListAtCap(): ReactNode {
  const spec = column({ file: { ref: 'id', accept: PICTURES, multiple: true, maxCount: 3 } } as never);
  const refs = [id(1), id(2), id(3)];
  return (
    <Frame>
      <Row label="Three of three">
        <FileField
          variant="picture"
          column={spec}
          value={JSON.stringify(refs)}
          resolvedByRef={new Map([[id(1), file(1, 'wings.jpg', '#c2410c')], [id(2), file(2, 'burger.jpg', '#a16207')], [id(3), file(3, 'fries.jpg', '#ca8a04')]])}
          onChange={() => undefined}
          upload={pending as never}
          choose={chooser}
        />
      </Row>
    </Frame>
  );
}

function Picker(props: { sources: Parameters<typeof PicturePicker>[0]['sources']; room?: number; multiple?: boolean }): ReactNode {
  return (
    <PicturePicker
      open
      modal={false}
      onOpenChange={() => undefined}
      title="Choose a picture"
      subtitle="For Photo"
      sources={props.sources}
      takes={(one) => one.mime.startsWith('image/')}
      refusal={(one) => `This column doesn't take ${one.mime === 'application/pdf' ? 'PDF' : one.mime} files.`}
      room={props.room ?? 1}
      multiple={props.multiple ?? false}
      footnote="The record gets its own copy."
      onChoose={pending as never}
    />
  );
}

const usedSource = { key: 'used', label: 'Used in Dishes', caption: 'record' as const, empty: 'No other Dishes record has a picture yet.', list: async () => USED };
const filesSource = { key: 'files', label: 'From the Files page', caption: 'file' as const, empty: 'No pictures on the Files page yet. Upload one here, or on the Files page.', list: async () => LIBRARY };

/** The picker on "Used in Dishes", with the Files page's tab beside it. */
export function PickerUsedIn(): ReactNode {
  return <Picker sources={[usedSource, filesSource]} />;
}

/** The Files page's tab: a PDF the column does not take, dimmed with its reason. */
export function PickerFilesPage(): ReactNode {
  return <Picker sources={[filesSource, usedSource]} />;
}

/** Several allowed: the footer counts what can still be added. */
export function PickerSeveral(): ReactNode {
  return <Picker sources={[usedSource]} room={2} multiple />;
}

/** Nothing to choose yet. */
export function PickerEmpty(): ReactNode {
  return <Picker sources={[{ ...usedSource, list: async () => [] }]} />;
}

/** The list could not be read. */
export function PickerFailed(): ReactNode {
  return <Picker sources={[{ ...usedSource, list: async () => Promise.reject(new Error('down')) }]} />;
}
