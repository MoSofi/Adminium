// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AppShell: sidebar + sticky topbar + routed outlet, plus the app-wide
 * surfaces — ⌘K palette, shortcuts panel, offline banner — and the global
 * keyboard registrations: `/`, `?`, `⌘⇧L`, `⌘B`, Esc (display), ⌘K (bound
 * here by useCommandK) and the data-driven G-chords derived from the nav
 * tree.
 *
 * Also owns the realtime subscription: WS `config-changed` invalidates
 * `['bootstrap']` + `['page', *]` so nav edits and regeneration propagate
 * live without reload.
 */
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { WifiOff } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useCommandK, useTheme, useThemePrefs } from '@adminium/ui';

import { invalidateForRealtimeEvent, resyncConfigOnConnect } from '../api/realtime.js';
import { bootstrapQuery, findPageBySlug, flattenNav, holdsSystemAction } from '../app/bootstrap.js';
import { pushRecent } from '../app/palette/recent.js';
import { gChordTargets } from '../app/shortcuts.js';
import { createRealtimeClient } from '../app/ws.js';
import { logout } from '../auth/authApi.js';
import { resyncOverrides } from '../i18n/setup.js';
import { t } from '../i18n/t.js';
import { DesktopUpdateToaster } from '../desktop/updates.js';
import { AppToastProvider } from '../pages/toasts.js';
import { hasStudioAccess } from '../studio/StudioGuard.js';
import { PageActionsProvider } from './PageActionsProvider.js';
/* Lazy: a `?`-triggered help modal is never on the first-paint path, and the
   entry-chunk ratchet (scripts/check-entry-budget.mjs) is the right place to
   pay for that. Rendered only once opened, so no Suspense fallback is needed —
   there is nothing on screen to replace while the chunk loads. */
const ShortcutsPanel = lazy(async () => ({
  default: (await import('./ShortcutsPanel.js')).ShortcutsPanel,
}));
/* Lazy for the same reason, and it is the larger of the two: the palette is a
   modal that is CLOSED on every first paint, on every route, for every user,
   so the entry chunk was carrying its body, ui's CommandPalette and the Radix
   Dialog family behind it purely so a dialog could render nothing. ⌘K is bound
   in AppShell (below) rather than inside the host, so the shortcut still works
   before the chunk exists — mounting is what the keypress triggers. Mounted on
   first open and kept mounted, so reopening never refetches. */
