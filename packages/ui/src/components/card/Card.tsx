// SPDX-License-Identifier: AGPL-3.0-only
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn.js';

export const cardVariants = cva('rounded-lg border border-border bg-surface shadow-card', {
  variants: {
    /** Hover lift (translateY(-3px) + shadow-md) via the tokens `.nb-lift` class. */
    hoverable: { true: 'nb-lift', false: '' },
    /**
     * Shadow-only hover bloom via the tokens `.nb-cardh` class — the widget-card
     * treatment. Deliberately not `hoverable`: that one also translates and
     * swaps the border, which on a grid of ~40 dashboard cards reads as noise.
     */
    raise: { true: 'nb-cardh', false: '' },
    /** Selected state: accent border + 3px accent-soft ring. */
    selected: { true: 'border-accent ring-[3px] ring-accent-soft', false: '' },
    /**
     * Density-aware padding via the tokens `--card-pad` var (20px comfortable /
     * 16px compact). Set `padded={false}` when composing CardHeader/CardBody/
     * CardFooter slots, which carry their own `--card-pad` padding.
     */
    padded: { true: 'p-[var(--card-pad)]', false: '' },
  },
  defaultVariants: { hoverable: false, raise: false, selected: false, padded: true },
});

export interface CardProps extends ComponentPropsWithRef<'div'>, VariantProps<typeof cardVariants> {
  /** Render the card as its child element (e.g. a router `<Link>`). */
  asChild?: boolean | undefined;
}

/**
 * Card — surface container: `--surface` bg, 1px `--border`, radius 14,
 * `--shadow` (shadow-card), density padding via `--card-pad`
 * (research/design-system.md §3 Tier 3).
 */
export function Card({ asChild, hoverable, raise, selected, padded, className, ...props }: CardProps) {
  const Comp = asChild ? Slot : 'div';
  return (
    <Comp
      data-selected={selected ? '' : undefined}
      className={cn(cardVariants({ hoverable, raise, selected, padded }), className)}
      {...props}
    />
  );
}

export type CardHeaderProps = ComponentPropsWithRef<'div'>;

/**
 * Card header slot: `--card-pad` padding + bottom hairline. Use with
 * `padded={false}` on Card.
 *
 * PACKS TO THE START, and does not spread its children. The slot defaulted to
 * `justify-between` on the theory that a header is "title left, action right",
 * but that is the minority case: across the dashboard 18 headers were an icon
 * beside its own heading and only 5 ended in a real action. On a narrow column
 * nobody noticed; widening the settings pages to `--container-page` flung
 * icons up to 500px from the titles they belong to.
 *
 * A header that DOES want its last child pushed right says so —
 * `className="justify-between"` — or gives its first child `flex-1`, which
 * several already do and which is why they were unaffected either way.
 */
export function CardHeader({ className, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-start gap-3 border-b border-border px-[var(--card-pad)] py-[calc(var(--card-pad)*0.7)]',
        className,
      )}
      {...props}
    />
  );
}

export type CardBodyProps = ComponentPropsWithRef<'div'>;

/** Card body slot: `--card-pad` padding. Use with `padded={false}` on Card. */
export function CardBody({ className, ...props }: CardBodyProps) {
  return <div className={cn('p-[var(--card-pad)]', className)} {...props} />;
}

export type CardFooterProps = ComponentPropsWithRef<'div'>;

/** Card footer slot on `--surface-2` with a top hairline. Use with `padded={false}` on Card. */
export function CardFooter({ className, ...props }: CardFooterProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 rounded-b-[inherit] border-t border-border bg-surface-2 px-[var(--card-pad)] py-[calc(var(--card-pad)*0.6)]',
        className,
      )}
      {...props}
    />
  );
}
