// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector's small shared parts: the panel eyebrow (the comp's 11 px
 * uppercase label), the option button (the comp's `optBtn`, 1516), the
 * dashed *Add …* button, and the divider.
 */
import type { ReactNode } from 'react';
import { cn } from '@adminium/ui';

export function PanelLabel({ children, className, id }: { children: ReactNode; className?: string | undefined; id?: string | undefined }) {
  return (
    <div id={id} className={cn('mb-[7px] block text-[11px] font-bold uppercase tracking-[.04em] text-fg-subtle', className)}>
      {children}
    </div>
  );
}

export function Divider() {
  return <div className="h-px bg-border" aria-hidden="true" />;
}

/** The comp's `optBtn` (1516): a flex-1 pill that turns accent-soft when on. */
export function OptionButton({
  on,
  label,
  onClick,
  children,
  testId,
  value,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  children?: ReactNode;
  testId?: string | undefined;
  value?: string | undefined;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={children === undefined ? undefined : label}
      aria-pressed={on}
      data-testid={testId}
      data-value={value}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center rounded-lg border px-1 py-[7px] text-[11px] font-bold transition-colors',
        on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface-2 text-fg-muted hover:border-border-strong',
      )}
    >
      {children ?? label}
    </button>
  );
}

/** The comp's swatch (`swBtn`, 1517): a 30 px tile, dark ring when on. */
export function Swatch({
  on,
  label,
  onClick,
  className,
  testId,
  value,
  swatch,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  className: string;
  testId?: string | undefined;
  value?: string | undefined;
  /** A literal colour for the tile (a brand hex); classes cover the token-coloured ones. */
  swatch?: string | undefined;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      data-testid={testId}
      data-value={value}
      onClick={onClick}
      style={{ '--adm-swatch': swatch ?? 'transparent' }}
      className={cn(
        'size-[30px] shrink-0 rounded-[9px] border-2 transition-shadow',
        on ? 'border-fg shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-border',
        className,
      )}
    />
  );
}

export function DashedButton({ onClick, children, testId, accent = false }: { onClick: () => void; children: ReactNode; testId?: string | undefined; accent?: boolean }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-[9px] border-[1.5px] border-dashed p-2 text-[11.5px] font-bold transition-colors',
        accent ? 'border-accent bg-accent-soft text-accent' : 'border-border-strong bg-transparent text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
