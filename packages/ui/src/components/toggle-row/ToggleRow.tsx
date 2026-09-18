// SPDX-License-Identifier: AGPL-3.0-only
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { Switch } from '../switch/index.js';

export interface ToggleRowProps extends Omit<ComponentPropsWithRef<'div'>, 'style' | 'onChange'> {
  /** The question this row answers: 13 / 700 (comp 259). */
  label: ReactNode;
  /** What being off MEANS — 11.5 subtle, under the label (comp 259). */
  description?: ReactNode | undefined;
  checked?: boolean | undefined;
  defaultChecked?: boolean | undefined;
  onCheckedChange?: ((checked: boolean) => void) | undefined;
  disabled?: boolean | undefined;
  /** Explicit id for the switch (defaults to a generated one). */
  controlId?: string | undefined;
}

/**
 * ToggleRow — a boolean as a bordered row: title, explanation, switch
 * (`designs/Create Dialogs.dc.html` 258–261; plan 50 D18).
 *
 * ─── Why a boolean is not a checkbox here ──────────────────────────────────
 *
 * A checkbox in a form grid is a 16px square beside a label, and it tells the
 * person nothing about what happens when they leave it alone. The comp's row
 * gives the answer its own line — "Off keeps the product as a draft in the
 * catalog" — which is the difference between a control you can use and one you
 * have to guess at. It is the DEFAULT control for a boolean column, not an
 * option, because the guess is the same on every table.
 *
 * The whole row is the label's `htmlFor` target, so clicking the sentence
 * toggles the switch, and a screen reader reads the label with it. The
 * description is wired through `aria-describedby` rather than folded into the
 * name: it explains, it does not identify.
 */
export function ToggleRow({
  label,
  description,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  controlId,
  className,
  ...props
}: ToggleRowProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const descriptionId = description === undefined || description === null ? undefined : `${id}-description`;
  return (
    /*
     * NO `opacity-40` ON THE TEXT when the row is disabled.
     *
     * Dimming small type is how a legible token becomes an illegible pixel: the
     * axe sweep measured this row's 11.5px description at 40% and failed it for
     * contrast in BOTH themes. The switch carries the disabled signal itself
     * (Radix dims it), the label is marked not-allowed, and the words stay
     * readable — which is the whole point of showing them to somebody who
     * cannot act on them.
     */
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-3',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className={cn(
            'block text-body-sm font-bold text-fg',
            disabled === true ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
        {descriptionId === undefined ? null : (
          <p id={descriptionId} className="mt-0.5 text-[11.5px] leading-4 text-fg-subtle">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        {...(descriptionId === undefined ? {} : { 'aria-describedby': descriptionId })}
        {...(checked === undefined ? {} : { checked })}
        {...(defaultChecked === undefined ? {} : { defaultChecked })}
        {...(disabled === undefined ? {} : { disabled })}
        {...(onCheckedChange === undefined ? {} : { onCheckedChange })}
      />
    </div>
  );
}
