/**
 * Sticky translucent topbar (09-generated-app.md §5.1, ia-mapping §5
 * color-mix + blur keeper): the page title over an optional subtitle line, the
 * desktop runtime chip (11-electron.md §8.1), chord-pending indicator ("G…"),
 * the page-actions slot pages publish into, global search affordance (`/`
 * focuses, click opens ⌘K), the notification bell (live unread count + feed
 * over `/me/notifications`, M7 T6 — the WS `notifications:<userId>` channel
 * keeps both fresh via the shared `['notifications']` query prefix), and the
 * avatar menu, which is also where light/dark now lives.
 *
 * The theme control is a menu item rather than a header button because the
 * header's icon slots are finite and a preference that is toggled once a day
 * does not deserve one — ⌘⇧L (AppShell), the ⌘K palette and the signed-out
 * auth screen all still reach it.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import {
  ArrowLeft,
  Bell,
  Database,
  LogOut,
  Moon,
  Settings,
  SlidersHorizontal,
  Sun,
  User,
} from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Spinner,
  useTheme,
  useThemePrefs,
} from '@adminium/ui';
import { formatRelativeTime } from '@adminium/widgets';

import {
  notificationsApi,
  notificationsQuery,
  unreadCountQuery,
  type NotificationDto,
} from '../api/notifications.js';
import type { BootstrapData } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { hasStudioAccess } from '../studio/StudioGuard.js';
import { PageActionsSlot, usePageBackTo, usePageSubtitle, usePageTitle } from './PageActionsProvider.js';
import { RuntimeChipHost } from './RuntimeChipHost.js';
import { useChordPending } from './ShortcutsProvider.js';

export interface TopbarProps {
  bootstrap: BootstrapData;
  /** Current page title for the breadcrumb slot. */
  title: string;
  onOpenPalette: () => void;
  onSignOut: () => void;
  onOpenAccount: () => void;
  /**
   * Studio entry points (09 §8: "a Studio section appears in the user menu").
   * Rendered only for role ≥ Admin — `StudioGuard` and the server both
   * re-enforce, so this gates discovery, not access.
   */
  onOpenStudio: () => void;
  onOpenStudioSettings: () => void;
}

/**
 * The topbar bell (M7 T6 notification center): a live unread-count dot fed by
 * `unreadCountQuery` and a popover feed over `notificationsQuery` — opening
 * marks everything read (`read-all`), and the WS `notifications:<userId>`
 * events invalidate the shared `['notifications']` prefix so count + feed
 * stay honest across tabs. Item clicks follow the server-authored internal
 * `actionUrl` (e.g. `/exports`).
 */
