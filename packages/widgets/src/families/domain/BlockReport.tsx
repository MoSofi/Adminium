import { sparkBars, sparkLine } from '@adminium/charts';
import { MonoText } from '@adminium/ui';
import { Paperclip } from 'lucide-react';

import { BlockEmpty } from './BlockShell.js';
import {
  categoricalItemsOf,
  formatBlockMoney,
  formatBlockNumber,
  formatBlockSize,
  rowOf,
  rowsOf,
  twoColRowsOf,
} from './block-lib.js';
import {
  blockAttachmentsConfigSchema,
  blockAttachmentsDemoData,
  blockBarChartConfigSchema,
  blockBarChartDemoData,
  blockImagePlaceholderConfigSchema,
  blockImagePlaceholderDemoData,
  blockKpiRowConfigSchema,
  blockKpiRowDemoData,
  blockLineChartConfigSchema,
  blockLineChartDemoData,
  blockTwoColTableConfigSchema,
  blockTwoColTableDemoData,
} from './blocks-config.js';
import type {
  BlockAttachmentsConfig,
  BlockBarChartConfig,
  BlockImagePlaceholderConfig,
  BlockKpiRowConfig,
  BlockLineChartConfig,
  BlockTwoColTableConfig,
} from './blocks-config.js';
import { numberField, stringField } from './domain-lib.js';
import type { BlockAttachment, BlockImagePlaceholder, BlockKpi } from './block-types.js';
import type { WidgetProps } from '../../registry/types.js';

export {
  blockAttachmentsConfigSchema,
  blockAttachmentsDemoData,
  blockBarChartConfigSchema,
  blockBarChartDemoData,
  blockImagePlaceholderConfigSchema,
  blockImagePlaceholderDemoData,
  blockKpiRowConfigSchema,
  blockKpiRowDemoData,
  blockLineChartConfigSchema,
  blockLineChartDemoData,
  blockTwoColTableConfigSchema,
  blockTwoColTableDemoData,
};

/**
 * TRACK BUILDER — the REPORT half of the annex §13 document-block vocabulary:
 *
 *   `block-kpi-row`, `block-bar-chart`, `block-line-chart`,
 *   `block-two-col-table`, `block-attachments`, `block-image-placeholder`.
 *
 * MINI CHARTS: the annex specifies "mini pure-div/SVG charts, currentColor
 * accent" — deliberately NOT the full `chart-bar` / `chart-line-area` widgets,
 * which carry axes, tooltips and legends a ~200px paper block has no room for.
 * They reuse @adminium/charts' PURE geometry primitives (`sparkBars`,
 * `sparkLine`) and paint a bare SVG in `currentColor`, so the doc's accent flows
 * through and the block adds no chart-runtime weight to the document chunk.
 */

// ── block-kpi-row ───────────────────────────────────────────────────────────

/**
 * Sign-aware delta tone (annex: "stat tiles with sign-aware delta coloring").
 * `invertDelta` flips it for metrics where up is bad (churn, latency, refunds) —
 * a green +18% churn would be an actively misleading report.
 */
function deltaTone(delta: number, invert: boolean): string {
  if (delta === 0) return 'text-fg-subtle';
  const good = invert ? delta < 0 : delta > 0;
  return good ? 'text-pos' : 'text-danger';
}

function formatKpiValue(kpi: BlockKpi, locale: string | undefined, currency: string | undefined): string {
  if (kpi.unit === 'currency') return formatBlockMoney(kpi.value, { locale, currency });
  if (kpi.unit === 'percent') return `${formatBlockNumber(Math.round(kpi.value * 1000) / 10, locale)}%`;
  return formatBlockNumber(kpi.value, locale);
}

