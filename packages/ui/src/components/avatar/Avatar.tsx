// SPDX-License-Identifier: AGPL-3.0-only
import { cva, type VariantProps } from 'class-variance-authority';
import { useState, type ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn.js';
import type { Tone } from '../icon-tile/index.js';

/**
 * The 5 fixed deterministic avatar gradients (research/design-system.md §3
 * Tier 1, 03-component-library.md §7.3). The hash below is FROZEN — changing
 * it re-colors every avatar in every install (major-version change).
 */
export const AVATAR_GRADIENTS = [
  ['#6366f1', '#a855f7'],
  ['#f59e0b', '#ef4444'],
  ['#10b981', '#0d9488'],
  ['#06b6d4', '#3b82f6'],
  ['#8b5cf6', '#ec4899'],
] as const;

/**
 * Static gradient utility classes, index-aligned with AVATAR_GRADIENTS.
 * Static classes (not runtime CSS vars) so Tailwind can see them — zero
 * `style` props.
 */
export const avatarGradientClasses = [
  'bg-[linear-gradient(135deg,#6366f1,#a855f7)]',
  'bg-[linear-gradient(135deg,#f59e0b,#ef4444)]',
  'bg-[linear-gradient(135deg,#10b981,#0d9488)]',
  'bg-[linear-gradient(135deg,#06b6d4,#3b82f6)]',
  'bg-[linear-gradient(135deg,#8b5cf6,#ec4899)]',
] as const;

/** Deterministic gradient index for a set of initials (frozen 31-multiply hash). */
export function avatarGradientIndex(initials: string): number {
  let h = 0;
  for (let i = 0; i < initials.length; i++) {
    h = (h * 31 + initials.charCodeAt(i)) >>> 0;
  }
  return h % AVATAR_GRADIENTS.length;
}

/**
 * Initials = first grapheme of the first + last word of `name`, uppercased
 * via `toLocaleUpperCase(locale)` (03-component-library.md §7.3).
 */
export function getInitials(name: string, locale?: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const firstWord = words[0];
  if (firstWord === undefined) return '';
  const first = [...firstWord][0] ?? '';
  const lastWord = words.length > 1 ? words[words.length - 1] : undefined;
  const last = lastWord === undefined ? '' : ([...lastWord][0] ?? '');
  return (first + last).toLocaleUpperCase(locale);
}

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/** Size → box + initials-type classes; shared with AvatarStack's overflow chip. */
export const avatarSizeClasses: Record<AvatarSize, string> = {
  /** 18px */ xs: 'size-[18px] text-[7px]',
  /** 24px */ sm: 'size-6 text-[9px]',
  /** 32px */ md: 'size-8 text-[11px]',
  /** 40px */ lg: 'size-10 text-[14px]',
  /** 56px */ xl: 'size-14 text-[19px]',
  /** 92px */ '2xl': 'size-[92px] text-[32px]',
};

export const avatarVariants = cva(
  'relative inline-flex shrink-0 select-none items-center justify-center font-bold uppercase leading-none text-white',
  {
    variants: {
      size: avatarSizeClasses,
      shape: { circle: 'rounded-full', square: '' },
    },
    compoundVariants: [
      { shape: 'square', size: 'xs', class: 'rounded-[5px]' },
      { shape: 'square', size: 'sm', class: 'rounded-[6px]' },
      { shape: 'square', size: 'md', class: 'rounded-[8px]' },
      { shape: 'square', size: 'lg', class: 'rounded-[10px]' },
      { shape: 'square', size: 'xl', class: 'rounded-[14px]' },
      { shape: 'square', size: '2xl', class: 'rounded-[20px]' },
    ],
    defaultVariants: { size: 'md', shape: 'circle' },
  },
);

const presenceDotSize: Record<AvatarSize, string> = {
  xs: 'size-1.5',
  sm: 'size-1.5',
  md: 'size-2',
  lg: 'size-2.5',
  xl: 'size-3',
  '2xl': 'size-4',
};

const presenceToneBg: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface AvatarProps
  extends Omit<ComponentPropsWithRef<'span'>, 'children'>,
    VariantProps<typeof avatarVariants> {
  /** Full name; initials and the deterministic gradient derive from it. */
  name: string;
  /** Optional image URL; falls back to initials while loading or on error. */
  src?: string | undefined;
  /** Locale used to uppercase the initials (`toLocaleUpperCase`). */
  locale?: string | undefined;
  /** Accessible name; defaults to `name`. */
  label?: string | undefined;
  /** Presence dot tone; the dot renders only when set (e.g. `pos` = online). */
  presence?: Tone | undefined;
}

/**
 * Avatar — initials over 1 of 5 fixed deterministic gradients, or an image
 * with initials fallback; circle / rounded-square shapes; sizes 18–92px;
 * optional presence dot (research/design-system.md §3 Tier 1).
 */
export function Avatar({
  name,
  src,
  locale,
  label,
  presence,
  size,
  shape,
  className,
  ...props
}: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = getInitials(name, locale);
  const gradientClass =
    avatarGradientClasses[avatarGradientIndex(initials)] ?? avatarGradientClasses[0];
  const showImage = src !== undefined && src !== '' && !imageFailed;
  const resolvedSize: AvatarSize = size ?? 'md';

  return (
    <span
      role="img"
      aria-label={label ?? name}
      data-gradient={avatarGradientIndex(initials)}
      className={cn(avatarVariants({ size, shape }), gradientClass, className)}
      {...props}
    >
      {initials}
      {showImage ? (
        <img
          src={src}
          alt=""
          aria-hidden="true"
          onError={() => setImageFailed(true)}
          className="absolute inset-0 size-full rounded-[inherit] object-cover"
        />
      ) : null}
      {presence === undefined ? null : (
        <span
          data-testid="avatar-presence"
          className={cn(
            'absolute bottom-0 end-0 z-10 rounded-full ring-2 ring-surface',
            presenceDotSize[resolvedSize],
            presenceToneBg[presence],
          )}
        />
      )}
    </span>
  );
}
