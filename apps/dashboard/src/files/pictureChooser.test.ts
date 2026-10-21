// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Choose existing…" on the wire: the URLs, bodies and refusals that actually
 * leave and come back, with `fetch` itself stubbed (a test that cannot fail
 * on a wrong URL cannot protect one). And the save that names a picture this
 * tab just made: it carries the page it was drawn from, and the refusal that
 * comes back when that page changed is the form's own error.
 */
import { PageSettingsChangedError, PictureCopyRefused } from '@adminium/widgets';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCrudApi } from '../api/crud.js';
import { pictureChooser } from './pictureChooser.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[];
let answer: (call: Call) => { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  answer = () => ({ status: 200, body: { data: [] } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { url: String(input), method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) };
      calls.push(call);
      const { status, body } = answer(call);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ID = 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD';
const view = (over: Record<string, unknown> = {}) => ({ id: ID, filename: 'wings.jpg', mime: 'image/jpeg', sizeBytes: 9, contentPath: `/api/v1/files/${ID}/content`, ...over });
const chooser = (filesPage: boolean) => pictureChooser({ connectionId: 'conn_1', table: 'main.dishes', pageTitle: 'Dishes', tableLabel: 'Dishes', filesPage, labelColumn: 'name' });

describe('choosing a picture the workspace has, on the wire', () => {
  it('lists a column’s pictures by its two names under the API prefix, with each record’s name', async () => {
    answer = () => ({ status: 200, body: { data: [view({ recordLabel: 'Spicy wings' })] } });
    const items = await chooser(false).usedIn({ column: 'photo', q: 'wings', signal: new AbortController().signal });
    expect(calls[0]?.url).toBe('/api/v1/files?connectionId=conn_1&usedInTable=main.dishes&usedInColumn=photo&limit=200&usedInLabel=name&q=wings');
    expect(items).toEqual([expect.objectContaining({ id: ID, recordLabel: 'Spicy wings' })]);
  });

  it('offers the Files page only to someone who can open it, and lists its own uploads', async () => {
    expect(chooser(false).library).toBeUndefined();
    await chooser(true).library!({ q: '', signal: new AbortController().signal });
    expect(calls[0]?.url).toBe('/api/v1/files?connectionId=conn_1&state=library&limit=200');
  });

  it('copies for the column and stores the value the server made', async () => {
    answer = () => ({ status: 201, body: { data: view({ id: 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCE' }), ref: 'https://admin.example.com/api/v1/files/file_01M1Q2R3S4T5V6W7X8Y9Z0ABCE/content' } });
    const made = await chooser(true).copy({ fileId: ID, column: 'photo' });
    expect(calls[0]).toMatchObject({ url: `/api/v1/files/${ID}/copy`, method: 'POST', body: { connectionId: 'conn_1', table: 'main.dishes', column: 'photo' } });
    expect(made.ref).toBe('https://admin.example.com/api/v1/files/file_01M1Q2R3S4T5V6W7X8Y9Z0ABCE/content');
  });

  it('says each refusal as the field says it: gone, not yours to change, a kind or a size the column does not take', async () => {
    const refusal = async (status: number, code: string, details?: unknown) => {
      answer = () => ({ status, body: { error: { code, message: code, details } } });
      return chooser(true).copy({ fileId: ID, column: 'photo' }).catch((error: unknown) => error);
    };
    expect(await refusal(404, 'NOT_FOUND')).toMatchObject({ reason: 'gone' });
    expect(await refusal(403, 'FORBIDDEN')).toMatchObject({ reason: 'forbidden' });
    expect(await refusal(422, 'TYPE_NOT_ACCEPTED')).toMatchObject({ reason: 'type' });
    const large = await refusal(422, 'TOO_LARGE', { maxBytes: 2097152 });
    expect(large).toBeInstanceOf(PictureCopyRefused);
    expect(large).toMatchObject({ reason: 'size', limit: 2097152 });
  });
});

describe('a save that names a picture this tab made', () => {
  it('carries the page it was drawn from, and a refusal because the page changed is the form’s', async () => {
    answer = (call) => (call.url.endsWith('/copy') ? { status: 201, body: { data: view(), ref: 'file_01M1Q2R3S4T5V6W7X8Y9Z0ABCF' } } : { status: 409, body: { error: { code: 'PAGE_CHANGED', message: 'changed' } } });
    const { ref } = await chooser(true).copy({ fileId: ID, column: 'photo' });
    const changed = vi.fn();
    const crud = createCrudApi('conn_1', 'main.dishes', { page: { id: 'page_1', revision: 4 }, onPageChanged: changed });
    const error = await crud.create({ name: 'Wings', photo: ref }).catch((reason: unknown) => reason);
    expect(calls.at(-1)).toMatchObject({ url: '/api/v1/data/conn_1/main.dishes', method: 'POST', body: { values: { name: 'Wings', photo: ref }, page: { id: 'page_1', revision: 4 } } });
    expect(error).toBeInstanceOf(PageSettingsChangedError);
    expect(changed).toHaveBeenCalled();
    // A save that names nothing this tab made carries no page.
    answer = () => ({ status: 201, body: { data: {}, undoToken: null } });
    await crud.create({ name: 'Fries' });
    expect((calls.at(-1)?.body as Record<string, unknown>)['page']).toBeUndefined();
  });
});
