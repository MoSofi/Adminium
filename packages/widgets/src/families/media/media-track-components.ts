/**
 * `media` family component barrel — the single lazy-import target for this
 * family's definitions, so the registry metadata graph reaches the
 * @adminium/ui-heavy media components only through a dynamic `import()` boundary
 * (one lazy chunk for the family, 04 §2.3). Mirrors the kpi/charts/feeds/boards
 * `*-components.ts` convention.
 */
export { AttachmentListWidget } from './AttachmentList.js';
export { FileBrowserWidget } from './FileBrowser.js';
export { ImageBoardWidget } from './ImageBoard.js';
export { LinkListWidget } from './LinkList.js';
export { UploadDropzoneWidget } from './UploadDropzone.js';
export { UploadProgressListWidget } from './UploadProgressList.js';
