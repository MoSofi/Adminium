import noLiteralColorOnTokenBg from './no-literal-color-on-token-bg.js';
import noPhysicalDirectionClasses from './no-physical-direction-classes.js';
import noStyleProp from './no-style-prop.js';

/**
 * eslint-plugin-adminium — shipped from @adminium/config (02-design-system.md §8).
 * Wired into the shared flat config exported at '@adminium/config/eslint'.
 */
const plugin = {
  meta: {
    name: 'eslint-plugin-adminium',
    version: '0.0.0',
  },
  rules: {
    'no-style-prop': noStyleProp,
    'no-physical-direction-classes': noPhysicalDirectionClasses,
    'no-literal-color-on-token-bg': noLiteralColorOnTokenBg,
  },
};

export default plugin;
