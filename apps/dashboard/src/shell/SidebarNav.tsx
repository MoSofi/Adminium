/**
 * Sidebar (09-generated-app.md §5.1): 256px rail — logo block + app-version
 * chip, the five fixed nav groups from the bootstrap NavTree (uppercase group
 * labels, accent-soft active state), and the persona UserCard footer with
 * sign-out. Live unread badges (WS) land with the notification center (M7).
 *
 * Multi-connection nav labels (M5-T05): once 2+ connections exist, each
 * group's items are sub-labeled by the owning connection's display name so
 * same-named tables from different sources stay unambiguous; with a single
 * connection the rail renders flat (no redundant label).
 */
import { Link } from '@tanstack/react-router';
import { Database, Hexagon, LogOut } from 'lucide-react';
import { Avatar, Badge, IconButton, cn } from '@adminium/ui';

import type { BootstrapData, NavGroupKey, NavItem } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { lucideByName } from '../lib/lucide.js';
import { distinctConnectionCount, sectionNavItems } from './navSections.js';

const GROUP_LABELS: Record<NavGroupKey, string> = {
  workspace: 'Workspace',
  library: 'Library',
  planning: 'Planning',
  people: 'People',
  account: 'Account',
};

export interface SidebarNavProps {
  bootstrap: BootstrapData;
  onSignOut: () => void;
  className?: string | undefined;
}

function NavItemList({ items }: { items: readonly NavItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {items.map((item) => {
        const Icon = lucideByName(item.icon);
        return (
          <li key={item.pageId}>
            <Link
              to="/p/$slug"
              params={{ slug: item.slug }}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg data-[status=active]:bg-accent-soft data-[status=active]:text-accent"
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t(item.labelKey, item.fallback)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({ bootstrap, onSignOut, className }: SidebarNavProps) {
  const { nav, user, version } = bootstrap;
  // 2+ sources → sub-label items per connection (M5-T05); else stay flat.
  const multiConnection = distinctConnectionCount(nav) >= 2;

  return (
    <aside
      data-part="sidebar"
      className={cn(
        'flex w-sidebar shrink-0 flex-col border-e border-border bg-surface',
        className,
      )}
    >
      {/* Logo block + version chip */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="flex size-[30px] items-center justify-center rounded-[9px] bg-accent text-white">
          <Hexagon className="size-[17px]" aria-hidden="true" />
        </span>
        <span className="text-[15px] font-extrabold tracking-[-0.02em] text-fg">Adminium</span>
        <Badge tone="neutral" className="ms-auto font-mono">
          v{version}
        </Badge>
      </div>

      {/* Nav groups */}
      <nav aria-label={t('nav.primary', 'Primary')} className="nb-scroll min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {nav.groups.length === 0 ? (
          <p className="px-2 py-3 text-body-sm text-fg-subtle">
            {t('nav.empty', 'Pages appear here once a database is connected.')}
          </p>
        ) : (
          nav.groups.map((group) => (
            <div key={group.key} className="mb-3">
              <div className="px-2 pb-1 pt-2 text-micro uppercase text-fg-subtle">
                {t(`nav.group.${group.key}`, GROUP_LABELS[group.key])}
              </div>
              {multiConnection ? (
                sectionNavItems(group.items).map((section) => (
                  <div key={section.connectionId ?? 'shared'} className="mb-1.5">
                    <div
                      data-part="nav-connection-label"
                      className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-1 text-micro font-bold text-fg-subtle"
                    >
                      <Database className="size-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">
                        {section.connectionId === null
                          ? t('nav.connection.shared', 'Shared')
                          : (section.connectionName ??
                            t('nav.connection.unnamed', 'Connection'))}
                      </span>
                    </div>
                    <NavItemList items={section.items} />
                  </div>
                ))
              ) : (
                <NavItemList items={group.items} />
              )}
            </div>
          ))
        )}
      </nav>

      {/* Persona footer */}
      <div data-part="sidebar-user-card" className="flex items-center gap-2.5 border-t border-border px-3.5 py-3">
        <Avatar name={user.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-fg">{user.name}</div>
          <div className="truncate text-caption text-fg-subtle">{user.email}</div>
        </div>
        <IconButton label={t('nav.signOut', 'Sign out')} onClick={onSignOut}>
          <LogOut className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        </IconButton>
      </div>
    </aside>
  );
}
