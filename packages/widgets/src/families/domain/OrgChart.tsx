import { Avatar, EmptyState } from '@adminium/ui';
import type { Tone } from '@adminium/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState } from 'react';

import { orgChartConfigSchema, orgChartDemoData } from './domain-config.js';
import type { OrgChartConfig } from './domain-config.js';
import {
  TONE_BORDER,
  TONE_SOFT,
  categoryTone,
  layoutOrgTree,
  orgRootsOf,
  resolveLocale,
  toneOf,
} from './domain-lib.js';
import type { OrgFieldMap, OrgLayoutNode } from './domain-lib.js';
import type { OrgNode } from './domain-types.js';
import type { WidgetProps } from '../../registry/types.js';

/**
 * `org-chart` (annex §13) — a hierarchical node tree with elbow connectors,
 * built from a SELF-REFERENCING people table (`manager_id → id`), which is also
 * this widget's auto-instantiation trigger (annex §13: "self-FK on a people
 * table (`manager_id`) → `org-chart`"). Node variants by depth: a root card, a
 * manager card with a dept chip + an expand/collapse "N reports" footer, and a
 * compact report card tinted from its parent's department tone.
 *
 * DIRECTION (10-i18n-theming.md §5.5): an org chart is a HIERARCHY, not a time
 * axis, so it mirrors — the tree grows inline-start → inline-end and flips whole
 * under `dir="rtl"`. The mirroring is done by the browser, not by us: geometry
 * from `layoutOrgTree` is canonical-LTR and every card is positioned on
 * `inset-inline-start` (`start-[var(--node-x)]`), the same logical-CSS mechanism
 * the `calendar` family's month grid relies on. The connector overlay is SVG —
 * which has no logical coordinate system — so it mirrors with
 * `rtl:-scale-x-100`; it draws only lines (no text), so a transform mirror is
 * exact. Both layers consume the SAME geometry, so they can never disagree.
 *
 * CYCLE SAFETY: a corrupt `manager_id` cycle (A→B→A, or a self-managing row)
 * must never hang the render. `buildOrgTree` is structurally loop-proof — see
 * its contract in domain-lib.ts — and every node still renders exactly once.
 */

export { orgChartConfigSchema, orgChartDemoData };
export type { OrgChartConfig };

export interface OrgChartProps {
  data: unknown;
  fields: OrgFieldMap;
  maxDepth?: number | undefined;
  collapsible?: boolean | undefined;
  defaultCollapsed?: readonly string[] | undefined;
  deptColorMap?: Record<string, string> | undefined;
  locale?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  /** Localized "N reports" footer template; `{count}` placeholder. */
  reportsLabel?: string | undefined;
  testId?: string | undefined;
}

/** Node tone: an explicit `meta.tone`, else a stable tone hashed from the dept. */
function nodeTone(node: OrgNode, deptColorMap: Record<string, string> | undefined): Tone {
  const explicit = node.meta?.tone;
  if (explicit !== undefined) return toneOf(explicit);
  return categoryTone(node.meta?.dept, deptColorMap);
}

/**
 * `{count}` interpolation for the localized reports footer.
 *
 * The template is a NON-INFLECTING "Reports · {count}" form on purpose. Widgets
 * are locale-agnostic and receive already-translated strings through config (the
 * boards `laneSummary` convention), so they interpolate by plain substitution —
 * there is no ICU runtime in here. A pluralized "{count} reports" would
 * therefore render with the wrong noun form in every locale with real plural
 * categories (ar has six, cs four), so the string is written to avoid grammatical
 * number agreement entirely rather than to fake it.
 */
function formatReports(template: string | undefined, count: number): string {
  const text = template ?? 'Reports · {count}';
  return text.replace('{count}', String(count));
}