const CommandPaletteHost = lazy(async () => ({
  default: (await import('../app/palette/CommandPaletteHost.js')).CommandPaletteHost,
}));
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
  // Latches on the first open from ANY source so the deferred chunk is
  // requested exactly once and never unmounted (see the effect below).
  const [paletteMounted, setPaletteMounted] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [offline, setOffline] = useState(false);

  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const title = useMemo(() => {
    const slugMatch = /^\/p\/([^/]+)/.exec(pathname);
    if (slugMatch !== null) {
      // Hidden pages title their tab like any other (30 follow-up).
      const item = findPageBySlug(bootstrap, slugMatch[1] ?? '');
      if (item !== null) return t(item.labelKey, item.fallback);
    }
    if (pathname.startsWith('/account')) return t('nav.account', 'Account');
    return t('nav.home', 'Home');
  }, [pathname, bootstrap]);

  // --- ⌘K Recent tracking: every page navigation / record open ----
  // lands in localStorage['adminium-recent:<userId>'] (app/palette/recent.ts),
  // so the palette's Recent group reflects real visits, not only palette use.
  useEffect(() => {
    const record = /^\/p\/([^/]+)\/r\/([^/]+)$/.exec(pathname);
    const match = record ?? /^\/p\/([^/]+)$/.exec(pathname);
    if (match === null) return;
    const slug = decodeURIComponent(match[1] as string);
    const item = findPageBySlug(bootstrap, slug);
    const pageLabel = item === null ? slug : t(item.labelKey, item.fallback);
    if (record !== null) {
      const recordId = decodeURIComponent(record[2] as string);
      pushRecent(bootstrap.user.id, {
        type: 'record',
        label: `${pageLabel} · ${recordId}`,
        href: pathname,
      });
    } else {
      pushRecent(bootstrap.user.id, { type: 'page', label: pageLabel, href: pathname });
    }
  }, [pathname, bootstrap.nav, bootstrap.user.id]);

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
      // notifications:<userId> feeds the sidebar unread badge + feeds (M7 T6).
      channels: ['config-changed', `notifications:${bootstrap.user.id}`],
      // config-changed → bootstrap + page invalidation; table/widget-data
      // publications → data-list + widget-data invalidation; notifications:*
      // → the ['notifications'] prefix (src/api/realtime.ts).
      onEvent: (event) => {
        invalidateForRealtimeEvent(queryClient, event);
        // A translation edit changes no query — it changes what every key
        // resolves to — so it needs its own reaction.
        if (event.type === 'i18n.changed') void resyncOverrides();
      },
      onStatusChange: (connected) => {
        setOffline(!connected);
        // The at-least-once floor: the hub is in-process with no
        // cross-node fan-out, and a socket that dropped during the backoff
        // window silently missed every event published in it. Comparing the
        // version on reconnect is what stops a tab serving stale strings
        // forever.
        if (!connected) return;
        void resyncOverrides();
        // The same floor for everything `config-changed` feeds, and it is
        // needed on the FIRST open too, not only after a drop: this fires
        // once the socket is up, which is strictly after the page fetched
        // its bootstrap, so a build that landed in between published to
        // nobody. `['bootstrap']` never goes stale on its own, so without
        // this the page holds that payload for its whole life — which is how
        // `/p/<slug>` could sit on "This page is not in the running build"
        // until a reload. One read, and it widens only if a stamp moved.
        void resyncConfigOnConnect(queryClient);
      },
    });
    client.start();
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    // Same floor for a tab that was simply in the background while an admin
    // edited copy — `visibilitychange` is the cheapest honest trigger.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void resyncOverrides();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      client.stop();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // No locale dep: `resyncOverrides` reads the live instance itself, so this
    // effect no longer closes over one. Keeping it here would also tear the
    // socket down and reconnect it on every locale switch, which the switch has
    // no reason to do.
  }, [queryClient, bootstrap.user.id]);

  useCommandK(() => setPaletteOpen((open) => !open));
  // Keyed on `paletteOpen` rather than set at each trigger, because three paths
  // open the palette — ⌘K here, the `/` shortcut below, and the Topbar's search
  // button — and a latch wired to only one of them leaves the others opening a
  // host that was never mounted.
  useEffect(() => {
    if (paletteOpen) setPaletteMounted(true);
  }, [paletteOpen]);

  // --- global shortcut registrations --------------------------------
  useShortcut({
    id: 'palette',
    group: 'General',
    label: t('shortcuts.palette', 'Open command palette'),
    keys: ['⌘', 'K'],
    // Bound by the useCommandK call above — display-only here.
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

  // Data-driven G-chords: first ≤8 nav items with unique letters, plus
  // the static `G S` → Studio chord ("via G then S"). Registered here
  // rather than via `useShortcut` so both stay gated on role — a viewer never
  // sees a Studio entry in the shortcuts panel it would only 403 on — and so
  // `s` is reserved from the nav letters in the same pass.
  // `G S` lands on `/studio`, the connections hub, whose list needs
  // `connections.manage` — the role alone would register a chord that opens
  // the forbidden state for a custom role without it.
  const studioAccess =
    hasStudioAccess(bootstrap.roles) && holdsSystemAction(bootstrap, 'connections.manage');
  useEffect(() => {
    const targets = gChordTargets(flattenNav(bootstrap.nav), studioAccess ? ['s'] : []);
    const unregister = targets.map(({ item, letter }) =>
      manager.register({
        id: `go-${item.slug}`,
        group: 'Navigation',
        /* i18n-dynamic-key: `item.slug` is a tenant page slug the Engine derives from the
           customer's own database tables, so the value set does not exist at build time and
           cannot be enumerated into a map — no `shortcuts.go.*` key can ship for it. */
        label: t(`shortcuts.go.${item.slug}`, `Go to ${item.fallback}`),
        keys: ['G', 'then', letter.toUpperCase()],
        handler: () => void navigate({ to: '/p/$slug', params: { slug: item.slug } }),
      }),
    );
    if (studioAccess) {
      unregister.push(
        manager.register({
          id: 'go-studio',
          group: 'Navigation',
          label: t('shortcuts.studio', 'Go to Studio'),
          keys: ['G', 'then', 'S'],
          handler: () => void navigate({ to: '/studio' }),
        }),
      );
    }
    return () => {
      for (const fn of unregister) fn();
    };
  }, [manager, bootstrap.nav, navigate, studioAccess]);

  return (
    <AppToastProvider>
    <div className="flex min-h-dvh bg-bg text-fg">
      {offline ? (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-warn px-3 py-2 text-[12.5px] font-bold text-accent-fg animate-[nb-slide_.3s_ease]"
        >
          <WifiOff className="size-[15px]" aria-hidden="true" />
          {t('states.offline.banner', "You're offline — trying to reconnect…")}
        </div>
      ) : null}

      <SidebarNav
        bootstrap={bootstrap}
        onSignOut={signOut}
        className={sidebarOpen ? 'hidden lg:flex' : 'hidden'}
      />

      {/* The provider has to span BOTH children: the topbar holds the slot, the
          outlet holds the pages that publish into it. */}
      <PageActionsProvider>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            bootstrap={bootstrap}
            title={title}
            onOpenPalette={() => setPaletteOpen(true)}
            onSignOut={signOut}
            onOpenAccount={() => void navigate({ to: '/account' })}
            onOpenPreferences={() => void navigate({ to: '/account/preferences' })}
            onOpenStudio={() => void navigate({ to: '/studio' })}
            onOpenStudioSettings={() => void navigate({ to: '/studio/settings' })}
            onOpenHelp={() => void navigate({ to: '/help' })}
            onOpenChangelog={() => void navigate({ to: '/changelog' })}
          />
          <main className="min-h-0 flex-1">
            <Outlet />
          </main>
        </div>
      </PageActionsProvider>

      {paletteMounted ? (
        <Suspense fallback={null}>
          <CommandPaletteHost
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            bootstrap={bootstrap}
            onNavigate={(slug) => void navigate({ to: '/p/$slug', params: { slug } })}
            onNavigateRecord={(slug, recordId) =>
              void navigate({ to: '/p/$slug/r/$recordId', params: { slug, recordId } })
            }
            onSignOut={signOut}
            onShowShortcuts={() => setShortcutsOpen(true)}
          />
        </Suspense>
      ) : null}
      {shortcutsOpen ? (
        <Suspense fallback={null}>
          <ShortcutsPanel open onOpenChange={setShortcutsOpen} />
        </Suspense>
      ) : null}
      {/* The app-global surface for `notify`-mode update availability — a
          desktop-only, guarded no-op elsewhere. Without a subscriber here the
          main process's broadcast update events fall off the end (green-but-
          broken); with it, a new version is heard app-wide, not only on /about. */}
      <DesktopUpdateToaster />
    </div>
    </AppToastProvider>
  );
}
