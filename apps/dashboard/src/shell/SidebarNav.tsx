// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sidebar: 256px rail — logo block + app-version chip and the five fixed nav
 * groups from the bootstrap NavTree (uppercase group labels, accent-soft
 * active state). Live unread badges: `badge: 'unread-count'` items render
 * the `/me/notifications` unread number (M7 T6), invalidated by the WS
 * `notifications:<userId>` channel.
 *
 * The rail is `sticky top-0 h-dvh` and only the middle `<nav>` scrolls. The
 * height is load-bearing: the shell parent is `min-h-dvh`, so without it the
 * aside stretches to *document* height, the inner `overflow-y-auto` never
 * engages, and the logo scrolls off the top of a long page.
 *
 * Multi-connection nav labels: once 2+ connections exist, each group's
 * items are sub-labeled by the owning connection's display name so
 * same-named tables from different sources stay unambiguous; with a single
 * connection the rail renders flat (no redundant label).
 */
import { Fragment, Suspense, lazy } from 'react';
import { Database } from 'lucide-react';
import { cn } from '@adminium/ui';

import { BrandMark, useBranding } from './BrandMark.js';
import { NAV_GROUP_KEYS, type BootstrapData } from '../app/bootstrap.js';
import { t } from '../i18n/t.js';
import { distinctConnectionCount, sectionNavItems } from './navSections.js';
import {
  AddOnLinkList,
  AddOnSettingsLinkList,
  AppSection,
  GROUP_LABEL_KEY,
  GROUP_LABELS,
  HostedAppSection,
  NavItemList,
  PLATFORM_NAV,
  PlatformLinkList,
  SETTINGS_GROUP,
  appKeyParam,
  useRailRows,
} from './railParts.js';
import { workspacesShown } from './workspaces/shown.js';

// Read from here by the app frame; they live with the rail's other pieces.
export { appKeyParam, splitAppKeyParam } from './railParts.js';

/*
 * The menu grouped by workspace: its own chunk. A server with no workspace (or
 * a person who sees one group) never loads it, and draws the rail it always
 * drew; one that has them asks for it with the bootstrap.
 */
const WorkspaceRail = lazy(async () => ({ default: (await import('./workspaces/WorkspaceRail.js')).WorkspaceRail }));

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
  /** What the topbar's menu button names in `aria-controls`. */
  id?: string | undefined;
}

export function SidebarNav({ bootstrap, className, id }: SidebarNavProps) {
  const { version } = bootstrap;
  const { showVersion } = useBranding();
  const grouped = workspacesShown(bootstrap);

  return (
    <aside
      id={id}
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

      {grouped ? (
        <Suspense fallback={<div className="min-h-0 flex-1" />}>
          <WorkspaceRail bootstrap={bootstrap} />
        </Suspense>
      ) : (
        <PlainNav bootstrap={bootstrap} />
      )}
    </aside>
  );
}

