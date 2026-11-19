// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
/**
 * A call's `signal` cancels the request itself: an add-on page's Stop aborts
 * it, the fetch ends, and the server sees the request close (the lead door
 * stops asking its source on that close). Proven against a real local server,
 * so it is the connection going away that is observed, not a mock being told.
 * It runs in Node, whose fetch is the standard one a browser's behaves like:
 * the test DOM's own fetch does not close a connection on abort.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './api.js';

let server: Server;
let origin = '';
/** Resolves with the request once it reaches the server; the server never answers it. */
let arrived: Promise<IncomingMessage>;
/** Resolves once the server sees that request's connection close. */
let closed: Promise<void>;

beforeEach(async () => {
  let reached!: (request: IncomingMessage) => void;
  let gone!: () => void;
  arrived = new Promise((resolve) => (reached = resolve));
  closed = new Promise((resolve) => (gone = resolve));
  server = createServer((request) => {
    request.socket.once('close', () => gone());
    reached(request);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => real(`${origin}${input}`, init));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Settles within `ms`, or says it did not. */
const within = <T>(work: Promise<T>, ms: number): Promise<T | 'timed out'> =>
  Promise.race([work, new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), ms))]);

describe('api: a signal cancels the request', () => {
  it('a stopped post closes the request at the server and rejects as aborted', async () => {
    const stop = new AbortController();
    const call = api.post('/api/v1/leads/lead-finder/search', { activity: '71111' }, { signal: stop.signal });
    const settled = call.then(
      () => 'answered',
      (error: unknown) => (error instanceof Error ? error.name : String(error)),
    );
    const request = await within(arrived, 5_000);
    expect(request).not.toBe('timed out');
    stop.abort();
    expect(await within(closed, 5_000)).toBeUndefined();
    expect(await within(settled, 5_000)).toBe('AbortError');
  });

  it('a stopped get closes the request too', async () => {
    const stop = new AbortController();
    const call = api.get('/api/v1/add-ons/lead-finder/sources', { signal: stop.signal }).catch((error: unknown) => error);
    expect(await within(arrived, 5_000)).not.toBe('timed out');
    stop.abort();
    expect(await within(closed, 5_000)).toBeUndefined();
    expect(((await call) as Error).name).toBe('AbortError');
  });

  it('without a signal the request stays open until the server answers', async () => {
    void api.post('/api/v1/leads/lead-finder/search', {}).catch(() => undefined);
    expect(await within(arrived, 5_000)).not.toBe('timed out');
    expect(await within(closed, 300)).toBe('timed out');
  });
});
