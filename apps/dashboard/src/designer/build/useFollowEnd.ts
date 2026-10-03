// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The chat follows its end while the Designer writes, unless the person
 * scrolled up to read.
 *
 * "Scrolled up" is read from what the person did, never from where the
 * column happens to be: the column is unpinned only when it moved up while
 * its content did not shrink. Measuring the distance to the end on every
 * scroll event unpinned it by accident — the event from the page's own
 * scroll could arrive after the next piece of content had already grown the
 * column, read as "40 px from the end", and the chat stopped following for
 * good (a card that waited for an answer then arrived out of sight).
 *
 * It follows on every change of size, not only on a new event: a notice
 * above the message box, a taller message box, a font that lands. And it
 * moves before the browser paints, so the new line is never seen below the
 * fold for a frame.
 */
import { useCallback, useLayoutEffect, useRef, type RefObject, type UIEvent } from 'react';

/** As close to the end as counts as being at it. */
const NEAR_PX = 40;

export interface FollowEnd {
  scroller: RefObject<HTMLDivElement | null>;
  /** The column's content: watched for a change of height. */
  content: RefObject<HTMLDivElement | null>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  /** Go to the end now, and follow it again. */
  pin: () => void;
  /** Bring one element of the chat into view (a card that waits), without unpinning. */
  reveal: (element: Element) => void;
}

export function useFollowEnd(deps: readonly unknown[]): FollowEnd {
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const seen = useRef({ top: 0, height: 0 });

  const follow = useCallback((): void => {
    const el = scroller.current;
    if (el === null || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
    seen.current = { top: el.scrollTop, height: el.scrollHeight };
  }, []);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget;
    const before = seen.current;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_PX) pinned.current = true;
    // Up, with nothing taken away below: the person is reading back.
    else if (el.scrollTop < before.top - 1 && el.scrollHeight >= before.height) pinned.current = false;
    seen.current = { top: el.scrollTop, height: el.scrollHeight };
  }, []);

  // The caller says what a change is (a new event).
  useLayoutEffect(follow, deps);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(follow);
    if (scroller.current !== null) observer.observe(scroller.current);
    if (content.current !== null) observer.observe(content.current);
    return () => observer.disconnect();
  }, [follow]);

  const pin = useCallback((): void => {
    pinned.current = true;
    follow();
  }, [follow]);

  const reveal = useCallback((element: Element): void => {
    const el = scroller.current;
    if (el === null) return;
    const box = el.getBoundingClientRect();
    const at = element.getBoundingClientRect();
    if (at.bottom > box.bottom) el.scrollTop += at.bottom - box.bottom + 12;
    // A card taller than the column shows its top: the question comes first.
    const moved = element.getBoundingClientRect();
    if (moved.top < box.top) el.scrollTop -= box.top - moved.top + 12;
    seen.current = { top: el.scrollTop, height: el.scrollHeight };
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_PX;
  }, []);

  return { scroller, content, onScroll, pin, reveal };
}
