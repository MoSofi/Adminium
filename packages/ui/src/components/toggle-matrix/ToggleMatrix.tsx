import { useDirection } from '@radix-ui/react-direction';
import { Check, Lock, Minus } from 'lucide-react';
import { useRef, useState } from 'react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { Eyebrow } from '../label/index.js';

/**
 * Cell state vocabulary. `locked` means granted-and-immutable (the Roles
 * comp's hard-locked Owner column): the cell renders a lock glyph with
 * neutral tone styling, stays in the keyboard-navigation order for
 * discoverability, exposes `aria-disabled` and never fires `onToggle`.
 */
export type ToggleMatrixCellState = 'on' | 'off' | 'locked';

export interface ToggleMatrixColumn {
  id: string;
  /** Column header text (also used in per-cell accessible names). */
  label: string;
  /**
   * Hard-locks the whole column: a lock glyph joins the header and every
   * cell renders `locked` regardless of `getCellState`.
   */
  locked?: boolean | undefined;
}

export interface ToggleMatrixRow {
  id: string;
  /** Row header text (also used in per-cell accessible names). */
  label: string;
}

export interface ToggleMatrixGroup {
  id: string;
  /** Uppercase eyebrow group label; omit for an unlabeled group. */
  label?: string | undefined;
  /** Leading Lucide icon for the group label (decorative). */
  icon?: React.ReactNode;
  rows: readonly ToggleMatrixRow[];
}

export interface ToggleMatrixProps
  extends Omit<React.ComponentPropsWithRef<'div'>, 'style' | 'onToggle'> {
  columns: readonly ToggleMatrixColumn[];
  /** Row entities, grouped; pass one label-less group for a flat matrix. */
  groups: readonly ToggleMatrixGroup[];
  /** Accessible name for the grid (required — i18n). */
  label: string;
  /** First-column heading over the row headers (e.g. "Permission"). */
  rowHeader: React.ReactNode;
  /** Resolves the state of one cell. */
  getCellState: (rowId: string, columnId: string) => ToggleMatrixCellState;
  /** Fires for editable cells with the *requested* next value. */
  onToggle?: ((rowId: string, columnId: string, next: boolean) => void) | undefined;
  /** Dirty predicate — dirty cells show the accent diff dot. */
  isDirty?: ((rowId: string, columnId: string) => boolean) | undefined;
  /** Disables every editable cell (read-only view / save in flight). */
  disabled?: boolean | undefined;
}

const cellKey = (rowId: string, columnId: string): string => `${rowId}\x00${columnId}`;

/**
 * ToggleMatrix — generic row-entities × column-capabilities grid with
 * tri-state cells per Roles Permissions.dc.html. Column and row
 * headers are sticky (logical `start`, so RTL mirrors), group labels render
 * as uppercase `Eyebrow` rows, and the cells form a roving-tabindex ARIA
 * grid: arrow keys move cell focus (direction-aware), Home/End jump within
 * the row, Space/Enter toggles the focused cell.
 */
