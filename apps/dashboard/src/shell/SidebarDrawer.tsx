// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rail as a drawer, for a page too narrow to sit beside it
 * (sidebarToggle.tsx decides when).
 *
 * Its own module so AppShell can load it lazily: the drawer is Radix Dialog,
 * which the entry chunk carries for nothing on every wide screen and on every
 * narrow one until the menu button is first pressed (scripts/check-entry-budget.mjs).
 */
import type { ReactNode } from 'react';
import { Drawer, DrawerTitle } from '@adminium/ui';

import { t } from '../i18n/t.js';

/** The rail as a drawer from the start edge, for a page too narrow to sit beside it. */
export function SidebarDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="start"
      aria-describedby={undefined}
      // The rail brings its own width, border and surface.
      className="w-auto border-e-0"
    >
      <DrawerTitle className="sr-only">{t('nav.drawerTitle', 'Navigation')}</DrawerTitle>
      {children}
    </Drawer>
  );
}
