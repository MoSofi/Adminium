// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A picture column's field and the picker it opens: the three buttons and
 * what each does, the copy every choice makes, the states the server can
 * name, and the keyboard model every host shares.
 */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedFile } from '../families/tables/cells.js';
import { gridColumnSpecSchema, type GridColumnSpec } from '../families/tables/column-spec.js';
import { controlForColumn, legalControls } from '../templates/page-crud/field-mapping.js';
import { FileField, type FileFieldUpload } from '../templates/page-crud/FileField.js';
import { PictureCopyRefused, type PictureChooser } from './PictureField.js';
import type { PickerItem } from './PicturePicker.js';

afterEach(cleanup);

const PICTURES = ['png', 'jpeg', 'webp', 'gif'];
const column = (over: Partial<GridColumnSpec> = {}): GridColumnSpec =>
  gridColumnSpecSchema.parse({ name: 'photo', label: 'Photo', logicalType: 'text', file: { ref: 'id', accept: PICTURES, inline: true, maxBytes: 2 * 1024 * 1024 }, ...over });

const id = (n: number): string => `file_01M1Q2R3S4T5V6W7X8Y9Z0AB${String(n).padStart(2, '0')}`;
const file = (n: number, over: Partial<ResolvedFile> = {}): ResolvedFile => ({ id: id(n), filename: `dish-${String(n)}.jpg`, mime: 'image/jpeg', sizeBytes: 243_712, contentPath: `/api/v1/files/${id(n)}/content`, ...over });
const item = (n: number, over: Partial<PickerItem> = {}): PickerItem => ({ ...file(n), recordLabel: `Dish ${String(n)}`, ...over });
const never = (() => new Promise(() => undefined)) as never;

function chooser(over: Partial<PictureChooser> = {}): PictureChooser & { copy: ReturnType<typeof vi.fn> } {
  const copy = vi.fn(async ({ fileId }: { fileId: string }) => ({ ref: `copy-of-${fileId}`, file: file(90, { filename: 'copy.jpg' }) }));
  return {
    pageTitle: 'Dishes',
    tableLabel: 'Dishes',
    usedIn: async () => [item(1), item(2)],
    copy,
    ...over,
  } as PictureChooser & { copy: ReturnType<typeof vi.fn> };
}

describe('which columns hold a picture', () => {
  it('a block that takes pictures only is Picture; any other block stays a file field', () => {
    expect(controlForColumn(column())).toBe('picture');
    expect(legalControls(column())).toContain('picture');
    // A page stored before this, with no kinds named, reads as it always did.
    expect(controlForColumn(column({ file: { ref: 'url', inline: true } } as never))).toBe('attachments');
    expect(controlForColumn(column({ file: { ref: 'url', accept: ['png', 'pdf'] } } as never))).toBe('attachments');
    expect(legalControls(column({ file: { ref: 'url' } } as never))).not.toContain('picture');
  });
});

