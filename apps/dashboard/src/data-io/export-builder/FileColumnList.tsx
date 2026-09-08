// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The start pane of step 2 — "In your file" (comp 219-259, 927-950): the
 * ordered rows with a grip, an index, the header input, the source caption,
 * the type chip and badges, the masked and duplicate lines, and a remove.
 *
 * Reorder is dnd-kit rendered the comp's way (41-export-builder.md D12):
 * pointer drags show an insertion line (3 px accent bar with the soft glow,
 * before or after the hovered row by pointer half) and dim the dragged row
 * to .42; rows do not shift. Arrow keys on the handle move a row one step at
 * once (comp 943); Space/Enter also start dnd-kit's keyboard drag.
 */
import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { Badge, IconButton, cn } from '@adminium/ui';
import { Columns3, GripVertical, RotateCcw, X } from 'lucide-react';

import { BADGE_LABEL, copy, type BadgeKind } from './copy.js';
import { duplicateHeaders, linkedCount, totalsCount, type Draft, type DraftColumn } from './model.js';

const BADGE_TONE: Record<BadgeKind, 'neutral' | 'accent' | 'pos' | 'warn' | 'danger'> = {
  key: 'neutral',
  linked: 'accent',
  count: 'pos',
  sum: 'pos',
  avg: 'pos',
  min: 'pos',
  max: 'pos',
  calculated: 'warn',
  masked: 'danger',
};

export interface FileColumnListProps {
  draft: Draft;
  onHeader: (id: string, header: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDrop: (id: string, overId: string, before: boolean) => void;
  onReset: () => void;
  onRemoveAll: () => void;
}

export function FileColumnList({ draft, onHeader, onRemove, onMove, onDrop, onReset, onRemoveAll }: FileColumnListProps) {
  const dupes = duplicateHeaders(draft);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; before: boolean } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  function onDragMove(event: DragMoveEvent): void {
    const target = event.over;
    if (target === null || target.id === event.active.id) {
      setOver(null);
      return;
    }
    const rect = target.rect;
    const pointerY = (event.active.rect.current.translated?.top ?? rect.top) + (event.active.rect.current.translated?.height ?? 0) / 2;
    setOver({ id: String(target.id), before: pointerY < rect.top + rect.height / 2 });
  }

  function onDragEnd(event: DragEndEvent): void {
    if (over !== null && String(event.active.id) !== over.id) onDrop(String(event.active.id), over.id, over.before);
    setDragId(null);
    setOver(null);
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-card" data-testid="export-builder-file">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-[13.5px] font-extrabold text-fg">{copy.inFile()}</div>
          <div className="mt-[3px] font-mono text-[10.5px] text-fg-subtle" data-testid="export-builder-summary">
            {copy.columnsSummary(draft.columns.length, linkedCount(draft), totalsCount(draft))}
          </div>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="nb-ib inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-surface px-2.5 py-1.5 text-[11.5px] font-bold text-fg-muted"
            data-testid="export-builder-reset"
          >
            <RotateCcw className="size-[13px]" aria-hidden="true" />
            {copy.reset()}
          </button>
          <button
            type="button"
            onClick={onRemoveAll}
            className="nb-ib rounded-[9px] border border-border bg-surface px-2.5 py-1.5 text-[11.5px] font-bold text-fg-muted"
            data-testid="export-builder-remove-all"
          >
            {copy.removeAll()}
          </button>
        </div>
      </div>

      {draft.columns.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-11 text-center">
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-surface-3 text-fg-subtle">
            <Columns3 className="size-5" aria-hidden="true" />
          </div>
          <div className="text-[13.5px] font-extrabold text-fg">{copy.emptyTitle()}</div>
          <div className="mt-[5px] text-[12px] text-fg-muted">{copy.emptyBody()}</div>
        </div>
      ) : null}

