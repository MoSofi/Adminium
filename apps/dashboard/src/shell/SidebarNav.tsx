// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sidebar (09-generated-app.md §5.1): 256px rail — logo block + app-version
 * chip and the five fixed nav groups from the bootstrap NavTree (uppercase
 * group labels, accent-soft active state). Live unread badges:
 * `badge: 'unread-count'` items render the `/me/notifications` unread number
 * (M7 T6), invalidated by the WS `notifications:<userId>` channel.
 *
 * The rail is `sticky top-0 h-dvh` and only the middle `<nav>` scrolls. The
 * height is load-bearing: the shell parent is `min-h-dvh`, so without it the
 * aside stretches to *document* height, the inner `overflow-y-auto` never
 * engages, and the logo scrolls off the top of a long page.
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
  Mail,
  ScrollText,
  ShieldCheck,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@adminium/ui';

import { unreadCountQuery } from '../api/notifications.js';
import { BrandMark, useBranding } from './BrandMark.js';
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

/**
 * Group key → literal bundle key (10-i18n-theming.md §2.5). The five §2A groups
 * are fixed (`NAV_GROUP_KEYS`), so `satisfies` makes a sixth group a compile
 * error here rather than a raw `nav.group.<new>` heading in the rail.
 */
const GROUP_LABEL_KEY = {
  workspace: 'nav.group.workspace',
  library: 'nav.group.library',
  planning: 'nav.group.planning',
  people: 'nav.group.people',
  account: 'nav.group.account',
} as const satisfies Record<NavGroupKey, string>;

export interface SidebarNavProps {
  bootstrap: BootstrapData;
  /**
   * Accepted but unused: the persona badge and its sign-out affordance live in
   * the topbar account menu now (`Topbar.tsx`, `topbar.signOut`). Kept so the
   * existing `AppShell` call site still typechecks until the prop is dropped
   * there too.
   */
  onSignOut?: (() => void) | undefined;
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
    // The `people` group was a declared `NavGroupKey` with no links behind it
    // until user management landed — which is exactly what "a complete RBAC
    // engine with no way to reach it" looked like in the rail.
    group: 'people',
    links: [
      { to: '/settings/team', labelKey: 'nav.team', fallback: 'Team', icon: Users, adminOnly: true },
      {
        to: '/settings/roles',
        labelKey: 'nav.roles',
        fallback: 'Roles & permissions',
        icon: ShieldCheck,
        adminOnly: true,
      },
      {
        to: '/audit',
        labelKey: 'nav.audit',
        fallback: 'Audit log',
        icon: ScrollText,
        adminOnly: true,
      },
    ],
  },
  {
    group: 'account',
    links: [
      {
        to: '/account/security',
        labelKey: 'nav.security',
        fallback: 'Password & sessions',
        icon: ShieldCheck,
      },
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

/**
 * One row shared by the generated-page list and the platform-link tail — they
 * sit in the same rail and drifted apart by a pixel each time one was touched.
 * `group` is here for the unread badge, which recolours on the active row.
 *
 * The comp draws no hover state at all (it is a static mock); `--surface-2` is
 * kept because a nav with no hover feedback reads as inert.
 */
const NAV_LINK_CLASS =
  'group flex items-center gap-[11px] rounded-md px-[11px] py-2 text-[13.5px] font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg data-[status=active]:bg-accent-soft data-[status=active]:font-bold data-[status=active]:text-accent';

function PlatformLinkList({ links }: { links: readonly PlatformNavLink[] }) {
  if (links.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {links.map((link) => (
        <li key={link.to}>
          <Link to={link.to} className={NAV_LINK_CLASS}>
            <link.icon className="size-[18px] shrink-0" aria-hidden="true" />
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
      className="ms-auto rounded-full bg-surface-3 px-[7px] py-px text-[10.5px] font-bold text-fg-subtle tabular-nums group-data-[status=active]:bg-accent group-data-[status=active]:text-accent-fg"
    >
      {count.data > 99 ? '99+' : count.data}
    </span>
  );
}

function NavItemList({ items }: { items: readonly NavItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((item) => {
        const Icon = lucideByName(item.icon);
        return (
          <li key={item.pageId}>
            <Link to="/p/$slug" params={{ slug: item.slug }} className={NAV_LINK_CLASS}>
              <Icon className="size-[18px] shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t(item.labelKey, item.fallback)}</span>
              {item.badge === 'unread-count' ? <UnreadCountBadge /> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({ bootstrap, className }: SidebarNavProps) {
  const { nav, version } = bootstrap;
  const { showVersion } = useBranding();
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
        'sticky top-0 flex h-dvh w-sidebar shrink-0 flex-col border-e border-border bg-surface',
        className,
      )}
    >
      {/*
        The aside stays unpadded so the nav's scrollbar rides flush against the
        border; every child carries the design's *effective* inset instead
        (rail 14px + child 8px = 22px, top 18px + 8px = 26px).
      */}
      <div className="flex items-center gap-2.5 px-[22px] pb-3.5 pt-[26px]">
        <BrandMark glow className="min-w-0" />
        {/* The version chip is opt-out (`branding.showVersion`): knowing which
            build you are on is a support handshake, but a white-labelled
            deployment is entitled not to advertise what it is built on. */}
        {showVersion ? (
          <span
            data-part="sidebar-version"
            className="ms-auto shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-bold text-fg-subtle"
          >
            v{version}
          </span>
        ) : null}
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
              <div key={group.key} className="mb-1">
                <div className="px-2 pb-1 pt-3 text-micro uppercase tracking-[0.06em] text-fg-subtle">
                  {t(GROUP_LABEL_KEY[group.key], GROUP_LABELS[group.key])}
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
                <div key={entry.group} className="mb-1" data-part="nav-platform-group">
                  <div className="px-2 pb-1 pt-3 text-micro uppercase tracking-[0.06em] text-fg-subtle">
                    {t(GROUP_LABEL_KEY[entry.group], GROUP_LABELS[entry.group])}
                  </div>
                  <PlatformLinkList links={links} />
                </div>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
