// SPDX-License-Identifier: AGPL-3.0-only
import { TriangleAlert } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

export interface CodePaneProps extends Omit<ComponentPropsWithRef<'div'>, 'onChange' | 'title'> {
  /** The header glyph (the comp's `braces`), 15 px, in `--code-blue`. */
  icon?: ReactNode;
  title: ReactNode;
  /** Whether the text differs from what the form holds: "edited — not applied". */
  dirty: boolean;
  /** The state badge's words for each state (i18n). */
  stateLabel: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  /** The textarea's accessible name (i18n). */
  textareaLabel: string;
  /** The header's end action — the comp's Format button. */
  action?: ReactNode;
  /** A parse or compile problem, shown in the strip under the text. */
  error?: ReactNode;
  /** The footer's buttons: `CodePaneButton`s. */
  footer?: ReactNode;
}

/**
 * CodePane — the builder's "Route definition" pane:
 * the dark island (`.adm-always-dark`, the scope's own `--bg`) with a header,
 * a monospace textarea, an error strip and a footer slot.
 *
 * Colours are the island's tokens, never the comp's hexes: text
 * `fg-muted` (#d3d3e0 in the comp), hairlines `border`, the error strip
 * `danger` on `danger-soft`.
 */
export function CodePane({
  icon,
  title,
  dirty,
  stateLabel,
  value,
  onValueChange,
  textareaLabel,
  action,
  error,
  footer,
  className,
  ...props
}: CodePaneProps) {
  return (
    <div className={cn('adm-always-dark flex min-h-0 flex-col bg-bg leading-[normal] text-fg', className)} {...props}>
      <div className="flex shrink-0 items-center gap-[9px] border-b border-border px-4 py-3">
        {icon === undefined ? null : (
          <span aria-hidden="true" className="flex text-code-blue [&_svg]:size-[15px]">
            {icon}
          </span>
        )}
        <span className="text-[12.5px] font-bold text-fg">{title}</span>
        <span
          data-state={dirty ? 'dirty' : 'synced'}
          className={cn(
            'rounded-[6px] px-[7px] py-[2px] text-[10px] font-bold',
            dirty ? 'bg-warn-soft text-warn' : 'bg-surface-3 text-fg-subtle',
          )}
        >
          {stateLabel}
        </span>
        {action === undefined ? null : <div className="ms-auto flex">{action}</div>}
      </div>
      <textarea
        aria-label={textareaLabel}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        spellCheck={false}
        dir="ltr"
        className={cn(
          'nb-code nb-scroll min-h-0 flex-1 resize-none border-none bg-transparent px-4 py-3.5',
          'font-mono text-[11.5px] leading-[1.65] text-fg-muted [tab-size:2]',
          'outline-none focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-light)_60%,transparent)]',
        )}
      />
      {error === undefined || error === null || error === false ? null : (
        <div role="alert" className="flex shrink-0 items-start gap-2 bg-danger-soft px-4 py-2.5 font-mono text-[11.5px] text-danger">
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}
      {footer === undefined ? null : <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3">{footer}</div>}
    </div>
  );
}

export interface CodePaneButtonProps extends ComponentPropsWithRef<'button'> {
  /**
   * `apply` fills the row's first half: the comp's LIGHT accent with near-white
   * text when enabled — the island flips `--accent` to the dark accent, so the
   * light one is pinned here — and `surface-3` /
   * `fg-subtle` when there is nothing to apply. `revert` is outlined.
   * `format` is the header's small action.
   */
  variant: 'apply' | 'revert' | 'format';
}

export function CodePaneButton({ variant, className, type = 'button', ...props }: CodePaneButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        variant === 'format'
          ? 'nb-ib rounded-[7px] bg-surface-2 px-2.5 py-[5px] text-[11.5px] font-bold text-fg-muted hover:text-fg'
          : 'flex-1 rounded-[9px] p-[9px] text-[12.5px] font-bold',
        variant === 'apply' &&
          'bg-[var(--accent-light)] text-fg disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-subtle',
        variant === 'revert' && 'border border-border-strong bg-transparent text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}
