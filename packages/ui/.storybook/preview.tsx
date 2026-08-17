// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Storybook preview — the four theming axes as global toolbar items
 * (03-component-library.md §8, 02-T13). One decorator drives everything by
 * mounting the real ThemeProvider with the toolbar globals as `userPrefs`, so
 * stories get exactly the DOM attributes (`data-theme`/`data-accent`/
 * `data-density`/`dir`/`lang`) and Radix DirectionProvider the apps get.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Decorator, Preview } from '@storybook/react-vite';
import { ACCENTS, DENSITIES, DIRS } from '@adminium/tokens';
import type { Accent, Density, Dir, ResolvedTheme } from '@adminium/tokens';

import { ThemeProvider } from '../src/theme/index.js';

import '@adminium/tokens/index.css';
import '../src/styles/storybook.css';
// The charts + widgets stories in the glob above render the chart primitives,
// whose `.adm-chart-*` / `.adm-donut-*` classes are hand-written CSS rather than
// Tailwind utilities — without this every chart story renders with unstyled SVG
// text and an unstyled donut legend. Reached by relative path for the same
// reason the stories are: `@adminium/ui` does not depend on `@adminium/charts`.
import '../../charts/src/styles.css';

/** Signals the VRT runner that mount effects have settled (03 §10). */
function VrtReady({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-vrt-ready', 'true');
    return () => {
      document.documentElement.removeAttribute('data-vrt-ready');
    };
  }, []);
  return children;
}

const withThemeAxes: Decorator = (Story, context) => {
  const theme = context.globals['theme'] as ResolvedTheme;
  const accent = context.globals['accent'] as Accent;
  const density = context.globals['density'] as Density;
  const dir = context.globals['dir'] as Dir;
  // dir is derived from locale in the provider; the toolbar exposes dir
  // directly, so map it back to the locale that produces it.
  const locale = dir === 'rtl' ? 'ar_EG' : 'en_US';
  return (
    // key remounts the provider on axis change, discarding any story-local setPref state
    <ThemeProvider
      key={`${theme}/${accent}/${density}/${dir}`}
      userPrefs={{ theme, accent, density, locale }}
    >
      <VrtReady>
        <Story />
      </VrtReady>
    </ThemeProvider>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Color theme',
      toolbar: { icon: 'sun', items: ['light', 'dark'], dynamicTitle: true },
    },
    accent: {
      description: 'Accent palette',
      toolbar: { icon: 'paintbrush', items: Object.keys(ACCENTS), dynamicTitle: true },
    },
    density: {
      description: 'Density',
      toolbar: { icon: 'grow', items: [...DENSITIES], dynamicTitle: true },
    },
    dir: {
      description: 'Text direction',
      toolbar: { icon: 'transfer', items: [...DIRS], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light', accent: 'indigo', density: 'comfortable', dir: 'ltr' },
  decorators: [withThemeAxes],
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    controls: { expanded: true },
    // addon-a11y runs axe-core automatically in the preview iframe on every
    // story render. scripts/a11y-sweep.mjs navigates to that same iframe and
    // runs axe itself (the authoritative ratchet gate), so the two collide on
    // one document — axe throws "Axe is already running" intermittently,
    // whichever story's addon run overlaps the sweep's. `manual: true` stops the
    // addon auto-running; the panel still checks on demand, and the sweep owns
    // the real gate. This is the deterministic fix the per-page/retry
    // mitigations in the sweep could only paper over.
    a11y: { manual: true },
  },
};

export default preview;
