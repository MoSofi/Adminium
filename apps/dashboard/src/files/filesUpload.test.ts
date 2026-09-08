// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The upload half of the files transport — progress, abort, and the request
 * that actually leaves (37-files-and-storage.md D5, §3.9, 37-T20).
 *
 * WHY A SECOND FILE, AND WHY IT STUBS `XMLHttpRequest`. Its sibling
 * `filesApi.test.ts` exists because four JSON calls shipped with a URL that
 * could never resolve while every mocked test passed; it stubs `fetch` so the
 * assertions are about the wire. `uploadFile` cannot be covered that way — it
 * does not use `fetch` at all. It uses XHR because XHR is the only browser API
 * that reports upload progress (`api.ts`), so the only stub that can see what
 * this function does is a stub of `XMLHttpRequest` itself. Mocking the module
 * would assert nothing about the POST, the query string, the progress
 * plumbing, or which error an abort produces — the four things this file is
 * for.
 *
 * The stub below is deliberately a real `EventTarget` rather than a bag of
 * spies: the transport registers with `addEventListener`, and a stub that only
 * recorded handler assignments would report green against a transport that
 * had stopped listening.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CSRF_HEADER, setCsrfToken } from '../app/api.js';
import { UploadAbortedError, uploadFile } from './api.js';

/**
 * `xhr.upload`. A browser exposes `onprogress` as an event-handler attribute
 * whose assignment registers a listener, so this supports both registration
 * styles — a stub that honoured only one would silently stop covering the
 * transport the day it switched.
 */
class UploadStub extends EventTarget {
  private handler: ((event: ProgressEvent) => void) | null = null;

  get onprogress(): ((event: ProgressEvent) => void) | null {
    return this.handler;
  }

  set onprogress(next: ((event: ProgressEvent) => void) | null) {
    if (this.handler !== null) this.removeEventListener('progress', this.handler as EventListener);
    this.handler = next;
    if (next !== null) this.addEventListener('progress', next as EventListener);
  }
}

/** Every request the transport opened during one test, newest last. */
let requests: XhrStub[] = [];

/** The subset of `XMLHttpRequest` `uploadFile` touches, plus drivers for a test. */
class XhrStub extends EventTarget {
  readonly upload = new UploadStub();
  readonly headers = new Map<string, string>();
  method = '';
  url = '';
  withCredentials = false;
  body: unknown = null;
  status = 0;
  responseText = '';
  aborted = false;

  constructor() {
    super();
    requests.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  send(body: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.dispatchEvent(new Event('abort'));
  }

  /** Drive one `progress` tick the way a browser does while bytes go out. */
  emitProgress(loaded: number, total: number, lengthComputable = true): void {
    this.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable, loaded, total }));
  }

  /** Finish with a 2xx and a JSON body — the route's `{file, ref}` reply. */
  succeed(payload: unknown): void {
    this.status = 200;
    this.responseText = JSON.stringify(payload);
    this.dispatchEvent(new Event('load'));
  }
}

/** The most recent request, or a failure — never `undefined` at a call site. */
function lastRequest(): XhrStub {
  const request = requests.at(-1);
  if (request === undefined) throw new Error('the transport opened no request');
  return request;
}

const PNG = new File([new Uint8Array([137, 80, 78, 71])], 'receipt.png', { type: 'image/png' });

