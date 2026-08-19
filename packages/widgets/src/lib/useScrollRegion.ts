// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Make a scrollable container keyboard-reachable — but ONLY when it is actually
 * scrollable.
 *
 * WHY CONDITIONAL, and why that is the whole point. axe's
 * `scrollable-region-focusable` fires when an element has scrollable overflow and
 * no way in from the keyboard: the content below the fold is unreachable without
 * a mouse. The obvious remedy is `tabIndex={0}` on every `overflow-auto`, and it
 * is wrong twice over. It adds a tab stop to containers that are NOT clipped at
 * the current size — measured, four scrollers already carrying `role="region"
 * tabIndex={0}` in this repo have ZERO overflow in their own stories, so they
 * ship four dead tab stops and four spurious landmarks today. And a container
 * whose children are already focusable does not need one at all.
 *
 * So this measures, and attaches the stop only while it is earned. A window
 * resize or a data change that removes the overflow removes the tab stop with it.
 *
 * NO `+ 13` FUDGE. An earlier design mirrored axe's own 13px buffer so "the gate
 * and the product agree". They do not: axe fired on the gantt canvas at 12px of
 * overflow in the sweep's own configuration, so a 13px threshold would have left
 * the flagged node without the stop. The honest comparison is a strict one.
 *
 * NAMING. A tab stop with no accessible name is announced as nothing, so the
 * region needs one — and the right name is the widget's own visible heading, not
 * an invented string. `WidgetFrame` publishes its `<h3>` id through
 * {@link useWidgetHeadingId}, so the region announces "Connection check", the
 * words on screen, rather than a second vocabulary only screen-reader users hear.
 * That also means this adds NO new i18n keys — which matters, because the last
 * batch of aria-label keys shipped as literal English into seven locales.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ScrollRegionOptions {
  /**
   * `group` for a widget-internal scroller, `undefined` for a `<ul>`/`<ol>`.
   *
   * Never `region`: a landmark per widget would put thirteen of them in a
   * dashboard's rotor. And on a list an explicit role REPLACES the implicit
   * `role="list"`, destroying the "list, N items" announcement — so lists pass
   * nothing.
   */
  readonly role?: 'group';
  /** Fallback name, used only when no frame heading is in scope. */
  readonly label?: string | undefined;
  /** The frame heading's id, from {@link useWidgetHeadingId}. */
  readonly labelledBy?: string | undefined;
}

export interface ScrollRegionProps {
  readonly ref: (node: HTMLElement | null) => void;
  readonly tabIndex?: 0;
  readonly role?: 'group';
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly className: string;
}

/** The focus ring every other control in this design system uses. */
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function useScrollRegion(options: ScrollRegionOptions = {}): ScrollRegionProps {
  const [overflowing, setOverflowing] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);

  const measure = useCallback((node: HTMLElement | null): void => {
    if (node === null) return;
    setOverflowing(node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight);
  }, []);

  // A callback ref rather than useEffect+useRef: the node has to be measured the
  // moment it mounts, and re-measured if React swaps it.
  const ref = useCallback(
    (node: HTMLElement | null): void => {
      nodeRef.current = node;
      measure(node);
    },
    [measure],
  );

  useEffect(() => {
    const node = nodeRef.current;
    if (node === null || typeof ResizeObserver === 'undefined') return;
    // Observe the CONTENT as well as the container. A container-only observer
    // goes stale when rows are added to a list that has not itself resized —
    // which is the common case for these widgets.
    const observer = new ResizeObserver(() => measure(node));
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, overflowing]);

  const named =
    options.labelledBy !== undefined
      ? { 'aria-labelledby': options.labelledBy }
      : options.label !== undefined
        ? { 'aria-label': options.label }
        : {};

  return {
    ref,
    className: overflowing ? FOCUS_RING : '',
    ...(overflowing ? { tabIndex: 0 as const } : {}),
    ...(overflowing && options.role !== undefined ? { role: options.role } : {}),
    ...(overflowing ? named : {}),
  };
}
