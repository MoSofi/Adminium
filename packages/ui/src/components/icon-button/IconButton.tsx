import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
// Statically imported, deliberately. `@radix-ui/react-tooltip` is already in the
// dashboard's entry chunk via the app shell's `Topbar`, so deferring it here buys
// 0.7 KiB gz (measured, 647.1 → 646.4) — and costs a module-level cache, async
// state in a Tier-1 primitive, and a bare→wrapped remount on first render.
import { Tooltip } from '../tooltip/Tooltip.js';

/**
 * Square icon button, radius 10 (`rounded-md`), sizes 28/32/34/38px. Hover →
 * surface-3, active scale .9 via the tokens `.nb-ib` interaction class
 * (research/design-system.md §3 Tier 1).
 */
export const iconButtonVariants = cva(
  'nb-ib inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
    'disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        bordered: 'border border-border-strong bg-surface',
        ghost: '',
      },
      size: {
        sm: 'size-7',
        md: 'size-8',
        lg: 'size-[34px]',
        xl: 'size-[38px]',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export interface IconButtonProps
  extends Omit<React.ComponentPropsWithRef<'button'>, 'style' | 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  /** Required accessible name (icon-only control) — rendered as `aria-label`. */
  label: string;
  /**
   * Also show {@link label} as a hover/focus tooltip. Icon-only controls give a
   * sighted mouse user nothing to read otherwise — `aria-label` reaches assistive
   * tech and no one else.
   *
   * OPT-IN rather than on by default: `IconButton` has ~100 call sites, and
   * several are already somebody else's trigger (`DropdownMenuTrigger asChild`,
   * `PopoverTrigger asChild`), where a second `asChild` trigger on the same
   * element is fragile. Ignored when `asChild` is set, for that reason.
   */
  tooltip?: boolean;
  /** Merge classes/props into the single child element (Radix Slot). */
  asChild?: boolean;
}

export function IconButton({
  className,
  variant,
  size,
  label,
  tooltip = false,
  asChild = false,
  children,
  ...props
}: IconButtonProps) {
  const Comp = asChild ? Slot : 'button';
  const button = (
    <Comp
      {...(asChild ? {} : { type: 'button' as const })}
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </Comp>
  );
  // The tooltip repeats the accessible name, so it is decorative to AT — Radix
  // would otherwise describe the control twice.
  return tooltip && !asChild ? (
    <Tooltip content={<span aria-hidden="true">{label}</span>}>{button}</Tooltip>
  ) : (
    button
  );
}
