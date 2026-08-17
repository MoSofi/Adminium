import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { Spinner } from '../spinner/Spinner.js';

/**
 * Button CVA map per 03-component-library.md §3.1 and
 * research/design-system.md §3 Tier 1. `size` is declared before `variant` so
 * the `link` variant's `h-auto p-0` wins the tailwind-merge conflict.
 */
export const buttonVariants = cva(
  'nb-press inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold ' +
    'transition-[background-color,color,box-shadow] duration-150 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ' +
    'disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
  {
    variants: {
      // Each size also pins its icon box. Every other icon-bearing component
      // here does (`IconTile`, `DropdownMenu`, `ChoiceChips`, `BulkActionBar`,
      // `SegmentedControl`); Button was the one that did not, so `iconLeft`
      // fell through to lucide's own 24px default — half again the comp's
      // 15/16px and taller than the 13px label beside it. The comps size
      // toolbar-button glyphs at 15px and the primary CTA's at 16px.
      size: {
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-[34px] px-3.5 text-[13px] [&_svg]:size-[15px]',
        lg: 'h-10 px-4 text-sm [&_svg]:size-4',
        // Header primary action: `md`'s height, but bolder and asymmetrically
        // padded so a leading icon does not sit adrift of the label. Its own
        // size rather than a change to `md`, which is the app-wide default.
        topbar: 'h-[34px] ps-2.5 pe-3.5 text-[13px] font-bold [&_svg]:size-4',
      },
      variant: {
        primary: 'bg-accent text-accent-fg shadow-glow hover:brightness-105',
        secondary: 'border border-border-strong bg-surface text-fg hover:bg-surface-2',
        ghost: 'text-fg-muted hover:bg-surface-3 hover:text-fg',
        outline: 'border border-border-strong text-fg hover:bg-surface-2',
        // text-accent-fg, not text-white: --accent-fg is the theme's inverted
        // foreground for every solid fill (5.24:1 on the light --danger,
        // 6.89:1 on the dark one; white on the dark --danger is 2.78:1).
        destructive: 'bg-danger text-accent-fg hover:brightness-105',
        destructiveSoft: 'bg-danger-soft text-danger hover:brightness-97',
        soft: 'bg-accent-soft text-accent hover:brightness-97',
        link: 'h-auto p-0 text-accent underline-offset-2 hover:underline',
        inverse: 'bg-fg text-bg hover:brightness-110',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

const SPINNER_SIZE = { sm: 'sm', md: 'sm', lg: 'md', topbar: 'sm' } as const;

export interface ButtonProps
  extends Omit<React.ComponentPropsWithRef<'button'>, 'style'>,
    VariantProps<typeof buttonVariants> {
  /**
   * Merge classes/props into the single child element (Radix Slot) — e.g. a
   * router `<Link>`. `loading`/`iconLeft`/`iconRight` are ignored with
   * `asChild`; the child owns its content.
   */
  asChild?: boolean;
  /** Swap `iconLeft` for a Spinner, set `aria-busy`, and disable the button. */
  loading?: boolean;
  /** Leading Lucide icon element (size inherited from the label). */
  iconLeft?: React.ReactNode;
  /** Trailing Lucide icon element. */
  iconRight?: React.ReactNode;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  iconLeft,
  iconRight,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size={SPINNER_SIZE[size ?? 'md']} /> : iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