      <DndContext
        sensors={sensors}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragStart={(event) => setDragId(String(event.active.id))}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragId(null);
          setOver(null);
        }}
      >
        <ol className="m-0 max-h-[calc(100vh-320px)] list-none overflow-auto p-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" tabIndex={0} aria-label={copy.inFile()}>
          {draft.columns.map((column, index) => (
            <Row
              key={column.id}
              column={column}
              index={index}
              dupe={dupes.has(column.header.trim().toLowerCase())}
              dragging={dragId === column.id}
              indicator={over !== null && over.id === column.id && dragId !== column.id ? (over.before ? 'before' : 'after') : null}
              onHeader={onHeader}
              onRemove={onRemove}
              onMove={onMove}
            />
          ))}
        </ol>
      </DndContext>
    </div>
  );
}

function Row({
  column,
  index,
  dupe,
  dragging,
  indicator,
  onHeader,
  onRemove,
  onMove,
}: {
  column: DraftColumn;
  index: number;
  dupe: boolean;
  dragging: boolean;
  indicator: 'before' | 'after' | null;
  onHeader: (id: string, header: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  const { setNodeRef: setDropRef } = useDroppable({ id: column.id });
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef } = useDraggable({ id: column.id });
  return (
    <li
      ref={(node) => {
        setDropRef(node);
        setDragRef(node);
      }}
      data-testid={`export-builder-row-${column.spec.name}`}
      className={cn(
        'relative flex items-start gap-2.5 border-b border-border px-3.5 py-[11px] last:border-b-0',
        dragging && 'opacity-[.42]',
        indicator === 'before' &&
          "before:absolute before:inset-x-2 before:-top-0.5 before:h-[3px] before:rounded-[3px] before:bg-accent before:shadow-[0_0_0_4px_var(--accent-soft)] before:content-['']",
        indicator === 'after' &&
          "after:absolute after:inset-x-2 after:-bottom-0.5 after:h-[3px] after:rounded-[3px] after:bg-accent after:shadow-[0_0_0_4px_var(--accent-soft)] after:content-['']",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        title={copy.dragTitle()}
        aria-label={copy.reorder(column.header)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            onMove(column.id, -1);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            onMove(column.id, 1);
          } else {
            listeners?.['onKeyDown']?.(event);
          }
        }}
        className="flex h-[30px] w-6 shrink-0 cursor-grab items-center justify-center rounded-[7px] text-fg-subtle focus-visible:outline-2 focus-visible:outline-accent"
        data-testid={`export-builder-handle-${column.spec.name}`}
      >
        <GripVertical className="size-[15px]" aria-hidden="true" />
      </button>
      <span className="flex h-[30px] w-5 shrink-0 items-center justify-end font-mono text-[10.5px] tabular-nums text-fg-subtle">
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <input
          value={column.header}
          onChange={(event) => onHeader(column.id, event.currentTarget.value)}
          aria-label={copy.headerLabel()}
          data-testid={`export-builder-header-${column.spec.name}`}
          className={cn(
            'w-full max-w-[320px] rounded-lg border bg-surface-2 px-2 py-1.5 text-[13px] font-bold text-fg outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]',
            dupe ? 'border-danger' : 'border-border',
          )}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10.5px] text-fg-subtle">{column.source}</span>
          <span className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-fg-muted">{column.type}</span>
          {column.badges.map((badge) => (
            <Badge key={badge} tone={BADGE_TONE[badge]} className="text-[9px] uppercase tracking-[.05em]">
              {BADGE_LABEL[badge]()}
            </Badge>
          ))}
        </div>
        {column.masked ? <div className="text-[10.5px] text-warn">{copy.maskedNote()}</div> : null}
        {dupe ? (
          <div className="text-[10.5px] font-bold text-danger" data-testid={`export-builder-dupe-${column.spec.name}`}>
            {copy.dupeNote()}
          </div>
        ) : null}
      </div>
      <IconButton
        variant="bordered"
        size="md"
        label={copy.remove(column.header)}
        title={copy.removeTitle()}
        onClick={() => onRemove(column.id)}
        data-testid={`export-builder-remove-${column.spec.name}`}
      >
        <X className="size-3.5" />
      </IconButton>
    </li>
  );
}
