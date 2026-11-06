// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The icons a saved app may take (`Save As App.dc.html`, About the app): the
 * comp's twelve, from the product's pinned lucide set. The file carries the
 * icon's lucide name (`icon`), which the server it is installed on shows.
 */
import { Bean, Coffee, CupSoda, Flame, Leaf, Package, Receipt, ShoppingBag, Sprout, Store, Truck, Warehouse, type LucideIcon } from 'lucide-react';
import { SegmentedControl } from '@adminium/ui';

import { t } from '../../i18n/t.js';

export interface AppIcon {
  name: string;
  Icon: LucideIcon;
  label: () => string;
}

export const APP_ICONS: readonly AppIcon[] = [
  { name: 'coffee', Icon: Coffee, label: () => t('studio:saveApp.icon.coffee', 'Coffee') },
  { name: 'bean', Icon: Bean, label: () => t('studio:saveApp.icon.bean', 'Bean') },
  { name: 'flame', Icon: Flame, label: () => t('studio:saveApp.icon.flame', 'Flame') },
  { name: 'package', Icon: Package, label: () => t('studio:saveApp.icon.package', 'Package') },
  { name: 'store', Icon: Store, label: () => t('studio:saveApp.icon.store', 'Shop') },
  { name: 'truck', Icon: Truck, label: () => t('studio:saveApp.icon.truck', 'Truck') },
  { name: 'leaf', Icon: Leaf, label: () => t('studio:saveApp.icon.leaf', 'Leaf') },
  { name: 'sprout', Icon: Sprout, label: () => t('studio:saveApp.icon.sprout', 'Sprout') },
  { name: 'shopping-bag', Icon: ShoppingBag, label: () => t('studio:saveApp.icon.shoppingBag', 'Shopping bag') },
  { name: 'receipt', Icon: Receipt, label: () => t('studio:saveApp.icon.receipt', 'Receipt') },
  { name: 'warehouse', Icon: Warehouse, label: () => t('studio:saveApp.icon.warehouse', 'Warehouse') },
  { name: 'cup-soda', Icon: CupSoda, label: () => t('studio:saveApp.icon.cupSoda', 'Cup') },
];

/** The icon of a saved app, when it is one of these; null otherwise. */
export function appIconOf(name: string | null | undefined): LucideIcon | null {
  return APP_ICONS.find((icon) => icon.name === name)?.Icon ?? null;
}

/** A radiogroup of the icons: arrow keys move and choose, one tab stop. */
export function AppIconPicker({ value, onChange, labelledBy }: { value: string | null; onChange: (name: string) => void; labelledBy: string }) {
  return (
    <SegmentedControl
      aria-labelledby={labelledBy}
      className="flex flex-wrap gap-1.5 bg-transparent p-0"
      itemClassName="size-9 rounded-[10px] border border-border-strong bg-surface px-0 text-fg-muted data-[selected]:border-accent data-[selected]:bg-accent-soft data-[selected]:text-accent [&_svg]:size-4"
      value={value ?? ''}
      onValueChange={onChange}
      options={APP_ICONS.map(({ name, Icon, label }) => ({ value: name, ariaLabel: label(), icon: <Icon aria-hidden /> }))}
    />
  );
}
