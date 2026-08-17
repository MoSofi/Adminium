// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Value renderers for the review-diff rows (§10.3 "row anatomy"): each diff
 * category carries a differently-shaped `llmValue`/`heuristicValue` (the
 * projections in `@adminium/llm` `apply/diff.ts`), and these helpers turn one
 * side of a row into a compact, localized React node — a label bundle, an
 * ordered enum with tone chips, an `orders.product_id → products.id` relation,
 * a PII masking pair, a dashboard-widget binding preview, and so on.
 *
 * Every reader narrows defensively from `unknown`: a chattier model or a future
 * schema tweak must degrade to a readable fallback, never crash the reviewer.
 */
import type { ReactNode } from 'react';
import { Badge, MonoText, Tag, type Tone } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { lucideByName } from '../../lib/lucide.js';

// ─── Localized text (L10n = { locale: string }) ──────────────────────────────

/** Canonical locale order (en_US first); mirrors `@adminium/llm` `LOCALES`. */
const LOCALE_ORDER = ['en_US', 'de_DE', 'fr_FR', 'cs_CZ', 'da_DK', 'zh_CN', 'zh_TW', 'ar_EG'];

export type L10n = Record<string, string>;

function isL10n(value: unknown): value is L10n {
  if (value === null || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}

/** The en_US string (or the first available locale) of a localized object. */
export function primaryText(value: unknown): string | null {
  if (!isL10n(value)) return null;
  if (typeof value['en_US'] === 'string') return value['en_US'];
  const first = Object.values(value)[0];
  return typeof first === 'string' ? first : null;
}

function localeEntries(value: L10n): [string, string][] {
  return Object.entries(value).sort(([a], [b]) => {
    const ia = LOCALE_ORDER.indexOf(a);
    const ib = LOCALE_ORDER.indexOf(b);
    return (ia === -1 ? LOCALE_ORDER.length : ia) - (ib === -1 ? LOCALE_ORDER.length : ib);
  });
}

/** Per-locale rows for the expanded view of a localized field. */
export function LocalizedField({ label, value }: { label: string; value: unknown }) {
  if (!isL10n(value)) return null;
  const entries = localeEntries(value);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-semibold uppercase tracking-wide text-fg-subtle">{label}</span>
      <ul className="flex flex-col gap-0.5">
        {entries.map(([locale, text]) => (
          <li key={locale} className="flex items-baseline gap-2">
            <MonoText className="shrink-0 text-caption text-fg-subtle">{locale}</MonoText>
            <span className="text-body-sm text-fg" dir="auto">
              {text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Categories whose values carry per-locale text (expander applies) ────────

const LOCALIZED_CATEGORIES = new Set(['label', 'group', 'copy']);

export function hasLocalizedDetail(category: string): boolean {
  return LOCALIZED_CATEGORIES.has(category);
}

// ─── Small building blocks ───────────────────────────────────────────────────

function Placeholder({ children }: { children: ReactNode }) {
  return <span className="text-body-sm italic text-fg-subtle">{children}</span>;
}

const ENUM_TONE: Record<string, Tone> = {
  pos: 'pos',
  warn: 'warn',
  danger: 'danger',
  accent: 'accent',
  muted: 'neutral',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// ─── Per-category compact summaries ──────────────────────────────────────────

function LabelSummary({ value }: { value: unknown }) {
  const record = asRecord(value);
  const label = primaryText(record?.['label']);
  const icon = typeof record?.['icon'] === 'string' ? (record['icon'] as string) : null;
  if (label === null && icon === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  const IconGlyph = icon !== null ? lucideByName(icon) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {IconGlyph !== null ? <IconGlyph aria-hidden className="size-3.5 text-fg-muted" /> : null}
      <span className="text-body-sm font-medium text-fg" dir="auto">
        {label ?? t('studio.llmRuns.review.value.none', 'No value')}
      </span>
    </span>
  );
}

function KeySummary({ value }: { value: unknown }) {
  const record = asRecord(value);
  if (record === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  const displayColumn = typeof record['displayColumn'] === 'string' ? record['displayColumn'] : null;
  const naturalKey = asStringArray(record['naturalKey']);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-caption text-fg-subtle">{t('studio.llmRuns.review.value.display', 'Display')}</span>
      {displayColumn !== null ? (
        <Tag mono>{displayColumn}</Tag>
      ) : (
        <Placeholder>{t('studio.llmRuns.review.value.dash', '—')}</Placeholder>
      )}
      <span className="ms-1 text-caption text-fg-subtle">{t('studio.llmRuns.review.value.key', 'Key')}</span>
      {naturalKey.length > 0 ? (
        naturalKey.map((column) => (
          <Tag key={column} mono>
            {column}
          </Tag>
        ))
      ) : (
        <Placeholder>{t('studio.llmRuns.review.value.dash', '—')}</Placeholder>
      )}
    </span>
  );
}

function EnumSummary({ value }: { value: unknown }) {
  const record = asRecord(value);
  if (record === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  const kind = typeof record['kind'] === 'string' ? record['kind'] : null;
  const order = asStringArray(record['order']);
  const tones = asRecord(record['tones']) ?? {};
  const terminal = new Set(asStringArray(record['terminal']));
  const values = order.length > 0 ? order : Object.keys(tones);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {kind !== null ? (
        <Badge tone={kind === 'workflow' ? 'accent' : 'neutral'}>
          {kind === 'workflow'
            ? t('studio.llmRuns.review.value.enumWorkflow', 'Workflow')
            : t('studio.llmRuns.review.value.enumCategory', 'Category')}
        </Badge>
      ) : null}
      {values.map((entry) => {
        const tone = ENUM_TONE[String(tones[entry] ?? 'muted')] ?? 'neutral';
        return (
          <Badge key={entry} tone={tone} dot={terminal.has(entry)}>
            {entry}
          </Badge>
        );
      })}
    </span>
  );
}

/** Relation identifier chips: `orders.product_id → products.id` (§10.3). */
export function RelationChips({ value }: { value: unknown }) {
  const record = asRecord(value);
  if (record === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  const from = `${short(record['fromTable'])}.${asStringArray(record['fromColumns']).join(', ')}`;
  const to = `${short(record['toTable'])}.${asStringArray(record['toColumns']).join(', ')}`;
  const kind = typeof record['kind'] === 'string' ? record['kind'] : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Tag mono>{from}</Tag>
      {/* U+2192 is not a bidi-mirrored glyph — flip it under RTL so the relation
          reads from→to after the flexbox visual order reverses (ar_EG). The
          transform needs a non-inline box, hence `inline-block`. */}
      <span aria-hidden className="inline-block text-fg-subtle rtl:-scale-x-100">
        →
      </span>
      <Tag mono>{to}</Tag>
      {kind !== null ? <Badge tone="info">{kind}</Badge> : null}
    </span>
  );
}

function PiiSummary({ value }: { value: unknown }) {
  if (value === null) {
    return <Badge tone="neutral">{t('studio.llmRuns.review.value.notPii', 'Not PII')}</Badge>;
  }
  const record = asRecord(value);
  if (record === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  const kind = typeof record['kind'] === 'string' ? record['kind'] : null;
  const masking = typeof record['masking'] === 'string' ? record['masking'] : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {kind !== null ? <Badge tone="warn">{kind}</Badge> : null}
      {masking !== null ? (
        <Tag mono tone="warn">
          {masking}
        </Tag>
      ) : null}
    </span>
  );
}

function TemplateSummary({ value }: { value: unknown }) {
  const record = asRecord(value);
  if (record === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  const template = typeof record['template'] === 'string' ? record['template'] : null;
  const rank = typeof record['rank'] === 'number' ? record['rank'] : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {template !== null ? <Tag mono tone="accent">{template}</Tag> : null}
      {rank !== null ? (
        <span className="text-caption text-fg-subtle">
          {t('studio.llmRuns.review.value.rank', 'rank {n}', { n: rank })}
        </span>
      ) : null}
    </span>
  );
}

function GroupSummary({ value }: { value: unknown }) {
  const record = asRecord(value);
  if (record === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  const label = primaryText(record['label']);
  const icon = typeof record['icon'] === 'string' ? (record['icon'] as string) : null;
  const tables = asStringArray(record['tables']);
  const IconGlyph = icon !== null ? lucideByName(icon) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {IconGlyph !== null ? <IconGlyph aria-hidden className="size-3.5 text-fg-muted" /> : null}
      <span className="text-body-sm font-medium text-fg" dir="auto">
        {label ?? t('studio.llmRuns.review.value.none', 'No value')}
      </span>
      <span className="text-caption text-fg-subtle">
        {t('studio.llmRuns.review.value.tableCount', '{n} tables', { n: tables.length })}
      </span>
    </span>
  );
}

function DashboardSummary({ value }: { value: unknown }) {
  const record = asRecord(value);
  if (record === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  const label = primaryText(record['label']);
  const domain = typeof record['domain'] === 'string' ? record['domain'] : null;
  const widgets = Array.isArray(record['widgets']) ? record['widgets'].length : 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-body-sm font-medium text-fg" dir="auto">
        {label ?? domain ?? t('studio.llmRuns.review.value.none', 'No value')}
      </span>
      <span className="text-caption text-fg-subtle">
        {t('studio.llmRuns.review.value.widgetCount', '{n} widgets', { n: widgets })}
      </span>
    </span>
  );
}

/** Dashboard-widget preview: name + span + column binding (§10.3). */
export function WidgetPreview({ value }: { value: unknown }) {
  const record = asRecord(value);
  if (record === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  const widget = typeof record['widget'] === 'string' ? record['widget'] : null;
  const span = typeof record['span'] === 'number' ? record['span'] : null;
  const table = typeof record['table'] === 'string' ? record['table'] : null;
  const metric = typeof record['metricColumn'] === 'string' ? record['metricColumn'] : null;
  const dimension = typeof record['dimensionColumn'] === 'string' ? record['dimensionColumn'] : null;
  const time = typeof record['timeColumn'] === 'string' ? record['timeColumn'] : null;
  const agg = typeof record['agg'] === 'string' ? record['agg'] : null;
  const binding = [agg, metric ?? dimension ?? time].filter((part) => part !== null).join(' · ');
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {widget !== null ? <Tag mono tone="accent">{widget}</Tag> : null}
      {span !== null ? (
        <span className="text-caption text-fg-subtle">
          {t('studio.llmRuns.review.value.span', 'span {n}', { n: span })}
        </span>
      ) : null}
      {table !== null ? (
        <MonoText className="text-caption text-fg-muted">
          {short(table)}
          {binding.length > 0 ? ` · ${binding}` : ''}
        </MonoText>
      ) : null}
    </span>
  );
}

function CopySummary({ value }: { value: unknown }) {
  const record = asRecord(value);
  const subtitle = primaryText(record?.['pageSubtitle']);
  if (subtitle === null) return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  return (
    <span className="text-body-sm text-fg" dir="auto">
      {subtitle}
    </span>
  );
}

/** Strip the leading `schema.` from a qualified table name for compact chips. */
function short(qualified: unknown): string {
  if (typeof qualified !== 'string') return '';
  const dot = qualified.indexOf('.');
  return dot === -1 ? qualified : qualified.slice(dot + 1);
}

// ─── Dispatch: compact single-line value for a diff side ─────────────────────

export function DiffValue({ category, value }: { category: string; value: unknown }) {
  if (value === undefined) {
    return <Placeholder>{t('studio.llmRuns.review.value.absent', 'None')}</Placeholder>;
  }
  switch (category) {
    case 'label':
      return <LabelSummary value={value} />;
    case 'key':
      return <KeySummary value={value} />;
    case 'enum':
      return <EnumSummary value={value} />;
    case 'relation':
      return <RelationChips value={value} />;
    case 'pii':
      return <PiiSummary value={value} />;
    case 'template':
      return <TemplateSummary value={value} />;
    case 'group':
      return <GroupSummary value={value} />;
    case 'dashboard':
      return <DashboardSummary value={value} />;
    case 'widget':
      return <WidgetPreview value={value} />;
    case 'copy':
      return <CopySummary value={value} />;
    default:
      return <Placeholder>{t('studio.llmRuns.review.value.none', 'No value')}</Placeholder>;
  }
}

/** The localized fields to expand per-row, in display order, for a category. */
export function localizedFieldsOf(category: string, value: unknown): { key: string; label: string; value: unknown }[] {
  const record = asRecord(value);
  if (record === null) return [];
  if (category === 'label' || category === 'group') {
    const fields: { key: string; label: string; value: unknown }[] = [];
    if (isL10n(record['label']))
      fields.push({ key: 'label', label: t('studio.llmRuns.review.value.label', 'Label'), value: record['label'] });
    if (isL10n(record['description']))
      fields.push({
        key: 'description',
        label: t('studio.llmRuns.review.value.description', 'Description'),
        value: record['description'],
      });
    return fields;
  }
  if (category === 'copy') {
    const fields: { key: string; label: string; value: unknown }[] = [];
    if (isL10n(record['pageSubtitle']))
      fields.push({
        key: 'pageSubtitle',
        label: t('studio.llmRuns.review.value.subtitle', 'Page subtitle'),
        value: record['pageSubtitle'],
      });
    const emptyState = asRecord(record['emptyState']);
    if (emptyState !== null) {
      if (isL10n(emptyState['headline']))
        fields.push({
          key: 'headline',
          label: t('studio.llmRuns.review.value.headline', 'Empty-state headline'),
          value: emptyState['headline'],
        });
      if (isL10n(emptyState['guidance']))
        fields.push({
          key: 'guidance',
          label: t('studio.llmRuns.review.value.guidance', 'Empty-state guidance'),
          value: emptyState['guidance'],
        });
    }
    return fields;
  }
  return [];
}
