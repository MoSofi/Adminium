/**
 * Vitest setup for @adminium/ui (happy-dom environment).
 * - Testing Library cleanup after every test (no `globals: true`, so the
 *   auto-cleanup entry point does not apply).
 * - Fresh controllable matchMedia mock per test (light scheme by default);
 *   tests that need to flip the scheme call `installMatchMedia` themselves.
 * - Reset localStorage and the theming attributes ThemeProvider stamps on
 *   `<html>`, so tests never leak axis state into each other.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { THEME_ATTRIBUTES } from '@adminium/tokens';

import { installMatchMedia } from './match-media.js';

beforeEach(() => {
  installMatchMedia();
  window.localStorage.clear();
  for (const attribute of Object.values(THEME_ATTRIBUTES)) {
    document.documentElement.removeAttribute(attribute);
  }
});

afterEach(() => {
  cleanup();
});
