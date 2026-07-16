import { lazy } from 'react';

import {
  attachmentListConfigSchema,
  attachmentListDemoData,
  fileBrowserConfigSchema,
  fileBrowserDemoData,
  imageBoardConfigSchema,
  imageBoardDemoData,
  linkListConfigSchema,
  linkListDemoData,
  uploadDropzoneConfigSchema,
  uploadDropzoneDemoData,
  uploadProgressListConfigSchema,
  uploadProgressListDemoData,
} from './media-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * TRACK MEDIA — `media` family registry metadata (annex §8; 04-T10). Metadata
 * only: the @adminium/ui-heavy widget components load through the
 * `media-track-components` barrel via `lazy(() => import(...))`, so the family
 * stays in ONE lazy chunk and the registry metadata never eagerly pulls the
 * component code into a sibling family's bundle (04 §2.3; the chunk-budget gate).
 * Schemas + `demoData` come from the PURE `media-config.ts` for the same reason.
 * The GREEN LOOP spreads `mediaTrackDefinitions` into the registry map. Widget
 * ids match the annex catalog exactly (acceptance #1).
 *
 * Sizing is the annex's grid note converted to 40px half-units
 * (04 §6.1: `h = round(annexRows × 2)`); widths map 1:1.
 *
 * `capabilities.editsData` marks the widgets that emit `mutate` intents (star a
 * file, delete an attachment, edit a caption, add/remove a link) — the host runs
 * them through the CRUD API with undo + audit; the widgets never write.
 */

export const fileBrowserDefinition: WidgetDefinition = defineWidget({
  id: 'file-browser',
  family: 'media',
  component: lazy(() => import('./media-track-components.js').then((m) => ({ default: m.FileBrowserWidget }))),
  configSchema: fileBrowserConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 8, minH: 12, defaultW: 12, defaultH: 18 }, // annex "full page body"
  placement: 'page',
  skeleton: 'block',
  capabilities: { editsData: true, exportCsv: true },
  demoData: fileBrowserDemoData,
  descriptionKey: 'widgets.media.fileBrowser.description',
});

export const uploadDropzoneDefinition: WidgetDefinition = defineWidget({
  id: 'upload-dropzone',
  family: 'media',
  component: lazy(() => import('./media-track-components.js').then((m) => ({ default: m.UploadDropzoneWidget }))),
  configSchema: uploadDropzoneConfigSchema,
  // annex §8: "none (emits files); constraints from config" — `static` is the
  // §3 shape for a widget whose payload is its config.
  dataContract: 'static',
  sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 4 }, // annex "min 4×2, default 6×2"
  placement: 'grid',
  skeleton: 'block',
  demoData: uploadDropzoneDemoData,
  descriptionKey: 'widgets.media.uploadDropzone.description',
});

export const uploadProgressListDefinition: WidgetDefinition = defineWidget({
  id: 'upload-progress-list',
  family: 'media',
  component: lazy(() => import('./media-track-components.js').then((m) => ({ default: m.UploadProgressListWidget }))),
  configSchema: uploadProgressListConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 }, // annex "min 3×2"
  placement: 'grid',
  skeleton: 'list',
  demoData: uploadProgressListDemoData,
  descriptionKey: 'widgets.media.uploadProgressList.description',
});

export const attachmentListDefinition: WidgetDefinition = defineWidget({
  id: 'attachment-list',
  family: 'media',
  component: lazy(() => import('./media-track-components.js').then((m) => ({ default: m.AttachmentListWidget }))),
  configSchema: attachmentListConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 }, // annex "min 3×2"
  placement: 'grid',
  skeleton: 'list',
  capabilities: { editsData: true },
  demoData: attachmentListDemoData,
  descriptionKey: 'widgets.media.attachmentList.description',
});

export const imageBoardDefinition: WidgetDefinition = defineWidget({
  id: 'image-board',
  family: 'media',
  component: lazy(() => import('./media-track-components.js').then((m) => ({ default: m.ImageBoardWidget }))),
  configSchema: imageBoardConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 6, minH: 8, defaultW: 6, defaultH: 10 }, // annex "min 6×4"
  placement: 'grid',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: imageBoardDemoData,
  descriptionKey: 'widgets.media.imageBoard.description',
});

export const linkListDefinition: WidgetDefinition = defineWidget({
  id: 'link-list',
  family: 'media',
  component: lazy(() => import('./media-track-components.js').then((m) => ({ default: m.LinkListWidget }))),
  configSchema: linkListConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 3, minH: 4, defaultW: 4, defaultH: 6 }, // annex "min 3×2"
  placement: 'grid',
  skeleton: 'list',
  capabilities: { editsData: true },
  demoData: linkListDemoData,
  descriptionKey: 'widgets.media.linkList.description',
});

export const mediaTrackDefinitions: readonly WidgetDefinition[] = [
  fileBrowserDefinition,
  uploadDropzoneDefinition,
  uploadProgressListDefinition,
  attachmentListDefinition,
  imageBoardDefinition,
  linkListDefinition,
];
