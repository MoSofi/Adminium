import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Shimmer placeholder using the tokens `.nb-skel` sweep (surface-3 ↔
 * surface-2, 1.4s; static under reduced motion). `aria-hidden` — the loading
 * *container* carries `aria-busy` (03-component-library.md §5.1).
 */
export const skeletonVariants = cva('nb-skel block', {
  variants: {
    rounded: {
      sm: 'rounded-sm',
      md: 'rounded-md',
      lg: 'rounded-lg',
      full: 'rounded-full',
    },
  },
  defaultVariants: { rounded: 'md' },
});

export interface SkeletonProps
  extends Omit<React.ComponentPropsWithRef<'div'>, 'style' | 'children'>,
    VariantProps<typeof skeletonVariants> {
  /** Width — number = px, string = any CSS length. Omit to size via className. */
  width?: number | string;
  /** Height — number = px, string = any CSS length. Omit to size via className. */
  height?: number | string;
}

function toCssSize(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

export function Skeleton({ className, rounded, width, height, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        skeletonVariants({ rounded }),
        width !== undefined && 'w-[var(--adm-w)]',
        height !== undefined && 'h-[var(--adm-h)]',
        className,
      )}
      // Sanctioned escape hatch: CSS custom properties only (02-design-system.md §8).
      style={{ '--adm-w': toCssSize(width), '--adm-h': toCssSize(height) }}
      {...props}
    />
  );
}
