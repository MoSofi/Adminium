// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `upload-dropzone` as the registry places it: the widget's config turned
 * into the dropzone's props. Apart from `UploadDropzone.tsx`, which is the
 * component alone and names no config schema.
 */
import { uploadDropzoneConfigSchema, uploadDropzoneDemoData } from './media-config.js';
import type { UploadDropzoneConfig } from './media-config.js';
import { UploadDropzone } from './UploadDropzone.js';
import type { WidgetProps } from '../../registry/types.js';

export { uploadDropzoneConfigSchema, uploadDropzoneDemoData };
export type { UploadDropzoneConfig };

export function UploadDropzoneWidget({ config }: WidgetProps<UploadDropzoneConfig>) {
  // No `onFiles` sink: `WidgetEvent` models drill-through/record-open/
  // mutate — it has no "here are some File handles" case, and inventing one is a
  // registry-contract change, not a widget decision. The dashboard composes the
  // exported <UploadDropzone> directly (import pages: dropzone +
  // column-mapping-table + validation-issues-list, annex) where it can hold
  // the File objects. Registry-placed, this instance is the visual affordance.
  return (
    <UploadDropzone
      {...(config.accept === undefined ? {} : { accept: config.accept })}
      {...(config.maxSize === undefined ? {} : { maxSize: config.maxSize })}
      multiple={config.multiple}
      disabled={config.disabled}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.dropTitle === undefined ? {} : { dropTitle: config.dropTitle })}
      {...(config.browsePrefix === undefined ? {} : { browsePrefix: config.browsePrefix })}
      {...(config.browseLabel === undefined ? {} : { browseLabel: config.browseLabel })}
      {...(config.hint === undefined ? {} : { hint: config.hint })}
    />
  );
}
