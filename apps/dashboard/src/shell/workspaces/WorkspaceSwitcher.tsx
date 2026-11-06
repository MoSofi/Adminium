// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card at the top of the rail and its menu, "Workspaces on {server}".
 *
 * - **One at a time**: the card names the tab's workspace (or "Other
 *   databases", captioned "Not in a workspace": it is no workspace). Its menu
 *   lists every group this person sees, the current one ticked; choosing one
 *   makes it the tab's workspace and stores it as where their next tab
 *   starts.
 * - **All in one menu**: the card names the server. The menu lists the same
 *   rows, unticked; choosing one unfolds that block and brings it into view,
 *   and keeps the page.
 *
 * Then, for whoever holds `settings.manage`, the view itself ("One at a time"
 * / "All in one menu"): ONE setting for everyone on the server, written beside
 * the other server defaults, so it says "Applies to everyone on this server."
 * It is not offered on the desktop app, a server of one person. Then "Manage
 * workspaces", for whoever manages connections, to Data connections.
 *
 * A popover of buttons rather than an ARIA menu: a menu may not hold a radio
 * group, and Tab and the arrow keys must both reach the view. The rows are
 * buttons in a list; the current one says so with `aria-current`.
 *
 * Its accessible name is what it shows ("Workspace, Fernhill Coffee";
 * "Server, Fernhill main"), never a different label.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Server, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger, SegmentedControl } from '@adminium/ui';

import { findPageBySlug, holdsSystemAction, type BootstrapData } from '../../app/bootstrap.js';
import { getI18nInstance, t } from '../../i18n/t.js';
import { DocsLink } from '../../kb/DocsLink.js';
import { docsUrl } from '../../kb/docsLinks.js';
import { getDesktopApi } from '../../lib/desktop-runtime.js';
import { useBranding } from '../BrandMark.js';
import { chooseGroup } from './current.js';
import { blockContent, enginesOf, type WorkspaceGroup } from './model.js';
import { WorkspaceTile, groupName } from './WorkspaceTile.js';

const ENGINE_NAMES: Record<string, string> = { postgres: 'Postgres', mysql: 'MySQL', sqlite: 'SQLite' };

/** "3 databases · MySQL, Postgres". */
export function groupCaption(bootstrap: Pick<BootstrapData, 'workspaces'>, group: WorkspaceGroup): string {
  const count = t('workspaces.databases', '{count, plural, one {# database} other {# databases}}', { count: group.connectionIds.length });
  const engines = enginesOf(bootstrap, group).map((engine) => ENGINE_NAMES[engine] ?? engine);
  if (engines.length === 0) return count;
  let list = engines.join(', ');
  try {
    list = new Intl.ListFormat(getI18nInstance()?.language ?? 'en-US', { style: 'short', type: 'unit' }).format(engines);
  } catch {
    // An engine list in plain commas.
  }
  return `${count} · ${list}`;
}

/** The view setting, written where the other server defaults are. */
async function writeView(view: 'one' | 'all'): Promise<void> {
  const { putWorkspaceView } = await import('../../settings/defaultsApi.js');
  await putWorkspaceView(view);
}