export function BlockKpiRowWidget({ config, data }: WidgetProps<BlockKpiRowConfig>) {
  const kpis: BlockKpi[] = rowsOf(data)
    .slice(0, config.maxTiles)
    .map((row, index) => ({
      id: stringField(row, config.idField) ?? `kpi-${index}`,
      label: stringField(row, config.labelField) ?? '',
      value: numberField(row, config.valueField) ?? 0,
      delta: numberField(row, config.deltaField),
      unit: (stringField(row, config.unitField) as BlockKpi['unit']) ?? 'plain',
    }));

  if (kpis.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No metrics'} body={config.emptyBody ?? 'Report metrics will appear here once the document is bound.'} />;
  }

  const locale = config.format?.locale;
  const currency = config.format?.currency;

  return (
    <div
      data-widget="block-kpi-row"
      data-testid={config.testId}
      className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {kpis.map((kpi) => (
        <div key={kpi.id} data-part="kpi-tile" className="rounded-md bg-surface-2 p-2.5">
          <p className="truncate text-caption text-fg-subtle">{kpi.label}</p>
          <MonoText className="block text-section font-bold text-fg">
            {formatKpiValue(kpi, locale, currency)}
          </MonoText>
          {kpi.delta !== undefined && (
            <MonoText
              data-part="kpi-delta"
              className={`block text-caption ${deltaTone(kpi.delta, config.invertDelta)}`}
            >
              {kpi.delta > 0 ? '+' : ''}
              {formatBlockNumber(Math.round(kpi.delta * 1000) / 10, locale)}%
            </MonoText>
          )}
        </div>
      ))}
    </div>
  );
}

// ── block-bar-chart / block-line-chart ──────────────────────────────────────

const CHART_W = 240;
const CHART_H = 64;

function ChartAxis({ labels }: { labels: readonly string[] }) {
  return (
    <div data-part="chart-axis" className="mt-1 flex justify-between text-micro text-fg-subtle">
      {labels.map((label, index) => (
        <span key={`${label}-${index}`}>{label}</span>
      ))}
    </div>
  );
}

export function BlockBarChartWidget({ config, data }: WidgetProps<BlockBarChartConfig>) {
  const items = categoricalItemsOf(data).slice(0, config.maxPoints);
  if (items.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No chart data'} body={config.emptyBody ?? 'A mini bar chart appears once this block is bound to a series.'} />;
  }

  const bars = sparkBars(items.map((item) => item.value), CHART_W, CHART_H, 3);
  const locale = config.format?.locale;

  return (
    <div data-widget="block-bar-chart" data-testid={config.testId} className="w-full text-accent">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-16 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={config.title ?? 'Bar chart'}
      >
        {bars.map((bar, index) => (
          <rect
            key={items[index]?.label ?? index}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={1}
            fill="currentColor"
            // The annex's emphasis: the latest bar reads full-tone, the rest
            // recede — the same convention @adminium/charts' Sparkline uses.
            opacity={bar.isLast ? 1 : 0.45}
          />
        ))}
      </svg>
      {config.showValues && (
        <div className="mt-1 flex justify-between text-micro text-fg-subtle">
          {items.map((item) => (
            <MonoText key={item.label}>{formatBlockNumber(item.value, locale)}</MonoText>
          ))}
        </div>
      )}
      {config.showAxis && <ChartAxis labels={items.map((item) => item.label)} />}
    </div>
  );
}

