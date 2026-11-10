// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pieces both rails draw: the plain one (`SidebarNav`) and the one
 * grouped by workspace (`workspaces/WorkspaceRail`). Their own module, so the
 * workspace rail, a lazy chunk, can use them without importing the rail that
 * loads it.
 */
import { Link, useMatchRoute, useRouter, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarClock,
  Download,
  ExternalLink,
  FileChartColumn,
  History,
  Mail,
  Package,
  Paperclip,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { unreadCountQuery } from '../api/notifications.js';
import {
  activeHostedItem,
  addOnNavOf,
  addOnPageAddress,
  appSectionsOf,
  holdsSystemAction,
  hostedAppsOf,
  type AddOnNavPage,
  type AppSection as AppSectionData,
  type BootstrapData,
  type HostedApp,
  type NavGroupKey,
  type NavItem,
  type SystemAction,
} from '../app/bootstrap.js';
import { isDashboardPath, isDocumentHref } from '../app/openHref.js';
import { t } from '../i18n/t.js';
import { lucideByName } from '../lib/lucide.js';
import { hasStudioAccess } from '../studio/StudioGuard.js';

export const GROUP_LABELS: Record<NavGroupKey, string> = {
  workspace: 'Pages',
  library: 'Library',
  planning: 'Planning',
  people: 'People',
  account: 'Account',
};

/**
 * Group key → literal bundle key. The five A groups are fixed
 * (`NAV_GROUP_KEYS`), so `satisfies` makes a sixth group a compile error here
 * rather than a raw `nav.group.<new>` heading in the rail.
 */
export const GROUP_LABEL_KEY = {
  workspace: 'nav.group.workspace',
  library: 'nav.group.library',
  planning: 'nav.group.planning',
  people: 'nav.group.people',
  account: 'nav.group.account',
} as const satisfies Record<NavGroupKey, string>;


/**
 * Static platform surfaces (M7 wave 2) — the the Engine does not seed into
 * `adminium_pages` yet (the same gap that makes `/imports`/`/exports` direct
 * routes; see data-io/routes.tsx). They render as a tail under their
 * ia-mapping A group so nav placement matches the spec today and the entries
 * can retire one-for-one as Engine seeding lands. `adminOnly` gates DISCOVERY
 * only (Email templates writes need `system:settings:manage`); the server
 * stays the security boundary.
 */
export interface PlatformNavLink {
  to: string;
  labelKey: string;
  fallback: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /**
   * The `system:` key the surface's own routes require, where holding the
   * Admin role is not enough. Set it when a non-holder who opened the row
   * would see a 403 rather than a narrowed page: an Admin holds `users.manage`
   * but not `roles.manage`, `api-keys.manage` or `automations.manage`, and a
   * custom role can hold any mix. Implies `adminOnly`'s discovery rule too,
   * since the check is on the grant and not the role.
   */
  requires?: SystemAction;
  /**
   * Also offered to a holder of this `system:` key who is not an admin: the
   * surface's writes ride it (Email templates: `settings.manage`, which a
   * marketer's role may hold without being the Admin). Discovery only, as
   * `adminOnly` is; the server checks every request.
   */
  alsoFor?: SystemAction;
  /** Offered unless the server says this person can import nothing (`canImport`); an older server says nothing. */
  imports?: true;
  /** Offered unless the server says this person can export nothing (`canExport`); an older server says nothing. */
  exports?: true;
}

export const PLATFORM_NAV: ReadonlyArray<{ group: NavGroupKey; links: readonly PlatformNavLink[] }> = [
  {
    group: 'library',
    links: [
      { to: '/imports', labelKey: 'nav.imports', fallback: 'Import data', icon: Upload, imports: true },
      { to: '/exports', labelKey: 'nav.exports', fallback: 'Data exports', icon: Download, exports: true },
      /*
       * `/files`. In `library` beside imports and exports because it is the
       * same kind of thing — a workspace-wide view of artifacts, not a page
       * over a customer table.
       *
       * `adminOnly` gates DISCOVERY only, as the comment above says: without
       * `files.manage` the page still works and shows the caller their OWN
       * uploads (the route is mine-only rather than forbidden), so hiding the
       * entry from non-admins costs them nothing they could see anyway while
       * keeping the rail short for the people who use the app rather than
       * administer it.
       */
      { to: '/files', labelKey: 'nav.files', fallback: 'Files', icon: Paperclip, adminOnly: true },
      {
        to: '/email-templates',
        labelKey: 'nav.emailTemplates',
        fallback: 'Email templates',
        icon: Mail,
        adminOnly: true,
        alsoFor: 'settings.manage',
      },
      /*
       * `/report-builder`: the comp's rail row is `{ key: 'reports', label:
       * 'Report builder', icon: 'file-bar-chart-2' }` (comp 123) — in the
       * comp's WORKSPACE group, which in Adminium's rail is the generated
       * pages'. It moves here, beside `/invoices`, the surface it mirrors
       * (Appendix A S1, the departure 34 S1 also took). NOT `/reports`, which
       * is Scheduled Reports in the `account` group below.
       */
      { to: '/report-builder', labelKey: 'nav.reportBuilder', fallback: 'Report builder', icon: FileChartColumn, adminOnly: true },
      /*
       * The comp's two adjacent Library rows (Automation Rules 370, Workflow
       * Logs 176). `adminOnly` gates DISCOVERY; the routes themselves are
       * behind `system:automations:manage` on the server, which is seeded to
       * super-admin only — so unlike `/files`, a non-holder who reached the
       * URL would see the 403 state rather than a narrowed page.
       */
      {
        to: '/automations',
        labelKey: 'nav.automations',
        fallback: 'Automations',
        icon: Workflow,
        requires: 'automations.manage',
      },
      {
        to: '/workflow-logs',
        labelKey: 'nav.workflowLogs',
        fallback: 'Workflow logs',
        icon: History,
        requires: 'automations.manage',
      },
    ],
  },
  {
    // The `people` group was a declared `NavGroupKey` with no links behind it
    // until user management landed — which is exactly what "a complete RBAC
    // engine with no way to reach it" looked like in the rail.
    group: 'people',
    links: [
      { to: '/settings/team', labelKey: 'nav.team', fallback: 'People', icon: UserRound, requires: 'users.manage' },
      { to: '/settings/teams', labelKey: 'nav.teams', fallback: 'Teams', icon: Users, requires: 'users.manage' },
      {
        to: '/settings/roles',
        labelKey: 'nav.roles',
        fallback: 'Roles & permissions',
        icon: ShieldCheck,
        requires: 'roles.manage',
      },
      {
        to: '/audit',
        labelKey: 'nav.audit',
        fallback: 'Audit log',
        icon: ScrollText,
        requires: 'audit.read',
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
export const NAV_LINK_CLASS =
  'group flex items-center gap-[11px] rounded-md px-[11px] py-2 text-[13.5px] font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg data-[status=active]:bg-accent-soft data-[status=active]:font-bold data-[status=active]:text-accent';

export function PlatformLinkList({ links }: { links: readonly PlatformNavLink[] }) {
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

/** The group the settings an app's role keeps of an add-on are linked in: beside imports, exports and files. */
export const SETTINGS_GROUP: NavGroupKey = 'library';

/**
 * One row per add-on whose settings the reader keeps through the per-add-on
 * grant (`addOn:<key>:settings`, an app's role carries it) without managing
 * add-ons: its own settings screen, as the add-ons page would draw them.
 */
export function AddOnSettingsLinkList({ addOns }: { addOns: readonly { key: string; name: string; connectionName?: string | null | undefined }[] }) {
  if (addOns.length === 0) return null;
  // An add-on kept on two databases is two rows of one name: each also says its database.
  const named = new Map<string, number>();
  for (const addOn of addOns) named.set(addOn.name, (named.get(addOn.name) ?? 0) + 1);
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-part="nav-add-on-settings">
      {addOns.map((addOn) => {
        const where = (named.get(addOn.name) ?? 0) > 1 ? (addOn.connectionName ?? null) : null;
        return (
          <li key={addOn.key}>
            {/* The copy's address: `<key>~<slug>` opens a later copy's settings. */}
            <Link to="/add-on-settings/$key" params={{ key: addOn.key }} className={NAV_LINK_CLASS}>
              <SlidersHorizontal className="size-[18px] shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t('nav.addOnSettings', '{name} settings', { name: addOn.name })}</span>
              {/* A space for the name read aloud; a flex row draws none. */}
              {where === null ? null : ' '}
              {where === null ? null : (
                <span data-part="nav-add-on-settings-database" className="max-w-[45%] shrink-0 truncate text-[12px] font-semibold text-fg-subtle">
                  {where}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * An add-on's rail rows (51b).
 *
 * `/add-ons/$key/$` rather than a route per page: the set of pages is whatever
 * is installed, which a code-based route tree cannot know at build time. The
 * splat also carries a page's own sub-paths, so an editor at
 * `/add-ons/invoices/documents/42` is the page's business and not the router's.
 *
 * Icons resolve through `lucideByName` exactly as a generated page's do, so an
 * add-on naming an icon that does not exist gets the neutral glyph rather than
 * a crash.
 */
export function AddOnLinkList({ pages }: { pages: readonly AddOnNavPage[] }) {
  if (pages.length === 0) return null;
  // A page of an add-on kept on two databases is a row per copy: each of those also says its database.
  const copies = new Map<string, number>();
  for (const page of pages) copies.set(`${page.addOnKey}/${page.ref}`, (copies.get(`${page.addOnKey}/${page.ref}`) ?? 0) + 1);
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-part="nav-add-on-pages">
      {pages.map((page) => {
        const Icon = lucideByName(page.icon);
        const address = addOnPageAddress(page);
        const where = (copies.get(`${page.addOnKey}/${page.ref}`) ?? 0) > 1 ? (page.connectionName ?? address) : null;
        return (
          <li key={`${address}/${page.ref}`}>
            <Link
              to="/add-ons/$key/$"
              params={{ key: address, _splat: page.ref }}
              className={NAV_LINK_CLASS}
            >
              <Icon className="size-[18px] shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{t(page.labelKey, page.fallback)}</span>
              {/* A space for the name read aloud; a flex row draws none. */}
              {where === null ? null : ' '}
              {where === null ? null : (
                <span data-part="nav-add-on-page-database" className="max-w-[45%] shrink-0 truncate text-[12px] font-semibold text-fg-subtle">
                  {where}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The `badge: 'unread-count'` live number: fed by `/me/notifications`'
 * `unreadCount` under the `['notifications']` query prefix, so WS
 * `notifications:<userId>` events (api/realtime.ts) keep it honest across
 * tabs; zero renders nothing. `pending-count` has no producer yet and is
 * deliberately not faked here.
 */
export function UnreadCountBadge() {
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

/**
 * An entry of an app's section that is not a page (`navLinks`). Its address
 * is the server's: a dashboard screen narrowed to the app, followed in place
 * and marked while it is the address shown, or the app's staff side, opened
 * as a document like "Open the staff screens".
 */
export function NavLinkRow({ item, link }: { item: NavItem; link: NonNullable<NavItem['link']> }) {
  const router = useRouter();
  const here = useRouterState({ select: (state) => state.location.href });
  const Icon = lucideByName(item.icon);
  const label = <span className="min-w-0 flex-1 truncate">{item.fallback}</span>;
  if (link.document || !isDashboardPath(link.href)) {
    return (
      <a href={isDocumentHref(link.href) ? link.href : undefined} target="_blank" rel="noreferrer" className={NAV_LINK_CLASS} data-part="nav-app-link">
        <Icon className="size-[18px] shrink-0" aria-hidden="true" />
        {label}
        <ExternalLink className="size-3.5 shrink-0 opacity-70 rtl:-scale-x-100" aria-hidden="true" />
      </a>
    );
  }
  return (
    <a
      href={link.href}
      className={NAV_LINK_CLASS}
      data-part="nav-app-link"
      data-status={here === link.href ? 'active' : undefined}
      aria-current={here === link.href ? 'page' : undefined}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        router.history.push(link.href);
      }}
    >
      <Icon className="size-[18px] shrink-0" aria-hidden="true" />
      {label}
    </a>
  );
}

export function NavItemList({ items }: { items: readonly NavItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((item) => {
        const Icon = lucideByName(item.icon);
        return (
          <li key={item.pageId}>
            {item.link !== undefined ? (
              <NavLinkRow item={item} link={item.link} />
            ) : item.addOnPage === undefined ? (
              <Link to="/p/$slug" params={{ slug: item.slug }} className={NAV_LINK_CLASS}>
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{t(item.labelKey, item.fallback)}</span>
                {item.badge === 'unread-count' ? <UnreadCountBadge /> : null}
              </Link>
            ) : (
              // A page that is an add-on's own code, in its add-on's section.
              <Link to="/add-ons/$key/$" params={{ key: item.addOnPage.key, _splat: item.addOnPage.ref }} className={NAV_LINK_CLASS}>
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{t(item.labelKey, item.fallback)}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One blended app's section.
 *
 * Same visual grammar as the five fixed groups — uppercase header, the same
 * row class — and deliberately NOT a sixth group. `NAV_GROUP_KEYS` is a closed
 * set with a `satisfies` that makes a sixth a compile error, and it should stay
 * closed: the five are the product's information architecture, while these are
 * whatever the operator happens to have installed.
 *
 * Active state is computed here rather than left to `Link`'s own matching, and
 * the reason is that neither of its modes is right. Exact matching would drop
 * the highlight the moment the app navigated to a screen it does not list (a
 * detail view); prefix matching would light up EVERY row, because an item whose
 * path is `''` — a surface whose only screen is its root — is a prefix of
 * everything. `activeHostedItem` is the app's own longest-match rule, shared with
 * the frame, so the highlight and the rendered screen cannot disagree.
 */
/**
 * The `$appKey` route param for a hosted section: the app key, or
 * `<appKey>~<instance>` for an extra tenant.
 *
 * ONE param rather than a second route segment, deliberately. A segment
 * (`/a/clients/berlin/…`) would sit exactly where the app's own paths live, so
 * `/a/clients/invoices` would mean two things; `~` cannot appear in an app key
 * or a slug, both of which are `[a-z0-9-]`, so this split is unambiguous.
 */
export function appKeyParam(app: Pick<HostedApp, 'appKey' | 'instance'>): string {
  return app.instance === undefined ? app.appKey : `${app.appKey}~${app.instance}`;
}

/** `<appKey>~<instance>` → its parts. The instance is null on the app's own section. */
export function splitAppKeyParam(param: string): { appKey: string; instance: string | null } {
  const at = param.indexOf('~');
  if (at === -1) return { appKey: param, instance: null };
  return { appKey: param.slice(0, at), instance: param.slice(at + 1) };
}

export function HostedAppSection({ app }: { app: HostedApp }) {
  return (
    <div className="mb-1" data-part="nav-hosted-app">
      <div className="px-2 pb-1 pt-3 text-micro uppercase tracking-[0.06em] text-fg-subtle">
        {app.label}
      </div>
      <HostedAppRows app={app} />
    </div>
  );
}

export function HostedAppRows({ app, inert = false }: { app: HostedApp; inert?: boolean }) {
  const matchRoute = useMatchRoute();
  const match = matchRoute({ to: '/a/$appKey/$', fuzzy: true });
  const here =
    match !== false && match.appKey === app.appKey
      ? (match._splat ?? '').replace(/^\/+|\/+$/g, '')
      : null;
  const active = here === null ? null : activeHostedItem(app, here);

  return (
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {app.items.map((item) => {
          const Icon = lucideByName(item.icon ?? 'file');
          return (
            <li key={item.id}>
              <Link
                to="/a/$appKey/$"
                params={{ appKey: appKeyParam(app), _splat: item.path }}
                className={NAV_LINK_CLASS}
                // The row's own `data-status`, not the router's — see above. A
                // second copy of the section (its database is in two workspaces)
                // marks nothing: one row is where the reader is.
                data-status={!inert && active?.id === item.id ? 'active' : undefined}
              >
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
  );
}

/**
 * An installed app's own section (`Installed Apps.dc.html`, the sidebar
 * view): its name and version, its pages under the groups its manifest names,
 * and its staff screens — the hosted rows when they live in the dashboard, a
 * link out when they open on their own address.
 */
export function AppSection({ section }: { section: AppSectionData }) {
  const staff = section.staff;
  // A page its app keeps off the sidebar is listed with the section and drawn by nothing here; a group left empty has no heading.
  const groups = section.groups.map((group) => ({ ...group, items: group.items.filter((item) => item.offRail !== true) })).filter((group) => group.items.length > 0);
  if (groups.length === 0 && staff === null) return null;
  return (
    <div className="mt-3.5 border-t border-border pt-3" data-part="nav-app-section">
      <div className="flex items-center gap-2.5 px-[9px] pb-2 pt-1">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-accent text-accent-fg">
          <Package className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-extrabold leading-[normal] tracking-[-0.01em] text-fg">
          {section.label}
        </span>
        <span className="font-mono text-[9.5px] font-bold leading-[normal] text-fg-subtle">{section.version}</span>
      </div>
      {groups.map((group) => (
        <div key={group.key} className="mb-1">
          {group.label === null ? null : (
            <div className="px-2.5 pb-1 pt-[11px] text-[10px] font-extrabold uppercase tracking-[0.08em] text-fg-subtle">
              {group.label}
            </div>
          )}
          <NavItemList items={group.items} />
        </div>
      ))}
      {staff?.placement === 'internal' ? (
        <HostedAppRows app={{ appKey: section.appKey, label: section.label, items: staff.items }} />
      ) : null}
      {staff?.placement === 'external' ? (
        <a href={staff.url} target="_blank" rel="noreferrer" className={NAV_LINK_CLASS} data-part="nav-app-open">
          <Package className="size-[18px] shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t('nav.app.openStaff', 'Open the staff screens')}</span>
          <ExternalLink className="size-3.5 shrink-0 opacity-70 rtl:-scale-x-100" aria-hidden="true" />
        </a>
      ) : null}
      {/* An extra instance opens on its own address too, named by its slug. */}
      {staff?.placement === 'external'
        ? (staff.instances ?? []).map((instance) => (
            <a
              key={instance.slug}
              href={instance.url}
              target="_blank"
              rel="noreferrer"
              className={NAV_LINK_CLASS}
              data-part="nav-app-open-instance"
            >
              <Package className="size-[18px] shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {t('nav.app.openStaffInstance', 'Open the staff screens · {instance}', { instance: instance.slug })}
              </span>
              <ExternalLink className="size-3.5 shrink-0 opacity-70 rtl:-scale-x-100" aria-hidden="true" />
            </a>
          ))
        : null}
    </div>
  );
}

/**
 * What both rails offer besides the generated pages: the platform rows each
 * group carries, the add-on rows, the add-on settings rows, the groups an
 * add-on brought, and the installed apps' sections. One reading, so the rail
 * grouped by workspace offers exactly what the plain one does.
 */
export function useRailRows(bootstrap: BootstrapData) {
  const admin = hasStudioAccess(bootstrap.roles);
  const platformLinksFor = (group: NavGroupKey): readonly PlatformNavLink[] =>
    (PLATFORM_NAV.find((entry) => entry.group === group)?.links ?? []).filter((link) =>
      link.requires !== undefined
        ? holdsSystemAction(bootstrap, link.requires)
        : (admin || link.adminOnly !== true || (link.alsoFor !== undefined && holdsSystemAction(bootstrap, link.alsoFor))) && !(link.imports && bootstrap.canImport === false) && !(link.exports && bootstrap.canExport === false),
    );
  /*
   * Add-on rows (51b). Filtered by the SAME rule the platform tail uses, so a
   * page an add-on marked `adminOnly` is invisible to a non-admin rather than
   * being a row that 403s when clicked.
   */
  const addOnNav = addOnNavOf(bootstrap);
  // The add-ons whose settings this reader keeps by grant, without managing add-ons: one row each, in Library.
  const addOnSettings = bootstrap.addOnSettings ?? [];
  // A page drawn in its add-on's own section, or with no place in the rail at all, is no row of the shared groups.
  const visibleAddOnPages = addOnNav.pages.filter((page) => (admin || !page.adminOnly) && page.inSection !== true && page.unlisted !== true);
  const addOnPagesFor = (group: string): readonly AddOnNavPage[] =>
    visibleAddOnPages.filter((page) => page.group === group);

  /*
   * The trailing band of groups an add-on brought: built-in groups keep their
   * order, and an add-on cannot push one of them down the rail. A group whose
   * every row is `adminOnly` renders NOTHING for a viewer who is not an admin —
   * the empty heading is the one thing the rail must not draw, and this is the
   * layer that can see it, because it is the layer that filtered the rows.
   */
  const declaredGroups = addOnNav.groups.filter(
    (group) => addOnPagesFor(group.key).length > 0,
  );
  const appSections = appSectionsOf(bootstrap);
  /*
   * An installed app's own section carries its staff screens too, so its
   * hosted section is not drawn a second time; an extra instance's still is.
   */
  const hostedApps = hostedAppsOf(bootstrap).filter(
    (app) => app.instance !== undefined || !appSections.some((section) => section.appKey === app.appKey),
  );
  return { platformLinksFor, addOnPagesFor, addOnSettings, declaredGroups, appSections, hostedApps };
}
