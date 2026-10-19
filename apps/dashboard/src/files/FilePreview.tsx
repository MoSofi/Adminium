// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a file looks like, where the browser can show it: the grid's tile
 * thumbnail and the drawer's preview.
 *
 * EVERY RENDERED BYTE GOES THROUGH `?inline=1`. The content route answers
 * `attachment` by default and honours `inline` only for its own allowlist
 * (`INLINE_SAFE` in `apps/server/src/routes/files/index.ts`), never SVG, and
 * sandboxes what it does serve inline. So the kinds below are that allowlist's
 * shape and no wider: asking for an SVG inline would get an attachment back.
 *
 * TEXT IS THE ONE EXCEPTION, and it is not rendered: it is fetched and put in a
 * `<pre>` as a string, so an HTML or script file shows as its source and runs
 * nothing. Only the head of it is read — a 300 MB log is not a preview.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { IconTile, Spinner, cn } from '@adminium/ui';
import { FILE_KIND_TONE, fileIconFor, kindOf } from '@adminium/widgets';

import { t } from '../i18n/t.js';
import type { FileDto } from './api.js';
import { formatBytes } from './filesQueries.js';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';

/** The image types every browser draws — HEIC is inline-safe but Chrome cannot decode it. */
const IMAGE_MIMES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_MIMES: ReadonlySet<string> = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const AUDIO_MIMES: ReadonlySet<string> = new Set(['audio/mpeg', 'audio/wav', 'audio/ogg']);
const TEXT_MIMES: ReadonlySet<string> = new Set(['application/json', 'application/xml']);

/** How much of a text file the drawer reads. */
const TEXT_PREVIEW_BYTES = 64 * 1024;

/**
 * A tile downloads its picture whole, so a 40 MB photo would cost 40 MB per
 * tile. Above this the tile keeps its icon; the drawer still shows the image.
 */
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

export function previewKindOf(file: FileDto): PreviewKind | null {
  // Trashed bytes 404 (D12): there is nothing to show.
  if (file.deletedAt !== null) return null;
  if (IMAGE_MIMES.has(file.mime)) return 'image';
  if (VIDEO_MIMES.has(file.mime)) return 'video';
  if (AUDIO_MIMES.has(file.mime)) return 'audio';
  if (file.mime === 'application/pdf') return 'pdf';
  if (file.mime.startsWith('text/') || TEXT_MIMES.has(file.mime)) return 'text';
  return null;
}

function inlinePath(file: FileDto): string {
  return `${file.contentPath}?inline=1`;
}

function TypeIcon({ file, size }: { file: FileDto; size: 'sm' | 'lg' }): ReactNode {
  return (
    <IconTile
      size={size}
      tone={FILE_KIND_TONE[kindOf(undefined, file.mime, file.filename)]}
      icon={fileIconFor(undefined, file.mime, file.filename)}
    />
  );
}

/** The small type icon that sits beside a file's name. */
export function FileTypeIcon({ file }: { file: FileDto }): ReactNode {
  return <TypeIcon file={file} size="sm" />;
}

/**
 * The tile's picture box. ALWAYS the same height, whatever is in it, so every
 * tile in a row lines up — a file with no picture gets its type icon centred
 * in the same box rather than a shorter tile.
 */
