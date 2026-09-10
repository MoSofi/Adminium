// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState, type Ref, type RefCallback } from 'react';

/**
 * Let a PORTALLED panel be scrolled by wheel and touch while a dialog's
 * scroll lock is active.
 *
 * `Modal` and `Drawer` are Radix dialogs, and Radix locks background scroll
 * with `react-remove-scroll`. That lock lives on the OVERLAY and whitelists
 * ("shards") only the dialog panel, then registers `wheel`/`touchmove` on
 * `document` and cancels every one whose target is in neither — WITHOUT
 * asking whether the target could be scrolled. An anchored panel is portalled
 * to `body` as a SIBLING of the dialog, so it is always "neither": a
 * scrollable one could be dragged by its scrollbar and moved by ↑/↓, but a
 * mouse wheel or a trackpad swipe did nothing at all.
 *
 * The lock's listener is on `document` in the BUBBLE phase, so stopping the
 * event at the panel means it is never seen and never cancelled, and the
 * browser scrolls the panel natively. Pair this with `overscroll-contain` on
 * the scroll container, which is what keeps the freed scroll from chaining to
 * the page at either end.
 *
 * Returns the `ref` to put on the panel; pass a forwarded `ref` in and it is
 * called too. Outside a dialog this changes nothing — there is no lock, and
 * `stopPropagation` does not stop the browser's own scrolling.
 */
export function useScrollLockBypass<T extends HTMLElement>(forwarded?: Ref<T> | undefined): RefCallback<T> {
  // State, not a ref: Radix mounts the portalled panel in a LATER commit than
  // the one that opens it, so an effect keyed on the open flag reads null and
  // never runs again. The node itself has to be the dependency.
  const [panel, setPanel] = useState<T | null>(null);

  useEffect(() => {
    if (panel === null) return undefined;
    const stop = (event: Event): void => {
      event.stopPropagation();
    };
    panel.addEventListener('wheel', stop);
    panel.addEventListener('touchmove', stop);
    return () => {
      panel.removeEventListener('wheel', stop);
      panel.removeEventListener('touchmove', stop);
    };
  }, [panel]);

  return useCallback(
    (node: T | null) => {
      setPanel(node);
      if (typeof forwarded === 'function') forwarded(node);
      else if (forwarded !== null && forwarded !== undefined) forwarded.current = node;
    },
    [forwarded],
  );
}
