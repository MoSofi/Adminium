// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The signature pad and the photo field, mounted as an app's own screen
 * mounts them: a plain element, the side's connection, table, column and
 * token, and an `onChange` that hears file ids.
 *
 * Worth proving: what is kept is sent once, for the column named, with the
 * session's token, and the app hears the id the server gave; a signature can
 * be made by keyboard alone (the name typed); what this mount sent and took
 * back is thrown away on the server, and what the app gave as `value` (the
 * record's) never is; a refused upload is said in the reader's words; the
 * field holds no more than it takes; the words are the reader's language.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KitMounted, PhotosProps, SignatureProps } from './contract.js';
import { mount } from './index.js';
import { clearOutsideWords, outsideWords } from './words.js';

const TARGET = { connectionId: 'conn_1', table: 'crm_sign_offs', csrfToken: 'csrf-1', locale: 'en-US', dir: 'ltr' as const };

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

let host: HTMLElement;
let mounted: KitMounted<SignatureProps> | KitMounted<PhotosProps> | null = null;
let sent: Sent[];
let answer: (call: Sent) => Response;
let ids: number;

/** The fetch the app gives: records each call, answers an upload with a new file id unless the test says otherwise. */
const fetcher = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
  const call = { method: init?.method ?? 'GET', url: input, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body };
  sent.push(call);
  return answer(call);
});

beforeEach(() => {
  clearOutsideWords();
  sent = [];
  ids = 0;
  answer = (call) =>
    call.method === 'POST'
      ? new Response(JSON.stringify({ data: { id: `file_${String((ids += 1))}` }, ref: `file_${String(ids)}` }), { status: 201, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  host = document.createElement('div');
  document.body.append(host);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:kit-1'), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  host.remove();
  vi.restoreAllMocks();
  fetcher.mockClear();
  expect(outsideWords()).toEqual([]);
});

/** A canvas that draws nothing and answers a PNG: the page's own is not there in this test's browser. */
function stubCanvas(): { strokes: () => number } {
  let strokes = 0;
  const context = {
    setTransform: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => (strokes += 1),
    clearRect: () => undefined,
    measureText: () => ({ width: 100 }),
    fillText: () => (strokes += 1),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    value(this: HTMLCanvasElement, done: (blob: Blob | null) => void, type: string) {
      done(new Blob(['png'], { type }));
    },
  });
  return { strokes: () => strokes };
}

async function signature(props: Partial<SignatureProps> = {}): Promise<ReturnType<typeof vi.fn<(id: string | null) => void>>> {
  const onChange = vi.fn<(id: string | null) => void>();
  await act(async () => {
    mounted = await mount('signature', host, { ...TARGET, column: 'signature', fetch: fetcher, onChange, label: "Customer's signature", ...props });
  });
  return onChange;
}

async function photos(props: Partial<PhotosProps> = {}): Promise<{ onChange: ReturnType<typeof vi.fn<(ids: string[]) => void>>; onBusy: ReturnType<typeof vi.fn<(busy: boolean) => void>> }> {
  const onChange = vi.fn<(ids: string[]) => void>();
  const onBusy = vi.fn<(busy: boolean) => void>();
  await act(async () => {
    mounted = await mount('photos', host, { ...TARGET, column: 'photos', fetch: fetcher, onChange, onBusy, label: 'Photos of the job', max: 2, ...props });
  });
  return { onChange, onBusy };
}

const uploads = (): Sent[] => sent.filter((call) => call.method === 'POST');
const discards = (): Sent[] => sent.filter((call) => call.method === 'DELETE');

describe('the signature pad', () => {
  it('sends a drawn signature once, as a PNG for its column with the session’s token, and tells the app its id', async () => {
    const canvas = stubCanvas();
    const onChange = await signature();
    const user = userEvent.setup();
    expect(screen.getByRole('group', { name: "Customer's signature" })).toBeTruthy();
    // Kept with nothing drawn: said, nothing sent.
    await user.click(screen.getByRole('button', { name: 'Keep this signature' }));
    expect(screen.getByRole('alert').textContent).toBe('Sign first, then keep the signature.');
    const pad = screen.getByRole('img', { name: 'Sign here with a finger, a pen or the mouse.' });
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(pad, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    expect(canvas.strokes()).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Keep this signature' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('file_1'));
    expect(uploads()).toHaveLength(1);
    const [upload] = uploads();
    const query = new URL(upload!.url, 'http://x').searchParams;
    expect(new URL(upload!.url, 'http://x').pathname).toBe('/api/v1/files');
    expect(Object.fromEntries(query)).toEqual({ connectionId: 'conn_1', table: 'crm_sign_offs', column: 'signature', filename: 'signature.png' });
    expect(upload!.headers).toMatchObject({ 'x-adminium-csrf': 'csrf-1', 'content-type': 'image/png' });
    expect((upload!.body as Blob).type).toBe('image/png');
    expect(screen.getByRole('img', { name: 'The signature as kept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign again' })).toBeTruthy();
  });

  it('is signed by keyboard alone: the name typed, Enter keeps it; signed again, what it sent is thrown away', async () => {
    stubCanvas();
    const onChange = await signature();
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement?.textContent).toBe('Type the name instead');
    await user.keyboard('{Enter}');
    const field = screen.getByLabelText<HTMLInputElement>('Name, as the signature');
    field.focus();
    await user.keyboard('Ada Lovelace{Enter}');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('file_1'));
    // The keyboard is left on the button that undoes it, and then on the way to sign again.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Sign again'));
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Sign by hand instead'));
    await waitFor(() => expect(discards().map((call) => call.url)).toEqual(['/api/v1/files/file_1']));
    expect(discards()[0]!.headers['x-adminium-csrf']).toBe('csrf-1');
  });

  it('shows the record’s signature as kept, and never throws it away', async () => {
    const onChange = await signature({ value: 'file_9' });
    const user = userEvent.setup();
    expect(screen.getByRole<HTMLImageElement>('img', { name: 'The signature as kept' }).getAttribute('src')).toBe('/api/v1/files/file_9/content');
    await user.click(screen.getByRole('button', { name: 'Sign again' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(discards()).toEqual([]);
  });

  it('says a refused upload in the reader’s words, and keeps the drawing to try again', async () => {
    stubCanvas();
    answer = () => new Response('{}', { status: 413 });
    const onChange = await signature();
    const user = userEvent.setup();
    const pad = screen.getByRole('img', { name: 'Sign here with a finger, a pen or the mouse.' });
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1 });
    await user.click(screen.getByRole('button', { name: 'Keep this signature' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This file is too large for this field.'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Keep this signature' }).disabled).toBe(false);
  });

  it('draws nothing and keeps nothing while disabled', async () => {
    await signature({ disabled: true });
    for (const name of ['Type the name instead', 'Clear', 'Keep this signature']) expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled, name).toBe(true);
  });

  it('speaks the reader’s language, right to left', async () => {
    await signature({ locale: 'ar-EG', dir: 'rtl', label: undefined });
    await waitFor(() => expect(screen.getByRole('button', { name: 'احتفظ بهذا التوقيع' })).toBeTruthy());
    expect(host.querySelector('.adm-kit')?.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('group', { name: 'التوقيع' })).toBeTruthy();
  });
});

