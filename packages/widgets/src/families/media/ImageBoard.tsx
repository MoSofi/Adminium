import { EmptyState, IconTile } from '@adminium/ui';
import { ImageIcon, Plus } from 'lucide-react';
import { useState } from 'react';

import { bindingSourceOf, fileRowsOf, stringField } from './media-lib.js';
import { imageBoardConfigSchema, imageBoardDemoData } from './media-config.js';
import type { ImageBoardConfig } from './media-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { imageBoardConfigSchema, imageBoardDemoData };
export type { ImageBoardConfig };

/**
 * `image-board` (annex §8) — the moodboard grid of droppable image slots with
 * captions and an Add-image slot. Niche but broadly useful: any table with an
 * image-URL column (product photos, property listings, design refs) auto-
 * instantiates onto it (annex §8).
 *
 * An EMPTY slot is a first-class state, not a loading artefact: the annex's
 * droppable placeholder ("Drop reference") is what an unfilled row renders. A
 * broken/blocked image URL degrades to the same placeholder via `onError` rather
 * than showing the browser's torn-image glyph.
 */

export interface BoardImage {
  id: string;
  imageUrl?: string | undefined;
  caption?: string | undefined;
  placeholder?: string | undefined;
}

export interface ImageBoardProps {
  images: readonly BoardImage[];
  columns?: number | undefined;
  editableCaptions?: boolean | undefined;
  allowAdd?: boolean | undefined;
  addLabel?: string | undefined;
  captionLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onCaptionChange?: ((image: BoardImage, caption: string) => void) | undefined;
  onAdd?: (() => void) | undefined;
  onOpen?: ((image: BoardImage) => void) | undefined;
  testId?: string | undefined;
}

/**
 * Column count → a static Tailwind grid class. A template literal
 * (`grid-cols-${n}`) would not survive Tailwind's static extraction — the class
 * must appear verbatim in the source to be emitted.
 */
const COLUMN_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
};

export function ImageBoard({
  images,
  columns = 2,
  editableCaptions = false,
  allowAdd = false,
  addLabel,
  captionLabel,
  emptyTitle,
  emptyBody,
  onCaptionChange,
  onAdd,
  onOpen,
  testId,
}: ImageBoardProps) {
  // Slots whose image failed to load fall back to the placeholder.
  const [broken, setBroken] = useState<readonly string[]>([]);

  if (images.length === 0 && !allowAdd) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? 'No images yet'}
        body={emptyBody ?? 'Reference images will appear on this board.'}
      />
    );
  }

  return (
    <div data-widget="image-board" data-testid={testId} className="h-full overflow-auto p-4">
      <ul className={`grid gap-3.5 ${COLUMN_CLASS[columns] ?? COLUMN_CLASS[2]}`}>
        {images.map((image) => {
          const failed = broken.includes(image.id);
          const src = failed ? undefined : image.imageUrl;
          return (
            <li key={image.id} data-part="image-slot" data-filled={src === undefined ? undefined : ''}>
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-surface-2">
                {src === undefined ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-subtle">
                    <ImageIcon aria-hidden="true" className="size-6" />
                    <span className="text-caption font-semibold">{image.placeholder ?? 'Drop reference'}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen?.(image)}
                    className="block size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  >
                    <img
                      src={src}
                      alt={image.caption ?? ''}
                      loading="lazy"
                      onError={() => setBroken((prev) => (prev.includes(image.id) ? prev : [...prev, image.id]))}
                      className="size-full object-cover"
                    />
                  </button>
                )}
              </div>
              {editableCaptions ? (
                <input
                  data-part="image-caption"
                  aria-label={captionLabel ?? 'Caption'}
                  defaultValue={image.caption ?? ''}
                  onBlur={(event) => onCaptionChange?.(image, event.currentTarget.value)}
                  className={
                    'mt-2 w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-caption ' +
                    'font-semibold text-fg-muted hover:border-border focus:border-accent focus:outline-none'
                  }
                />
              ) : (
                image.caption !== undefined && (
                  <p data-part="image-caption" className="mt-2 text-caption font-semibold text-fg-muted">
                    {image.caption}
                  </p>
                )
              )}
            </li>
          );
        })}
        {allowAdd && (
          <li>
            <button
              type="button"
              data-part="image-add"
              onClick={onAdd}
              className={
                'flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 ' +
                'border-dashed border-border-strong text-fg-subtle transition-colors duration-150 ' +
                'hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
              }
            >
              <IconTile size="md" tone="accent" icon={<Plus />} />
              <span className="text-caption font-bold">{addLabel ?? 'Add image'}</span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Project an untrusted `record-list` onto `BoardImage`s via the field naming. */
export function boardImagesOf(data: unknown, config: ImageBoardConfig): BoardImage[] {
  return fileRowsOf(data).map((row, index): BoardImage => ({
    id: stringField(row, config.idField) ?? `image-${index}`,
    imageUrl: stringField(row, config.imageField),
    caption: stringField(row, config.captionField),
    placeholder: stringField(row, config.placeholderField),
  }));
}

export function ImageBoardWidget({ config, data, onEvent }: WidgetProps<ImageBoardConfig>) {
  const source = bindingSourceOf(config.binding);
  return (
    <ImageBoard
      images={boardImagesOf(data, config)}
      columns={config.columns}
      // An editable caption is a write: only offer it when a binding exists to
      // write to, else the field would silently swallow every edit.
      editableCaptions={config.editableCaptions && source !== null}
      allowAdd={config.allowAdd}
      {...(config.addLabel === undefined ? {} : { addLabel: config.addLabel })}
      {...(config.captionLabel === undefined ? {} : { captionLabel: config.captionLabel })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      onOpen={(image) => {
        const href = image.imageUrl ?? config.href;
        if (href !== undefined) onEvent({ type: 'drill-through', href });
      }}
      onCaptionChange={(image, caption) => {
        if (source === null || caption === (image.caption ?? '')) return; // no-op blur
        onEvent({
          type: 'mutate',
          intent: 'update',
          connectionId: source.connectionId,
          table: source.table,
          recordId: image.id,
          values: { [config.captionField]: caption },
        });
      }}
    />
  );
}
