// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A TABLE FOLLOWED LIVE (`useLiveTable`), AS AN ADD-ON'S PAGE USES IT: a
 * chat's inbox beside its list of conversations.
 *
 * - it joins the table's `widget-data` channel, by the table's real id;
 * - a frame on it reads the page's list of that table again, once for a burst;
 * - the live line coming back after a drop reads it again (a change made
 *   while it was down is never sent again); its first "up" does not;
 * - a table the reader may not read is never joined.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/fixtures.js';
import { AddOnKeyContext } from './data-kit/context.js';
import { LIVE_TABLE_WAIT_MS, useLiveTable, useRecords } from './data-kit/hooks.js';
import type { KitReply } from './data-kit/resolve.js';

/** The shared stream, as a page's hook meets it: the channels joined, and a way to send a frame or move the line. */
const stream = vi.hoisted(() => ({
  joined: [] as string[],
  listeners: new Map<string, ((event: { channel: string; type: string; data: unknown }) => void)[]>(),
  statuses: [] as ((up: boolean) => void)[],
  up: false,
}));
vi.mock('../pages/lmc/stream.js', () => ({
  appStreamTransport: () => ({
    subscribe(channel: string, listener: (event: { channel: string; type: string; data: unknown }) => void, onStatus?: (up: boolean) => void) {
      stream.joined.push(channel);
      stream.listeners.set(channel, [...(stream.listeners.get(channel) ?? []), listener]);
      if (onStatus !== undefined) {
        stream.statuses.push(onStatus);
        onStatus(stream.up);
      }
      return () => {
        stream.listeners.set(channel, (stream.listeners.get(channel) ?? []).filter((one) => one !== listener));
        stream.statuses = stream.statuses.filter((one) => one !== onStatus);
      };
    },
  }),
}));

const CONN = 'cnx_chat';
const KIT: KitReply = {
  connectionId: CONN,
  tables: {
    conversations: { id: 'public.chat_conversations', can: { read: true, create: false, update: true, delete: true }, unreadable: [] },
    choices: { id: 'public.chat_choices', can: { read: false, create: false, update: false, delete: false }, unreadable: [] },
  },
  hosts: [],
  has: {},
  currency: 'EUR',
};
const CHANNEL = `widget-data:${CONN}:public.chat_conversations`;

/** The server: the kit's read, and the conversations list, counted. */
function serve(): { lists: () => number } {
  let lists = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = new URL(String(input), 'http://adminium.test');
      const path = decodeURIComponent(url.pathname);
      if (path === '/api/v1/add-ons/live-chat/kit') return jsonResponse(200, KIT);
      if (path === `/api/v1/data/${CONN}/public.chat_conversations`) {
        lists += 1;
        return jsonResponse(200, { data: [{ id: lists, state: 'waiting' }] });
      }
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } });
    }),
  );
  return { lists: () => lists };
}

function wrapper({ children }: { children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AddOnKeyContext.Provider value="live-chat">
        <Suspense fallback={null}>{children}</Suspense>
      </AddOnKeyContext.Provider>
    </QueryClientProvider>
  );
}

/** A frame on a channel, as the server sends one for a written row. */
function frame(channel: string): void {
  for (const listener of stream.listeners.get(channel) ?? []) listener({ channel, type: 'record.create', data: { type: 'record.create', pk: { id: 9 }, row: { id: 9 } } });
}

/** The live line goes down or comes back. */
function line(up: boolean): void {
  stream.up = up;
  for (const status of [...stream.statuses]) status(up);
}

beforeEach(() => {
  stream.joined = [];
  stream.listeners = new Map();
  stream.statuses = [];
  stream.up = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a table followed live', () => {
  it('joins the table’s channel and reads its list again on a frame, once for a burst', async () => {
    const server = serve();
    const page = renderHook(() => ({ list: useRecords('conversations'), live: useLiveTable('conversations') }), { wrapper });
    await waitFor(() => expect(page.result.current?.list.rows).toEqual([{ id: 1, state: 'waiting' }]));
    expect(stream.joined).toEqual([CHANNEL]);
    expect(page.result.current.live.connected).toBe(true);
    expect(server.lists()).toBe(1);

    act(() => {
      for (let index = 0; index < 5; index += 1) frame(CHANNEL);
    });
    await new Promise((resolve) => setTimeout(resolve, LIVE_TABLE_WAIT_MS + 50));
    await waitFor(() => expect(server.lists()).toBe(2));
    await waitFor(() => expect(page.result.current.list.rows).toEqual([{ id: 2, state: 'waiting' }]));
    // A frame of another table reads nothing.
    act(() => frame(`widget-data:${CONN}:public.chat_messages`));
    await new Promise((resolve) => setTimeout(resolve, LIVE_TABLE_WAIT_MS + 50));
    expect(server.lists()).toBe(2);
  });

  it('reads the list again when the live line comes back after a drop, and not on its first “up”', async () => {
    stream.up = false;
    const server = serve();
    const page = renderHook(() => ({ list: useRecords('conversations'), live: useLiveTable('conversations') }), { wrapper });
    await waitFor(() => expect(page.result.current?.list.rows).toHaveLength(1));
    expect(page.result.current.live.connected).toBe(false);
    // Joined: the first "up" is the join, and nothing was missed before it.
    act(() => line(true));
    await new Promise((resolve) => setTimeout(resolve, LIVE_TABLE_WAIT_MS + 50));
    expect(server.lists()).toBe(1);
    expect(page.result.current.live.connected).toBe(true);
    // A drop, then back: what was written meanwhile is read.
    act(() => line(false));
    expect(page.result.current.live.connected).toBe(false);
    act(() => line(true));
    await new Promise((resolve) => setTimeout(resolve, LIVE_TABLE_WAIT_MS + 50));
    await waitFor(() => expect(server.lists()).toBe(2));
  });

  it('never joins a table the reader may not read, nor one it is told not to follow', async () => {
    serve();
    const page = renderHook(() => ({ choices: useLiveTable('choices'), off: useLiveTable('conversations', { enabled: false }) }), { wrapper });
    await waitFor(() => expect(page.result.current).not.toBeNull());
    expect(stream.joined).toEqual([]);
    expect(page.result.current.choices.connected).toBe(false);
  });
});
