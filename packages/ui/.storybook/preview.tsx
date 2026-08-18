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
  initialGlobals: {
    theme: 'light',
    accent: 'indigo',
    density: 'comfortable',
    dir: 'ltr',
    // Stops addon-a11y auto-running axe in the preview iframe — see the note on
    // `parameters.a11y` below. In Storybook 9 this switch is a GLOBAL; the
    // identically-named parameter is read by nothing.
    a11y: { manual: true },
  },
  decorators: [withThemeAxes],
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    controls: { expanded: true },
    // addon-a11y runs axe-core automatically in the preview iframe on every
    // story render. `scripts/a11y-sweep.mjs` navigates to that same iframe and
    // runs axe itself (the authoritative ratchet gate), so the two collide on
    // one document and axe throws "Axe is already running" — whichever story's
    // addon run happens to overlap the sweep's.
    //
    // THE SWITCH MOVED. This was `parameters.a11y.manual: true`, which is what
    // Storybook 8 read. The 9.x addon gates its run on
    //   `parameters.a11y.disable !== true && parameters.a11y.test !== 'off'
    //    && globals.a11y.manual !== true`
    // (verified in the installed `dist/preview.js`) — the PARAMETER named
    // `manual` appears nowhere in it, so the old setting was silently inert and
    // the sweep kept flaking while this file claimed to have fixed it.
    //
    // `test: 'off'` here is the parameter-level switch; `globals.a11y.manual` in
    // `initialGlobals` above is the direct successor to the old one. Either
    // alone suffices — both are set because a switch that quietly stops being
    // read is precisely the failure this comment exists to record. The panel
    // still runs on demand, and the sweep owns the real gate.
    //
    // WHY THE TWO AXE RUNS COLLIDE AT ALL, since it is not obvious: the addon
    // bundles its own axe-core (4.12.1) which self-registers on `window.axe`,
    // and `@axe-core/playwright` (4.13.x) injects into that same global. They
    // are different versions but share one `_running` flag, so the sweep's run
    // throws the moment it lands on a story whose addon run is still going.
    //
    // MEASURED, not assumed — polling `axe._running` during story render:
    // before this change the addon ran on 2 of 3 sampled stories (including
    // `document-canvas-report`, the exact story CI reported); after, 0 of 3.
    // Note that counting `window.axe.run` calls does NOT detect it: the addon
    // holds its own module reference and never calls through the global.
    a11y: { test: 'off' },
  },
};

export default preview;
