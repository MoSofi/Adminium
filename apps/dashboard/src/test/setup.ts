/**
 * Vitest setup (happy-dom): Testing Library cleanup, a controllable
 * matchMedia stub (ThemeProvider tracks prefers-color-scheme), and reset of
 * localStorage + the theming attributes stamped on <html>.
 */
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { THEME_ATTRIBUTES } from '@adminium/tokens';

/**
 * Testing Library's default `asyncUtilTimeout` is 1000ms — the budget a
 * `findBy*` gives an element to appear. That is fine for a suite running alone,
 * and too tight for this one running under `turbo run test`: turbo executes the
 * dashboard and @adminium/widgets suites CONCURRENTLY, and each vitest sizes its
 * worker pool to the full CPU count, so an 8-core machine runs ~16 workers. At
 * 2x oversubscription these lazily-mounted, i18n-provider-wrapped pages take
 * >1000ms to paint — renders measured at ~380ms standalone were observed at
 * ~3400ms under load — and `findBy*` gave up mid-render. That surfaced as ~17
 * failures scattered across 8 unrelated files (PreferencesPage, pageRenderer,
 * StudioAiPage, …), every one of which passed when its file was run alone. M7
 * Wave 4 is what tipped it over: it roughly doubled the concurrently-running
 * widgets suite.
 *
 * Raising the budget removes a load-sensitive FALSE NEGATIVE without weakening
 * a single assertion: `findBy*` still fails when an element never appears — it
 * just waits long enough to tell truth from CPU starvation. `testTimeout` in
 * vitest.config.ts is raised in step so a slow-but-correct render is not cut off
 * by the enclosing 5s test budget instead.
 */
configure({ asyncUtilTimeout: 5000 });

function installMatchMedia(): void {
  const mql = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  window.matchMedia = mql as typeof window.matchMedia;
}

beforeEach(() => {
  // Files pinned to `// @vitest-environment node` (e.g. prehydration.test.ts) have no DOM.
  if (typeof window === 'undefined') return;
  installMatchMedia();
  window.localStorage.clear();
  window.sessionStorage.clear();
  for (const attribute of Object.values(THEME_ATTRIBUTES)) {
    document.documentElement.removeAttribute(attribute);
  }
});

afterEach(() => {
  cleanup();
});
