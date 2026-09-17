// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The files transport's WIRE, not its behaviour.
 *
 * WHY THIS EXISTS. Every other test of this feature mocks `files/api.ts` and
 * asserts what the callers do with its return value — which is the right shape
 * for a component test and is exactly why four of these five calls shipped
 * broken: `apiFetch` hands its argument straight to `fetch` and adds no base,
 * so `'/files/resolve'` resolves against whatever route the SPA happens to be
 * on. Delete, Restore, the batch resolve and the record-panel list were all
 * dead on the wire, and every mocked test still passed. (Found by the 37e
 * review, not by this suite — which is why this suite now exists.)
 *
 * So these assertions are deliberately dumb: they stub `fetch` itself and
 * check the URL and method that actually leave. A test that cannot fail on a
 * wrong URL cannot protect a URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteFile, listRecordFiles, resolveFiles, restoreFile } from './api.js';

interface Call {
  url: string;
  method: string;
}

let calls: Call[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every real route lives under this prefix — see `openapi.json`. */
const PREFIX = '/api/v1/files';

describe('files transport — the URLs that actually leave', () => {
  it('resolves a batch under the API prefix', async () => {
    await resolveFiles(['file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${PREFIX}/resolve`);
    expect(calls[0]?.method).toBe('POST');
  });

  it('sends no request at all for an empty batch', async () => {
    // A grid page with no file values must cost nothing.
    expect(await resolveFiles([])).toEqual(new Map());
    expect(calls).toHaveLength(0);
  });

  it('chunks a batch larger than the route accepts', async () => {
    // The route caps `refs` at 200; a bigger page is chunked here rather than
    // refused, because the cap is about one request's size.
    await resolveFiles(Array.from({ length: 450 }, (_, i) => `file_${String(i)}`));
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.url).toBe(`${PREFIX}/resolve`);
  });

  it('lists one record’s files under the API prefix, with the entity filter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method ?? 'GET' });
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    await listRecordFiles({ connectionId: 'conn_1', table: 'public.invoices', recordId: '1042' });
    const url = new URL(calls[0]?.url ?? '', 'https://example.test');
    expect(url.pathname).toBe(PREFIX);
    expect(url.searchParams.get('connectionId')).toBe('conn_1');
    expect(url.searchParams.get('table')).toBe('public.invoices');
    expect(url.searchParams.get('recordId')).toBe('1042');
  });

  it('trashes and restores under the API prefix', async () => {
    await deleteFile('file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD');
    await restoreFile('file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `DELETE ${PREFIX}/file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD`,
      `POST ${PREFIX}/file_01M1Q2R3S4T5V6W7X8Y9Z0ABCD/restore`,
    ]);
  });

  it('percent-encodes an id rather than pasting it into a path', async () => {
    await deleteFile('weird/id');
    expect(calls[0]?.url).toBe(`${PREFIX}/weird%2Fid`);
  });
});
