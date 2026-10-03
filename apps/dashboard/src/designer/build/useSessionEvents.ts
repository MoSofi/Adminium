// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A session's events, kept in order: read from the start, then followed on
 * the `designer:<id>` channel. Every event is written to the session's file
 * before it is sent, so the read is the truth and the channel the fast path:
 * on a gap in the numbers, and each time the socket (re)connects, the page
 * reads what it missed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { createRealtimeClient } from '../../app/ws.js';
import { designerApi, type DesignerEvent } from '../api.js';

/** How many catch-up pages one read may follow; a session is bounded by its limits long before. */
const MAX_PAGES = 50;

export interface SessionEvents {
  events: DesignerEvent[];
  /** The first read is done. */
  loaded: boolean;
  /** Read what was missed now (after an action whose events must be seen at once). */
  catchUp: () => void;
}

function isEvent(value: unknown): value is DesignerEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event['seq'] === 'number' && typeof event['turn'] === 'number' && typeof event['kind'] === 'string';
}

export function useSessionEvents(sessionId: string): SessionEvents {
  const [events, setEvents] = useState<DesignerEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const last = useRef(0);
  const reading = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const alive = useRef(true);

  const add = useCallback((incoming: readonly DesignerEvent[]) => {
    const fresh = incoming.filter((event) => event.seq > last.current).sort((a, b) => a.seq - b.seq);
    if (fresh.length === 0) return;
    // Only events that continue the run are kept; a later one waits for the read that fills the gap.
    const kept: DesignerEvent[] = [];
    for (const event of fresh) {
      if (event.seq !== last.current + 1) break;
      kept.push(event);
      last.current = event.seq;
    }
    if (kept.length > 0) setEvents((previous) => [...previous, ...kept]);
  }, []);

  const read = useCallback((): void => {
    if (reading.current !== null) {
      again.current = true;
      return;
    }
    reading.current = (async () => {
      try {
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const reply = await designerApi.eventsSince(sessionId, last.current);
          if (!alive.current) return;
          add(reply.events);
          if (!reply.more) break;
        }
      } catch {
        // The next connect or gap reads again.
      } finally {
        reading.current = null;
        if (alive.current) setLoaded(true);
        if (again.current && alive.current) {
          again.current = false;
          read();
        }
      }
    })();
  }, [add, sessionId]);

  useEffect(() => {
    alive.current = true;
    last.current = 0;
    setEvents([]);
    setLoaded(false);
    read();
    const client = createRealtimeClient({
      channels: [`designer:${sessionId}`],
      sseEventTypes: ['designer'],
      onStatusChange: (connected) => {
        if (connected) read();
      },
      onEvent: (event) => {
        if (event.type !== 'designer' || !isEvent(event.data)) return;
        if (event.data.seq > last.current + 1) {
          read();
          return;
        }
        add([event.data]);
      },
    });
    client.start();
    return () => {
      alive.current = false;
      client.stop();
    };
  }, [add, read, sessionId]);

  return { events, loaded, catchUp: read };
}
