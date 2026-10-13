// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A board that follows a colleague's change.
 *
 * WHAT A BOARD PAGE LISTENS TO. The `widget-data:{connectionId}:{table}`
 * channel of its cards' table and, for a board whose columns are the rows of
 * a table, that table's too. They are the only channels over a table a
 * browser may subscribe to (`table:*` is published by the server and
 * subscribed to by nobody), and the server lets a person on one only while
 * their own role reads that table — so somebody who may not read the columns'
 * table is simply sent nothing of it.
 *
 * WHAT A FRAME DOES. It reads the page again: the cards' batch and the columns
 * read both live under `['widget-data', pageId]`, so one invalidation is one
 * request each. A frame says "this table changed" and nothing is taken from
 * the row it may carry: what a reader is shown of a card is the data route's
 * to answer, with their row limits and masks.
 *
 * ONE READ FOR A BURST. A busy table sends a frame for every write by anybody.
 * The first one starts a short wait and the ones that arrive during it are
 * the same burst: the page is read once when the wait ends. (The transport
 * gathers the frames that name no row — `api/streamTransport.ts` — but a
 * reader with no row limit is sent each write as its own frame, so the wait
 * here is the one that holds for everybody.)
 *
 * WHAT IS NOT FOLLOWED. A change to a table the board only reads THROUGH — the
 * name a card shows of the row a link points at — sends no frame on these two
 * channels; it shows at the next read. And this tab's own save reads the page
 * at once (`PageRenderer`), then once more when its own frame's wait ends.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { PageEnvelope } from '@adminium/engine/config';
import { streamChannel } from '@adminium/widgets/binding';

import { BARE_CHANGE_WAIT_MS } from '../../api/streamTransport.js';
import { WIDGET_DATA_KEY_ROOT } from '../../api/widgetData.js';
import { appStreamTransport } from '../lmc/stream.js';
import { boardReadOf } from './boardColumns.js';

/** How long a burst of frames is gathered into one read of the page: the transport's own wait for the frames that name no row. */
export const BOARD_LIVE_WAIT_MS = BARE_CHANGE_WAIT_MS;

/** A file hung on a record changes no card and no count. */
const IGNORED_TYPES: ReadonlySet<string> = new Set(['record.attachments']);

/** The channels a board page follows: its cards' table, and the table its columns are the rows of. */
export function boardLiveChannels(page: PageEnvelope): string[] {
  const { connectionId, table } = page.source;
  if (connectionId === null || table === null || table === undefined) return [];
  const columnsTable = boardReadOf(page)?.from?.table;
  return [...new Set([table, ...(columnsTable === undefined ? [] : [columnsTable])])].map((name) => streamChannel(connectionId, name));
}

export function useBoardLive(page: PageEnvelope): void {
  const queryClient = useQueryClient();
  const channels = useMemo(() => boardLiveChannels(page), [page]);
  // By value: a page that is read again and says the same keeps its subscriptions.
  const key = channels.join('\n');
  useEffect(() => {
    if (key === '') return;
    let wait: ReturnType<typeof setTimeout> | null = null;
    const onFrame = (event: { type: string }): void => {
      if (IGNORED_TYPES.has(event.type) || wait !== null) return;
      wait = setTimeout(() => {
        wait = null;
        void queryClient.invalidateQueries({ queryKey: [WIDGET_DATA_KEY_ROOT, page.id] });
      }, BOARD_LIVE_WAIT_MS);
    };
    const transport = appStreamTransport();
    const leave = key.split('\n').map((channel) => transport.subscribe(channel, onFrame));
    return () => {
      for (const off of leave) off();
      if (wait !== null) clearTimeout(wait);
    };
  }, [key, queryClient, page.id]);
}
