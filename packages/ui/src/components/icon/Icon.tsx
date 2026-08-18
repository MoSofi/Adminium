// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Icon — thin wrapper over lucide-react (research/design-system.md §3 "Icons"):
 * Lucide exclusively, `stroke-width: 2`, inline sizes 12–18px (12/13/14/15
 * common) and up to 26px inside icon tiles, always `currentColor` so the
 * surrounding token color (`text-fg-muted`, tone colors) flows in.
 *
 * Directional icons (chevrons, arrows, corner-*) must mirror in RTL — pass
 * `rtlMirror` and the icon flips via the `rtl:-scale-x-100` utility.
 *
 * Accessibility: decorative by default (`aria-hidden`); pass `aria-label` to
 * make it an image with an accessible name (icon-only buttons label the
 * BUTTON, not the icon — see 03-component-library.md §9).
 */
import type { LucideProps, icons } from 'lucide-react';

import { cn } from '../../lib/cn.js';
import { useLucideIcon } from './icon-resolver.js';

/**
 * Every lucide icon name, PascalCase (`"ChevronDown"`, `"CircleAlert"`, …).
 *
 * `import type { icons }` rather than a value import, and that is the whole
 * point: the name space is still the full catalogue for typing, and a type-only
 * import is erased, so none of the 1,611 icon modules reach the bundle. The
 * value side comes from `icon-resolver.ts` — see its header for the 112.6 KiB
 * gzipped this removed from the dashboard entry.
 */
export type IconName = keyof typeof icons;

/** Sanctioned icon sizes (px) per research/design-system.md §3. */
export const ICON_SIZES = [12, 13, 14, 15, 16, 18, 26] as const;
export type IconSize = (typeof ICON_SIZES)[number];

/**
 * The placeholder's box, one literal class per sanctioned size.
 *
 * A map of literals rather than `size-[${size}px]`: Tailwind generates
 * utilities from source TEXT, so an interpolated class produces nothing and the
 * placeholder would collapse to zero — which is the layout shift it exists to
 * prevent. The same reason `surfaceDefaults` keeps its widths as literals.
 */
const PLACEHOLDER_SIZE: Readonly<Record<IconSize, string>> = {
  12: 'size-[12px]',
  13: 'size-[13px]',
  14: 'size-[14px]',
  15: 'size-[15px]',
  16: 'size-[16px]',
  18: 'size-[18px]',
  26: 'size-[26px]',
};

export interface IconProps extends Omit<LucideProps, 'size'> {
  /** Lucide icon name, e.g. `"Search"`, `"ChevronDown"`. */
  name: IconName;
  /** Pixel size from the design-system scale. @default 16 */
  size?: IconSize;
  /** Stroke width. @default 2 */
  strokeWidth?: number;
  /**
   * Mirror the icon horizontally in RTL (`rtl:-scale-x-100`). Set on
   * directional glyphs: chevrons, arrows, undo/redo, corner-*, log-in/out.
   * @default false
   */
  rtlMirror?: boolean;
  /**
   * Restated rather than inherited. `LucideProps` reaches these through
   * `Partial<SVGProps<SVGSVGElement>>`, which does not survive the `Omit<…,
   * 'size'>` above under this package's React/lucide type resolution — the
   * component destructures both, so without them it does not compile.
   */
  className?: string | undefined;
  'aria-label'?: string | undefined;
}

export function Icon(props: IconProps) {
  const {
    name,
    size = 16,
    strokeWidth = 2,
    rtlMirror = false,
    className,
    'aria-label': ariaLabel,
    ...rest
  } = props;
  const LucideIcon = useLucideIcon(name);
  if (LucideIcon === undefined) {
    // Outside the statically-imported core set, so the catalogue is loading.
    // A same-sized inert box, not nothing: the alternative is a glyph-shaped
    // hole that closes a frame later and shifts everything beside it.
    return (
      <span
        aria-hidden={ariaLabel ? undefined : true}
        aria-label={ariaLabel}
        role={ariaLabel ? 'img' : undefined}
        className={cn('inline-block', PLACEHOLDER_SIZE[size], className)}
      />
    );
  }
  return (
    <LucideIcon
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      className={cn(rtlMirror && 'rtl:-scale-x-100', className)}
      {...rest}
    />
  );
}
