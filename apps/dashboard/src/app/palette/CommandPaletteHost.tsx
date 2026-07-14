/**
 * ⌘K command palette (09-generated-app.md §5.2, designs/Command
 * Palette.dc.html): ui CommandPalette shell + useCommandK, with fixed group
 * order — Actions (theme toggle, shortcuts panel, sign out) then Navigate
 * (nav-tree entries with their G-chord hints).
 *
 * Search: apps/server/src/routes has no `/api/v1/search` yet, so the palette
 * searches the nav tree client-side only. TODO(Wave B, M4-T06): merge the
 * async `Records` group from `GET /api/v1/search?q=&limit=5` at query ≥ 2
 * chars, plus the mixed-entity Recent group. The "Ask AI" footer renders only
 * when bootstrap `llm.enabled` (hidden for now — 06-llm-assist.md lands M6).
 */
import { Keyboard, LogOut, Moon, Sparkles, Sun } from 'lucide-react';
import { useMemo } from 'react';
import {
  CommandPalette,
  useCommandK,
  useTheme,
  useThemePrefs,
  type CommandGroup,
  type CommandItem,
} from '@adminium/ui';

import { flattenNav, type BootstrapData } from '../bootstrap.js';
import { gChordTargets } from '../shortcuts.js';
import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';

export interface CommandPaletteHostProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bootstrap: BootstrapData;
  onNavigate: (slug: string) => void;
  onSignOut: () => void;
  onShowShortcuts: () => void;
}

export function CommandPaletteHost({
  open,
  onOpenChange,
  bootstrap,
  onNavigate,
  onSignOut,
  onShowShortcuts,
}: CommandPaletteHostProps) {
  const resolved = useTheme();
  const { setPref } = useThemePrefs();
  const dark = resolved.theme === 'dark';

  useCommandK(() => onOpenChange(!open));

  const groups: CommandGroup[] = useMemo(() => {
    const navItems = flattenNav(bootstrap.nav);
    const chords = new Map(gChordTargets(navItems).map(({ item, letter }) => [item.pageId, letter]));
    return [
      {
        id: 'actions',
        label: t('palette.actions', 'Actions'),
        items: [
          {
            id: 'action:toggle-theme',
            label: dark
              ? t('palette.themeLight', 'Switch to light theme')
              : t('palette.themeDark', 'Switch to dark theme'),
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
  }, [bootstrap.nav, dark]);

  const handleSelect = (item: CommandItem) => {
    if (item.id === 'action:toggle-theme') {
      setPref('theme', dark ? 'light' : 'dark');
    } else if (item.id === 'action:sign-out') {
      onSignOut();
    } else if (item.id === 'action:shortcuts') {
      onShowShortcuts();
    } else if (item.id.startsWith('nav:')) {
      onNavigate(item.id.slice('nav:'.length));
    }
  };

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      groups={groups}
      onSelect={handleSelect}
      labels={{
        dialog: t('palette.dialog', 'Command palette'),
        placeholder: t('palette.placeholder', 'Type a command or search…'),
        navigate: t('palette.footerNavigate', 'navigate'),
        open: t('palette.footerOpen', 'select'),
        close: t('palette.footerClose', 'close'),
        empty: (query) => t('palette.empty', `No results for "${query}"`),
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