describe('the picture field', () => {
  it('shows the picture with Upload, Choose existing… and Remove, each saying what it does', () => {
    render(<FileField variant="picture" column={column()} value={id(1)} resolved={file(1)} onChange={() => undefined} upload={never} choose={chooser()} />);
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose existing…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove the picture from Photo' })).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(screen.getByText('PNG, JPEG, WebP or GIF, up to 2 MB.')).toBeTruthy();
  });

  it('empty: a frame named "No picture yet", and no Remove; without a chooser, no Choose existing…', () => {
    render(<FileField variant="picture" column={column()} value={null} onChange={() => undefined} upload={never} />);
    expect(screen.getByRole('img', { name: 'No picture yet' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choose existing…' })).toBeNull();
  });

  it('names what the server can name: a picture no longer there, a link to another site', () => {
    const { rerender } = render(<FileField variant="picture" column={column()} value={id(5)} resolved={null} onChange={() => undefined} upload={never} choose={chooser()} />);
    expect(screen.getByRole('img', { name: 'This picture is no longer available.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose existing…' })).toBeTruthy();
    rerender(<FileField variant="picture" column={column()} value="https://img.example.net/dishes/wings.jpg" resolved={null} onChange={() => undefined} upload={never} choose={chooser()} />);
    expect(screen.getAllByText('A picture on another site. This dashboard does not show pictures from img.example.net.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Replace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove the picture from Photo' })).toBeTruthy();
  });

  it('refuses a picture larger than the column takes before a byte is sent', async () => {
    const upload = vi.fn(never) as unknown as FileFieldUpload & { mock: { calls: unknown[] } };
    render(<FileField variant="picture" column={column()} value={null} onChange={() => undefined} upload={upload} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, big);
    expect(await screen.findByText("That picture is larger than this column's 2 MB limit.")).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it('Choose existing… copies the chosen picture for this record, and says it is saved with the record', async () => {
    const onChange = vi.fn();
    const choose = chooser();
    render(<FileField variant="picture" column={column()} value={null} onChange={onChange} upload={never} choose={choose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose existing…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose a picture' });
    expect(within(dialog).getByText('The record gets its own copy.')).toBeTruthy();
    // No Files-page tab for someone who cannot open the Files page.
    expect(within(dialog).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Used in Dishes']);
    const tile = await within(dialog).findByRole('option', { name: "Dish 2's picture, dish-2.jpg" });
    await userEvent.click(tile);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(`copy-of-${id(2)}`));
    expect(choose.copy).toHaveBeenCalledWith({ fileId: id(2), column: 'photo' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Saved with the record.')).toBeTruthy();
  });

  it('a picture gone since the list was read is dropped, and the dialog says so', async () => {
    const choose = chooser({ copy: vi.fn(async () => Promise.reject(new PictureCopyRefused('gone'))) as never });
    render(<FileField variant="picture" column={column()} value={null} onChange={() => undefined} upload={never} choose={choose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose existing…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('option', { name: "Dish 1's picture, dish-1.jpg" }));
    expect(await within(dialog).findByText('That picture is no longer available.')).toBeTruthy();
    expect(within(dialog).queryByRole('option', { name: "Dish 1's picture, dish-1.jpg" })).toBeNull();
  });

  it('a table the person may not change: the refusal is said in the field after the attempt', async () => {
    const choose = chooser({ copy: vi.fn(async () => Promise.reject(new PictureCopyRefused('forbidden'))) as never });
    render(<FileField variant="picture" column={column()} value={null} onChange={() => undefined} upload={never} choose={choose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose existing…' }));
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('option', { name: "Dish 1's picture, dish-1.jpg" }));
    expect(await screen.findByText("You can't change Dishes, so you can't add a picture to it.")).toBeTruthy();
  });
});

describe('the picker', () => {
  it('offers the Files page to someone who can open it, and dims a kind the column does not take with the reason', async () => {
    const choose = chooser({ library: async () => [item(3, { recordLabel: undefined }), item(4, { filename: 'menu.pdf', mime: 'application/pdf', recordLabel: undefined })] });
    render(<FileField variant="picture" column={column()} value={null} onChange={() => undefined} upload={never} choose={choose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose existing…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('tab', { name: 'From the Files page' }));
    const pdf = await within(dialog).findByRole('option', { name: 'menu.pdf, 238 KB' });
    expect(pdf.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(pdf.getAttribute('aria-describedby')!)?.textContent).toBe("This column doesn't take PDF files.");
    await userEvent.click(pdf);
    expect(choose.copy).not.toHaveBeenCalled();
  });

  it('one tab stop and a roving focus: arrows move, Home and End go to the ends, Enter chooses', async () => {
    const onChange = vi.fn();
    const choose = chooser({ usedIn: async () => [item(1), item(2), item(3), item(4), item(5)] });
    render(<FileField variant="picture" column={column()} value={null} onChange={onChange} upload={never} choose={choose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose existing…' }));
    const dialog = await screen.findByRole('dialog');
    const grid = await within(dialog).findByRole('listbox', { name: 'Pictures' });
    const options = within(grid).getAllByRole('option');
    expect(options.filter((option) => option.tabIndex === 0)).toHaveLength(1);
    // Focus lands on the chosen tab first, a moment after the dialog opens.
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('tab'));
    act(() => options[0]!.focus());
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(options[1]);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(options[4]);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(options[0]);
    await userEvent.keyboard('{Home}{ArrowDown}');
    expect(document.activeElement).toBe(options[4]);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(`copy-of-${id(5)}`));
  });

  it('several: Space ticks, the footer counts what is left, and at the most the rest are unavailable', async () => {
    const onChange = vi.fn();
    const multi = column({ file: { ref: 'id', accept: PICTURES, multiple: true, maxCount: 3 } } as never);
    const choose = chooser({ usedIn: async () => [item(1), item(2), item(3)] });
    render(<FileField variant="picture" column={multi} value={JSON.stringify([id(9)])} resolvedByRef={new Map([[id(9), file(9)]])} onChange={onChange} upload={never} choose={choose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Choose existing…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Up to 2 can be added')).toBeTruthy();
    const options = await within(dialog).findAllByRole('option');
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('tab'));
    act(() => options[0]!.focus());
    await userEvent.keyboard(' ');
    expect(within(dialog).getByText('1 more can be added')).toBeTruthy();
    await userEvent.click(options[1]!);
    expect(options[2]!.getAttribute('aria-disabled')).toBe('true');
    expect(within(dialog).getByText('That is the most this record takes. Take one off to choose another.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add 2 pictures' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(JSON.stringify([id(9), `copy-of-${id(1)}`, `copy-of-${id(2)}`])));
  });

  it('empty, failed and no match say so, and Try again reads again', async () => {
    let calls = 0;
    const choose = chooser({
      usedIn: async ({ q }) => {
        calls += 1;
        if (calls === 1) throw new Error('down');
        return q === '' ? [] : [];
      },
    });
    render(<FileField variant="picture" column={column()} value={null} onChange={() => undefined} upload={never} choose={choose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose existing…' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Could not load these pictures.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByText('No other Dishes record has a picture yet.')).toBeTruthy();
    await userEvent.type(within(dialog).getByRole('searchbox'), 'wings');
    expect(await within(dialog).findByText('No file name matches “wings”.')).toBeTruthy();
  });
});
