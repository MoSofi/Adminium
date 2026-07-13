import { Plus, X } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/MonoText.js';

export interface FilterChipProps extends ComponentPropsWithRef<'div'> {
  /** Field name ("status"). */
  field: ReactNode;
  /** Operator, rendered mono ("=", "contains", "≥"). */
  op: ReactNode;
  /** Value ("paid"). */
  value: ReactNode;
  /** Remove handler; the X button renders only when set. */
  onRemove?: (() => void) | undefined;
  /** Accessible label for the remove button (required when removable — i18n). */
  removeLabel?: string | undefined;
}

/**
 * FilterChip — `field · op · value` pill with a remove button
 * (research/design-system.md §3 Tier 3): field muted, operator mono-muted,
 * value emphasized.
 */
export function FilterChip({
  field,
  op,
  value,
  onRemove,
  removeLabel,
  className,
  ...props
}: FilterChipProps) {
  return (
    <div
      data-part="filter-chip"
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface ps-2.5 text-caption',
        onRemove === undefined ? 'pe-2.5' : 'pe-1',
        className,
      )}
      {...props}
    >
      <span className="text-fg-muted">{field}</span>
      <MonoText className="text-[10.5px] text-fg-subtle">{op}</MonoText>
      <span className="font-bold text-fg">{value}</span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className={cn(
            'nb-ib inline-flex size-5 shrink-0 items-center justify-center rounded-full text-fg-muted hover:text-fg',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
          )}
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface AddFilterChipProps extends Omit<ComponentPropsWithRef<'button'>, 'style' | 'children'> {
  /** Visible label ("Add filter"). */
  label: ReactNode;
}

/** Dashed companion button that opens the filter builder. */
export function AddFilterChip({ label, className, ...props }: AddFilterChipProps) {
  return (
    <button
      type="button"
      data-part="add-filter-chip"
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5',
        'text-caption font-semibold text-fg-muted hover:border-accent hover:text-accent',
        'transition-colors duration-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    >
      <Plus className="size-3" aria-hidden="true" />
      {label}
    </button>
  );
}