export function BlockLineChartWidget({ config, data }: WidgetProps<BlockLineChartConfig>) {
  const items = categoricalItemsOf(data).slice(0, config.maxPoints);
  if (items.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No chart data'} body={config.emptyBody ?? 'A mini line chart appears once this block is bound to a series.'} />;
  }

  const layout = sparkLine(items.map((item) => item.value), CHART_W, CHART_H, 3);
  const locale = config.format?.locale;
  // Close the polyline down to the baseline for the filled variant.
  const areaPoints = layout.points === '' ? '' : `0,${CHART_H} ${layout.points} ${CHART_W},${CHART_H}`;

  return (
    <div data-widget="block-line-chart" data-testid={config.testId} className="w-full text-accent">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-16 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={config.title ?? 'Line chart'}
      >
        {config.area && areaPoints !== '' && (
          <polygon data-part="line-area" points={areaPoints} fill="currentColor" opacity={0.14} />
        )}
        <polyline
          data-part="line-stroke"
          points={layout.points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {layout.last !== null && (
          <circle cx={layout.last.x} cy={layout.last.y} r={2.5} fill="currentColor" />
        )}
      </svg>
      {config.showValues && (
        <div className="mt-1 flex justify-between text-micro text-fg-subtle">
          {items.map((item) => (
            <MonoText key={item.label}>{formatBlockNumber(item.value, locale)}</MonoText>
          ))}
        </div>
      )}
      {config.showAxis && <ChartAxis labels={items.map((item) => item.label)} />}
    </div>
  );
}

// ── block-two-col-table ─────────────────────────────────────────────────────

export function BlockTwoColTableWidget({ config, data }: WidgetProps<BlockTwoColTableConfig>) {
  const rows = twoColRowsOf(data);
  if (rows.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No rows'} body={config.emptyBody ?? 'Two-column rows will appear here.'} />;
  }

  // annex: "first row styled header" — but only when `headerRow` says so, in
  // which case that row leaves the body rather than rendering twice.
  const head = config.headerRow ? rows[0] : undefined;
  const body = config.headerRow ? rows.slice(1) : rows;

  return (
    <table data-widget="block-two-col-table" data-testid={config.testId} className="w-full text-body-sm">
      {head !== undefined && (
        <thead>
          <tr className="border-b border-border text-micro uppercase text-fg-subtle">
            <th scope="col" className="py-2 text-start font-bold">{head[0]}</th>
            <th scope="col" className="py-2 text-end font-bold">{head[1]}</th>
          </tr>
        </thead>
      )}
      <tbody>
        {body.map((row, index) => (
          <tr key={`${row[0]}-${index}`} className="border-b border-border/60 last:border-0">
            <td className="py-1.5 text-start text-fg-muted">{row[0]}</td>
            <td className="py-1.5 text-end text-fg">
              {config.monoRightColumn ? <MonoText>{row[1]}</MonoText> : row[1]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── block-attachments ───────────────────────────────────────────────────────

export function BlockAttachmentsWidget({ config, data }: WidgetProps<BlockAttachmentsConfig>) {
  const files: BlockAttachment[] = rowsOf(data)
    .slice(0, config.maxRows)
    .map((row, index) => ({
      id: stringField(row, config.idField) ?? `att-${index}`,
      name: stringField(row, config.nameField) ?? '',
      size: numberField(row, config.sizeField) ?? 0,
    }));

  if (files.length === 0) {
    return <BlockEmpty title={config.emptyTitle ?? 'No attachments'} body={config.emptyBody ?? 'Files attached to this document will appear here.'} />;
  }

  const locale = config.format?.locale;

  return (
    <ul data-widget="block-attachments" data-testid={config.testId} className="w-full space-y-1">
      {files.map((file) => (
        <li key={file.id} data-part="attachment-row" className="flex items-center gap-2.5 py-1 text-body-sm">
          <Paperclip className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-fg">{file.name}</span>
          <MonoText className="shrink-0 text-caption text-fg-subtle">
            {formatBlockSize(file.size, locale)}
          </MonoText>
        </li>
      ))}
    </ul>
  );
}

// ── block-image-placeholder ─────────────────────────────────────────────────

const RATIO_CLASS: Record<BlockImagePlaceholderConfig['ratio'], string> = {
  '16/9': 'aspect-video',
  '4/3': 'aspect-4/3',
  '1/1': 'aspect-square',
};

export function BlockImagePlaceholderWidget({ config, data }: WidgetProps<BlockImagePlaceholderConfig>) {
  const payload = rowOf<BlockImagePlaceholder>(data);
  if (payload === null) {
    return <BlockEmpty title={config.emptyTitle ?? 'No image slot'} body={config.emptyBody ?? 'An image placeholder appears once this block is bound.'} />;
  }

  const caption = stringField({ text: payload.text }, 'text') ?? '';

  return (
    <div data-widget="block-image-placeholder" data-testid={config.testId} className="w-full">
      {/*
        The annex's "dashed diagonal-stripe box". The stripes are a token-driven
        repeating-linear-gradient utility, not an inline style prop (banned) and
        not a raster asset.
      */}
      <div
        data-part="image-slot"
        className={`flex w-full items-center justify-center rounded-md border border-dashed border-border-strong bg-[repeating-linear-gradient(45deg,var(--surface-2)_0px,var(--surface-2)_6px,var(--surface-3)_6px,var(--surface-3)_12px)] ${RATIO_CLASS[config.ratio]}`}
      >
        <span className="px-3 text-center text-caption text-fg-subtle">{caption}</span>
      </div>
    </div>
  );
}
