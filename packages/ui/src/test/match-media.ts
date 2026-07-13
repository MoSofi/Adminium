/**
 * Controllable `window.matchMedia` mock for happy-dom tests.
 *
 * happy-dom's built-in matchMedia cannot flip `prefers-color-scheme` at
 * runtime, which ThemeProvider's `system` tracking needs. `installMatchMedia`
 * replaces `window.matchMedia` with an implementation that tracks every
 * `(prefers-color-scheme: dark)` list it hands out and lets the test flip the
 * scheme, dispatching `change` events to `addEventListener`/`addListener`
 * subscribers. All other queries return static non-matching lists.
 */
const DARK_QUERY = '(prefers-color-scheme: dark)';

type ChangeListener = (event: MediaQueryListEvent) => void;

export interface MatchMediaController {
  /** Current `(prefers-color-scheme: dark)` state. */
  readonly prefersDark: boolean;
  /** Flip the scheme and notify every live dark-query list. */
  setPrefersDark(next: boolean): void;
  /** Total `change` listeners currently attached to dark-query lists. */
  listenerCount(): number;
}

interface MutableMediaQueryList {
  matches: boolean;
  media: string;
  onchange: ChangeListener | null;
  addEventListener(type: string, listener: ChangeListener): void;
  removeEventListener(type: string, listener: ChangeListener): void;
  addListener(listener: ChangeListener): void;
  removeListener(listener: ChangeListener): void;
  dispatchEvent(): boolean;
}

export function installMatchMedia(
  options: { prefersDark?: boolean } = {},
): MatchMediaController {
  let prefersDark = options.prefersDark ?? false;
  const darkLists: { list: MutableMediaQueryList; listeners: Set<ChangeListener> }[] = [];

  const makeList = (query: string): MutableMediaQueryList => {
    const isDarkQuery = query === DARK_QUERY;
    const listeners = new Set<ChangeListener>();
    const list: MutableMediaQueryList = {
      matches: isDarkQuery ? prefersDark : false,
      media: query,
      onchange: null,
      addEventListener(type, listener) {
        if (type === 'change') listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'change') listeners.delete(listener);
      },
      addListener(listener) {
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
      dispatchEvent() {
        return false;
      },
    };
    if (isDarkQuery) darkLists.push({ list, listeners });
    return list;
  };

  // happy-dom's window type is structurally a DOM Window; the cast keeps the
  // mock minimal instead of implementing the full MediaQueryList interface.
  (window as unknown as { matchMedia: (query: string) => MutableMediaQueryList }).matchMedia = (
    query: string,
  ) => makeList(query);

  return {
    get prefersDark() {
      return prefersDark;
    },
    setPrefersDark(next: boolean) {
      if (next === prefersDark) return;
      prefersDark = next;
      for (const { list, listeners } of darkLists) {
        list.matches = next;
        const event = { matches: next, media: DARK_QUERY } as MediaQueryListEvent;
        list.onchange?.(event);
        for (const listener of [...listeners]) listener(event);
      }
    },
    listenerCount() {
      return darkLists.reduce((total, entry) => total + entry.listeners.size, 0);
    },
  };
}
