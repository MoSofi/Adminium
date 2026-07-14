/**
 * Upload dropzone for the schema-file source mode (09 §8.2 mode c) — local
 * to Studio until a shared `upload-dropzone` lands in @adminium/ui. Drag or
 * browse; hands the caller the File. Validation/copy stays in the step.
 */
import { UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import type * as React from 'react';

import { t } from '../../i18n/t.js';

export interface DropzoneProps {
  /** Comma-separated `accept` for the hidden input (e.g. ".sql,.json"). */
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean | undefined;
}

export function Dropzone({ accept, onFile, disabled = false }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file !== undefined) onFile(file);
  };

  const onDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) pick(event.dataTransfer.files);
  };

  return (
    <>
      <button
        type="button"
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
          'flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border-strong bg-surface-2 px-6 py-10 ' +
          'text-center transition-colors duration-150 hover:border-fg-subtle ' +
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
          'disabled:pointer-events-none disabled:opacity-40 data-[dragging]:border-accent data-[dragging]:bg-accent-soft'
        }
      >
        <UploadCloud aria-hidden="true" className="size-6 text-fg-subtle" />
        <span className="text-body-sm font-semibold text-fg">
          {t('studio.source.file.dropTitle', 'Drop your schema file here, or browse')}
        </span>
        <span className="text-caption text-fg-muted">
          {t('studio.source.file.dropHint', '.sql or .json — pg_dump, CREATE TABLE scripts, Adminium JSON')}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          pick(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}
