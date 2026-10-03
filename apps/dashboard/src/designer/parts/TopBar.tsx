// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's top bar: the mark and its name back to `/design`, a
 * middle part a page may fill (the build page's app name and version), and at
 * the end the shell's own theme and language controls. Home has "Open the
 * dashboard"; the build page has its own "Open in the dashboard" instead.
 */
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, Hexagon, Languages, LayoutDashboard, Moon, Sun } from 'lucide-react';
import { allLocales } from '@adminium/i18n';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useTheme,
  useThemePrefs,
} from '@adminium/ui';

import { t } from '../../i18n/t.js';

export function TopBar({ middle, end, dashboardLink = false }: { middle?: ReactNode; end?: ReactNode; dashboardLink?: boolean }): ReactNode {
  const resolved = useTheme();
  const { prefs, setPref } = useThemePrefs();
  const dark = resolved.theme === 'dark';
  const locales = allLocales().filter((locale) => locale.enabled);
  const current = locales.find((locale) => locale.id === prefs.locale) ?? locales.find((locale) => locale.id === resolved.locale);
  const themeLabel = dark ? t('designer:topbar.toLight', 'Switch to light theme') : t('designer:topbar.toDark', 'Switch to dark theme');

  return (
    <header className="relative z-30 flex h-[58px] items-center gap-2.5 border-b border-border bg-surface px-[clamp(14px,3vw,28px)]">
      <Link to="/design" aria-label={t('designer:topbar.home', 'Adminium Designer home')} className="flex min-w-0 items-center gap-2.5 text-fg hover:text-fg">
        <span aria-hidden="true" className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-accent text-accent-fg shadow-sm">
          <Hexagon className="size-[17px]" />
        </span>
        <span className="hidden whitespace-nowrap text-[15.5px] font-extrabold tracking-tight sm:inline">{t('designer:brand', 'Adminium Designer')}</span>
      </Link>
      {middle === undefined ? null : <div className="flex min-w-0 flex-1 items-center justify-center gap-2">{middle}</div>}
      <div className="ms-auto flex items-center gap-2">
        {end}
        {dashboardLink ? (
          <a
            href="/"
            aria-label={t('designer:topbar.dashboard', 'Open the dashboard')}
            className="inline-flex items-center gap-[7px] rounded-[10px] px-[11px] py-2 text-[13px] font-bold text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <LayoutDashboard aria-hidden="true" className="size-4" />
            <span className="hidden sm:inline">{t('designer:topbar.dashboard', 'Open the dashboard')}</span>
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setPref('theme', dark ? 'light' : 'dark')}
          aria-label={themeLabel}
          title={themeLabel}
          className="flex size-[38px] items-center justify-center rounded-[10px] border border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
        >
          {dark ? <Sun aria-hidden="true" className="size-[17px]" /> : <Moon aria-hidden="true" className="size-[17px]" />}
        </button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={t('designer:topbar.language', 'Language')}
            className="flex h-[38px] items-center gap-[7px] rounded-[10px] border border-border bg-surface px-2.5 text-[12.5px] font-bold text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <Languages aria-hidden="true" className="size-[17px]" />
            <span className="hidden sm:inline">{current?.native ?? ''}</span>
            <ChevronDown aria-hidden="true" className="hidden size-3.5 sm:inline" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            {locales.map((locale) => (
              <DropdownMenuItem
                key={locale.id}
                lang={locale.tag}
                onSelect={() => setPref('locale', locale.id)}
                trailing={locale.id === current?.id ? <Check aria-hidden="true" className="text-accent" /> : undefined}
              >
                {locale.native}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
