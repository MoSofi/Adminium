// SPDX-License-Identifier: AGPL-3.0-only
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/**
 * The Adminium mark: table rows stacked into a capital A. One colour, drawn on
 * a 32 grid, and it takes `currentColor`, so the caller decides the colour:
 * bare it is the text colour, on an accent tile it is the tile's foreground.
 * The same four rows are the website's logo and the desktop app's icon
 * (`apps/desktop/resources/icons/icon-master.svg`); change one, change all.
 *
 * Decorative by default: the product's name stands beside it wherever it is
 * shown, so it is hidden from assistive technology unless a `title` is given.
 */
export interface AdminiumMarkProps extends Omit<React.ComponentPropsWithRef<'svg'>, 'children' | 'viewBox'> {
  /** An accessible name, for a mark shown with no name beside it. */
  title?: string;
}

export function AdminiumMark({ title, className, ...props }: AdminiumMarkProps): React.ReactNode {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      data-part="adminium-mark"
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <rect x="11.5" y="5" width="9" height="5.6" rx="2.2" />
      <rect x="7.5" y="13.2" width="17" height="5.6" rx="2.2" />
      <rect x="3.5" y="21.4" width="10.5" height="5.6" rx="2.2" />
      <rect x="18" y="21.4" width="10.5" height="5.6" rx="2.2" />
    </svg>
  );
}
