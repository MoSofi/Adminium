import js from '@eslint/js';
import tseslint from 'typescript-eslint';

import adminium from '../src/eslint-plugin/index.js';
import { PHYSICAL_DIRECTION_ALLOWLIST } from './physical-direction-allowlist.js';

/**
 * Shared ESLint flat config for every Adminium workspace package.
 * Consumed as: `import adminium from '@adminium/config/eslint'`.
 *
 * Base: @eslint/js recommended + typescript-eslint recommended (non-type-aware,
 * kept minimal and fast). Adds the design-system guardrails from
 * 02-design-system.md §8: adminium/no-style-prop on JSX files, a ban on
 * styled-components/emotion/styled-jsx imports, and a ban on
 * physical-direction Tailwind utilities in string literals.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // CSS-in-JS libraries are banned everywhere; styling is Tailwind
      // utilities + CVA backed by @adminium/tokens (02-design-system.md §7).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['styled-components', 'styled-components/*'],
              message:
                'styled-components is banned — use Tailwind utilities + CVA backed by @adminium/tokens (02-design-system.md §7).',
            },
            {
              group: ['@emotion/*'],
              message:
                '@emotion/* is banned — use Tailwind utilities + CVA backed by @adminium/tokens (02-design-system.md §7).',
            },
            {
              group: ['styled-jsx', 'styled-jsx/*'],
              message:
                'styled-jsx is banned — use Tailwind utilities + CVA backed by @adminium/tokens (02-design-system.md §7).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { adminium },
    rules: {
      'adminium/no-style-prop': 'error',
      // Physical-direction Tailwind utilities break RTL; use logical
      // counterparts (ms-/me-/ps-/pe-/start-/end-/border-s-/border-e-/
      // rounded-s-/rounded-e-/text-start/text-end) per 10-i18n-theming.md §5.2.
      // Covers ml/mr/pl/pr/left/right/border-l/border-r/rounded-l/rounded-r/
      // rounded-corner/text-left/text-right, including under variant prefixes
      // (`rtl:ml-2`) and inside template literals; justified physical cases go
      // on the reviewed allowlist file.
      'adminium/no-physical-direction-classes': [
        'error',
        { allow: PHYSICAL_DIRECTION_ALLOWLIST },
      ],
    },
  },
  {
    // i18n key hygiene (10-i18n-theming.md §2.5). Everywhere, including plain
    // .ts: keys are assembled in config and data modules as often as in JSX.
    // Fabricated keys cannot be verified against the 8 bundles, are invisible
    // to the extractor and to the review-status tracker, and render as a raw
    // dotted string to the user when they miss. Validity of a non-fabricated
    // key is the type checker's job — see the rule docblock.
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.stories.tsx'],
    plugins: { adminium },
    rules: {
      'adminium/no-dynamic-i18n-key': 'error',
      // Same scope, same reason class (23-runtime-translations.md §4.6):
      // substituting a token into a translator's RESULT works only because
      // the call passes no ICU args and `format()` throws, and it breaks
      // outright once an admin can edit the message at runtime.
      'adminium/no-t-result-replace': 'error',
    },
  },
  {
    // Hardcoded UI copy renders English in all 8 locales (10-i18n-theming.md
    // §2.7). Scoped to the surfaces that OWN copy: @adminium/ui is deliberately
    // absent because every string there arrives as a prop by contract
    // (03-component-library.md §1), and tests/stories author throwaway text.
    files: [
      'apps/dashboard/src/**/*.tsx',
      'packages/widgets/src/**/*.tsx',
      'apps/desktop/src/**/*.tsx',
    ],
    ignores: ['**/*.test.tsx', '**/*.stories.tsx'],
    plugins: { adminium },
    rules: {
      'adminium/no-literal-strings': 'error',
    },
  },
  {
    // Deliberately `.ts` AS WELL as `.tsx`: the class strings this rule guards
    // live as often in plain-TS recipe modules (@adminium/ui lib/tones.ts's
    // toneSolidClasses, per-component Record<Tone, string> maps) as they do in
    // JSX. Restricting it to .tsx would have missed the canonical tone map.
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { adminium },
    rules: {
      // A literal colour (`text-white`) on a themed background (`bg-accent`)
      // pins one half of a token pair while the other half keeps flipping with
      // data-theme. This is invisible to the token-pair contrast gate
      // (packages/tokens/scripts/contrast-check.mjs measures token vs. token),
      // and it is how white-on-accent fell from 6.29:1 to 2.29:1 in five
      // components when the dark accent was re-tuned. Use the paired foreground
      // token (text-accent-fg on solid tones, text-<tone> on -soft, text-fg* on
      // surfaces) per 02-design-system.md §3.2 and @adminium/ui lib/tones.ts.
      'adminium/no-literal-color-on-token-bg': 'error',
    },
  },
);
