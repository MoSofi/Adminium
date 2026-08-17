// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `media` family public surface (annex §8) — the file/media components
 * (file-browser, upload-dropzone, upload-progress-list, attachment-list,
 * image-board, link-list) plus the TRACK MEDIA registry metadata. Component code
 * is also reachable through each definition's `lazy()` ref, so the registry still
 * emits one chunk per family (04 §2.3); this barrel is for direct
 * template/story composition and tests. Registry metadata lives in
 * `media-track.definitions.ts`; schemas + demo generators in `media-config.ts`.
 */
export {
  FileBrowser,
  FileBrowserWidget,
  fileBrowserConfigSchema,
  fileBrowserDemoData,
  fileNodesOf,
  type FileBrowserConfig,
  type FileBrowserProps,
} from './FileBrowser.js';
export {
  UploadDropzone,
  UploadDropzoneWidget,
  uploadDropzoneConfigSchema,
  uploadDropzoneDemoData,
  type UploadDropzoneConfig,
  type UploadDropzoneProps,
} from './UploadDropzone.js';
export {
  UploadProgressList,
  UploadProgressListWidget,
  uploadJobsOf,
  uploadProgressListConfigSchema,
  uploadProgressListDemoData,
  type UploadJob,
  type UploadProgressListConfig,
  type UploadProgressListProps,
  type UploadStatus,
} from './UploadProgressList.js';
export {
  AttachmentList,
  AttachmentListWidget,
  attachmentListConfigSchema,
  attachmentListDemoData,
  attachmentsOf,
  type Attachment,
  type AttachmentListConfig,
  type AttachmentListProps,
} from './AttachmentList.js';
export {
  ImageBoard,
  ImageBoardWidget,
  boardImagesOf,
  imageBoardConfigSchema,
  imageBoardDemoData,
  type BoardImage,
  type ImageBoardConfig,
  type ImageBoardProps,
} from './ImageBoard.js';
export {
  LinkList,
  LinkListWidget,
  isSafeHref,
  linkListConfigSchema,
  linkListDemoData,
  referenceLinksOf,
  type LinkListConfig,
  type LinkListProps,
  type ReferenceLink,
} from './LinkList.js';
export {
  FILE_KINDS,
  FILE_KIND_TONE,
  ROOT_ID,
  SMART_FOLDER_FILTERS,
  bindingSourceOf,
  breadcrumbTrail,
  childrenOf,
  clampPct,
  displayUrl,
  extensionOf,
  fileRowsOf,
  formatModified,
  formatSize,
  kindOf,
  type BindingSource,
  type FileKind,
  type FileNode,
  type SmartFolderFilter,
} from './media-lib.js';
export { fileIconFor, fileKindIcon, linkIcon } from './media-icons.js';
export { smartFolderSchema, type SmartFolderConfig } from './media-config.js';
export {
  attachmentListDefinition,
  fileBrowserDefinition,
  imageBoardDefinition,
  linkListDefinition,
  mediaTrackDefinitions,
  uploadDropzoneDefinition,
  uploadProgressListDefinition,
} from './media-track.definitions.js';
