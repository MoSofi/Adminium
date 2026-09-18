// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

export interface MetaPillProps extends Omit<ComponentPropsWithRef<'button'>, 'value' | 'children'> {
  /** The 13px icon: a calendar, a flag, a person, a hash (comp 147–179). */
  icon?: ReactNode | undefined;
  /** What the pill says when nothing is chosen — the field's own name. */
  placeholder: ReactNode;
  /** What is chosen. Absent ⇒ the pill is in its unset state. */
  value?: ReactNode | undefined;
  /** True while its menu is open, for the focus ring the comp draws. */
  open?: boolean | undefined;
}

/**
 * MetaPill — quick-create's inline field (comp
 * 147–180, 609–610).
 *
 * A pill is a whole field in one 24px-tall control: the icon says what KIND of
 * thing it holds, the text is the value or the field's name, and the two drawn
 * states — set and unset — are the entire affordance. It carries no label
 * above it, because in a quick-create dialog a column of labels over four
 * 24px controls is more chrome than form.
 */
export function MetaPill({ icon, placeholder, value, open = false, className, ...props }: MetaPillProps) {
  const set = value !== undefined && value !== null && value !== '';
  return (
    <button
      type="button"
      aria-expanded={props['aria-haspopup'] === undefined ? undefined : open}
      className={cn(
        'nb-ib inline-flex items-center gap-1.5 rounded-full border px-[11px] py-1.5 text-[12px] transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        set
          ? 'border-accent bg-accent-soft font-bold text-accent'
          : 'border-border-strong bg-surface-2 text-fg-muted hover:text-fg',
        className,
      )}
      {...props}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="flex size-[13px] items-center justify-center">
          {icon}
        </span>
      )}
      <span className="truncate">{set ? value : placeholder}</span>
    </button>
  );
}