export function WorkspaceSwitcher({
  bootstrap,
  groups,
  current,
  view,
  onGoTo,
}: {
  bootstrap: BootstrapData;
  groups: readonly WorkspaceGroup[];
  current: WorkspaceGroup | null;
  view: 'one' | 'all';
  /** All in one menu: unfold and show a block. */
  onGoTo: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { appName } = useBranding();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mayChooseView = holdsSystemAction(bootstrap, 'settings.manage') && getDesktopApi() === null;
  const mayManage = bootstrap.workspaces?.manage === true || holdsSystemAction(bootstrap, 'connections.manage');

  const choose = (group: WorkspaceGroup) => {
    setOpen(false);
    if (view === 'all') {
      onGoTo(group.id);
      return;
    }
    chooseGroup(bootstrap.user.id, group.id, { remember: true });
    // A page of a database the new workspace does not hold gives way to the workspace's first page.
    const slug = /^\/p\/([^/]+)/.exec(pathname)?.[1];
    const here = slug === undefined ? null : findPageBySlug(bootstrap, decodeURIComponent(slug));
    if (here !== null && typeof here.connectionId === 'string' && !group.connectionIds.includes(here.connectionId)) {
      const first = blockContent(bootstrap.nav, [], group).groups[0]?.items.find((item) => item.offRail !== true && item.link === undefined && item.addOnPage === undefined);
      if (first !== undefined) void navigate({ to: '/p/$slug', params: { slug: first.slug } });
      else void navigate({ to: '/' });
    }
  };

  const setView = (next: string) => {
    if ((next !== 'one' && next !== 'all') || next === view || saving) return;
    setSaving(true);
    writeView(next)
      .then(() => queryClient.invalidateQueries({ queryKey: ['bootstrap'] }))
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  const card =
    view === 'all' || current === null ? (
      <>
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-muted">
          <Server className="size-[15px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-bold uppercase leading-[normal] tracking-[0.05em] text-fg-subtle">{t('workspaces.card.server', 'Server')}</span>
          <span className="block truncate text-[13px] font-bold leading-[normal]">{appName}</span>
        </span>
      </>
    ) : (
      <>
        <WorkspaceTile group={current} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-bold uppercase leading-[normal] tracking-[0.05em] text-fg-subtle">
            {current.kind === 'other' ? t('workspaces.card.notInOne', 'Not in a workspace') : t('workspaces.card.workspace', 'Workspace')}
          </span>
          <span className="block truncate text-[13px] font-bold leading-[normal]">{groupName(current)}</span>
        </span>
      </>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-part="workspace-card"
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2 text-start text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {card}
        <ChevronsUpDown aria-hidden="true" className="size-[15px] shrink-0 text-fg-subtle" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        aria-label={t('workspaces.menu.title', 'Workspaces on {server}', { server: appName })}
        className="w-[min(300px,calc(100vw-32px))] border-border-strong p-1.5 leading-[normal]"
        data-part="workspace-menu"
      >
        <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.05em] text-fg-subtle">
          {t('workspaces.menu.title', 'Workspaces on {server}', { server: appName })}
        </div>
        <ul className="m-0 list-none p-0">
          {groups.map((group) => {
            const ticked = view === 'one' && current?.id === group.id;
            return (
              <li key={group.id}>
                <button
                  type="button"
                  aria-current={ticked ? 'true' : undefined}
                  onClick={() => choose(group)}
                  className="flex w-full items-center gap-[11px] rounded-md px-2.5 py-2 text-start text-fg hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  data-part="workspace-menu-row"
                >
                  <WorkspaceTile group={group} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{groupName(group)}</span>
                    <span className="mt-px block truncate text-[11.5px] text-fg-subtle">{groupCaption(bootstrap, group)}</span>
                  </span>
                  {ticked ? <Check aria-hidden="true" className="size-4 shrink-0 text-accent" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {mayChooseView ? (
          <>
            <div aria-hidden="true" className="mx-1 my-1.5 h-px bg-border" />
            <div className="px-2.5 pb-2 pt-1.5">
              <div id="workspace-view-label" className="mb-1.5 text-[12.5px] font-bold">
                {t('workspaces.view.label', 'Show workspaces')}
              </div>
              <SegmentedControl
                aria-labelledby="workspace-view-label"
                aria-describedby="workspace-view-caption"
                className="flex w-full bg-surface-3"
                itemClassName="h-[30px] flex-1 rounded-sm text-[12px] font-bold"
                value={view}
                disabled={saving}
                onValueChange={setView}
                options={[
                  { value: 'one', label: t('workspaces.view.one', 'One at a time') },
                  { value: 'all', label: t('workspaces.view.all', 'All in one menu') },
                ]}
              />
              <div id="workspace-view-caption" className="mt-[7px] text-[11.5px] leading-[1.5] text-fg-subtle">
                {t('workspaces.view.caption', 'Applies to everyone on this server.')}
              </div>
              <DocsLink href={docsUrl('guides/workspaces#the-two-views')} className="mt-1 text-[11.5px]">
                {t('workspaces.view.docsLink', 'How the two views differ')}
              </DocsLink>
            </div>
          </>
        ) : null}
        {mayManage ? (
          <>
            <div aria-hidden="true" className={mayChooseView ? 'mx-1 mb-1.5 h-px bg-border' : 'mx-1 my-1.5 h-px bg-border'} />
            <Link
              to="/studio"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-[11px] rounded-md px-2.5 py-2 text-[13px] font-bold text-fg hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              data-part="workspace-manage"
            >
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center text-fg-muted">
                <SlidersHorizontal className="size-4" />
              </span>
              {t('workspaces.menu.manage', 'Manage workspaces')}
            </Link>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
