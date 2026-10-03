// SPDX-License-Identifier: AGPL-3.0-only
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type * as React from 'react';

import { useScrollLockBypass } from '../../hooks/useScrollLockBypass.js';
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
 * (research/design-system.md Tier 3). Rendered in a portal; typeahead,
 * arrow-key roving and Esc/outside dismissal are Radix built-ins.
 */
export function DropdownMenuContent({ className, sideOffset = 6, ref, ...props }: DropdownMenuContentProps) {
  // The panel is portalled beside a dialog, not inside it, so a dialog's
  // scroll lock would cancel every wheel over it. Nothing here scrolls today
  // — this is what makes a `max-h-… overflow-y-auto` menu work when one
  // arrives, instead of silently being dead to the wheel.
  const setPanel = useScrollLockBypass<HTMLDivElement>(ref);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={setPanel}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[190px] overscroll-contain rounded-lg border border-border bg-surface p-1 shadow-menu ',
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

/** A set of radio items: one of them is the value (`value`/`onValueChange`). */
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export type DropdownMenuRadioItemProps = Omit<
  React.ComponentPropsWithRef<typeof DropdownMenuPrimitive.RadioItem>,
  'style'
> & {
  /** Leading icon (decorative). */
  icon?: React.ReactNode | undefined;
  /** A second, quieter line under the label. */
  description?: React.ReactNode | undefined;
};

/**
 * One choice of a radio group — `menuitemradio`, checked when it is the
 * group's value. The check sits at the END, after an optional leading icon
 * and a second line, as a menu of named choices reads.
 */
export function DropdownMenuRadioItem({ className, children, icon, description, ...props }: DropdownMenuRadioItemProps) {
  return (
    <DropdownMenuPrimitive.RadioItem className={cn(itemClasses, 'items-start py-2', className)} {...props}>
      {icon ? (
        <span aria-hidden="true" className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-surface-3 text-fg-muted">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{children}</span>
        {description ? <span className="mt-0.5 block text-[12px] leading-snug text-fg-muted">{description}</span> : null}
      </span>
      <DropdownMenuPrimitive.ItemIndicator aria-hidden="true" className="mt-0.5 flex items-center text-accent">
        <Check strokeWidth={3} />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.RadioItem>
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
