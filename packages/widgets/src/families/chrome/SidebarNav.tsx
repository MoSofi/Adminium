// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `sidebar-nav` (annex §11) — grouped data-driven nav: group labels, icon links,
 * active state, optional live count badges. The generator builds its payload
 * from the included tables + adminium pages (annex §11 auto-instantiation: "the
 * app shell always mounts `sidebar-nav`"), and tables with unread/pending
 * semantics push counts into `badgeField`.
 *
 * Built fresh in the widgets package rather than lifted from
 * `apps/dashboard/src/shell/SidebarNav.tsx`: that one is bound to the app's
 * `BootstrapData`, its `@tanstack/react-router` `Link`, its `t()` and its
 * `navSections` module — a widget may never import an app (04 §2.1). The annex's
 * contract here is the generic groups/items payload. The app keeps its shell rail.
 *
 * Navigation goes through `onEvent` (04 §2.1): the widget renders anchors so
 * middle-click / "open in new tab" keep working, but a plain left-click is
 * intercepted and handed to the host's router.
 */

import { Badge, EmptyState, cn } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import type { MouseEvent } from 'react';

import { chromeIcon } from './chrome-icons.js';
import { formatCount, isSafeHref, recordRowsOf, numberField, stringField } from './chrome-lib.js';
import { sidebarNavConfigSchema, sidebarNavDemoData } from './chrome-config.js';
import type { SidebarNavConfig } from './chrome-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { sidebarNavConfigSchema, sidebarNavDemoData };
export type { SidebarNavConfig };

export interface NavItem {
  key: string;
  label: string;
  icon?: string | undefined;
  href?: string | undefined;
  badge?: number | undefined;
}

export interface NavGroup {
  key: string;
  label?: string | undefined;
  items: NavItem[];
}

/**
 * Group the flat payload into ordered sections. Config `groups` fixes the order
 * and supplies display labels; groups the payload has but config does not render
 * AFTER the ordered ones in first-seen order — a new table must never silently
 * vanish from the nav just because nobody updated the group list.
 */
export function navGroupsOf(data: unknown, config: SidebarNavConfig): NavGroup[] {
  const rows = recordRowsOf(data);
  const byKey = new Map<string, NavGroup>();
  const seen: string[] = [];

  for (const row of rows) {
    const label = stringField(row, config.labelField);
    if (label === undefined) continue;
    const groupKey = stringField(row, config.groupField) ?? '';
    if (!byKey.has(groupKey)) {
      byKey.set(groupKey, { key: groupKey, items: [] });
      seen.push(groupKey);
    }
    const href = stringField(row, config.hrefField);
    byKey.get(groupKey)?.items.push({
      key: stringField(row, config.keyField) ?? href ?? label,
      label,
      icon: stringField(row, config.iconField),
      ...(isSafeHref(href) ? { href } : {}),
      badge: numberField(row, config.badgeField),
    });
  }

  const ordered = config.groups ?? [];
  const orderedKeys = new Set(ordered.map((g) => g.key));
  const out: NavGroup[] = [];
  for (const g of ordered) {
    const found = byKey.get(g.key);
    if (found !== undefined) out.push({ ...found, label: g.label ?? found.label });
  }
  for (const key of seen) {
    if (!orderedKeys.has(key)) out.push(byKey.get(key) as NavGroup);
  }
  return out;
}

export interface SidebarNavViewProps {
  groups: readonly NavGroup[];
  activeHref?: string | undefined;
  showBadges?: boolean | undefined;
  locale?: string | undefined;
  a11yLabel?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  onNavigate?: ((href: string) => void) | undefined;
  testId?: string | undefined;
}

export function SidebarNavView({
  groups,
  activeHref,
  showBadges = true,
  locale,
  a11yLabel,
  emptyTitle,
  emptyBody,
  onNavigate,
  testId,
}: SidebarNavViewProps) {
  const t = useMaybeT();
  if (groups.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.chrome.sidebarNav.emptyTitle', 'No navigation yet')}
        body={emptyBody ?? t('ui:widgets.chrome.sidebarNav.emptyBody', 'Included tables appear here once a connection is generated.')}
      />
    );
  }

  const click = (event: MouseEvent<HTMLAnchorElement>, href: string | undefined) => {
    // Let the browser own modified clicks (new tab/window) and non-primary
    // buttons; only a plain left-click is the host's to route.
    if (href === undefined || onNavigate === undefined) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(href);
  };

  return (
    <nav
      data-widget="sidebar-nav"
      data-testid={testId}
      aria-label={a11yLabel ?? t('ui:widgets.chrome.sidebarNav.a11yLabel', 'Main')}
      className="h-full overflow-y-auto px-2 pb-4"
    >
      {groups.map((group) => (
        <section key={group.key} data-part="nav-group" data-group={group.key} className="mb-4">
          {group.label !== undefined && group.label !== '' && (
            <h3 className="mb-1 px-2 text-caption font-bold uppercase tracking-wide text-fg-subtle">{group.label}</h3>
          )}
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {group.items.map((item) => {
              const active = item.href !== undefined && item.href === activeHref;
              const count = showBadges ? formatCount(item.badge, locale) : undefined;
              const icon = chromeIcon(item.icon);
              return (
                <li key={item.key}>
                  <a
                    href={item.href ?? '#'}
                    data-part="nav-item"
                    data-active={active ? 'true' : undefined}
                    // `aria-current="page"` is what actually tells a screen
                    // reader which nav item is the current one — the accent
                    // background is only a visual cue.
                    aria-current={active ? 'page' : undefined}
                    onClick={(event) => click(event, item.href)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-body-sm no-underline',
                      active ? 'bg-accent-soft font-bold text-accent' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    {icon !== undefined && (
                      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                        {icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {count !== undefined && (
                      <Badge data-part="nav-badge" tone={active ? 'accent' : 'neutral'} className="shrink-0">
                        {count}
                      </Badge>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export function SidebarNavWidget({ config, data, onEvent }: WidgetProps<SidebarNavConfig>) {
  return (
    <SidebarNavView
      groups={navGroupsOf(data, config)}
      activeHref={config.activeHref}
      showBadges={config.showBadges}
      locale={config.format?.locale}
      a11yLabel={config.a11yLabel}
      emptyTitle={config.emptyTitle}
      emptyBody={config.emptyBody}
      onNavigate={(href) => onEvent({ type: 'drill-through', href })}
      testId={config.testId}
    />
  );
}
