// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ⌘K command palette (Command Palette.dc.html): the ui CommandPalette shell,
 * fixed group order — Actions (theme toggle, shortcuts panel, sign out),
 * Navigate (nav-tree entries with their G-chord hints), Recent (mixed-entity
 * localStorage list./recent.ts — AppShell records every page navigation /
 * record open), then the async Records group: at ≥ 2 query chars, a
 * debounced `GET /api/v1/search?types=record&limit=3` (././api/search.ts)
 * merges server record hits; selecting one navigates to
 * `/p/:pageSlug/r/:recordId`.
 *
 * Honesty rules: while the search is in flight a disabled "Searching…" row
 * renders (never a stale pretend-result); a completed empty search adds
 * nothing, so the palette's own empty state echoes the query; a failed search
 * degrades to no Records group rather than an error card — the palette is a
 * launcher, not a status surface.
 *
 * The "Ask AI" footer renders when bootstrap `llm.enabled` — i.e. once an
 * admin configures a provider in Settings → AI.
 *
 * Loaded lazily by AppShell on the first open (the entry-chunk ratchet,
 * apps/dashboard/scripts/check-entry-budget.mjs — a modal that is closed on
 * every first paint has no business in the boot chunk). ⌘K is therefore bound
 * in AppShell, not here: the shortcut has to work before this module exists.
 */
import { ExternalLink, FileText, History, Keyboard, Loader2, LogOut, Moon, Sparkles, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  CommandPalette,
  useTheme,
  useThemePrefs,
  type CommandGroup,
  type CommandItem,
} from '@adminium/ui';

import { PALETTE_SEARCH_LIMIT, recordHits, search, type SearchRecordHit } from '../../api/search.js';
import { appSectionsOf, flattenNav, type BootstrapData } from '../bootstrap.js';
import { hrefForRecord } from '../links.js';
import { gChordTargets } from '../shortcuts.js';
import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';
import { pushRecent, readRecent, type RecentEntry } from './recent.js';

/** Debounce for the async Records group (snappy but not chatty). */
export const SEARCH_DEBOUNCE_MS = 200;
/** Server minimum — below this the palette stays client-side only. */
export const SEARCH_MIN_CHARS = 2;

const RECORD_ID_PREFIX = 'record:';
const RECENT_ID_PREFIX = 'recent:';

type RecordsState =
  | { status: 'idle'; hits: SearchRecordHit[] }
  | { status: 'loading'; hits: SearchRecordHit[] }
  | { status: 'ready'; hits: SearchRecordHit[] };

export interface CommandPaletteHostProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bootstrap: BootstrapData;
  onNavigate: (slug: string) => void;
  /** Record hit / recent record entry → `/p/:slug/r/:recordId`. */
  onNavigateRecord: (slug: string, recordId: string) => void;
  onSignOut: () => void;
  onShowShortcuts: () => void;
  /** An app's screen: in the dashboard (`/a/<key>/<path>`), or its own address in a new tab. */
  onOpenApp?: (target: { appKey: string; path: string } | { url: string }) => void;
}

/** An external app's screen: `app-screen:<appKey>/<screen id> <url>`. */
const APP_SCREEN_ID_PREFIX = 'app-screen:';

/** Parse an app href back into a palette navigation (recent entries). */
function parseAppHref(href: string): { slug: string; recordId: string | null } | null {
  const record = /^\/p\/([^/]+)\/r\/([^/]+)$/.exec(href);
  if (record !== null) {
    return {
      slug: decodeURIComponent(record[1] as string),
      recordId: decodeURIComponent(record[2] as string),
    };
  }
  const page = /^\/p\/([^/]+)$/.exec(href);
  if (page !== null) return { slug: decodeURIComponent(page[1] as string), recordId: null };
  return null;
}

