// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's top bar: the mark and its name back to `/design`, a
 * middle part a page may fill (the build page's app name and version), and at
 * the end the shell's own theme and language controls. Home has "Open the
 * dashboard"; the build page has its own "Open Dashboard" instead.
 *
 * On the build page (`build`) the bar is lower and tighter, in three columns
 * so the middle stays in the middle; the product's name gives way under 900
 * and the language's under 1180, which leaves their icons.
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
import { BuildShare, ProjectButton, useDesktopProject } from './DesktopProject.js';

export function TopBar({ middle, end, dashboardLink = false, build = false }: { middle?: ReactNode; end?: ReactNode; dashboardLink?: boolean; build?: boolean }): ReactNode {
  const resolved = useTheme();
  const { prefs, setPref } = useThemePrefs();
  const dark = resolved.theme === 'dark';
  const locales = allLocales().filter((locale) => locale.enabled);
  const current = locales.find((locale) => locale.id === prefs.locale) ?? locales.find((locale) => locale.id === resolved.locale);
  // Inside the desktop app, a project folder: its button, and Build | Share (Home has it in the middle).
  const project = useDesktopProject();
  const centre = middle ?? (project !== null && !build ? <BuildShare project={project} /> : undefined);
  const themeLabel = dark ? t('designer:topbar.toLight', 'Switch to light theme') : t('designer:topbar.toDark', 'Switch to dark theme');

  return (
    <header
      className={
        build
          ? 'relative z-30 grid h-[52px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[14px] border-b border-border bg-surface px-4 leading-[normal] max-md:flex max-md:gap-1.5 max-md:px-3'
          : project !== null
            ? 'relative z-30 grid h-[58px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border bg-surface px-6'
            : 'relative z-30 flex h-[58px] items-center gap-2.5 border-b border-border bg-surface px-[clamp(14px,3vw,28px)]'
      }
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Link to="/design" aria-label={t('designer:topbar.home', 'Adminium Designer home')} className="flex min-w-0 shrink-0 items-center gap-2.5 text-fg hover:text-fg">
          <span aria-hidden="true" className={`flex shrink-0 items-center justify-center bg-accent text-accent-fg shadow-sm ${build ? 'size-7 rounded-[8px]' : 'size-[30px] rounded-[9px]'}`}>
            <Hexagon className={build ? 'size-4' : 'size-[17px]'} />
          </span>
          <span className={`hidden whitespace-nowrap font-extrabold tracking-tight ${build ? `text-[15px] ${project === null ? 'min-[900px]:inline' : 'min-[1280px]:inline'}` : `text-[15.5px] ${project === null ? 'sm:inline' : 'min-[1200px]:inline'}`}`}>{t('designer:brand', 'Adminium Designer')}</span>
        </Link>
        {project === null ? null : <ProjectButton project={project} />}
      </div>
      {centre === undefined ? null : <div className={`flex min-w-0 flex-1 items-center justify-center ${build ? 'gap-1.5' : 'gap-2'}`}>{centre}</div>}
      <div className={`ms-auto flex shrink-0 items-center justify-end ${build ? 'gap-1.5' : 'gap-2'}`}>
        {end}
        {dashboardLink ? (
          <a
            href="/"
            aria-label={t('designer:topbar.dashboard', 'Open the dashboard')}
            className="inline-flex items-center gap-[7px] rounded-[10px] px-[11px] py-2 text-[13px] font-bold text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <LayoutDashboard aria-hidden="true" className="size-4" />
            <span className={`hidden ${project === null ? 'sm:inline' : 'min-[1200px]:inline'}`}>{t('designer:topbar.dashboard', 'Open the dashboard')}</span>
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setPref('theme', dark ? 'light' : 'dark')}
          aria-label={themeLabel}
          title={themeLabel}
          className={`flex shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg ${build ? 'size-[34px]' : 'size-[38px]'}`}
        >
          {dark ? <Sun aria-hidden="true" className={build ? 'size-4' : 'size-[17px]'} /> : <Moon aria-hidden="true" className={build ? 'size-4' : 'size-[17px]'} />}
        </button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            aria-label={t('designer:topbar.language', 'Language')}
            className={`flex shrink-0 items-center justify-center gap-[7px] rounded-[10px] border border-border bg-surface text-[12.5px] font-bold text-fg-muted hover:border-border-strong hover:text-fg ${
              build ? 'h-[34px] min-w-[34px] min-[1180px]:px-2.5' : 'h-[38px] px-2.5'
            }`}
          >
            <Languages aria-hidden="true" className={build ? 'size-4' : 'size-[17px]'} />
            <span className={`hidden ${build ? 'min-[1180px]:inline' : 'sm:inline'}`}>{current?.native ?? ''}</span>
            <ChevronDown aria-hidden="true" className={`hidden size-3.5 ${build ? 'min-[1180px]:inline' : 'sm:inline'}`} />
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
