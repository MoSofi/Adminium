// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rows editor (comp 715-731, 1495-1513; Appendix A §E3): one row per
 * entry with a grip (native drag to reorder), Duplicate and Remove, and the
 * schema's cells — input, mono, textarea, or a *cycle* button that steps
 * Pending → In progress → Done. Plain schemas (paragraphs, list items) hold
 * bare strings; the rest hold records.
 *
 * D17: the grip is a mouse affordance; *Move up* / *Move down* icon buttons
 * reveal on focus so a keyboard reorders too.
 */
import { ChevronDown, ChevronUp, Copy, GripVertical, Minus, Plus } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { IconButton, Input, Textarea, cn } from '@adminium/ui';

import { t } from '../../../i18n/t.js';
import type { EmailRowsSchema } from '../../model/blocks.js';
import { cellPlaceholder, cycleLabel, rowNoun, rowsLabel } from './fieldText.js';
import { DashedButton, PanelLabel } from './parts.js';

export type RowValue = string | Record<string, unknown>;

export interface RowsEditorProps {
  schema: EmailRowsSchema;
  rows: readonly RowValue[];
  onCell: (index: number, key: string, value: string) => void;
  onFocusCell: (index: number, key: string) => void;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

const CYCLE = ['todo', 'current', 'done'] as const;

function cellValue(row: RowValue, key: string, plain: boolean): string {
  if (plain) return typeof row === 'string' ? row : '';
  if (typeof row !== 'object') return '';
  const value = row[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export function RowsEditor({ schema, rows, onCell, onFocusCell, onAdd, onDuplicate, onRemove, onMove }: RowsEditorProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const plain = schema.plain === true;
  const noun = rowNoun(schema.noun);

  const onDragStart = (index: number) => (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', String(index));
    } catch {
      // Some browsers refuse setData outside a real drag; the state carries the index.
    }
    setDragging(index);
  };
  const onDragOver = (index: number) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (over !== index) setOver(index);
  };
  const onDrop = (index: number) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (dragging !== null && dragging !== index) onMove(dragging, index);
    setDragging(null);
    setOver(null);
  };

  return (
    <div data-testid="email-rows-editor" className="flex flex-col gap-[7px]">
      <PanelLabel className="mb-0">{rowsLabel(schema.label)}</PanelLabel>
      {rows.map((row, index) => (
        <div
          key={index}
          data-testid="email-row-entry"
          onDragOver={onDragOver(index)}
          onDrop={onDrop(index)}
          className={cn(
            'group/row flex items-start gap-[5px] rounded-[9px] p-0.5',
            dragging === index && 'opacity-40',
            over === index && dragging !== null && dragging !== index && 'shadow-[inset_0_2px_0_0_var(--accent)]',
          )}
        >
          <span className="flex w-7 shrink-0 flex-col items-center gap-[3px] pt-[3px]">
            <span
              draggable
              onDragStart={onDragStart(index)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              title={t('email:inspector.dragToReorder', 'Drag to reorder')}
              className="flex size-[26px] cursor-grab items-center justify-center rounded-[7px] text-fg-subtle"
              aria-hidden="true"
            >
              <GripVertical className="size-[15px]" />
            </span>
            <IconButton variant="bordered" size="sm" label={t('email:inspector.duplicateRow', 'Duplicate {noun}', { noun })} onClick={() => onDuplicate(index)}>
              <Copy className="size-3.5" />
            </IconButton>
            <IconButton variant="bordered" size="sm" label={t('email:inspector.removeRow', 'Remove {noun}', { noun })} onClick={() => onRemove(index)}>
              <Minus className="size-3.5" />
            </IconButton>
            <span className="flex flex-col gap-[3px] opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
              <IconButton variant="ghost" size="sm" label={t('email:inspector.moveUp', 'Move up')} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
                <ChevronUp className="size-3.5" />
              </IconButton>
              <IconButton variant="ghost" size="sm" label={t('email:inspector.moveDown', 'Move down')} disabled={index === rows.length - 1} onClick={() => onMove(index, index + 1)}>
                <ChevronDown className="size-3.5" />
              </IconButton>
            </span>
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-[5px]">
            {schema.cells.map((cell) => {
              const value = cellValue(row, cell.key, plain);
              const name = `${rowsLabel(schema.label)} ${String(index + 1)} ${cellPlaceholder(cell.placeholder) || cell.key}`.trim();
              if (cell.kind === 'cycle') {
                const current = CYCLE.includes(value as (typeof CYCLE)[number]) ? (value as (typeof CYCLE)[number]) : 'todo';
                const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length] ?? 'todo';
                return (
                  <button
                    key={cell.key}
                    type="button"
                    data-testid="email-cycle-cell"
                    data-value={current}
                    aria-label={name}
                    onClick={() => onCell(index, cell.key, next)}
                    style={{ '--adm-cell-w': cell.width === undefined ? 'auto' : `${String(cell.width)}px` }}
                    className="h-[34px] w-[var(--adm-cell-w)] shrink-0 rounded-md border border-border bg-surface-2 px-2.5 text-center text-[12px] font-bold text-fg"
                  >
                    {cycleLabel(current)}
                  </button>
                );
              }
              if (cell.kind === 'area') {
                return (
                  <Textarea
                    key={cell.key}
                    rows={2}
                    aria-label={name}
                    placeholder={cellPlaceholder(cell.placeholder)}
                    value={value}
                    onFocus={() => onFocusCell(index, cell.key)}
                    onChange={(event) => onCell(index, cell.key, event.target.value)}
                    className="min-h-[88px] w-full flex-[1_1_100%] text-[12px]"
                  />
                );
              }
              return (
                <div
                  key={cell.key}
                  style={{ '--adm-cell-w': cell.width === undefined ? 'auto' : `${String(cell.width)}px` }}
                  className={cell.width === undefined ? 'min-w-0 flex-[1_1_96px]' : 'w-[var(--adm-cell-w)] shrink-0'}
                >
                  <Input
                    mono={cell.kind === 'mono'}
                    aria-label={name}
                    placeholder={cellPlaceholder(cell.placeholder)}
                    value={value}
                    onFocus={() => onFocusCell(index, cell.key)}
                    onChange={(event) => onCell(index, cell.key, event.target.value)}
                    className="w-full text-[12px]"
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <DashedButton onClick={onAdd} testId="email-add-row">
        <Plus className="size-3.5" aria-hidden="true" />
        {t('email:inspector.addRow', 'Add {noun}', { noun })}
      </DashedButton>
    </div>
  );
}
