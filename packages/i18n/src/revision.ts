/**
 * The i18n revision counter (23-runtime-translations.md §4.4).
 *
 * A language switch is observable — i18next emits `languageChanged` and the
 * provider re-renders. An OVERRIDE change is not: the language is identical,
 * the resource store simply now holds different text. Nothing in React knows
 * anything happened.
 *
 * So every operation that changes what a key resolves to bumps this counter,
 * and the surfaces that render translated text subscribe to it.
 *
 * Why a re-render and not a remount: the obvious fix — keying the subtree on
 * the revision — remounts `ThemeProvider`, which owns the locale axis and
 * holds the optimistic `setPref` layer. That wipes the user's in-flight locale
 * choice (bootstrap's server value then wins and the switch silently reverts)
 * and destroys the Translations editor's own unsaved buffer on every save. A
 * plain re-render propagates new text and keeps all component state.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let revision = 0;

/** Current revision — the `getSnapshot` for `useSyncExternalStore`. */
export function getI18nRevision(): number {
  return revision;
}

/** Subscribe to revision changes; returns an unsubscribe function. */
export function subscribeI18nRevision(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Announce that resolved text has changed. Call after applying, replacing or
 * clearing runtime overrides, and after swapping the instance.
 *
 * Listeners are isolated: one throwing subscriber must not stop the rest from
 * learning that the strings moved.
 */
export function bumpI18nRevision(): void {
  revision += 1;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error('[i18n] revision subscriber threw', error);
    }
  }
}

/** Test helper — reset the counter and drop every subscriber. */
export function resetI18nRevision(): void {
  revision = 0;
  listeners.clear();
}
