import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';

/**
 * Semantic tone vocabulary shared by tinted components (research/design-system.md §3,
 * 03-component-library.md §3.3).
 *
 * TODO(wave-2): consolidate into `lib/tones.ts` together with the status→tone
 * registry (03-component-library.md §7.6) — kept local here to avoid creating
 * shared lib files while ui-infra scaffolds `src/lib/` concurrently.
 */
export type Tone = 'neutral' | 'accent' | 'pos' | 'warn' | 'danger' | 'info';

/** Tone → soft background + strong foreground utility pairs. */
export const toneSoftClasses: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** Tone → solid background + on-tone foreground utility pairs. */
export const toneSolidClasses: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg',
  accent: 'bg-accent text-accent-fg',
  pos: 'bg-pos text-white',
  warn: 'bg-warn text-white',
  danger: 'bg-danger text-white',
  info: 'bg-info text-white',
};

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
