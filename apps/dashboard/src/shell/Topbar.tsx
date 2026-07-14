/**
 * Sticky translucent topbar (09-generated-app.md §5.1, ia-mapping §5
 * color-mix + blur keeper): current page title, global search affordance
 * (`/` focuses, click opens ⌘K), chord-pending indicator ("G…"), theme
 * toggle, NotificationBell placeholder, and the avatar menu.
 */
import { Bell, LogOut, Moon, Settings, Sun, User } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Tooltip,
  useTheme,
  useThemePrefs,
} from '@adminium/ui';

import type { BootstrapData } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { useChordPending } from './ShortcutsProvider.js';

export interface TopbarProps {
  bootstrap: BootstrapData;
  /** Current page title for the breadcrumb slot. */
  title: string;
  onOpenPalette: () => void;
  onSignOut: () => void;
  onOpenAccount: () => void;
}

export function Topbar({ bootstrap, title, onOpenPalette, onSignOut, onOpenAccount }: TopbarProps) {
  const resolved = useTheme();
  const { setPref } = useThemePrefs();
  const dark = resolved.theme === 'dark';
  const pending = useChordPending();
  const { user } = bootstrap;

  return (
    <header
      data-part="topbar"
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] px-4 backdrop-blur-[8px]"
    >
      <h1 className="min-w-0 truncate text-section text-fg">{title}</h1>

      {pending === null ? null : (
        <span data-part="chord-pending" className="text-caption font-bold text-fg-subtle">
          {pending.toUpperCase()}…
        </span>
      )}

      <div className="ms-auto flex items-center gap-2">
        {/* Read-only affordance: clicking (or `/`) opens the ⌘K palette. */}
        <SearchInput
          kbd="⌘K"
          placeholder={t('topbar.search', 'Search…')}
          readOnly
          data-part="topbar-search"
          className="hidden w-[220px] cursor-pointer sm:flex"
          inputClassName="cursor-pointer"
          onClick={onOpenPalette}
          onFocus={(event) => {
            event.currentTarget.blur();
            onOpenPalette();
          }}
        />

        <Tooltip content={t('topbar.theme', 'Toggle light / dark')}>
          <IconButton
            size="lg"
            label={t('topbar.themeLabel', dark ? 'Switch to light theme' : 'Switch to dark theme')}
            onClick={() => setPref('theme', dark ? 'light' : 'dark')}
          >
            {dark ? <Sun className="size-[17px]" /> : <Moon className="size-[17px]" />}
          </IconButton>
        </Tooltip>

        {/* Notification center lands in M7 (09-T15) — placeholder popover. */}
        <Popover>
          <PopoverTrigger asChild>
            <IconButton size="lg" label={t('topbar.notifications', 'Notifications')}>
              <Bell className="size-[17px]" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[260px] text-body-sm text-fg-muted">
            {t('topbar.notificationsSoon', 'Notifications arrive with the notification center (M7).')}
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('topbar.userMenu', 'Account menu')}
              className="ms-1 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Avatar name={user.name} size="md" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuLabel>
              <div className="truncate text-[13px] font-bold text-fg">{user.name}</div>
              <div className="truncate text-caption font-normal text-fg-subtle">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<User />} onSelect={onOpenAccount}>
              {t('topbar.profile', 'Profile')}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Settings />} onSelect={onOpenAccount}>
              {t('topbar.preferences', 'Preferences')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<LogOut className="rtl:-scale-x-100" />} onSelect={onSignOut}>
              {t('topbar.signOut', 'Sign out')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