/** The rail with no workspaces (or one group for this person): the one it always was. */
function PlainNav({ bootstrap }: { bootstrap: BootstrapData }) {
  const { nav } = bootstrap;
  // 2+ sources → sub-label items per connection; else stay flat.
  const multiConnection = distinctConnectionCount(nav) >= 2;
  const { platformLinksFor, addOnPagesFor, addOnSettings, declaredGroups, appSections, hostedApps } = useRailRows(bootstrap);

  // Groups with only platform links or only add-on rows (no generated pages
  // yet) still render — a built-in group is drawn when ANYTHING lands in it.
  const navGroupKeys = new Set(nav.groups.map((group) => group.key));
  const platformOnlyGroups = PLATFORM_NAV.filter((entry) => !navGroupKeys.has(entry.group));
  const platformOnlyKeys = new Set(platformOnlyGroups.map((entry) => entry.group));
  /*
   * A built-in group an add-on landed in that neither of the two lists above
   * would have drawn: no generated pages, and no platform links either
   * (`planning` and `people` are empty on a stock instance). Without this the
   * page installs, the rail has no heading to hang it under, and the row
   * silently does not exist.
   */
  const addOnOnlyBuiltinGroups = NAV_GROUP_KEYS.filter(
    (key) =>
      !navGroupKeys.has(key) && !platformOnlyKeys.has(key) && addOnPagesFor(key).length > 0,
  );

  /*
   * Blended apps sit AFTER `workspace` (D7): they are the operator's daily
   * work, so burying them under Library/Planning/People/Account would put the
   * thing this wave exists to surface at the bottom of the rail.
   *
   * When there is no `workspace` group at all — a fresh instance with no
   * connection — they render first instead of vanishing, which is the case
   * that matters most: an operator whose ONLY installed thing is an app.
   */
  const hostedSections =
    hostedApps.length === 0 && appSections.length === 0 ? null : (
      <>
        {/* Keyed by the route param: an app and its instances share `appKey`. */}
        {hostedApps.map((app) => (
          <HostedAppSection key={appKeyParam(app)} app={app} />
        ))}
        {appSections.map((section) => (
          <AppSection key={section.appKey} section={section} />
        ))}
      </>
    );
  const hostedAfter = nav.groups.some((group) => group.key === 'workspace') ? 'workspace' : null;

  return (
      <nav aria-label={t('nav.primary', 'Primary')} className="nb-scroll min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {/*
          * The platform tail is NOT conditional on having generated pages.
          * This used to be an either/or: with no `nav.groups` the rail rendered
          * the prompt below (or the hosted apps) and returned, which skipped
          * `platformOnlyGroups` entirely — so a fresh instance hid Team, Roles,
          * API keys, the audit log, Files, Email templates, imports, exports
          * and scheduled reports behind a database connection none of them need.
          * The first thing an admin does is invite people, and Team was
          * unreachable until they had connected a source first.
          *
          * So the three blocks below always run and each contributes what it
          * has. The prompt is now only what it says it is — an explanation for
          * the missing PAGES — and shows when there is genuinely nothing
          * generated and no app either.
          */}
        {hostedAfter === null ? hostedSections : null}
        {nav.groups.length === 0 && hostedApps.length === 0 && appSections.length === 0 ? (
          <p className="px-2 py-3 text-body-sm text-fg-subtle" data-part="nav-empty">
            {/* Two different emptinesses. With pages that exist but are not
                shared with this role, "connect a database" is false — and it
                sends the reader looking for a setup step that is not theirs. */}
            {bootstrap.partsOff === true
              ? t('nav.emptyPartsOff', 'Nothing is switched on for you right now. Ask an administrator.')
              : bootstrap.pagesWithheld === true
              ? t(
                  'nav.emptyWithheld',
                  'No pages have been shared with your role yet. Ask an administrator for access.',
                )
              : bootstrap.hasConnections === true
                ? t('nav.emptyConnected', 'Pages appear here once they are made from the connected database.')
                : t('nav.empty', 'Pages appear here once a database is connected.')}
          </p>
        ) : null}
        {nav.groups.map((group) => (
              <Fragment key={group.key}>
              <div className="mb-1">
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
                {group.key === SETTINGS_GROUP && <AddOnSettingsLinkList addOns={addOnSettings} />}
                <AddOnLinkList pages={addOnPagesFor(group.key)} />
              </div>
              {hostedAfter === group.key ? hostedSections : null}
              </Fragment>
        ))}
        {platformOnlyGroups.map((entry) => {
          const links = platformLinksFor(entry.group);
          const pages = addOnPagesFor(entry.group);
          const settings = entry.group === SETTINGS_GROUP ? addOnSettings : [];
          if (links.length === 0 && pages.length === 0 && settings.length === 0) return null;
          return (
            <div key={entry.group} className="mb-1" data-part="nav-platform-group">
              <div className="px-2 pb-1 pt-3 text-micro uppercase tracking-[0.06em] text-fg-subtle">
                {t(GROUP_LABEL_KEY[entry.group], GROUP_LABELS[entry.group])}
              </div>
              <PlatformLinkList links={links} />
              <AddOnSettingsLinkList addOns={settings} />
              <AddOnLinkList pages={pages} />
            </div>
          );
        })}
        {addOnOnlyBuiltinGroups.map((key) => (
          <div key={key} className="mb-1" data-part="nav-platform-group">
            <div className="px-2 pb-1 pt-3 text-micro uppercase tracking-[0.06em] text-fg-subtle">
              {t(GROUP_LABEL_KEY[key], GROUP_LABELS[key])}
            </div>
            <AddOnLinkList pages={addOnPagesFor(key)} />
          </div>
        ))}
        {declaredGroups.map((group) => (
          <div key={group.key} className="mb-1" data-part="nav-add-on-group">
            <div className="px-2 pb-1 pt-3 text-micro uppercase tracking-[0.06em] text-fg-subtle">
              {t(group.labelKey, group.fallback)}
            </div>
            <AddOnLinkList pages={addOnPagesFor(group.key)} />
          </div>
        ))}
      </nav>
  );
}
