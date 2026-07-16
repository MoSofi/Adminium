import { IconTile } from '@adminium/ui';
import { CloudUpload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { formatSize, resolveLocale } from './media-lib.js';
import { uploadDropzoneConfigSchema, uploadDropzoneDemoData } from './media-config.js';
import type { UploadDropzoneConfig } from './media-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { uploadDropzoneConfigSchema, uploadDropzoneDemoData };
export type { UploadDropzoneConfig };

/**
 * `upload-dropzone` (annex §8) — the dashed-border drag-and-drop target: icon
 * tile, "Drop files to upload", a format/size hint, an "or browse" micro-CTA, and
 * an accent hover/drag-over state. Generalises the Studio-local
 * `apps/dashboard/src/studio/connect/Dropzone.tsx` (09 §8.2 mode c) into the
 * reusable registry widget.
 *
 * NO TRANSPORT: this widget renders state and EMITS files through `onFiles` — it
 * never uploads. There are no files routes yet (08 §2.11), so the host owns the
 * transport; when they land, the dashboard wires `onFiles` to them and pipes the
 * resulting job rows into `upload-progress-list`. Data contract is `static`
 * (annex §8: "none (emits files); constraints from config").
 *
 * The `maxSize` constraint is enforced here (oversize files are reported through
 * `onReject`, never silently dropped) because it is the one check that needs no
 * backend — everything else is the server's job.
 */

export interface UploadDropzoneProps {
  accept?: string | undefined;
  /** Max bytes per file; oversize picks are routed to `onReject`. */
  maxSize?: number | undefined;
  multiple?: boolean | undefined;
  disabled?: boolean | undefined;
  locale?: string | undefined;
  dropTitle?: string | undefined;
  browsePrefix?: string | undefined;
  browseLabel?: string | undefined;
  hint?: string | undefined;
  onFiles?: ((files: readonly File[]) => void) | undefined;
  /** Files rejected by the `maxSize` constraint, with the limit that failed. */
  onReject?: ((files: readonly File[], reason: 'max-size') => void) | undefined;
  testId?: string | undefined;
}

export function UploadDropzone({
  accept,
  maxSize,
  multiple = true,
  disabled = false,
  locale,
  dropTitle,
  browsePrefix,
  browseLabel,
  hint,
  onFiles,
  onReject,
  testId,
}: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const tag = resolveLocale(locale);

  const pick = (list: FileList | null): void => {
    if (list === null || list.length === 0) return;
    const files = multiple ? [...list] : [...list].slice(0, 1);
    if (maxSize === undefined) {
      onFiles?.(files);
      return;
    }
    const accepted = files.filter((file) => file.size <= maxSize);
    const rejected = files.filter((file) => file.size > maxSize);
    if (rejected.length > 0) onReject?.(rejected, 'max-size');
    if (accepted.length > 0) onFiles?.(accepted);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) pick(event.dataTransfer.files);
  };

  const sizeHint = maxSize === undefined ? undefined : formatSize(maxSize, tag);

  return (
    <div data-widget="upload-dropzone" data-testid={testId} className="flex h-full flex-col p-3">
      <button
        type="button"
        data-part="dropzone"
        disabled={disabled}
        data-dragging={dragging ? '' : undefined}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={
          'flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed ' +
          'border-border-strong bg-surface-2 px-6 py-8 text-center transition-colors duration-150 ' +
          'hover:border-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
          'disabled:pointer-events-none disabled:opacity-40 data-[dragging]:border-accent data-[dragging]:bg-accent-soft'
        }
      >
        <IconTile size="xl" tone="accent" icon={<CloudUpload />} className="mb-2" />
        <span className="text-body-sm font-bold text-fg">{dropTitle ?? 'Drop files to upload'}</span>
        <span className="text-caption text-fg-muted">
          {browsePrefix ?? 'or'} <span className="font-bold text-accent">{browseLabel ?? 'browse'}</span>
        </span>
        {(hint !== undefined || sizeHint !== undefined) && (
          <span className="mt-2 text-caption text-fg-subtle" data-part="dropzone-hint">
            {[hint, sizeHint].filter((part) => part !== undefined).join(' · ')}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        data-part="dropzone-input"
        multiple={multiple}
        {...(accept === undefined ? {} : { accept })}
        className="hidden"
        onChange={(event) => {
          pick(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}

export function UploadDropzoneWidget({ config }: WidgetProps<UploadDropzoneConfig>) {
  // No `onFiles` sink: `WidgetEvent` (04 §2.1) models drill-through/record-open/
  // mutate — it has no "here are some File handles" case, and inventing one is a
  // registry-contract change, not a widget decision. The dashboard composes the
  // exported <UploadDropzone> directly (import pages: dropzone +
  // column-mapping-table + validation-issues-list, annex §10) where it can hold
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