export function FileThumbnail({ file, className }: { file: FileDto; className?: string }): ReactNode {
  const [failed, setFailed] = useState(false);
  const kind = previewKindOf(file);
  const pictured =
    !failed &&
    file.sizeBytes <= THUMBNAIL_MAX_BYTES &&
    (kind === 'image' || kind === 'video');

  return (
    <div
      className={cn(
        'flex h-32 w-full items-center justify-center overflow-hidden rounded-md bg-surface-2',
        className,
      )}
      data-testid="files-thumbnail"
    >
      {!pictured ? (
        <TypeIcon file={file} size="lg" />
      ) : kind === 'image' ? (
        <img
          src={inlinePath(file)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        // The first frame, from a metadata-only fetch (the route answers
        // ranges). `#t=0.1` because some encoders leave frame 0 black.
        <video
          src={`${inlinePath(file)}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          aria-hidden
          onError={() => setFailed(true)}
          className="pointer-events-none size-full object-cover"
        />
      )}
    </div>
  );
}

/** The drawer's preview. Renders nothing at all for a kind it cannot show. */
export function FilePreview({ file }: { file: FileDto }): ReactNode {
  const kind = previewKindOf(file);
  const [failed, setFailed] = useState(false);
  const title = t('files:drawer.previewTitle', 'Preview of {name}', { name: file.filename });

  if (kind === null) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center"
        data-testid="files-preview-none"
      >
        <TypeIcon file={file} size="lg" />
        <span className="text-body-sm text-fg-muted">
          {file.deletedAt === null
            ? t('files:drawer.previewNone', 'There is no preview for this kind of file.')
            : t('files:drawer.previewTrashed', 'A file in the trash cannot be previewed.')}
        </span>
      </div>
    );
  }

  if (failed) return <PreviewFailed />;

  const frame = 'w-full rounded-lg border border-border bg-surface-2';
  switch (kind) {
    case 'image':
      return (
        <div className={cn(frame, 'flex items-center justify-center overflow-hidden')} data-testid="files-preview">
          <img
            src={inlinePath(file)}
            alt={title}
            onError={() => setFailed(true)}
            className="max-h-[60vh] max-w-full object-contain"
          />
        </div>
      );
    case 'video':
      return (
        <video
          src={inlinePath(file)}
          controls
          preload="metadata"
          aria-label={title}
          onError={() => setFailed(true)}
          className={cn(frame, 'max-h-[60vh] bg-black')}
          data-testid="files-preview"
        />
      );
    case 'audio':
      return (
        <audio
          src={inlinePath(file)}
          controls
          preload="metadata"
          aria-label={title}
          onError={() => setFailed(true)}
          className="w-full"
          data-testid="files-preview"
        />
      );
    case 'pdf':
      return (
        <iframe
          src={inlinePath(file)}
          title={title}
          className={cn(frame, 'h-[60vh]')}
          data-testid="files-preview"
        />
      );
    case 'text':
      // `setFailed` itself, not an arrow: the fetch effect is keyed on it, and a
      // fresh function every render would refetch every render.
      return <TextPreview file={file} onFailed={setFailed} />;
  }
}

function PreviewFailed(): ReactNode {
  return (
    <div
      className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-body-sm text-fg-muted"
      data-testid="files-preview-failed"
    >
      {t('files:drawer.previewFailed', 'This file could not be shown here. Download it to open it.')}
    </div>
  );
}

function TextPreview({ file, onFailed }: { file: FileDto; onFailed: (failed: boolean) => void }): ReactNode {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    fetch(file.contentPath, {
      credentials: 'same-origin',
      signal: controller.signal,
      // Only the head: the route answers ranges, and a server that ignores
      // the header is still cut short below.
      headers: { range: `bytes=0-${String(TEXT_PREVIEW_BYTES - 1)}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const bytes = new Uint8Array(await response.arrayBuffer()).slice(0, TEXT_PREVIEW_BYTES);
        setText(new TextDecoder().decode(bytes));
      })
      .catch(() => {
        if (!controller.signal.aborted) onFailed(true);
      });
    return () => controller.abort();
  }, [file.contentPath, onFailed]);

  if (text === null) {
    return (
      <div className="flex justify-center p-6" data-testid="files-preview-loading">
        <Spinner size="sm" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-testid="files-preview">
      <pre
        className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-3 font-mono text-caption text-fg"
      >
        {text}
      </pre>
      {file.sizeBytes > TEXT_PREVIEW_BYTES ? (
        <span className="text-caption text-fg-subtle">
          {t('files:drawer.previewTruncated', 'Showing the first {size}.', {
            size: formatBytes(TEXT_PREVIEW_BYTES),
          })}
        </span>
      ) : null}
    </div>
  );
}