describe('the photo field', () => {
  const choose = async (...names: string[]): Promise<void> => {
    const input = screen.getByTestId<HTMLInputElement>('kit-photos-input');
    const files = names.map((name) => new File(['jpeg'], name, { type: 'image/jpeg' }));
    await act(async () => {
      fireEvent.change(input, { target: { files } });
    });
  };

  it('sends each photo chosen for its column and tells the app the ids it holds, in order', async () => {
    const { onChange, onBusy } = await photos();
    await choose('a.jpg', 'b.jpg');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['file_1', 'file_2']));
    expect(uploads().map((call) => new URL(call.url, 'http://x').searchParams.get('column'))).toEqual(['photos', 'photos']);
    expect(onBusy).toHaveBeenCalledWith(true);
    expect(onBusy).toHaveBeenLastCalledWith(false);
    expect(screen.getAllByRole('img').map((img) => img.getAttribute('alt'))).toEqual(['Photo 1', 'Photo 2']);
    // Full: the button is off and the count says so.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add a photo' }).disabled).toBe(true);
    expect(host.textContent).toContain('2 of 2');
  });

  it('throws away on the server a photo it sent and the person took out; the record’s own it never does', async () => {
    const { onChange } = await photos({ value: ['file_held'], max: 3 });
    expect(screen.getByRole<HTMLImageElement>('img', { name: 'Photo 1' }).getAttribute('src')).toBe('/api/v1/files/file_held/content');
    await choose('new.jpg');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['file_held', 'file_1']));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Take photo 2 out' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['file_held']));
    expect(discards().map((call) => call.url)).toEqual(['/api/v1/files/file_1']);
    await user.click(screen.getByRole('button', { name: 'Take photo 1 out' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([]));
    expect(discards()).toHaveLength(1);
    // The focus stays in the field.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Add a photo'));
  });

  it('says a refused photo in the reader’s words and holds no id for it', async () => {
    answer = (call) => (call.method === 'POST' ? new Response('{}', { status: 415 }) : new Response('{}'));
    const { onChange } = await photos();
    await choose('scan.heic');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This kind of file is not taken here.'));
    expect(onChange).not.toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]));
  });

  it('takes no more than it holds', async () => {
    const { onChange } = await photos({ max: 1 });
    await choose('a.jpg', 'b.jpg', 'c.jpg');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['file_1']));
    expect(uploads()).toHaveLength(1);
  });
});
