import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/** Root — controls open state (`open`/`onOpenChange`/`defaultOpen`). */
export const DropdownMenu = DropdownMenuPrimitive.Root;

/** Trigger — always `asChild`-compatible; typically wraps a `Button`/`IconButton`. */
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** Logical grouping wrapper (no styling). */
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export type DropdownMenuContentProps = Omit<
  React.ComponentPropsWithRef<typeof DropdownMenuPrimitive.Content>,
  'style'
>;

/**
 * Menu panel — radius 14 (`rounded-lg`), `--shadow-menu`, `nb-pop` entrance
 * (research/design-system.md §3 Tier 3). Rendered in a portal; typeahead,
 * arrow-key roving and Esc/outside dismissal are Radix built-ins.
 */
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[190px] rounded-lg border border-border bg-surface p-1 shadow-menu ',
          'animate-[nb-pop_.16s_cubic-bezier(.2,.7,.3,1)]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

const itemClasses =
  'flex cursor-default select-none items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[13px] text-fg outline-none ' +
  'data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ' +
  '[&_svg]:size-3.5 [&_svg]:shrink-0';

export interface DropdownMenuItemProps
  extends Omit<React.ComponentPropsWithRef<typeof DropdownMenuPrimitive.Item>, 'style'> {
  /** Leading Lucide icon (decorative, muted). */
  icon?: React.ReactNode | undefined;
  /** Danger text + danger-soft highlight (delete/revoke actions). */
  destructive?: boolean | undefined;
  /** Trailing slot aligned to the end — typically a `Kbd` shortcut. */
  trailing?: React.ReactNode | undefined;
}

/** Action item with optional leading icon, trailing slot and destructive tone. */
export function DropdownMenuItem({
  icon,
  destructive = false,
  trailing,
  className,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-destructive={destructive ? '' : undefined}
      className={cn(
        itemClasses,
        destructive && 'text-danger data-[highlighted]:bg-danger-soft',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className={cn('flex items-center', destructive ? 'text-danger' : 'text-fg-muted')}>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="ms-auto flex shrink-0 items-center">{trailing}</span> : null}
    </DropdownMenuPrimitive.Item>
  );
}

export type DropdownMenuCheckboxItemProps = Omit<
  React.ComponentPropsWithRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  'style'
>;

/** Checkable item — reserves a leading check column (`checked`/`onCheckedChange`). */
export function DropdownMenuCheckboxItem({ className, children, ...props }: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenuPrimitive.CheckboxItem className={cn(itemClasses, 'relative ps-7', className)} {...props}>
      <DropdownMenuPrimitive.ItemIndicator
        aria-hidden="true"
        className="absolute start-2 flex items-center text-accent"
      >
        <Check strokeWidth={3} />
      </DropdownMenuPrimitive.ItemIndicator>
      <span className="relative min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export type DropdownMenuLabelProps = Omit<
  React.ComponentPropsWithRef<typeof DropdownMenuPrimitive.Label>,
  'style'
>;

/** Section label — uppercase micro-eyebrow above a group of items. */
export function DropdownMenuLabel({ className, ...props }: DropdownMenuLabelProps) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[.05em] text-fg-subtle', className)}
      {...props}
    />
  );
}

export type DropdownMenuSeparatorProps = Omit<
  React.ComponentPropsWithRef<typeof DropdownMenuPrimitive.Separator>,
  'style'
>;

/** 1px divider between item groups. */
export function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}
