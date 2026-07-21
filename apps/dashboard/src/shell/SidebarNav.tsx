/**
 * Sidebar (09-generated-app.md §5.1): 256px rail — logo block + app-version
 * chip, the five fixed nav groups from the bootstrap NavTree (uppercase group
 * labels, accent-soft active state), and the persona UserCard footer with
 * sign-out. Live unread badges: `badge: 'unread-count'` items render the
 * `/me/notifications` unread number (M7 T6), invalidated by the WS
 * `notifications:<userId>` channel.
 *
 * Multi-connection nav labels (M5-T05): once 2+ connections exist, each
 * group's items are sub-labeled by the owning connection's display name so
 * same-named tables from different sources stay unambiguous; with a single
 * connection the rail renders flat (no redundant label).
 */
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarClock,
  Database,
  Download,
  Hexagon,
  LogOut,
  Mail,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, Badge, IconButton, cn } from '@adminium/ui';

import { unreadCountQuery } from '../api/notifications.js';
import type { BootstrapData, NavGroupKey, NavItem } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { lucideByName } from '../lib/lucide.js';
import { hasStudioAccess } from '../studio/StudioGuard.js';
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

/**
 * Static platform surfaces (M7 wave 2) — the §2.2 "universal utility pages"
 * the Engine does not seed into `adminium_pages` yet (the same gap that makes
 * `/imports`/`/exports` direct routes; see data-io/routes.tsx). They render as
 * a tail under their ia-mapping §2A group so nav placement matches the spec
 * today and the entries can retire one-for-one as Engine seeding lands.
 * `adminOnly` gates DISCOVERY only (Email templates writes need
 * `system:settings:manage`); the server stays the security boundary.
 */
interface PlatformNavLink {
  to: string;
  labelKey: string;
  fallback: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const PLATFORM_NAV: ReadonlyArray<{ group: NavGroupKey; links: readonly PlatformNavLink[] }> = [
  {
    group: 'library',
    links: [
      { to: '/imports', labelKey: 'nav.imports', fallback: 'Import data', icon: Upload },
      { to: '/exports', labelKey: 'nav.exports', fallback: 'Data exports', icon: Download },
      {
        to: '/email-templates',
        labelKey: 'nav.emailTemplates',
        fallback: 'Email templates',
        icon: Mail,
        adminOnly: true,
      },
    ],
  },
  {
    group: 'account',
    links: [
      {
        to: '/account/notifications',
        labelKey: 'nav.notificationSettings',
        fallback: 'Notification settings',
        icon: Bell,
      },
      {
        to: '/reports',
        labelKey: 'nav.scheduledReports',
        fallback: 'Scheduled reports',
        icon: CalendarClock,
      },
    ],
  },
];

function PlatformLinkList({ links }: { links: readonly PlatformNavLink[] }) {
  if (links.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {links.map((link) => (
        <li key={link.to}>
          <Link
            to={link.to}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg data-[status=active]:bg-accent-soft data-[status=active]:text-accent"
          >
            <link.icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t(link.labelKey, link.fallback)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The `badge: 'unread-count'` live number (09 §5.4): fed by
 * `/me/notifications`' `unreadCount` under the `['notifications']` query
 * prefix, so WS `notifications:<userId>` events (api/realtime.ts) keep it
 * honest across tabs; zero renders nothing. `pending-count` has no producer
 * yet and is deliberately not faked here.
 */
function UnreadCountBadge() {
  const count = useQuery(unreadCountQuery());
  if (count.data === undefined || count.data === 0) return null;
  return (
    <span
      data-part="nav-unread-badge"
      className="ms-auto rounded-full bg-accent px-1.5 font-mono text-[10px] font-bold leading-[16px] text-accent-fg tabular-nums"
    >
      {count.data > 99 ? '99+' : count.data}
    </span>
  );
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
              {item.badge === 'unread-count' ? <UnreadCountBadge /> : null}
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
  const admin = hasStudioAccess(bootstrap.roles);
  const platformLinksFor = (group: NavGroupKey): readonly PlatformNavLink[] =>
    (PLATFORM_NAV.find((entry) => entry.group === group)?.links ?? []).filter(
      (link) => admin || link.adminOnly !== true,
    );
  // §2A groups with only platform links (no generated pages yet) still render.
  const navGroupKeys = new Set(nav.groups.map((group) => group.key));
  const platformOnlyGroups = PLATFORM_NAV.filter((entry) => !navGroupKeys.has(entry.group));

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
        <span className="flex size-[30px] items-center justify-center rounded-[9px] bg-accent text-accent-fg">
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
          <>
            {nav.groups.map((group) => (
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
                <PlatformLinkList links={platformLinksFor(group.key)} />
              </div>
            ))}
            {platformOnlyGroups.map((entry) => {
              const links = platformLinksFor(entry.group);
              if (links.length === 0) return null;
              return (
                <div key={entry.group} className="mb-3" data-part="nav-platform-group">
                  <div className="px-2 pb-1 pt-2 text-micro uppercase text-fg-subtle">
                    {t(`nav.group.${entry.group}`, GROUP_LABELS[entry.group])}
                  </div>
                  <PlatformLinkList links={links} />
                </div>
              );
            })}
          </>
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
