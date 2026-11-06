// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The menu grouped by workspace (`Workspaces.dc.html`), for someone who sees
 * two groups or more.
 *
 * - **One at a time**: the card names the tab's workspace; below it, that
 *   workspace's block.
 * - **All in one menu**: the card names the server; below it, one folding
 *   block per workspace this person sees, then "Other databases".
 *
 * A BLOCK holds every page of its databases, from every nav group, under
 * today's group headings (drawn once the block has pages of two groups),
 * sectioned per database with the comp's mono label once it holds two
 * databases; then the sections of the apps and add-ons installed on them.
 *
 * Then, once, in both views: SHARED (pages of no database, installs kept once
 * per server, hosted apps of no install) and the platform rows (Library,
 * People, Account and what add-ons brought), exactly the rows the plain rail
 * offers.
 *
 * ONE `aria-current`. A database in two workspaces puts its pages in both
 * blocks; only the copy in the tab's workspace is a router link that can be
 * current. The other copy is a plain link that says, to a screen reader,
 * which other workspace it is also in; following it makes its block the
 * tab's workspace.
 */
import { useRouter } from '@tanstack/react-router';
import { ChevronRight, ExternalLink, Package } from 'lucide-react';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@adminium/ui';

import type { AppSection, BootstrapData, NavItem } from '../../app/bootstrap.js';
import { isDashboardPath, isDocumentHref } from '../../app/openHref.js';
import { useCommonWords } from '../../i18n/commonWords.js';
import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';
import { sectionNavItems } from '../navSections.js';
import {
  AddOnLinkList,
  AddOnSettingsLinkList,
  GROUP_LABEL_KEY,
  GROUP_LABELS,
  HostedAppRows,
  HostedAppSection,
  NAV_LINK_CLASS,
  NavItemList,
  PlatformLinkList,
  SETTINGS_GROUP,
  useRailRows,
} from '../railParts.js';
import { NAV_GROUP_KEYS } from '../../app/bootstrap.js';
import { chooseGroup, useCurrentGroup } from './current.js';
import { blockContent, databasesOf, groupsHolding, sharedContent, type BlockContent, type WorkspaceGroup } from './model.js';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';
import { WorkspaceTile, groupName } from './WorkspaceTile.js';

const GROUP_HEADING_CLASS = 'px-2 pb-1 pt-3 text-micro uppercase tracking-[0.06em] text-fg-subtle';

/** The id of a block's body, for its fold button and the switcher's "go to". */
export function blockId(groupId: string): string {
  return `ws-block-${groupId}`;
}

/** How a block's rows behave: the tab's workspace's are the real links; another's are copies. */
interface RowMode {
  /** This block is the tab's workspace: its rows may be current. */
  active: boolean;
  /** The other workspaces a row's database is in, for "also in". */
  alsoIn: (item: Pick<NavItem, 'connectionId'>) => string | null;
  /** Following a row of this block makes it the tab's workspace. */
  follow: () => void;
}

/**
 * A row of a block that is not the tab's workspace: a plain link to the same
 * place, never current, saying where else it is.
 */
function CopyRow({ item, mode }: { item: NavItem; mode: RowMode }) {
  const router = useRouter();
  const Icon = lucideByName(item.icon);
  const also = mode.alsoIn(item);
  const label = (
    <span className="min-w-0 flex-1 truncate">
      {item.link === undefined ? t(item.labelKey, item.fallback) : item.fallback}
      {also === null ? null : <span className="sr-only">{` (${t('workspaces.alsoIn', 'also in {workspace}', { workspace: also })})`}</span>}
    </span>
  );
  if (item.link !== undefined && (item.link.document || !isDashboardPath(item.link.href))) {
    return (
      <a href={isDocumentHref(item.link.href) ? item.link.href : undefined} target="_blank" rel="noreferrer" className={NAV_LINK_CLASS} data-part="nav-app-link">
        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
        {label}
        <ExternalLink className="size-3.5 shrink-0 opacity-70 rtl:-scale-x-100" aria-hidden="true" />
      </a>
    );
  }
  const href =
    item.link !== undefined
      ? item.link.href
      : item.addOnPage !== undefined
        ? router.buildLocation({ to: '/add-ons/$key/$', params: { key: item.addOnPage.key, _splat: item.addOnPage.ref } }).href
        : router.buildLocation({ to: '/p/$slug', params: { slug: item.slug } }).href;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    mode.follow();
    router.history.push(href);
  };
  return (
    <a href={href} className={NAV_LINK_CLASS} data-part="nav-copy" onClick={onClick}>
      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
      {label}
    </a>
  );
}