export function OrgChart({
  data,
  fields,
  maxDepth = 6,
  collapsible = true,
  defaultCollapsed,
  deptColorMap,
  locale,
  emptyTitle,
  emptyBody,
  reportsLabel,
  testId,
}: OrgChartProps) {
  const tag = resolveLocale(locale);
  const { roots } = useMemo(() => orgRootsOf(data, fields), [data, fields]);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(defaultCollapsed ?? []),
  );

  const layout = useMemo(
    () => layoutOrgTree(roots, { maxDepth, collapsed }),
    [roots, maxDepth, collapsed],
  );

  if (roots.length === 0) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? 'No reporting structure'}
        body={emptyBody ?? 'The org chart appears once people rows reference a manager.'}
      />
    );
  }

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div data-widget="org-chart" data-testid={testId} className="h-full overflow-auto p-4">
      <div
        role="tree"
        aria-label="Organization chart"
        className="relative mx-auto h-[var(--org-canvas-h)] w-[var(--org-canvas-w)]"
        style={{ '--org-canvas-w': `${layout.width}px`, '--org-canvas-h': `${layout.height}px` }}
      >
        {/*
          Connector layer. `rtl:-scale-x-100` mirrors the elbows to match the
          cards, which mirror natively via `inset-inline-start`. Decorative: the
          reporting relationship is conveyed to AT by `aria-level` on each node.
        */}
        <svg
          className="pointer-events-none absolute inset-0 rtl:-scale-x-100"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
          focusable="false"
          data-testid="org-chart-connectors"
        >
          {layout.connectors.map((connector) => (
            <path
              key={`${connector.parentId}-${connector.childId}`}
              d={connector.d}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>

        {layout.nodes.map((entry) => (
          <OrgCard
            key={entry.id}
            entry={entry}
            tone={nodeTone(entry.node, deptColorMap)}
            locale={tag}
            collapsible={collapsible}
            reportsLabel={reportsLabel}
            onToggle={toggle}
          />
        ))}
      </div>
    </div>
  );
}

interface OrgCardProps {
  entry: OrgLayoutNode;
  tone: Tone;
  locale: string;
  collapsible: boolean;
  reportsLabel: string | undefined;
  onToggle: (id: string) => void;
}

function OrgCard({ entry, tone, locale, collapsible, reportsLabel, onToggle }: OrgCardProps) {
  const { node } = entry;
  const isRoot = entry.depth === 0;
  const dept = node.meta?.dept;
  // A toggle only makes sense when there is something to expand AND the instance
  // allows collapsing. `maxDepth`-pruned nodes are excluded: their collapsed
  // state is forced by the cap, so `onToggle` could never expand them — a live
  // button there is a dead control, and `aria-expanded` on it would be a lie.
  const expandable = entry.hasChildren && !entry.pruned;
  const showToggle = collapsible && expandable;

  return (
    <div
      role="treeitem"
      aria-level={entry.depth + 1}
      aria-label={node.label}
      {...(expandable ? { 'aria-expanded': !entry.collapsed } : {})}
      data-testid={`org-node-${node.id}`}
      data-depth={entry.depth}
      className={[
        'absolute top-[var(--node-y)] start-[var(--node-x)] h-[var(--node-h)] w-[var(--node-w)]',
        'flex flex-col items-center rounded-xl border bg-surface p-3 text-center shadow-sm',
        'transition-shadow hover:shadow-md',
        isRoot ? `border-t-2 ${TONE_BORDER[tone]}` : 'border-border',
      ].join(' ')}
      style={{
        '--node-x': `${entry.x}px`,
        '--node-y': `${entry.y}px`,
        '--node-w': `${entry.width}px`,
        '--node-h': `${entry.height}px`,
      }}
    >
      <Avatar
        name={node.label}
        size={isRoot ? 'lg' : 'md'}
        locale={locale}
        {...(node.meta?.avatar === undefined ? {} : { src: node.meta.avatar })}
      />
      <p className="mt-1.5 w-full truncate text-body-sm font-bold text-fg">{node.label}</p>
      {node.meta?.role === undefined ? null : (
        <p className="w-full truncate text-caption text-fg-muted">{node.meta.role}</p>
      )}
      {dept === undefined ? null : (
        <span
          className={`mt-1 truncate rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${TONE_SOFT[tone]}`}
        >
          {dept}
        </span>
      )}
      {!showToggle ? null : (
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          data-testid={`org-toggle-${node.id}`}
          className="mt-auto flex w-full items-center justify-center gap-1 border-t border-border pt-1.5 text-caption font-bold text-fg-subtle hover:text-fg"
        >
          {entry.collapsed ? (
            <ChevronDown className="size-3" aria-hidden="true" />
          ) : (
            <ChevronUp className="size-3" aria-hidden="true" />
          )}
          {formatReports(reportsLabel, entry.childCount)}
        </button>
      )}
    </div>
  );
}

/** Resolve the config's field-name map once per render (stable identity). */
function fieldsOf(config: OrgChartConfig): OrgFieldMap {
  return {
    idField: config.idField,
    parentField: config.parentField,
    labelField: config.labelField,
    roleField: config.roleField,
    deptField: config.deptField,
    avatarField: config.avatarField,
    toneField: config.toneField,
  };
}

export function OrgChartWidget({ config, data }: WidgetProps<OrgChartConfig>) {
  const fields = useMemo(() => fieldsOf(config), [config]);
  return (
    <OrgChart
      data={data}
      fields={fields}
      maxDepth={config.maxDepth}
      collapsible={config.collapsible}
      {...(config.defaultCollapsed === undefined ? {} : { defaultCollapsed: config.defaultCollapsed })}
      {...(config.deptColorMap === undefined ? {} : { deptColorMap: config.deptColorMap })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.reportsLabel === undefined ? {} : { reportsLabel: config.reportsLabel })}
    />
  );
}
