/**
 * `breadcrumb` (annex §11) — ancestor chain from parent pointers, clickable,
 * separator glyph, RTL-aware. Evidence: File Manager.
 *
 * Wraps @adminium/ui's `Breadcrumbs`, which already owns the separator chevron
 * and its RTL mirroring; this file adds the record-list binding, the deep-trail
 * collapse, and routes clicks through `onEvent`.
 */

import { Breadcrumbs } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';

import { collapseTrail } from './chrome-lib.js';
import { breadcrumbConfigSchema, breadcrumbDemoData } from './chrome-config.js';
import type { BreadcrumbConfig } from './chrome-config.js';
import { isSafeHref, recordRowsOf, stringField } from './chrome-lib.js';
import type { WidgetProps } from '../../registry/types.js';

export { breadcrumbConfigSchema, breadcrumbDemoData };
export type { BreadcrumbConfig };

export interface Crumb {
  id: string;
  label: string;
  href?: string | undefined;
}

/** Project the §3 `record-list` payload onto the ordered ancestor trail. */
export function crumbsOf(data: unknown, config: BreadcrumbConfig): Crumb[] {
  const rows = recordRowsOf(data);
  const out: Crumb[] = [];
  for (const [index, row] of rows.entries()) {
    const label = stringField(row, config.labelField);
    if (label === undefined) continue;
    const href = stringField(row, config.hrefField);
    out.push({
      id: stringField(row, config.idField) ?? `crumb-${index}`,
      label,
      ...(isSafeHref(href) ? { href } : {}),
    });
  }
  return out;
}

export function BreadcrumbWidget({ config, data, onEvent }: WidgetProps<BreadcrumbConfig>) {
  const t = useMaybeT();
  const crumbs = crumbsOf(data, config);
  const shown = collapseTrail(crumbs, config.maxDepth);

  if (shown.length === 0) return null;

  return (
    <div className="flex h-full items-center px-[var(--widget-pad)] pb-[var(--widget-pad)]" data-widget="breadcrumb" data-testid={config.testId}>
      <Breadcrumbs
        label={config.a11yLabel ?? t('ui:widgets.chrome.breadcrumb.a11yLabel', 'Breadcrumb')}
        items={shown.map((crumb) =>
          crumb === null
            ? // The collapsed middle: a non-interactive ellipsis, never a link.
              { label: '…' }
            : {
                label: crumb.label,
                ...(crumb.href === undefined
                  ? {}
                  : { onClick: () => onEvent({ type: 'drill-through', href: crumb.href as string }) }),
              },
        )}
      />
    </div>
  );
}
