/**
 * TRACK DOMAIN `domain` family stories (annex §13): each widget's loaded
 * variant, the four WidgetFrame states through WidgetHost (acceptance #4), and
 * light/dark × LTR/RTL matrices (acceptance #9).
 *
 * REAL GEOMETRY MIRRORING — the RTL stories are not a bare `dir` attribute, and
 * the two widgets deliberately show OPPOSITE behavior (10-i18n-theming.md §5.5):
 *
 *   - `org-chart` MIRRORS. Node cards are positioned on `inset-inline-start` and
 *     the connector overlay carries `rtl:-scale-x-100`, so a `dir="rtl"` wrapper
 *     genuinely flips the whole tree — root right-of-center, branches growing
 *     inline-start → inline-end.
 *   - `gantt-chart` does NOT mirror. Its timeline canvas is a fixed-LTR island,
 *     so the RTL story must show the date header + bars + today line in the SAME
 *     place while the legend chrome around them mirrors. That contrast IS the
 *     visual regression this story exists to catch.
 *
 * Every payload is the same seeded generator `demoData` uses, and the gantt
 * pins `format.referenceTime` so the today marker lands identically on every
 * capture (no wall-clock read → byte-deterministic VRT).
 *
 * Widgets resolve through a LOCAL registry override so the stories work before
 * the green loop merges the definitions into the global map.
 */
import type { ReactNode } from 'react';

import { GANTT_DEMO_TODAY_MS, ganttChartDemoData, orgChartDemoData } from './domain-config.js';
import { ganttChartDefinition, orgChartDefinition } from './domain-track.definitions.js';
import { WidgetHost } from '../../frame/WidgetHost.js';
import { buildRegistry } from '../../registry/index.js';
import type { WidgetDefinition } from '../../registry/types.js';

const definitions: WidgetDefinition[] = [orgChartDefinition, ganttChartDefinition];
const registry = buildRegistry(definitions);

const meta = { title: 'Widgets/Domain' };
export default meta;

type Status = 'success' | 'loading' | 'error';

function host(
  widgetId: string,
  instanceId: string,
  config: Record<string, unknown>,
  data: unknown,
  status: Status = 'success',
  width = 'w-[46rem]',
) {
  return (
    <div className={width}>
      <WidgetHost
        widgetId={widgetId}
        instanceId={instanceId}
        config={config}
        registry={registry}
        data={
          status === 'success'
            ? { status, data }
            : status === 'error'
              ? { status, error: new Error('TABLE_FORBIDDEN'), refetch: () => {} }
              : { status }
        }
      />
    </div>
  );
}

function Frame({ dark, dir, children }: { dark?: boolean; dir?: 'ltr' | 'rtl'; children: ReactNode }) {
  const content = (
    <div dir={dir} className="flex flex-wrap items-start gap-4 bg-bg p-4">
      {children}
    </div>
  );
  return dark ? <div data-theme="dark">{content}</div> : content;
}

const orgData = orgChartDemoData(7);
const ganttData = ganttChartDemoData(7);

const orgConfig = { title: 'Reporting structure', reportsLabel: 'Reports · {count}' };
const orgAr = {
  title: 'الهيكل التنظيمي',
  reportsLabel: 'المرؤوسون · {count}',
  format: { locale: 'ar-EG' },
};

/** `format.referenceTime` pins "now" → the today line never moves between captures. */
const ganttConfig = {
  title: 'Launch plan',
  format: { referenceTime: GANTT_DEMO_TODAY_MS },
};
const ganttAr = {
  title: 'خطة الإطلاق',
  ungroupedLabel: 'المهام',
  format: { locale: 'ar-EG', referenceTime: GANTT_DEMO_TODAY_MS },
};

// --- loaded variants ---------------------------------------------------------

export const OrgChartStory = {
  name: 'org-chart',
  render: () => host('org-chart', 's-org', orgConfig, orgData),
};

export const OrgChartCollapsed = {
  name: 'org-chart — collapsed branch',
  render: () =>
    host('org-chart', 's-org-collapsed', { ...orgConfig, defaultCollapsed: ['d1'] }, orgData),
};

export const OrgChartMaxDepth = {
  name: 'org-chart — maxDepth 1 (VPs only)',
  render: () => host('org-chart', 's-org-depth', { ...orgConfig, maxDepth: 1 }, orgData),
};

/**
 * A corrupt self-FK cycle (a → b → a) reaching the widget. It must render both
 * people and must NOT hang — the cycle-safety contract, made visible.
 */
