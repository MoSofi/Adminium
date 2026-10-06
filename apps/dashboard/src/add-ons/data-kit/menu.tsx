// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data kit's menu: a button that opens a short list of things to do
 * (a row's "more", a page's second actions). The dashboard's own dropdown,
 * under two names a page can use without knowing how it is put together.
 */
import type { ReactElement, ReactNode } from 'react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@adminium/ui';

export interface MenuProps {
  /** The menu's name: the button's words when no `trigger` is given, and what a screen reader calls the list. */
  label: string;
  /** The button that opens it, when it is not a plain one (an icon button). */
  trigger?: ReactElement;
  /** Where the list sits against its button. */
  align?: 'start' | 'end';
  children: ReactNode;
}

export function Menu({ label, trigger, align = 'end', children }: MenuProps): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger ?? <Button variant="secondary">{label}</Button>}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} aria-label={label}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface MenuItemProps {
  onSelect: () => void;
  /** A thing that cannot be taken back: drawn in the danger tone. */
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function MenuItem({ onSelect, danger = false, disabled, icon, children }: MenuItemProps): ReactNode {
  return (
    <DropdownMenuItem onSelect={() => onSelect()} destructive={danger} {...(disabled === undefined ? {} : { disabled })} {...(icon === undefined ? {} : { icon })}>
      {children}
    </DropdownMenuItem>
  );
}
