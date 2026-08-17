// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import type { Tone } from '../../lib/tones.js';
import { Button } from '../button/Button.js';
import { IconTile } from '../icon-tile/IconTile.js';

export interface SuccessStateProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Heading (e.g. "Invitation sent"). */
  title: ReactNode;
  /** Supporting copy — echo harvested inputs here ("We emailed kim@acme.io"). */
  body?: ReactNode;
  /** Done button label (required — i18n). */
  doneLabel: string;
  /** Done handler — closes the host modal / advances the wizard. */
  onDone?: (() => void) | undefined;
  /** Autofocus the Done button on mount (modal phase 2 re-focus). Default true. */
  autoFocusDone?: boolean | undefined;
  /** Override the check icon. */
  icon?: ReactNode;
  /** Tile tone. Default `pos`. */
  tone?: Tone | undefined;
  /** Extra actions rendered after the Done button (e.g. "Invite another"). */
  actions?: ReactNode;
}

/**
 * SuccessState — 56px pos-soft check tile + heading + copy + Done button;
 * modal phase 2 everywhere and wizard terminal step
 * (03-component-library.md §5.3, §7.1).
 */
export function SuccessState({
  title,
  body,
  doneLabel,
  onDone,
  autoFocusDone = true,
  icon,
  tone = 'pos',
  actions,
  className,
  children,
  ...props
}: SuccessStateProps) {
  return (
    <div
      data-part="success-state"
      className={cn('flex flex-col items-center px-6 py-8 text-center', className)}
      {...props}
    >
      <IconTile size="xl" tone={tone} icon={icon ?? <Check />} />
      <h2 className="mt-4 text-modal text-fg">{title}</h2>
      {body === undefined || body === null ? null : (
        <p className="mt-1.5 max-w-[340px] text-body-sm text-fg-muted">{body}</p>
      )}
      {children}
      <div className="mt-6 flex items-center gap-2">
        <Button autoFocus={autoFocusDone} onClick={onDone} className="min-w-[120px]">
          {doneLabel}
        </Button>
        {actions}
      </div>
    </div>
  );
}