function NotificationBell() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = useQuery(unreadCountQuery());
  // Fetched lazily — the feed only loads once the popover opens.
  const feed = useQuery({ ...notificationsQuery({ limit: 20 }), enabled: open });
  const unreadCount = unread.data ?? 0;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && unreadCount > 0) {
      // Mark-read on open: the badge is a "you have unseen items" signal, and
      // opening the feed is seeing them. Failures are silent — the next WS
      // event or poll re-syncs the count.
      void notificationsApi
        .markAllRead()
        .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
        .catch(() => undefined);
    }
  };

  const openItem = (item: NotificationDto) => {
    setOpen(false);
    // Server-authored internal paths only ('/exports', '/reports', …).
    if (item.actionUrl !== null && item.actionUrl.startsWith('/')) {
      router.history.push(item.actionUrl);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {/* `border-border` overrides the `bordered` variant's `border-border-strong`:
            the comp's header controls sit on the same hairline as the bar itself. */}
        <IconButton
          size="xl"
          variant="bordered"
          label={t('topbar.notifications', 'Notifications')}
          className="relative border-border"
        >
          <Bell className="size-[17px]" />
          {unreadCount > 0 && (
            <span
              data-part="topbar-unread-badge"
              aria-hidden="true"
              className="pointer-events-none absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 font-mono text-[10px] font-bold leading-4 text-accent-fg tabular-nums"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0" data-part="topbar-notifications">
        <div className="border-b border-border px-3.5 py-2.5 text-body-sm font-bold text-fg">
          {t('topbar.notifications', 'Notifications')}
        </div>
        {feed.isPending ? (
          <div className="flex items-center justify-center py-8">
            <Spinner label={t('topbar.notificationsLoading', 'Loading notifications')} />
          </div>
        ) : feed.isError ? (
          <p className="px-3.5 py-6 text-body-sm text-fg-muted" role="alert">
            {t('topbar.notificationsError', 'Couldn’t load notifications.')}
          </p>
        ) : feed.data.items.length === 0 ? (
          <p className="px-3.5 py-6 text-body-sm text-fg-muted">
            {t('topbar.notificationsEmpty', 'You’re all caught up.')}
          </p>
        ) : (
          <ul className="nb-scroll m-0 max-h-[360px] list-none overflow-y-auto p-1">
            {feed.data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-start transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="flex w-full items-center gap-2">
                    {item.readAt === null && (
                      <span
                        data-part="notification-unread-dot"
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-accent"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-fg">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-caption text-fg-subtle">
                      {formatRelativeTime(new Date(item.createdAt).toISOString())}
                    </span>
                  </span>
                  {item.body !== null && (
                    <span className="w-full truncate text-caption text-fg-muted">{item.body}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border p-1">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.history.push('/account/notifications');
            }}
            className="w-full rounded-md px-2.5 py-2 text-start text-body-sm font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            {t('nav.notificationSettings', 'Notification settings')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Topbar({
  bootstrap,
  title,
  onOpenPalette,
  onSignOut,
  onOpenAccount,
  onOpenStudio,
  onOpenStudioSettings,
}: TopbarProps) {
  const resolved = useTheme();
  const { setPref } = useThemePrefs();
  const dark = resolved.theme === 'dark';
  const pending = useChordPending();
  const subtitle = usePageSubtitle();
  // A routed sub-screen names itself; the shell's path derivation only knows
  // `/p/$slug` and `/account`, and answers "Home" for everything else.
  const publishedTitle = usePageTitle();
  const backTo = usePageBackTo();
  const { user } = bootstrap;
  const admin = hasStudioAccess(bootstrap.roles);

  return (
    <header
      data-part="topbar"
      /* The translucent base mixes --surface, not --bg: the sidebar beside it is
         --surface, so mixing page grey drew a visible seam along the shared edge.
         Height comes from padding rather than `h-14` — the title block is two
         lines whenever a page publishes a subtitle. */
      className="sticky top-0 z-30 flex shrink-0 items-center gap-4 border-b border-border bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-7 py-4 backdrop-blur-[8px]"
    >
      {backTo === null ? null : (
        <IconButton
          variant="ghost"
          size="lg"
          label={t('nav.back', 'Back')}
          data-part="topbar-back"
          asChild
        >
          {/* Before the title, not inside the page body: a screen reached from
              a list needs its way out where the eye already is — beside the
              heading that tells you where you are. `rtl:-scale-x-100` because
              "back" is a direction, and the glyph has to follow the reading
              order the way the sign-out arrow already does. */}
          <Link to={backTo}>
            <ArrowLeft className="rtl:-scale-x-100" />
          </Link>
        </IconButton>
      )}

      <div className="min-w-0">
        <h1 className="truncate text-topbar-title leading-[1.2] text-fg">
          {publishedTitle ?? title}
        </h1>
        {subtitle === null ? null : (
          <div data-part="topbar-subtitle" className="mt-0.5 truncate text-body-sm text-fg-muted">
            {subtitle}
          </div>
        )}
      </div>

      {/* 11-electron.md §8.1: "The topbar … gains a runtime chip next to the
          environment area, desktop only." There is no environment chip in the
          shell yet (03's app-shell reserves the slot), so the chip takes the
          slot beside the title — the same position, and the one place a fact
          about WHICH Adminium this is belongs. Renders `null` off-desktop. */}
      <RuntimeChipHost />

      {pending === null ? null : (
        <span data-part="chord-pending" className="text-caption font-bold text-fg-subtle">
          {pending.toUpperCase()}…
        </span>
      )}

      <div className="ms-auto flex items-center gap-2.5">
        {/* Page-owned controls lead the cluster, so the shell's own affordances
            keep a fixed position at the end of the bar as pages change. */}
        <PageActionsSlot />

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

        <NotificationBell />

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
            {/* Verb label, not a checkbox item: the icon and the wording already
                say which way the switch goes, and a checked state would have to
                pick a side ("dark is on") that half the users read backwards.
                Closes on select (Radix default) — the theme flip is visible
                behind the closing menu either way, and staying open would leave
                a stale label under the cursor. Placed before the Studio
                separator so that separator still opens the admin-only section. */}
            <DropdownMenuItem
              icon={dark ? <Sun /> : <Moon />}
              trailing={<Kbd>⌘⇧L</Kbd>}
              onSelect={() => setPref('theme', dark ? 'light' : 'dark')}
            >
              {dark ? t('theme.toLight', 'Light mode') : t('theme.toDark', 'Dark mode')}
            </DropdownMenuItem>
            {admin ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t('topbar.studio', 'Studio')}</DropdownMenuLabel>
                <DropdownMenuItem icon={<Database />} onSelect={onOpenStudio}>
                  {t('studio.hub.title', 'Data connections')}
                </DropdownMenuItem>
                {/* Pages is deliberately absent: Workspace settings owns the
                    entry point ("Manage pages"), so the menu lists one door per
                    destination instead of two paths to the same surface. */}
                <DropdownMenuItem icon={<SlidersHorizontal />} onSelect={onOpenStudioSettings}>
                  {t('studio.settingsHub.title', 'Workspace settings')}
                </DropdownMenuItem>
              </>
            ) : null}
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
