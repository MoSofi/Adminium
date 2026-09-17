// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-files` template — the component the dashboard PageRenderer mounts for
 * `template: 'page-files'` envelopes, plus the pure config-projection helpers
 * its binding and tests share.
 */
export {
  PAGE_FILES_TEMPLATE_ID,
  PageFiles,
  classifyFilesItems,
  type PageFilesLabels,
  type PageFilesProps,
} from './PageFiles.js';
export { hasStarredColumn, resolveFileBrowserConfig } from './file-mapping.js';
export { demoFilesLayout } from './demo-layout.js';