export const OrgChartCycle = {
  name: 'org-chart — self-FK cycle (must not hang)',
  render: () =>
    host(
      'org-chart',
      's-org-cycle',
      orgConfig,
      {
        rows: [
          { id: 'a', manager_id: 'b', name: 'Ana Silva', title: 'Director', dept: 'Operations' },
          { id: 'b', manager_id: 'a', name: 'Bo Chen', title: 'Director', dept: 'Operations' },
        ],
        total: 2,
      },
      'success',
      'w-[28rem]',
    ),
};

export const GanttChartStory = {
  name: 'gantt-chart',
  render: () => host('gantt-chart', 's-gantt', ganttConfig, ganttData),
};

export const GanttChartNoToday = {
  name: 'gantt-chart — no today line, no legend',
  render: () =>
    host('gantt-chart', 's-gantt-bare', { ...ganttConfig, todayLine: false, showLegend: false }, ganttData),
};

// --- four WidgetFrame states (acceptance #4) ---------------------------------

export const OrgChartStates = {
  name: 'org-chart — four states',
  render: () => (
    <Frame>
      {host('org-chart', 's-org-loaded', orgConfig, orgData)}
      {host('org-chart', 's-org-skeleton', orgConfig, undefined, 'loading')}
      {host('org-chart', 's-org-empty', orgConfig, { roots: [], total: 0 })}
      {host('org-chart', 's-org-error', orgConfig, undefined, 'error')}
    </Frame>
  ),
};

export const GanttChartStates = {
  name: 'gantt-chart — four states',
  render: () => (
    <Frame>
      {host('gantt-chart', 's-gantt-loaded', ganttConfig, ganttData)}
      {host('gantt-chart', 's-gantt-skeleton', ganttConfig, undefined, 'loading')}
      {host('gantt-chart', 's-gantt-empty', ganttConfig, { rows: [], total: 0 })}
      {host('gantt-chart', 's-gantt-error', ganttConfig, undefined, 'error')}
    </Frame>
  ),
};

// --- light/dark × LTR/RTL matrix (acceptance #9) ------------------------------

export const OrgChartLightLtr = {
  name: 'org-chart — light · LTR',
  render: () => <Frame>{host('org-chart', 's-org-l-ltr', orgConfig, orgData)}</Frame>,
};

export const OrgChartDarkLtr = {
  name: 'org-chart — dark · LTR',
  render: () => <Frame dark>{host('org-chart', 's-org-d-ltr', orgConfig, orgData)}</Frame>,
};

/** The tree genuinely flips: cards ride `inset-inline-start`, elbows scale-x. */
export const OrgChartLightRtl = {
  name: 'org-chart — light · RTL (tree mirrors)',
  render: () => <Frame dir="rtl">{host('org-chart', 's-org-l-rtl', orgAr, orgData)}</Frame>,
};

export const OrgChartDarkRtl = {
  name: 'org-chart — dark · RTL (tree mirrors)',
  render: () => (
    <Frame dark dir="rtl">
      {host('org-chart', 's-org-d-rtl', orgAr, orgData)}
    </Frame>
  ),
};

export const GanttChartLightLtr = {
  name: 'gantt-chart — light · LTR',
  render: () => <Frame>{host('gantt-chart', 's-gantt-l-ltr', ganttConfig, ganttData)}</Frame>,
};

export const GanttChartDarkLtr = {
  name: 'gantt-chart — dark · LTR',
  render: () => <Frame dark>{host('gantt-chart', 's-gantt-d-ltr', ganttConfig, ganttData)}</Frame>,
};

/**
 * The canvas must look IDENTICAL to the LTR capture (fixed-LTR island: date
 * header, bars and today line stay put, label gutter stays physically left)
 * while the widget header + legend mirror. A capture where the bars flipped is
 * the regression.
 */
export const GanttChartLightRtl = {
  name: 'gantt-chart — light · RTL (canvas stays LTR, chrome mirrors)',
  render: () => <Frame dir="rtl">{host('gantt-chart', 's-gantt-l-rtl', ganttAr, ganttData)}</Frame>,
};

export const GanttChartDarkRtl = {
  name: 'gantt-chart — dark · RTL (canvas stays LTR, chrome mirrors)',
  render: () => (
    <Frame dark dir="rtl">
      {host('gantt-chart', 's-gantt-d-rtl', ganttAr, ganttData)}
    </Frame>
  ),
};
