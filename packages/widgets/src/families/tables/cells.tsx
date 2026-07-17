import { Avatar, Badge, MonoText, StatusPill, type Tone } from '@adminium/ui';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import {
  columnAlign,
  formatAbsoluteTime,
  formatMoney,
  formatRelativeTime,
  maskedColumnsOf,
  uiToneOf,
} from './column-spec.js';
import type { GridColumnSpec, GridRow } from './column-spec.js';
import type { WidgetEvent } from '../../registry/types.js';

/**
 * Type-aware cell renderers for the `tables` family (annex §3 `data-grid`;
 * 09-generated-app.md §7.1 list keepers): money → mono end-aligned Intl
 * currency, status/category enum → pill/badge, FK → avatar chip firing
 * `record-open`, boolean → ✓/✕ glyph, timestamp → relative + absolute title,
 * email/url → mono/link, PII → '•••' with an unmask affordance when the
 * caller may reveal.
 */

export interface CellContext {
  /** Host event sink — FK chips emit `record-open` through it. */
  onEvent?: ((event: WidgetEvent) => void) | undefined;
  /** Caller may reveal PII values received unmasked from the server. */
  canUnmask?: boolean | undefined;
  connectionId?: string | undefined;
  /** Per-widget format overrides (shared config `format`). */
  locale?: string | undefined;
  currency?: string | undefined;
  /** Unmask-toggle accessible labels (i18n). */
  revealLabel?: string | undefined;
  hideLabel?: string | undefined;
}

export const MASKED_PLACEHOLDER = '•••';

const EMPTY_CELL = <span className="text-fg-subtle">—</span>;

function MaskedCell({
  value,
  revealable,
  context,
}: {
  value: unknown;
  revealable: boolean;
  context: CellContext;
}) {
  const [revealed, setRevealed] = useState(false);
  if (!revealable) {
    return (
      <MonoText data-part="cell-masked" className="text-fg-subtle">
        {MASKED_PLACEHOLDER}
      </MonoText>
    );
  }
  return (
    <span data-part="cell-masked" className="inline-flex items-center gap-1.5">
      <MonoText className={revealed ? undefined : 'text-fg-subtle'}>
        {revealed ? String(value) : MASKED_PLACEHOLDER}
      </MonoText>
      <button
        type="button"
        aria-label={revealed ? (context.hideLabel ?? 'Hide value') : (context.revealLabel ?? 'Reveal value')}
        aria-pressed={revealed}
        onClick={(event) => {
          event.stopPropagation();
          setRevealed((current) => !current);
        }}
        className="nb-ib inline-flex size-5 items-center justify-center rounded text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        {revealed ? <EyeOff className="size-3" aria-hidden="true" /> : <Eye className="size-3" aria-hidden="true" />}
      </button>
    </span>
  );
}

function FkChipCell({
  column,
  row,
  value,
  context,
}: {
  column: GridColumnSpec;
  row: GridRow;
  value: unknown;
  context: CellContext;
}) {
  const fk = column.fk as NonNullable<GridColumnSpec['fk']>;
  const displayRaw = fk.displayKey !== undefined ? row[fk.displayKey] : undefined;
  const display = displayRaw !== null && displayRaw !== undefined && String(displayRaw) !== ''
    ? String(displayRaw)
    : String(value);
  const open = () => {
    context.onEvent?.({
      type: 'record-open',
      connectionId: context.connectionId,
      table: fk.table,
      recordId: value as string | number,
    });
  };
  return (
    <button
      type="button"
      data-part="cell-fk-chip"
      onClick={(event) => {
        event.stopPropagation();
        open();
      }}
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface pe-2 ps-0.5 text-caption font-semibold text-fg hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      <Avatar name={display} size="xs" />
      <span className="truncate">{display}</span>
    </button>
  );
}

function enumTone(column: GridColumnSpec, value: string): Tone | undefined {
  const tone = column.enumTones?.[value];
  return tone === undefined ? undefined : uiToneOf(tone);
}

