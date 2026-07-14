/**
 * AppShell (09-generated-app.md §5.1): sidebar + sticky topbar + routed
 * outlet, plus the app-wide surfaces — ⌘K palette, shortcuts panel, offline
 * banner — and the global keyboard registrations (§5.3): `/`, `?`, `⌘⇧L`,
 * `⌘B`, Esc (display), ⌘K (display; bound by useCommandK) and the
 * data-driven G-chords derived from the nav tree.
 *
 * Also owns the realtime subscription: WS `config-changed` invalidates
 * `['bootstrap']` + `['page', *]` so nav edits and regeneration propagate
 * live without reload (§2.1 step 5).
 */
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTheme, useThemePrefs } from '@adminium/ui';

import { invalidateForRealtimeEvent } from '../api/realtime.js';
import { bootstrapQuery, findNavItemBySlug, flattenNav } from '../app/bootstrap.js';
import { CommandPaletteHost } from '../app/palette/CommandPaletteHost.js';
import { gChordTargets } from '../app/shortcuts.js';
import { createRealtimeClient } from '../app/ws.js';
import { logout } from '../auth/authApi.js';
import { t } from '../i18n/t.js';
import { AppToastProvider } from '../pages/toasts.js';
import { ShortcutsPanel } from './ShortcutsPanel.js';
import { useShortcut, useShortcutManager } from './ShortcutsProvider.js';
import { SidebarNav } from './SidebarNav.js';
import { Topbar } from './Topbar.js';

export function AppShell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: bootstrap } = useSuspenseQuery(bootstrapQuery());
  const resolved = useTheme();
  const { setPref } = useThemePrefs();
  const manager = useShortcutManager();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [offline, setOffline] = useState(false);

  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const title = useMemo(() => {
    const slugMatch = /^\/p\/([^/]+)/.exec(pathname);
    if (slugMatch !== null) {
      const item = findNavItemBySlug(bootstrap.nav, slugMatch[1] ?? '');
      if (item !== null) return t(item.labelKey, item.fallback);
    }
    if (pathname.startsWith('/account')) return t('nav.account', 'Account');
    return t('nav.home', 'Home');
  }, [pathname, bootstrap.nav]);

  const signOut = () => {
    logout()
      .catch(() => undefined)
      .finally(() => {
        queryClient.clear();
        void navigate({ to: '/login' });
      });
  };

  // --- realtime: config-changed → invalidate; offline banner signal --------
  useEffect(() => {
    const client = createRealtimeClient({
      channels: ['config-changed'],
      // config-changed → bootstrap + page invalidation; table/widget-data
      // publications → data-list + widget-data invalidation (src/api/realtime.ts).
      onEvent: (event) => invalidateForRealtimeEvent(queryClient, event),
      onStatusChange: (connected) => setOffline(!connected),
    });
    client.start();
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      client.stop();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [queryClient]);

  // --- global shortcut registrations (§5.3) --------------------------------
  useShortcut({
    id: 'palette',
    group: 'General',
    label: t('shortcuts.palette', 'Open command palette'),
    keys: ['⌘', 'K'],
    // Bound by useCommandK inside CommandPaletteHost — display-only here.
  });
  useShortcut({
    id: 'focus-search',
    group: 'General',
    label: t('shortcuts.search', 'Focus search'),
    keys: ['/'],
    handler: () => setPaletteOpen(true),
  });
  useShortcut({
    id: 'shortcuts-panel',
    group: 'General',
    label: t('shortcuts.panel', 'Show shortcuts panel'),
    keys: ['?'],
    handler: () => setShortcutsOpen((open) => !open),
  });
  useShortcut({
    id: 'toggle-theme',
    group: 'General',
    label: t('shortcuts.theme', 'Toggle light / dark'),
    keys: ['⌘', '⇧', 'L'],
    handler: () => setPref('theme', resolved.theme === 'dark' ? 'light' : 'dark'),
  });
  useShortcut({
    id: 'dismiss',
    group: 'General',
    label: t('shortcuts.dismiss', 'Close or dismiss'),
    keys: ['Esc'],
    // Bound by Radix overlays — display-only.
  });
  useShortcut({
    id: 'toggle-sidebar',
    group: 'View',
    label: t('shortcuts.sidebar', 'Toggle sidebar'),
    keys: ['⌘', 'B'],
    handler: () => setSidebarOpen((open) => !open),
  });

  // Data-driven G-chords: first ≤8 nav items with unique letters (§5.3).
  useEffect(() => {
    const targets = gChordTargets(flattenNav(bootstrap.nav));
    const unregister = targets.map(({ item, letter }) =>
      manager.register({
        id: `go-${item.slug}`,
        group: 'Navigation',
        label: t(`shortcuts.go.${item.slug}`, `Go to ${item.fallback}`),
        keys: ['G', 'then', letter.toUpperCase()],
        handler: () => void navigate({ to: '/p/$slug', params: { slug: item.slug } }),
      }),
    );
    return () => {
      for (const fn of unregister) fn();
    };
  }, [manager, bootstrap.nav, navigate]);

  return (
    <AppToastProvider>
    <div className="flex min-h-dvh bg-bg text-fg">
      {offline ? (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-warn px-3 py-2 text-[12.5px] font-bold text-white animate-[nb-slide_.3s_ease]"
        >
          <WifiOff className="size-[15px]" aria-hidden="true" />
          {t('states.offlineBanner', "You're offline — trying to reconnect…")}
        </div>
      ) : null}

      <SidebarNav
        bootstrap={bootstrap}
        onSignOut={signOut}
        className={sidebarOpen ? 'hidden lg:flex' : 'hidden'}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          bootstrap={bootstrap}
          title={title}
          onOpenPalette={() => setPaletteOpen(true)}
          onSignOut={signOut}
          onOpenAccount={() => void navigate({ to: '/account' })}
        />
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>

      <CommandPaletteHost
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        bootstrap={bootstrap}
        onNavigate={(slug) => void navigate({ to: '/p/$slug', params: { slug } })}
        onSignOut={signOut}
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsPanel open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
    </AppToastProvider>
  );
}
