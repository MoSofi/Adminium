// SPDX-License-Identifier: AGPL-3.0-only
import { Children, type ComponentPropsWithRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { avatarSizeClasses, type AvatarSize } from '../avatar/index.js';

export interface AvatarStackProps extends ComponentPropsWithRef<'div'> {
  /** `Avatar` elements (or same-sized nodes) to stack. */
  children: ReactNode;
  /** Maximum avatars shown before collapsing the rest into a `+N` chip. */
  max?: number | undefined;
  /** Size of the `+N` overflow chip; match the stacked avatars' size. */
  size?: AvatarSize | undefined;
  /** Accessible name for the group (e.g. "Assignees"). */
  label?: string | undefined;
  /** Formats the overflow chip text; defaults to `` (n) => `+${n}` ``. */
  overflowLabel?: ((hidden: number) => string) | undefined;
}

/**
 * AvatarStack — overlapping avatar row: −8px overlap via the logical `-ms-2`
 * negative margin, 2px `--surface` ring on every item, and a `+N` overflow
 * chip past `max` (research/design-system.md §3 Tier 1).
 */
export function AvatarStack({
  children,
  max,
  size = 'md',
  label,
  overflowLabel = (n) => `+${n}`,
  className,
  ...props
}: AvatarStackProps) {
  const items = Children.toArray(children);
  const visible = max === undefined ? items : items.slice(0, Math.max(0, max));
  const hidden = items.length - visible.length;

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex items-center [&>*]:relative [&>*]:ring-2 [&>*]:ring-surface [&>*:not(:first-child)]:-ms-2',
        className,
      )}
      {...props}
    >
      {visible}
      {hidden > 0 ? (
        <span
          data-testid="avatar-stack-overflow"
          className={cn(
            'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-surface-3 font-mono font-bold tabular-nums text-fg-muted',
            avatarSizeClasses[size],
          )}
        >
          {overflowLabel(hidden)}
        </span>
      ) : null}
    </div>
  );
}