export function ToggleMatrix({
  columns,
  groups,
  label,
  rowHeader,
  getCellState,
  onToggle,
  isDirty,
  disabled = false,
  className,
  ...props
}: ToggleMatrixProps) {
  const direction = useDirection();
  const flatRows = groups.flatMap((group) => group.rows);
  const [focus, setFocus] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  const focusCell = (rowIndex: number, colIndex: number) => {
    const row = flatRows[rowIndex];
    const column = columns[colIndex];
    if (row === undefined || column === undefined) return;
    setFocus({ row: rowIndex, col: colIndex });
    cellRefs.current.get(cellKey(row.id, column.id))?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.dataset['part'] !== 'matrix-cell') {
      return;
    }
    const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const { row, col } = focus;
    switch (event.key) {
      case forward:
        focusCell(row, col + 1);
        break;
      case backward:
        focusCell(row, col - 1);
        break;
      case 'ArrowDown':
        focusCell(row + 1, col);
        break;
      case 'ArrowUp':
        focusCell(row - 1, col);
        break;
      case 'Home':
        focusCell(row, 0);
        break;
      case 'End':
        focusCell(row, columns.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // Clamp the roving position if rows/columns shrank between renders.
  const focusRow = Math.min(focus.row, Math.max(flatRows.length - 1, 0));
  const focusCol = Math.min(focus.col, Math.max(columns.length - 1, 0));

  let flatRowIndex = -1;

  return (
    <div
      role="grid"
      aria-label={label}
      data-part="toggle-matrix"
      onKeyDown={handleKeyDown}
      // Column count feeds the grid template via the '--*' escape hatch.
      style={{ '--adm-matrix-cols': String(columns.length) }}
      className={cn(
        'grid overflow-auto rounded-lg border border-border bg-surface shadow-card',
        '[grid-template-columns:minmax(200px,1.5fr)_repeat(var(--adm-matrix-cols),minmax(84px,110px))]',
        className,
      )}
      {...props}
    >
      <div role="row" className="contents">
        <div
          role="columnheader"
          className="sticky start-0 top-0 z-30 border-b border-border bg-surface-2 px-5 py-3.5 text-start text-[12px] font-extrabold text-fg"
        >
          {rowHeader}
        </div>
        {columns.map((column) => (
          <div
            key={column.id}
            role="columnheader"
            data-part="matrix-column-header"
            className="sticky top-0 z-20 flex items-center justify-center gap-1 border-b border-border bg-surface-2 px-2 py-3.5 text-center text-[12px] font-extrabold text-fg"
          >
            {column.label}
            {column.locked ? (
              <Lock aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" />
            ) : null}
          </div>
        ))}
      </div>

      {groups.map((group, groupIndex) => (
        <div key={group.id} className="contents">
          {group.label === undefined ? null : (
            <div role="row" className="contents">
              <div
                role="gridcell"
                aria-colspan={columns.length + 1}
                data-part="matrix-group-label"
                className={cn(
                  'col-span-full bg-surface pb-1.5 pt-3 ps-5 pe-4',
                  groupIndex > 0 && 'border-t border-border',
                )}
              >
                <span className="sticky start-5 inline-flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-fg-subtle">
                  {group.icon}
                  <Eyebrow>{group.label}</Eyebrow>
                </span>
              </div>
            </div>
          )}
          {group.rows.map((row) => {
            flatRowIndex += 1;
            const rowIndex = flatRowIndex;
            return (
              <div key={row.id} role="row" className="contents">
                <div
                  role="rowheader"
                  className="sticky start-0 z-10 border-t border-border bg-surface py-2 ps-5 pe-4 text-start text-body-sm font-semibold text-fg"
                >
                  {row.label}
                </div>
                {columns.map((column, colIndex) => {
                  const state: ToggleMatrixCellState = column.locked
                    ? 'locked'
                    : getCellState(row.id, column.id);
                  const locked = state === 'locked';
                  const on = state === 'on';
                  const dirty = !locked && isDirty !== undefined && isDirty(row.id, column.id);
                  const roving = rowIndex === focusRow && colIndex === focusCol;
                  return (
                    <div
                      key={column.id}
                      role="gridcell"
                      className="flex items-center justify-center border-t border-border py-1"
                    >
                      <button
                        type="button"
                        data-part="matrix-cell"
                        data-state={state}
                        data-dirty={dirty || undefined}
                        aria-label={`${row.label} — ${column.label}`}
                        // Locked ⇒ granted immutably (Owner column semantics).
                        aria-pressed={locked ? true : on}
                        aria-disabled={locked || disabled || undefined}
                        tabIndex={roving ? 0 : -1}
                        ref={(element) => {
                          const key = cellKey(row.id, column.id);
                          if (element === null) cellRefs.current.delete(key);
                          else cellRefs.current.set(key, element);
                        }}
                        onFocus={() => setFocus({ row: rowIndex, col: colIndex })}
                        onClick={() => {
                          if (locked || disabled) return;
                          onToggle?.(row.id, column.id, !on);
                        }}
                        className={cn(
                          'relative inline-flex size-8 items-center justify-center rounded-md transition-[background-color,color] duration-100 [&_svg]:size-[15px]',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                          locked
                            ? 'cursor-not-allowed bg-surface-3 text-fg-subtle opacity-85'
                            : on
                              ? 'bg-accent-soft text-accent hover:bg-surface-3 active:scale-90'
                              : 'text-fg-subtle hover:bg-surface-3 active:scale-90',
                          !locked && disabled && 'cursor-default opacity-60 active:scale-100',
                        )}
                      >
                        {locked ? (
                          <Lock aria-hidden="true" />
                        ) : on ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Minus aria-hidden="true" />
                        )}
                        {dirty ? (
                          <span
                            data-part="matrix-dirty-dot"
                            aria-hidden="true"
                            className="absolute end-0.5 top-0.5 size-1.5 rounded-full bg-accent"
                          />
                        ) : null}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