export function CommandPaletteHost({
  open,
  onOpenChange,
  bootstrap,
  onNavigate,
  onNavigateRecord,
  onSignOut,
  onShowShortcuts,
  onOpenApp,
}: CommandPaletteHostProps) {
  const resolved = useTheme();
  const { setPref } = useThemePrefs();
  const dark = resolved.theme === 'dark';
  const userId = bootstrap.user.id;

  // Controlled query — the host needs it for the debounced server search.
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<RecordsState>({ status: 'idle', hits: [] });
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  // Re-read on every open: recents are written outside React (localStorage).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRecords({ status: 'idle', hits: [] });
    setRecent(readRecent(userId));
  }, [open, userId]);

  const needle = query.trim();
  useEffect(() => {
    if (!open) return;
    if (needle.length < SEARCH_MIN_CHARS) {
      setRecords({ status: 'idle', hits: [] });
      return;
    }
    let cancelled = false;
    setRecords((prev) => ({ status: 'loading', hits: prev.hits }));
    const timer = setTimeout(() => {
      search(needle, { limit: PALETTE_SEARCH_LIMIT, types: ['record'] })
        .then((groups) => {
          if (!cancelled) setRecords({ status: 'ready', hits: recordHits(groups) });
        })
        .catch(() => {
          // Degrade to "no records" — the empty state stays honest about the
          // query, and transport failures surface via the offline banner.
          if (!cancelled) setRecords({ status: 'ready', hits: [] });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, needle]);

  const groups: CommandGroup[] = useMemo(() => {
    const navItems = flattenNav(bootstrap.nav);
    const chords = new Map(gChordTargets(navItems).map(({ item, letter }) => [item.pageId, letter]));
    const out: CommandGroup[] = [
      {
        id: 'actions',
        label: t('palette.actions', 'Actions'),
        items: [
          {
            id: 'action:toggle-theme',
            label: dark
              ? t('palette.themeLight', 'Light mode')
              : t('palette.themeDark', 'Dark mode'),
            icon: dark ? <Sun /> : <Moon />,
            hint: '⌘⇧L',
            keywords: ['theme', 'dark', 'light', 'appearance'],
          },
          {
            id: 'action:shortcuts',
            label: t('palette.shortcuts', 'Keyboard shortcuts'),
            icon: <Keyboard />,
            hint: '?',
            keywords: ['keys', 'help'],
          },
          {
            id: 'action:sign-out',
            label: t('palette.signOut', 'Sign out'),
            icon: <LogOut className="rtl:-scale-x-100" />,
            keywords: ['logout', 'log out'],
          },
        ],
      },
      {
        id: 'navigate',
        label: t('palette.navigate', 'Navigate'),
        items: navItems.map((item) => {
          const Icon = lucideByName(item.icon);
          const letter = chords.get(item.pageId);
          return {
            id: `nav:${item.slug}`,
            label: t(item.labelKey, item.fallback),
            icon: <Icon />,
            ...(letter === undefined ? {} : { hint: `G ${letter.toUpperCase()}` }),
            keywords: [item.slug],
          };
        }),
      },
    ];

    /*
     * The installed apps: each one's pages and its staff screens, named by
     * the app they belong to — the sidebar draws them in its own section, so
     * "Navigate" above does not list them.
     */
    const appItems: CommandItem[] = appSectionsOf(bootstrap).flatMap((section) => {
      const pages = section.groups.flatMap((group) =>
        group.items.map((item): CommandItem => {
          const Icon = lucideByName(item.icon);
          return {
            id: `nav:${item.slug}`,
            label: t(item.labelKey, item.fallback),
            description: section.label,
            icon: <Icon />,
            keywords: [item.slug, section.label],
          };
        }),
      );
      const staff = section.staff;
      const screens: CommandItem[] =
        staff === null
          ? []
          : staff.placement === 'internal'
            ? staff.items.map((item) => {
                const Icon = lucideByName(item.icon ?? 'file');
                return {
                  id: `app:${section.appKey}/${item.path}`,
                  label: item.label,
                  description: section.label,
                  icon: <Icon />,
                  keywords: [section.label],
                };
              })
            : [
                {
                  id: `app-open:${staff.url}`,
                  label: t('nav.app.openStaff', 'Open the staff screens'),
                  description: section.label,
                  icon: <ExternalLink className="rtl:-scale-x-100" />,
                  keywords: [section.label],
                },
                // Each screen, opened at the app's own address.
                ...(staff.items ?? []).map((item): CommandItem => {
                  const Icon = lucideByName(item.icon ?? 'file');
                  return {
                    id: `${APP_SCREEN_ID_PREFIX}${section.appKey}/${item.id} ${staff.url}${item.path}`,
                    label: item.label,
                    description: section.label,
                    icon: <Icon />,
                    keywords: [section.label],
                  };
                }),
                ...(staff.instances ?? []).map(
                  (instance): CommandItem => ({
                    id: `app-open:${instance.url}`,
                    label: t('nav.app.openStaff', 'Open the staff screens'),
                    description: `${section.label} · ${instance.slug}`,
                    icon: <ExternalLink className="rtl:-scale-x-100" />,
                    keywords: [section.label, instance.slug],
                  }),
                ),
              ];
      return [...pages, ...screens];
    });
    if (appItems.length > 0) out.push({ id: 'apps', label: t('palette.apps', 'Apps'), items: appItems });

    if (recent.length > 0) {
      out.push({
        id: 'recent',
        label: t('palette.recent', 'Recent'),
        items: recent.map((entry) => ({
          id: `${RECENT_ID_PREFIX}${entry.href}`,
          label: entry.label,
          icon: <History />,
          keywords: [entry.type, entry.href],
        })),
      });
    }

    // Async Records group. Server hits matched q against columns the
    // label may not contain, so the current query rides along as a keyword —
    // the palette's client-side filter must never hide a server hit.
    if (needle.length >= SEARCH_MIN_CHARS) {
      const items: CommandItem[] =
        records.status === 'loading'
          ? [
              {
                id: 'records:loading',
                label: t('palette.searching', 'Searching records…'),
                icon: <Loader2 className="animate-spin" />,
                disabled: true,
                keywords: [needle],
              },
            ]
          : records.hits.map((hit) => ({
              id: `${RECORD_ID_PREFIX}${hit.pageSlug} ${hit.recordId}`,
              label: hit.label,
              // The muted subtitle.
              ...(hit.context === undefined ? {} : { description: hit.context }),
              icon: <FileText />,
              keywords: [needle, hit.table],
            }));
      if (items.length > 0) {
        out.push({ id: 'records', label: t('palette.records', 'Records'), items });
      }
    }

    return out;
  }, [bootstrap, dark, recent, records, needle]);

  const handleSelect = (item: CommandItem) => {
    if (item.id === 'action:toggle-theme') {
      setPref('theme', dark ? 'light' : 'dark');
    } else if (item.id === 'action:sign-out') {
      onSignOut();
    } else if (item.id === 'action:shortcuts') {
      onShowShortcuts();
    } else if (item.id.startsWith('nav:')) {
      onNavigate(item.id.slice('nav:'.length));
    } else if (item.id.startsWith(APP_SCREEN_ID_PREFIX)) {
      // `<appKey>/<screen id> <url>` — the id keeps two screens at one URL apart.
      const rest = item.id.slice(APP_SCREEN_ID_PREFIX.length);
      onOpenApp?.({ url: rest.slice(rest.indexOf(' ') + 1) });
    } else if (item.id.startsWith('app-open:')) {
      onOpenApp?.({ url: item.id.slice('app-open:'.length) });
    } else if (item.id.startsWith('app:')) {
      const rest = item.id.slice('app:'.length);
      const at = rest.indexOf('/');
      onOpenApp?.({ appKey: rest.slice(0, at), path: rest.slice(at + 1) });
    } else if (item.id.startsWith(RECORD_ID_PREFIX)) {
      // Slugs never contain spaces (engine slugify); recordIds may (composite
      // PK JSON tuples) — split on the FIRST space only.
      const rest = item.id.slice(RECORD_ID_PREFIX.length);
      const sep = rest.indexOf(' ');
      const slug = rest.slice(0, sep);
      const recordId = rest.slice(sep + 1);
      pushRecent(userId, {
        type: 'record',
        label: item.label,
        href: hrefForRecord(slug, recordId),
      });
      onNavigateRecord(slug, recordId);
    } else if (item.id.startsWith(RECENT_ID_PREFIX)) {
      const href = item.id.slice(RECENT_ID_PREFIX.length);
      const target = parseAppHref(href);
      if (target === null) return;
      if (target.recordId === null) onNavigate(target.slug);
      else onNavigateRecord(target.slug, target.recordId);
    }
  };

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      groups={groups}
      onSelect={handleSelect}
      query={query}
      onQueryChange={setQuery}
      labels={{
        dialog: t('palette.dialog', 'Command palette'),
        placeholder: t('palette.placeholder', 'Type a command or search…'),
        navigate: t('palette.footerNavigate', 'navigate'),
        open: t('palette.footerOpen', 'select'),
        close: t('palette.footerClose', 'close'),
        empty: (query) => t('palette.empty', `No results for "${query}"`, { query }),
      }}
      footerExtra={
        bootstrap.llm.enabled ? (
          <span className="flex items-center gap-1.5 text-caption text-fg-muted">
            <Sparkles className="size-[13px] text-accent" aria-hidden="true" />
            {t('palette.askAi', 'Ask AI')}
          </span>
        ) : undefined
      }
    />
  );
}
