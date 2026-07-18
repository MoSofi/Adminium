import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { toneSoftClasses } from '../../lib/tones.js';

// Canonical vocabulary lives in lib/tones.ts (03-component-library.md §3.3);
// re-exported here because this module was the barrel's historical source.
export { toneSoftClasses, toneSolidClasses } from '../../lib/tones.js';
export type { Tone } from '../../lib/tones.js';

export const iconTileVariants = cva(
  'inline-flex shrink-0 items-center justify-center [&_svg]:shrink-0 [&_svg]:stroke-2',
  {
    variants: {
      tone: toneSoftClasses,
      size: {
        /** 28px */
        sm: 'size-7 rounded-[8px] [&_svg]:size-3.5',
        /** 36px */
        md: 'size-9 rounded-[10px] [&_svg]:size-4',
        /** 44px */
        lg: 'size-11 rounded-[12px] [&_svg]:size-5',
        /** 56px */
        xl: 'size-14 rounded-[14px] [&_svg]:size-[26px]',
      },
    },
    defaultVariants: { tone: 'accent', size: 'md' },
  },
);

export interface IconTileProps
  extends ComponentPropsWithRef<'div'>,
    VariantProps<typeof iconTileVariants> {
  /** Lucide icon element (stroke-width 2); size is inherited from the tile. */
  icon?: ReactNode;
  /**
   * Accessible name. When omitted the tile is treated as decorative
   * (`aria-hidden="true"`).
   */
  label?: string | undefined;
}

/**
 * IconTile — the universal "Lucide icon in a tinted rounded square"
 * (research/design-system.md §3 Tier 1). Tone-soft background + tone-colored
 * icon across all 6 tones; sizes 28/36/44/56px.
 */
export function IconTile({ icon, label, tone, size, className, children, ...props }: IconTileProps) {
  return (
    <div
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      data-tone={tone ?? 'accent'}
      className={cn(iconTileVariants({ tone, size }), className)}
      {...props}
    >
      {icon ?? children}
    </div>
  );
}