function Rows({ items, mode }: { items: readonly NavItem[]; mode: RowMode }) {
  if (mode.active) return <NavItemList items={items} />;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((item) => (
        <li key={item.pageId}>
          <CopyRow item={item} mode={mode} />
        </li>
      ))}
    </ul>
  );
}

/** A database's name over its pages, once a block holds two databases. */
function DatabaseLabel({ children }: { children: ReactNode }) {
  return (
    <div data-part="nav-database-label" className="truncate px-[11px] pb-1 pt-3 font-mono text-[11.5px] font-semibold leading-[normal] text-fg-subtle">
      {children}
    </div>
  );
}

/** An installed app's or add-on's section inside a block: its name, kind and version, then its rows. */
function BlockSection({ section, mode }: { section: AppSection; mode: RowMode }) {
  const groups = section.groups.map((group) => ({ ...group, items: group.items.filter((item) => item.offRail !== true) })).filter((group) => group.items.length > 0);
  const staff = section.staff;
  if (groups.length === 0 && staff === null) return null;
  return (
    <div data-part="nav-app-section">
      <div className="flex items-center gap-2.5 px-[11px] pb-1.5 pt-3.5">
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface-3 text-fg-muted">
          <Package className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-extrabold leading-[normal] tracking-[-0.01em] text-fg">{section.label}</span>
        {section.kind === 'add-on' ? (
          <span className="shrink-0 rounded-sm border border-border-strong px-1.5 py-px text-[10.5px] font-bold leading-[normal] text-fg-subtle">
            {t('workspaces.section.addOn', 'Add-on')}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-[10.5px] font-semibold leading-[normal] text-fg-subtle">{section.version}</span>
      </div>
      {groups.map((group) => (
        <div key={group.key} className="mb-1">
          {group.label === null ? null : (
            <div className="px-2.5 pb-1 pt-[11px] text-[10px] font-extrabold uppercase tracking-[0.08em] text-fg-subtle">{group.label}</div>
          )}
          <Rows items={group.items} mode={mode} />
        </div>
      ))}
      {staff?.placement === 'internal' ? <HostedAppRows app={{ appKey: section.appKey, label: section.label, items: staff.items }} inert={!mode.active} /> : null}
      {staff?.placement === 'external' ? (
        <a href={staff.url} target="_blank" rel="noreferrer" className={NAV_LINK_CLASS} data-part="nav-app-open">
          <Package className="size-[18px] shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t('nav.app.openStaff', 'Open the staff screens')}</span>
          <ExternalLink className="size-3.5 shrink-0 opacity-70 rtl:-scale-x-100" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

/** What a block (or the Shared group) holds, as rows. */
function BlockBody({ content, mode, empty }: { content: BlockContent; mode: RowMode; empty?: boolean }) {
  const headings = content.groups.length >= 2;
  const perDatabase = databasesOf({ groups: content.groups, sections: [] }).length >= 2;
  if (content.groups.length === 0 && content.sections.length === 0) {
    return empty === true ? (
      <p className="px-2 py-3 text-body-sm text-fg-subtle" data-part="nav-empty">
        {t('nav.emptyConnected', 'Pages appear here once they are made from the connected database.')}
      </p>
    ) : null;
  }
  return (
    <>
      {content.groups.map((group) => (
        <div key={group.key} className="mb-1">
          {headings ? <div className={GROUP_HEADING_CLASS}>{t(GROUP_LABEL_KEY[group.key], GROUP_LABELS[group.key])}</div> : null}
          {perDatabase ? (
            sectionNavItems(group.items).map((section) => (
              <div key={section.connectionId ?? 'shared'} className="mb-1">
                <DatabaseLabel>{section.connectionName ?? t('nav.connection.unnamed', 'Connection')}</DatabaseLabel>
                <Rows items={section.items} mode={mode} />
              </div>
            ))
          ) : (
            <Rows items={group.items} mode={mode} />
          )}
        </div>
      ))}
      {content.sections.map((section) => (
        <BlockSection key={section.installId ?? section.appKey} section={section} mode={mode} />
      ))}
    </>
  );
}

/** All in one menu: a block with its folding header. */
function FoldBlock({
  group,
  open,
  onToggle,
  children,
}: {
  group: WorkspaceGroup;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = blockId(group.id);
  return (
    <div data-part="nav-workspace-block" data-workspace={group.id}>
      <button
        type="button"
        id={`${id}-head`}
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex w-full items-center gap-[9px] rounded-md px-[11px] pb-1.5 pt-3 text-start text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <WorkspaceTile group={group} size={22} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-extrabold leading-[normal]">{groupName(group)}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn('size-4 shrink-0 text-fg-subtle transition-transform duration-150', open ? 'rotate-90' : 'rtl:-scale-x-100')}
        />
      </button>
      <div id={id} hidden={!open} className="flex flex-col">
        {children}
      </div>
    </div>
  );
}

export function WorkspaceRail({ bootstrap }: { bootstrap: BootstrapData }) {
  // Its words are a group of their own, out of the entry chunk: wait for them, under the rail's Suspense.
  useCommonWords();
  const { groups, current, view } = useCurrentGroup(bootstrap);
  const { platformLinksFor, addOnPagesFor, addOnSettings, declaredGroups, appSections, hostedApps } = useRailRows(bootstrap);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const modeFor = (group: WorkspaceGroup): RowMode => ({
    active: current?.id === group.id,
    alsoIn: (item) => {
      if (typeof item.connectionId !== 'string') return null;
      const others = groupsHolding(groups, item.connectionId).filter((other) => other.id !== group.id);
      if (others.length === 0) return null;
      return groupName(others.find((other) => other.id === current?.id) ?? others[0]!);
    },
    follow: () => chooseGroup(bootstrap.user.id, group.id),
  });

  /** The switcher's "go to", in All in one menu: unfold that block and bring it into view. */
  const goTo = (groupId: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
    requestAnimationFrame(() => {
      const head = document.getElementById(`${blockId(groupId)}-head`);
      head?.scrollIntoView({ block: 'nearest' });
      head?.focus();
    });
  };

  const shared = sharedContent(bootstrap.nav, appSections, groups);
  const sharedMode: RowMode = { active: true, alsoIn: () => null, follow: () => undefined };
  const sharedHas = shared.groups.length > 0 || shared.sections.length > 0 || hostedApps.length > 0;

  // The platform rows, once: each built-in group's links, its add-on rows and (Library) the add-on settings rows.
  const platform = NAV_GROUP_KEYS.map((key) => ({
    key,
    links: key === 'workspace' ? [] : platformLinksFor(key),
    pages: addOnPagesFor(key),
    settings: key === SETTINGS_GROUP ? addOnSettings : [],
  })).filter((entry) => entry.links.length + entry.pages.length + entry.settings.length > 0);

  return (
    <>
      <div className="px-2.5 pb-1.5">
        <WorkspaceSwitcher bootstrap={bootstrap} groups={groups} current={current} view={view} onGoTo={goTo} />
      </div>
      <div className="nb-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {view === 'one' ? (
          current === null ? null : (
            <nav aria-label={groupName(current)} data-part="nav-workspace" data-workspace={current.id}>
              <BlockBody content={blockContent(bootstrap.nav, appSections, current)} mode={modeFor(current)} empty />
            </nav>
          )
        ) : (
          <nav aria-label={t('workspaces.filter.all', 'All workspaces')} data-part="nav-workspaces">
            {groups.map((group) => (
              <FoldBlock
                key={group.id}
                group={group}
                open={!folded.has(group.id)}
                onToggle={() =>
                  setFolded((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  })
                }
              >
                <BlockBody content={blockContent(bootstrap.nav, appSections, group)} mode={modeFor(group)} />
              </FoldBlock>
            ))}
          </nav>
        )}

        <nav aria-label={t('workspaces.serverNav', 'Server')} data-part="nav-server">
          {sharedHas ? (
            <div className="mb-1" data-part="nav-shared">
              <div className={GROUP_HEADING_CLASS}>{t('nav.connection.shared', 'Shared')}</div>
              <BlockBody content={shared} mode={sharedMode} />
              {hostedApps.map((app) => (
                <HostedAppSection key={app.instance === undefined ? app.appKey : `${app.appKey}~${app.instance}`} app={app} />
              ))}
            </div>
          ) : null}
          {platform.map((entry) => (
            <div key={entry.key} className="mb-1" data-part="nav-platform-group">
              <div className={GROUP_HEADING_CLASS}>{t(GROUP_LABEL_KEY[entry.key], GROUP_LABELS[entry.key])}</div>
              <PlatformLinkList links={entry.links} />
              <AddOnSettingsLinkList addOns={entry.settings} />
              <AddOnLinkList pages={entry.pages} />
            </div>
          ))}
          {declaredGroups.map((group) => (
            <div key={group.key} className="mb-1" data-part="nav-add-on-group">
              <div className={GROUP_HEADING_CLASS}>{t(group.labelKey, group.fallback)}</div>
              <AddOnLinkList pages={addOnPagesFor(group.key)} />
            </div>
          ))}
        </nav>
      </div>
    </>
  );
}
