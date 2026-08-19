// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `tab-bar` (annex §11) — icon+label underline or pill tabs driving panel
 * visibility; supports count pills in labels and cross-page link tabs. Evidence:
 * Workspace Settings, CRUD Admin (tab count pills), Ticket Queue.
 *
 * Wraps @adminium/ui's `Tabs`/`TabsList`/`TabsTrigger` (Radix — which owns the
 * roving-tabindex keyboard model and the `underline`/`pill` variants); this file
 * adds the record-list binding, the count pills, and cross-page link tabs.
 *
 * SCOPE: the widget renders the TAB STRIP, not the panels. Tabs in a generated
 * page either drive a sibling widget's filter (the host reads the active key) or
 * navigate (`hrefField`) — so there is no `TabsContent` here by design.
 */

import { Tabs, TabsList, TabsTrigger } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { chromeIcon } from './chrome-icons.js';
import { isSafeHref, numberField, recordRowsOf, stringField } from './chrome-lib.js';
import { tabBarConfigSchema, tabBarDemoData } from './chrome-config.js';
import type { TabBarConfig } from './chrome-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { tabBarConfigSchema, tabBarDemoData };
export type { TabBarConfig };

export interface TabDef {
  key: string;
  label: string;
  icon?: string | undefined;
  count?: number | undefined;
  href?: string | undefined;
}

/** Project the §3 `record-list` payload onto tab defs. */
export function tabsOf(data: unknown, config: TabBarConfig): TabDef[] {
  const rows = recordRowsOf(data);
  const out: TabDef[] = [];
  for (const [index, row] of rows.entries()) {
    const label = stringField(row, config.labelField);
    if (label === undefined) continue;
    const href = stringField(row, config.hrefField);
    out.push({
      key: stringField(row, config.keyField) ?? `tab-${index}`,
      label,
      icon: stringField(row, config.iconField),
      count: numberField(row, config.countField),
      ...(isSafeHref(href) ? { href } : {}),
    });
  }
  return out;
}

export function TabBarWidget({ config, data, onEvent }: WidgetProps<TabBarConfig>) {
  const t = useMaybeT();
  const tabs = tabsOf(data, config);
  if (tabs.length === 0) return null;

  // `tabs` is non-empty here, so the fallback always resolves to a real key —
  // Radix needs a defined `value` (a controlled Tabs root cannot take undefined).
  const active = config.activeKey ?? (tabs[0] as TabDef).key;

  return (
    <div className="flex h-full items-start px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="tab-bar" data-testid={config.testId}>
      <Tabs
        // `variant` maps the annex's `style` vocabulary onto the UI component's.
        variant={config.style === 'segmented' ? 'pill' : 'underline'}
        value={active}
        onValueChange={(key) => {
          // A link tab navigates; a filter tab just reports the change and the
          // host re-queries its siblings. Both go through onEvent (04 §2.1).
          const href = tabs.find((tab) => tab.key === key)?.href;
          if (href !== undefined) onEvent({ type: 'drill-through', href });
        }}
        className="w-full"
      >
        <TabsList aria-label={config.a11yLabel ?? t('ui:widgets.chrome.tabBar.a11yLabel', 'Tabs')}>
          {tabs.map((tab) => {
            const icon = chromeIcon(tab.icon);
            return (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                data-part="tab"
                // This strip renders no `TabsContent` by design (see the file
                // header), but Radix's Trigger emits `aria-controls` pointing at
                // a panel id unconditionally — so every selected tab advertised a
                // relationship to an element that is never in the DOM. A screen
                // reader following that reference lands on nothing.
                //
                // Deleting the attribute works because Radix sets it BEFORE
                // spreading `...triggerProps`, and our `TabsTrigger` spreads
                // `{...props}` last onto the primitive, so an explicit
                // `undefined` wins. axe only flagged the SELECTED trigger per
                // story (it skips a dangling IDREF on `aria-selected="false"`),
                // which is why this is 12 fingerprints and not 60.
                aria-controls={undefined}
                {...(config.counts && tab.count !== undefined ? { count: tab.count } : {})}
              >
                {icon !== undefined && (
                  <span aria-hidden="true" className="me-1.5 inline-flex size-4 items-center justify-center [&_svg]:size-4">
                    {icon}
                  </span>
                )}
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </div>
  );
}
