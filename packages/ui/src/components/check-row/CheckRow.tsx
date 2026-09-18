// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from 'lucide-react';
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/index.js';

export interface CheckRowProps extends Omit<ComponentPropsWithRef<'div'>, 'style' | 'onChange'> {
  /** The thing being turned on: 13 / 700 with a detail, 13 / 600 without. */
  label: ReactNode;
  /** The second line (comp 405) — what this one grants, in plain words. */
  detail?: ReactNode | undefined;
  /** Trailing mono text (comp 498): a scope, a code, a count. */
  scope?: ReactNode | undefined;
  checked?: boolean | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  disabled?: boolean | undefined;
}

/**
 * CheckRow — a bordered, tinted row with a box, a label and a detail or a mono
 * scope (comp 402–407, 494–500).
 *
 * ─── What it is for, and what it is not ────────────────────────────────────
 *
 * Two shapes in the comp, one control: "provision these systems on day one"
 * (label + detail) and a permission list (label + a mono scope at the end). It
 * is a CHOICE MADE VISIBLE — the whole row is the target, the selected state
 * is a tinted border rather than a tick you have to look for, and the detail
 * has somewhere to live.
 *
 * It is never the default for anything: a boolean gets a `ToggleRow` and a list
 * gets chips. A check row is what an admin CHOOSES when the options deserve a
 * sentence each (Appendix C).
 *
 * The row is a real `checkbox` role with `aria-checked`, driven by Space as
 * well as by a click, because that is what a person reaching it by keyboard
 * expects — and a div with an onClick is not reachable at all.
 */
export function CheckRow({
  label,
  detail,
  scope,
  checked = false,
  onCheckedChange,
  disabled = false,
  className,
  ...props
}: CheckRowProps) {
  const id = useId();
  const descriptionId = detail === undefined || detail === null ? undefined : `${id}-detail`;
  const toggle = (): void => {
    if (disabled) return;
    onCheckedChange?.(!checked);
  };
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      {...(descriptionId === undefined ? {} : { 'aria-describedby': descriptionId })}
      {...(disabled ? { 'aria-disabled': true } : { tabIndex: 0 })}
      onClick={toggle}
      onKeyDown={(event) => {
        // Space is the checkbox key; Enter is not, and browsers do not send a
        // click for either on a div — so both are wired by hand.
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          toggle();
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-[11px] rounded-[11px] border px-3.5 py-2.5',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        checked ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
        // `pointer-events-none`, but NOT an opacity: dimming 11.5px type is
        // what failed `ToggleRow`'s description in the axe sweep, and this row
        // escapes the same rule only because `aria-disabled` makes axe skip it.
        disabled && 'pointer-events-none cursor-not-allowed',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          // `text-accent-fg`, never a literal white: the box's background is a
          // token that follows the theme and a literal foreground does not — the
          // pair loses contrast the moment the theme flips (the lint rule
          // measures it).
          'flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-accent-fg',
          checked ? 'bg-accent' : 'border-[1.5px] border-border-strong',
        )}
      >
        <Check className={cn('size-3', checked ? 'opacity-100' : 'opacity-0')} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-body-sm text-fg', detail === undefined ? 'font-semibold' : 'font-bold')}>
          {label}
        </span>
        {descriptionId === undefined ? null : (
          <span id={descriptionId} className="block text-[11.5px] leading-4 text-fg-subtle">
            {detail}
          </span>
        )}
      </span>
      {scope === undefined || scope === null ? null : (
        <MonoText className="shrink-0 text-[11px] text-fg-subtle">{scope}</MonoText>
      )}
    </div>
  );
}
