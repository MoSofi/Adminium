// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The default `page-files` demo layout — the manifest's slot areas
 * (templates/page-files.json) filled the way the §14 archetype pass fills them
 * on an attachments table: the required `browser` slot (`file-browser`) and
 * the `usage` slot (`usage-meter`). No bindings → every widget renders
 * `demoData(hash(instanceId))` (04 §5.3 demo mode). Used by Storybook, tests
 * and first-run states.
 */

import type { PageLayout } from '../../page-config/index.js';

export const demoFilesLayout: PageLayout = {
  version: 1,
  items: [
    {
      i: 'browser',
      widget: 'file-browser',
      x: 3,
      y: 0,
      w: 9,
      h: 12,
      config: { title: 'Files' },
    },
    {
      i: 'usage',
      widget: 'usage-meter',
      x: 0,
      y: 12,
      w: 3,
      h: 3,
      config: { title: 'Attachments Storage', format: 'filesize', max: 5_000_000_000 },
    },
  ],
};
