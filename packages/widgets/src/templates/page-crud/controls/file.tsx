// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The three file LOOKS (comp 233–236, 377–378, 464–475) over ONE pipeline.
 *
 * `FileField` already owns the upload, the workspace cap, the refusal and the
 * stored-reference grammar (plan 38). Nothing here re-implements any of that:
 * an image square, an avatar circle and an attachments box are the same field
 * wearing what the comp draws for the kind of file it holds. A second upload
 * path would be a second set of bugs about the same bytes.
 */
import { useMaybeT } from '@adminium/i18n/react';

import { FileField } from '../FileField.js';
import type { ControlProps } from './types.js';

function fileProps(props: ControlProps) {
  return {
    column: props.column,
    value: props.value,
    onChange: (next: string | null) => props.onChange(next),
    ...(props.upload === undefined ? {} : { upload: props.upload }),
    ...(props.files === undefined ? {} : { resolvedByRef: props.files }),
    ...(props.files?.get(String(props.value ?? '')) === undefined
      ? {}
      : { resolved: props.files.get(String(props.value ?? '')) }),
    ...((props.column.file?.maxBytes ?? props.maxFileBytes) === undefined
      ? {}
      : { maxBytes: props.column.file?.maxBytes ?? props.maxFileBytes }),
    ...(props.id === undefined ? {} : { inputId: props.id }),
  };
}

/**
 * The caption under an attachments box, GENERATED from what the column
 * actually accepts (comp 475) — never a fixed sentence.
 *
 * "PDF or PNG, up to 10 MB" is true only when the block says so; with no
 * restriction there is nothing honest to write, so nothing is written.
 */
function acceptCaption(props: ControlProps, t: ReturnType<typeof useMaybeT>): string | null {
  const accept = props.column.file?.accept;
  const maxBytes = props.column.file?.maxBytes ?? props.maxFileBytes;
  const kinds =
    accept === undefined || accept.length === 0
      ? null
      : accept
          .map((entry) => entry.replace(/^\./, '').replace('/*', '').toUpperCase())
          .filter((entry) => entry !== '')
          .join(' · ');
  const size =
    maxBytes === undefined
      ? null
      : t('ui:formDialog.control.upTo', 'up to {size} MB', {
          size: String(Math.round(maxBytes / (1024 * 1024))),
        });
  if (kinds === null && size === null) return null;
  return [kinds, size].filter((part) => part !== null).join(', ');
}

export function AttachmentsControl(props: ControlProps) {
  const t = useMaybeT();
  const caption = acceptCaption(props, t);
  return (
    <div className="flex flex-col gap-1.5">
      <FileField {...fileProps(props)} />
      {caption === null ? null : <p className="text-[11.5px] text-fg-subtle">{caption}</p>}
    </div>
  );
}

/** A square preview for an image column (comp 233–236). */
export function ImageControl(props: ControlProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="size-20 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-2">
        <FilePreview {...props} className="size-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <FileField {...fileProps(props)} />
      </div>
    </div>
  );
}

/** The same, round, for a person (comp 377–378). */
export function AvatarControl(props: ControlProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="size-14 shrink-0 overflow-hidden rounded-full border border-border bg-surface-2">
        <FilePreview {...props} className="size-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <FileField {...fileProps(props)} />
      </div>
    </div>
  );
}

/**
 * What the current value looks like, when the host has resolved it.
 *
 * `contentPath` is a SAME-ORIGIN path by contract — never a destination's
 * public URL, which the CSP blocks — so the preview asks for the
 * resolved file rather than building a link of its own.
 *
 * Decorative: the file's name is already in the field beside it, so a second
 * announcement of the same thing is noise to a screen reader.
 */
function FilePreview(props: ControlProps & { className?: string }) {
  const resolved = props.files?.get(String(props.value ?? ''));
  if (resolved === undefined || resolved === null) return null;
  if (!resolved.mime.startsWith('image/')) return null;
  return <img src={resolved.contentPath} alt="" aria-hidden="true" className={props.className ?? ''} />;
}
