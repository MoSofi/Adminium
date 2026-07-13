import js from '@eslint/js';
import tseslint from 'typescript-eslint';

import adminium from '../src/eslint-plugin/index.js';

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
      // counterparts (ms-/me-/ps-/pe-/start-/end-/text-start/text-end)
      // per 02-design-system.md §3.2/§8.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/(^|\\s)(-?(ml|mr|pl|pr|left|right)-|text-left(\\s|$)|text-right(\\s|$))/]',
          message:
            'Physical-direction Tailwind utility — use the logical equivalent (ms-/me-/ps-/pe-/start-/end-/text-start/text-end) per 02-design-system.md §3.2.',
        },
      ],
    },
  },
);