beforeEach(() => {
  requests = [];
  vi.stubGlobal('XMLHttpRequest', XhrStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('files upload transport', () => {
  it('POSTs to the files route and reports progress through to completion', async () => {
    const fractions: number[] = [];
    const pending = uploadFile({
      file: PNG,
      connectionId: 'conn_1',
      table: 'public.invoices',
      recordId: '1042',
      column: 'receipt',
      onProgress: (fraction) => fractions.push(fraction),
    });

    const request = lastRequest();
    expect(request.method).toBe('POST');
    const url = new URL(request.url, 'https://example.test');
    expect(url.pathname).toBe('/api/v1/files');
    expect(url.searchParams.get('filename')).toBe('receipt.png');
    expect(url.searchParams.get('connectionId')).toBe('conn_1');
    expect(url.searchParams.get('table')).toBe('public.invoices');
    expect(url.searchParams.get('recordId')).toBe('1042');
    expect(url.searchParams.get('column')).toBe('receipt');
    // The body IS the file (D5); metadata rides the query string above.
    expect(request.body).toBe(PNG);

    request.emitProgress(0, 300);
    request.emitProgress(150, 300);
    request.emitProgress(300, 300);
    // 100% is the one the UI needs most: a bar that stops at 0.5 reads as a
    // frozen upload even when the bytes all arrived.
    expect(fractions).toEqual([0, 0.5, 1]);

    request.succeed({ file: { id: 'file_1' }, ref: 'file_1' });
    await expect(pending).resolves.toEqual({ file: { id: 'file_1' }, ref: 'file_1' });
  });

  it('ignores a progress tick whose length is not yet computable', async () => {
    const fractions: number[] = [];
    const pending = uploadFile({
      file: PNG,
      connectionId: 'conn_1',
      table: 'public.invoices',
      onProgress: (fraction) => fractions.push(fraction),
    });

    const request = lastRequest();
    // The browser fires these while it is still measuring. Without the guard
    // the two ticks below reach `onProgress` as NaN and Infinity — measured,
    // by deleting it — and a progress bar sized from either is not a bar.
    request.emitProgress(0, 0, false);
    request.emitProgress(64, 0, true);
    expect(fractions).toEqual([]);

    request.succeed({ file: { id: 'file_1' } });
    await pending;
  });

  it('rejects with the typed UploadAbortedError when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = uploadFile({
      file: PNG,
      connectionId: 'conn_1',
      table: 'public.invoices',
      signal: controller.signal,
    });

    const request = lastRequest();
    expect(request.method).toBe('POST');
    expect(new URL(request.url, 'https://example.test').pathname).toBe('/api/v1/files');

    controller.abort();
    // The signal has to reach the request itself — a promise that rejects
    // while the bytes keep going is a cancel the user does not get.
    expect(request.aborted).toBe(true);
    // A cancel is not a failure to report, and the TYPE is the only thing that
    // separates it from the `ApiError`s this same promise rejects with. Worth
    // pinning even though no caller reads it today: `FileField` re-derives the
    // answer from its own `abort.signal.aborted`, and the record attachments
    // panel does not distinguish at all — it renders "The upload was
    // cancelled." in its error slot. The class is the seam that lets either
    // stop guessing, and only this test holds it in place.
    await expect(pending).rejects.toBeInstanceOf(UploadAbortedError);
    await expect(pending).rejects.toMatchObject({ name: 'UploadAbortedError' });
  });

  it('sends the raw body credentialed, CSRF-headed and typed', async () => {
    setCsrfToken('csrf-token-for-this-tab');
    const pending = uploadFile({ file: PNG, connectionId: 'conn_1', table: 'public.invoices' });

    const request = lastRequest();
    // `apiFetch` puts the credentials and the CSRF header on every mutation it
    // sends (`app/api.ts`); this call bypasses `apiFetch` entirely and has to
    // set both itself, which is how a hand-rolled transport ends up 403ing.
    expect(request.withCredentials).toBe(true);
    expect(request.headers.get(CSRF_HEADER)).toBe('csrf-token-for-this-tab');
    expect(request.headers.get('content-type')).toBe('image/png');

    request.succeed({ file: { id: 'file_1' } });
    await pending;
  });

  it('falls back to an octet-stream claim for a file the browser could not type', async () => {
    const untyped = new File([new Uint8Array([1, 2])], 'notes', { type: '' });
    const pending = uploadFile({ file: untyped, connectionId: 'conn_1', table: 'public.invoices' });

    const request = lastRequest();
    // The claim is advisory either way — the server sniffs the bytes (D8) — so
    // what this pins is that the header is always SENT, since it exists to help
    // a proxy in between and an empty one helps nobody.
    expect(request.headers.get('content-type')).toBe('application/octet-stream');

    request.succeed({ file: { id: 'file_1' } });
    await pending;
  });
});
