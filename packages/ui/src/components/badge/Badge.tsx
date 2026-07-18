import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { toneSoftClasses } from '../../lib/tones.js';

// The semantic tone vocabulary lives in lib/tones.ts (03-component-library.md
// §3.3); re-exported here for the library-internal `../badge/Badge.js` imports.
export type { Tone } from '../../lib/tones.js';

/**
 * Pill badge: radius-full, 11px/700, soft tone background + strong tone
 * foreground (research/design-system.md §3 Tier 1). The tone→class map is the
 * shared `toneSoftClasses` recipe — one source of truth for every soft tint.
 */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold leading-4',
  {
    variants: {
      tone: toneSoftClasses,
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends Omit<React.ComponentPropsWithRef<'span'>, 'style'>,
    VariantProps<typeof badgeVariants> {
  /** Render a 6px status dot (currentColor) before the content. */
  dot?: boolean;
  /**
   * Merge classes/props into the single child element instead of rendering a
   * `<span>` (Radix Slot). The `dot` option is ignored when `asChild` is set.
   */
  asChild?: boolean;
}

export function Badge({ className, tone, dot = false, asChild = false, children, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : 'span';
  return (
    <Comp data-tone={tone ?? 'neutral'} className={cn(badgeVariants({ tone }), className)} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {dot ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}
