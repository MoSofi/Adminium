// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';

/**
 * useCommandK — global ⌘K / Ctrl+K hotkey (research/design-system.md §3
 * Tier 3 CommandPalette). Fires `onTrigger` and prevents the browser default;
 * typical wiring toggles the palette: `useCommandK(() => setOpen((o) => !o))`.
 */
export function useCommandK(onTrigger: () => void, options: { enabled?: boolean | undefined } = {}): void {
  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        event.preventDefault();
        onTrigger();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // onTrigger intentionally unbound — callers pass inline lambdas; latest
    // closure is captured via the listener re-registration below.
  }, [enabled, onTrigger]);
}
