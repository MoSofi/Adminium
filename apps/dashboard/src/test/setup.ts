/**
 * Vitest setup (happy-dom): Testing Library cleanup, a controllable
 * matchMedia stub (ThemeProvider tracks prefers-color-scheme), and reset of
 * localStorage + the theming attributes stamped on <html>.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { THEME_ATTRIBUTES } from '@adminium/tokens';

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
