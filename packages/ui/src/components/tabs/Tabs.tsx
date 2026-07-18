import * as TabsPrimitive from '@radix-ui/react-tabs';
import { createContext, useContext, type ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn.js';
import { CountBadge } from '../count-badge/CountBadge.js';

export type TabsVariant = 'underline' | 'pill';

const TabsVariantContext = createContext<TabsVariant>('underline');

export interface TabsProps extends ComponentPropsWithRef<typeof TabsPrimitive.Root> {
  /**
   * `underline` = 2px accent bottom border on the active tab;
   * `pill` = segmented surface-2 tray, active = surface + card shadow.
   */
  variant?: TabsVariant | undefined;
}

/**
 * Tabs — Radix tabs with `underline` and `pill` variants
 * (research/design-system.md §3 Tier 3). Arrow keys auto-mirror in RTL via
 * the app-level Radix `DirectionProvider`.
 */
export function Tabs({ variant = 'underline', className, ...props }: TabsProps) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.Root
        data-variant={variant}
        className={cn('flex flex-col', className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

export type TabsListProps = ComponentPropsWithRef<typeof TabsPrimitive.List>;

const listVariantClasses: Record<TabsVariant, string> = {
  underline: 'flex items-center gap-5 border-b border-border',
  pill: 'inline-flex items-center gap-1 self-start rounded-md bg-surface-2 p-[3px]',
};

/** Tab strip; styling follows the parent `Tabs` variant. */
export function TabsList({ className, ...props }: TabsListProps) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.List
      data-variant={variant}
      className={cn(listVariantClasses[variant], className)}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentPropsWithRef<typeof TabsPrimitive.Trigger> {
  /**
   * Optional count pill (the shared `CountBadge` primitive — mono, surface-3;
   * accent fill when the tab is active via the Radix `data-state` group).
   */
  count?: number | undefined;
}

const triggerVariantClasses: Record<TabsVariant, string> = {
  underline:
    '-mb-px border-b-2 border-transparent pb-2.5 pt-1 text-[13px] text-fg-muted hover:text-fg ' +
    'data-[state=active]:border-accent data-[state=active]:text-fg',
  pill:
    'h-7 rounded-[8px] px-3 text-[12.5px] text-fg-muted hover:text-fg ' +
    'data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-card',
};

/** A single tab trigger with an optional mono count pill. */
export function TabsTrigger({ count, className, children, ...props }: TabsTriggerProps) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'group inline-flex items-center gap-1.5 font-semibold transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-40',
        triggerVariantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
      {count === undefined ? null : (
        <CountBadge
          data-testid="tab-count"
          // Active-state accent fill rides the trigger's Radix `data-state`
          // group (CSS-only) rather than CountBadge's `active` prop, which
          // would need JS knowledge of the selected tab.
          className="group-data-[state=active]:bg-accent group-data-[state=active]:text-accent-fg"
        >
          {count}
        </CountBadge>
      )}
    </TabsPrimitive.Trigger>
  );
}

export type TabsContentProps = ComponentPropsWithRef<typeof TabsPrimitive.Content>;

/** Tab panel. */
export function TabsContent({ className, ...props }: TabsContentProps) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  );
}
