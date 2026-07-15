import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: [
    '../src/**/*.mdx',
    '../src/**/*.stories.tsx',
    // 04-T17 QA harness: the charts + widgets stories (incl.
    // widgets/src/qa/qa-widgets.stories.tsx — every widget × four WidgetFrame
    // states, tagged `vrt`) are part of the workspace Storybook + VRT matrix
    // (acceptance #9). The @adminium/charts barrel is now assembled and its
    // built `dist` exports every primitive these stories consume, so the glob
    // resolves. See packages/widgets/src/qa/README.md.
    '../../charts/src/**/*.stories.tsx',
    '../../widgets/src/**/*.stories.tsx',
  ],
  addons: ['@storybook/addon-a11y'],
  async viteFinal(viteConfig) {
    // Tailwind v4 compiles src/styles/storybook.css (tokens + @source globs).
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
    return viteConfig;
  },
};

export default config;