/**
 * Render one cell's content for a column spec. Pure dispatch on
 * `semantic`/`logicalType`; interactive treatments (FK chip, unmask toggle)
 * stop propagation so row-open clicks stay intact.
 */
export function CellValue({
  column,
  row,
  context = {},
}: {
  column: GridColumnSpec;
  row: GridRow;
  context?: CellContext | undefined;
}): ReactNode {
  const value = row[column.name];
  const maskedByServer = maskedColumnsOf(row).includes(column.name);

  if (maskedByServer) return <MaskedCell value={null} revealable={false} context={context} />;
  if (column.pii && value !== null && value !== undefined) {
    return <MaskedCell value={value} revealable={context.canUnmask === true} context={context} />;
  }
  if (value === null || value === undefined) return EMPTY_CELL;

  if (column.semantic === 'money') {
    return (
      <MonoText data-part="cell-money" className="font-semibold">
        {formatMoney(value, { locale: context.locale, currency: context.currency ?? column.currency })}
      </MonoText>
    );
  }

  if (column.fk !== undefined) {
    return <FkChipCell column={column} row={row} value={value} context={context} />;
  }

  if (column.semantic === 'status-workflow') {
    const tone = enumTone(column, String(value));
    return <StatusPill status={String(value)} {...(tone === undefined ? {} : { tone })} />;
  }
  if (column.semantic === 'category-enum' || column.logicalType === 'enum') {
    return <Badge tone={enumTone(column, String(value)) ?? 'neutral'}>{String(value)}</Badge>;
  }

  if (column.logicalType === 'boolean') {
    return value === true ? (
      <Check data-part="cell-bool-true" className="size-4 text-pos" aria-label="true" role="img" />
    ) : (
      <X data-part="cell-bool-false" className="size-4 text-fg-subtle" aria-label="false" role="img" />
    );
  }

  if (
    column.semantic === 'created-at' ||
    column.semantic === 'updated-at' ||
    column.semantic === 'event-timestamp' ||
    column.logicalType === 'timestamp' ||
    column.logicalType === 'timestamptz'
  ) {
    return (
      <span data-part="cell-timestamp" title={formatAbsoluteTime(value, context.locale)} className="whitespace-nowrap text-fg-muted">
        {formatRelativeTime(value, { locale: context.locale })}
      </span>
    );
  }

  if (column.semantic === 'email') {
    return <MonoText data-part="cell-email">{String(value)}</MonoText>;
  }
  if (column.semantic === 'url' || column.semantic === 'image-url') {
    return (
      <a
        data-part="cell-url"
        href={String(value)}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="truncate font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {String(value)}
      </a>
    );
  }

  if (column.semantic === 'percent') {
    const amount = typeof value === 'number' ? value : Number(value);
    return <MonoText data-part="cell-percent">{Number.isFinite(amount) ? `${String(amount)}%` : String(value)}</MonoText>;
  }

  if (column.logicalType === 'json') {
    return <MonoText className="truncate text-caption text-fg-muted">{JSON.stringify(value)}</MonoText>;
  }

  if (column.mono || column.semantic === 'pk-id' || column.semantic === 'external-id' || column.logicalType === 'uuid' || isPlainNumber(column)) {
    return <MonoText>{String(value)}</MonoText>;
  }

  return <span className="truncate">{String(value)}</span>;
}

function isPlainNumber(column: GridColumnSpec): boolean {
  return (
    column.logicalType === 'integer' ||
    column.logicalType === 'bigint' ||
    column.logicalType === 'decimal' ||
    column.logicalType === 'float'
  );
}

/** Utility: the flex alignment class for a column (mono numbers end-align). */
export function cellAlignClass(column: GridColumnSpec): string {
  return columnAlign(column) === 'end' ? 'justify-end text-end' : 'justify-start text-start';
}
