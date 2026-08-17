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
import { icons } from 'lucide-react';
import type { LucideProps } from 'lucide-react';

import { cn } from '../../lib/cn.js';

/** Every lucide icon name, PascalCase (`"ChevronDown"`, `"CircleAlert"`, …). */
export type IconName = keyof typeof icons;

/** Sanctioned icon sizes (px) per research/design-system.md §3. */
export const ICON_SIZES = [12, 13, 14, 15, 16, 18, 26] as const;
export type IconSize = (typeof ICON_SIZES)[number];

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
  const LucideIcon = icons[name];
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
