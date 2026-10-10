// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the Designer's top bars gain inside the desktop app, when the window
 * holds a project folder: the project's name as a button with the three
 * things a person does with a project as a whole, and Build | Share.
 *
 * Nothing here renders anywhere else. In a browser there is no bridge; in the
 * app's classic workspace the bridge says the window holds no project; and an
 * app older than these calls has no `project` on its bridge at all.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, FolderOpen, Hammer, Package, RadioTower, X } from 'lucide-react';
import type { DesktopProjectInfo } from '@adminium/desktop/api';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { getDesktopApi } from '../../lib/desktop-runtime.js';

/** Asked once per page load: the project a window holds does not change under a page. */
let asked: Promise<DesktopProjectInfo | null> | null = null;

function projectInfo(): Promise<DesktopProjectInfo | null> {
  const project = getDesktopApi()?.project;
  if (project === undefined) return Promise.resolve(null);
  asked ??= project.info().catch(() => null);
  return asked;
}

/** For tests: the next read asks the bridge again. */
export function forgetDesktopProject(): void {
  asked = null;
}

/** The project this window holds, or `null`: not the app, not a project, or not known yet. */
export function useDesktopProject(): DesktopProjectInfo | null {
  const [info, setInfo] = useState<DesktopProjectInfo | null>(null);
  useEffect(() => {
    let live = true;
    void projectInfo().then((value) => {
      if (live) setInfo(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return info;
}

/** The system's own name for where folders are looked at. */
export function showInFolderLabel(platform: string | undefined): string {
  if (platform === 'darwin') return t('designer:project.showFinder', 'Show in Finder');
  if (platform === 'win32') return t('designer:project.showExplorer', 'Show in File Explorer');
  return t('designer:project.showFiles', 'Show in the file manager');
}

/** The rule, then the project's name as a button with its menu. */
export function ProjectButton({ project }: { project: DesktopProjectInfo }): ReactNode {
  const api = getDesktopApi();
  return (
    <>
      <span aria-hidden="true" className="h-[22px] w-px shrink-0 bg-border-strong" />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t('designer:project.menu', 'Project: {name}', { name: project.name })}
          className="inline-flex h-[34px] min-w-0 max-w-full items-center gap-1.5 rounded-[10px] border border-transparent bg-transparent pe-2 ps-2.5 text-[14px] font-extrabold tracking-[-0.01em] text-fg hover:border-border-strong"
        >
          <span className="truncate">{project.name}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[230px]">
          {/* The ZIP is made by the app, with the choice of what goes in it: not built yet. */}
          <DropdownMenuItem disabled icon={<Package aria-hidden="true" />}>
            {t('designer:project.export', 'Export this project…')}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<FolderOpen aria-hidden="true" />} onSelect={() => void api?.project.showInFolder()}>
            {showInFolderLabel(api?.platform)}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<X aria-hidden="true" />} onSelect={() => void api?.project.close()}>
            {t('designer:project.close', 'Close project')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

const segment = (on: boolean): string =>
  [
    'inline-flex items-center gap-[7px] rounded-[8px] border-0 py-1.5 pe-[15px] ps-[13px] text-[13px] font-bold leading-[normal]',
    on ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(20,20,35,.10),0_1px_3px_rgba(20,20,35,.08)]' : 'bg-transparent text-fg-muted',
    'disabled:cursor-not-allowed disabled:opacity-45',
  ].join(' ');

/** Build | Share. Build is where the project is; sharing it is not built yet, so its side cannot be chosen. */
export function BuildShare({ project }: { project: DesktopProjectInfo }): ReactNode {
  const shared = project.mode === 'serve';
  return (
    <div role="radiogroup" aria-label={t('designer:mode.label', 'Build or share')} className="inline-flex shrink-0 gap-0.5 rounded-[11px] border border-border bg-surface-3 p-[3px]">
      <button type="button" role="radio" aria-checked={!shared} tabIndex={shared ? -1 : 0} className={segment(!shared)}>
        <Hammer aria-hidden="true" className="size-[15px]" />
        {t('designer:mode.build', 'Build')}
      </button>
      <button type="button" role="radio" aria-checked={shared} tabIndex={shared ? 0 : -1} disabled={!shared} className={segment(shared)}>
        <RadioTower aria-hidden="true" className="size-[15px]" />
        {t('designer:mode.share', 'Share')}
      </button>
    </div>
  );
}

/** Build | Share for a bar that fills its own end (the build page): nothing outside a desktop project. */
export function DesktopBuildShare(): ReactNode {
  const project = useDesktopProject();
  return project === null ? null : <BuildShare project={project} />;
}
