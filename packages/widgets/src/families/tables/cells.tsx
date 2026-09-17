// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeT } from '@adminium/i18n/react';
import { Avatar, Badge, MonoText, StatusPill, type Tone } from '@adminium/ui';
import { Check, Eye, EyeOff, Paperclip, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import {
  columnAlign,
  dateOnlyValue,
  formatAbsoluteTime,
  formatCalendarDate,
  formatDisplayValue,
  formatMoney,
  formatRelativeTime,
  maskedColumnsOf,
  uiToneOf,
} from './column-spec.js';
import type { GridColumnSpec, GridRow } from './column-spec.js';
import { useCustomCellRenderer } from './custom-cells.js';
import { parseRefList } from '../../page-config/file-refs.js';
import type { WidgetEvent } from '../../registry/types.js';

/**
 * Type-aware cell renderers for the `tables` family (annex `data-grid`; list
 * keepers): money → mono end-aligned Intl currency, status/category enum →
 * pill/badge, FK → avatar chip firing `record-open`, boolean → ✓/✕ glyph,
 * timestamp → relative + absolute title, date → locale calendar day
 * (wire-instant decoded, ISO-day title), email/url → mono/link, PII → '•••'
 * with an unmask affordance when the caller may reveal.
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
  /**
   * Resolved file references for this page of rows.
   *
   * The host batches one `POST /files/resolve` per fetched page and hands the
   * answers down as a map keyed by the STORED VALUE — so a grid of fifty rows
   * with a file column costs one request, not fifty. A value that is absent
   * from the map, or maps to `null`, renders as today's plain link: it is a
   * foreign URL, or a file this reader may not see, and both are the same
   * thing from here.
   */
  files?: ReadonlyMap<string, ResolvedFile | null> | undefined;
  /** Above this, an image column shows its chip instead of a preview (D24). */
  thumbnailMaxBytes?: number | undefined;
}

/** What the host's resolve call hands back for one stored reference. */
export interface ResolvedFile {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  /** Same-origin path. NEVER a destination's public URL — the CSP blocks it (D24). */
  contentPath: string;
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
  const t = useMaybeT();
  const [revealed, setRevealed] = useState(false);
  if (!revealable) {
    return (
      <MonoText data-part="cell-masked" className="truncate text-fg-subtle">
        {MASKED_PLACEHOLDER}
      </MonoText>
    );
  }
  return (
    <span data-part="cell-masked" className="inline-flex min-w-0 items-center gap-1.5">
      <MonoText className={revealed ? 'truncate' : 'truncate text-fg-subtle'}>
        {revealed ? String(value) : MASKED_PLACEHOLDER}
      </MonoText>
      <button
        type="button"
        aria-label={
          revealed
            ? (context.hideLabel ?? t('ui:widgets.tables.hideLabel', 'Hide value'))
            : (context.revealLabel ?? t('ui:widgets.tables.revealLabel', 'Reveal value'))
        }
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
  // The chip's monogram is ON unless the page turned it off — an absent flag
  // is what every stored page has, and those must look as they did.
  const avatar = column.avatar !== false;
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
      // `ps-0.5` exists to hug the avatar's round edge. With no avatar that
      // start padding is a visible notch, so the chip pads evenly instead.
      className={`inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface pe-2 text-caption font-semibold text-fg hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
        avatar ? 'ps-0.5' : 'ps-2'
      }`}
    >
      {avatar ? <Avatar name={display} size="xs" /> : null}
      <span className="truncate">{display}</span>
    </button>
  );
}

function enumTone(column: GridColumnSpec, value: string): Tone | undefined {
  const tone = column.enumTones?.[value];
  return tone === undefined ? undefined : uiToneOf(tone);
}

/**
 * One cell: the type-aware content, optionally behind a monogram.
 *
 * The avatar is a WRAPPER rather than another branch of the dispatch below,
 * so it composes with whatever treatment the column already has — a name in
 * plain text, a linked lookup, a badge — instead of replacing it. The FK chip
 * is the one exception: it draws its own monogram inside the pill, where it
 * belongs, so wrapping it too would give it two.
 *
 * Nothing to monogram means no monogram: a null, an empty string, or a value
 * the reader is not being shown all render exactly as they did before, because
 * the initials would be either meaningless or a leak of a masked value's shape.
 */
/** Human byte size for a chip. Deliberately not `Intl.NumberFormat` units:
 * `notation: 'compact'` on bytes reads as "1.2K" where a person expects "1.2 KB",
 * and the unit table below is four lines against a formatter that needs a
 * locale-aware unit vocabulary this component does not have.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit] ?? 'TB'}`;
}

const THUMBNAIL_MIMES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * A resolved file in a grid cell: a thumbnail for a small raster image,
 * otherwise a chip with the name and size.
 *
 * THE IMAGE IS THE ORIGINAL, rendered small. There is no server-side resizing
 * (D39), so the size cap is what stops a 40 px box from downloading twelve
 * megabytes — above it, the chip. And the `src` is always the SAME-ORIGIN
 * content path, never a destination's `publicBaseUrl`: the dashboard's CSP is
 * `default-src 'self'`, so a cross-origin `<img>` is blocked outright and
 * widening `img-src` per destination would mean a per-request CSP.
 */
function FileCell({
  column,
  file,
  context,
}: {
  column: GridColumnSpec;
  file: ResolvedFile;
  context: CellContext;
}): ReactNode {
  const t = useMaybeT();
  const cap = context.thumbnailMaxBytes ?? 2_097_152;
  const showsImage =
    column.file?.inline === true && THUMBNAIL_MIMES.has(file.mime) && file.sizeBytes <= cap;

  return (
    <a
      data-part="cell-file"
      href={file.contentPath}
      // Downloads and previews both leave this page; a row-open click must not
      // also fire, the same reason the FK chip and the unmask toggle stop it.
      onClick={(event) => event.stopPropagation()}
      target="_blank"
      rel="noreferrer"
      title={`${file.filename} · ${formatBytes(file.sizeBytes)}`}
      className="inline-flex min-w-0 items-center gap-1.5 font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {showsImage ? (
        <img
          src={`${file.contentPath}?inline=1`}
          alt=""
          loading="lazy"
          className="size-10 shrink-0 rounded border border-border object-cover"
        />
      ) : (
        <Paperclip aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
      )}
      <span className="truncate">{file.filename}</span>
      <span data-part="cell-file-size" className="shrink-0 text-xs text-fg-subtle">
        {formatBytes(file.sizeBytes)}
      </span>
      <span className="sr-only">{t?.('ui:widgets.tables.fileDownload', 'Download') ?? 'Download'}</span>
    </a>
  );
}

export function CellValue({
  column,
  row,
  context = {},
}: {
  column: GridColumnSpec;
  row: GridRow;
  context?: CellContext | undefined;
}): ReactNode {
  const content = <CellContent column={column} row={row} context={context} />;
  if (column.avatar !== true || column.fk !== undefined) return content;

  const value = row[column.name];
  const masked = column.pii === true || maskedColumnsOf(row).includes(column.name);
  if (masked || value === null || value === undefined || String(value).trim() === '') {
    return content;
  }
  return (
    <span data-part="cell-avatar" className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar name={String(value)} size="xs" />
      {content}
    </span>
  );
}

/**
 * Render one cell's content for a column spec. Pure dispatch on
 * `semantic`/`logicalType`; interactive treatments (FK chip, unmask toggle)
 * stop propagation so row-open clicks stay intact.
 */
function CellContent({
  column,
  row,
  context = {},
}: {
  column: GridColumnSpec;
  row: GridRow;
  context?: CellContext | undefined;
}): ReactNode {
  const t = useMaybeT();
  const custom = useCustomCellRenderer();
  const value = row[column.name];
  const maskedByServer = maskedColumnsOf(row).includes(column.name);

  if (maskedByServer) return <MaskedCell value={null} revealable={false} context={context} />;
  if (column.pii && value !== null && value !== undefined) {
    return <MaskedCell value={value} revealable={context.canUnmask === true} context={context} />;
  }
  /*
   * A host-drawn cell (`custom-cells.tsx`) comes after the masking, which a
   * host must not be able to skip, and before everything else: it may draw an
   * empty value too.
   */
  if (custom !== null) {
    const drawn = custom(column, row);
    if (drawn !== undefined) return drawn;
  }
  if (value === null || value === undefined) return EMPTY_CELL;

  /*
   * An explicit `display` block wins over the semantic chain below, and it has
   * to be tested BEFORE it because a derived value has no useful `semantic` or
   * `logicalType` — a computed invoice total would otherwise fall all the way
   * through to the plain mono-string branch and render `1367.28` unformatted.
   *
   * Opt-in by construction: absent on every generated page, so a page that
   * does not carry one renders exactly what it rendered before.
   */
  if (column.display !== undefined) {
    return (
      <MonoText
        data-part="cell-display"
        className={column.display.kind === 'currency' ? 'truncate font-semibold' : 'truncate'}
      >
        {formatDisplayValue(value, column.display, {
          locale: context.locale,
          currency: context.currency ?? column.currency,
        })}
      </MonoText>
    );
  }

  /* Every text-shaped cell truncates. The grid cell is a flex container, so its
     children are blockified and `truncate` bites — but only the plain-string and
     url branches ever set it, so a long email or uuid escaped its column and
     painted over the next one's pill (visible in any table with a mono column
     narrower than its values). The comp ellipsizes all of them. */
  if (column.semantic === 'money') {
    return (
      <MonoText data-part="cell-money" className="truncate font-semibold">
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
      <Check data-part="cell-bool-true" className="size-4 text-pos" aria-label={t('ui:widgets.tables.trueLabel', 'true')} role="img" />
    ) : (
      <X data-part="cell-bool-false" className="size-4 text-fg-subtle" aria-label={t('ui:widgets.tables.falseLabel', 'false')} role="img" />
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
      <span data-part="cell-timestamp" title={formatAbsoluteTime(value, context.locale)} className="truncate whitespace-nowrap text-fg-muted">
        {formatRelativeTime(value, { locale: context.locale })}
      </span>
    );
  }

  if (column.logicalType === 'date') {
    // Calendar day, never the raw wire instant — pg DATE arrives as the
    // writer's local midnight in UTC, the wrong day for any viewer ahead of
    // the writer (dateOnlyValue in column-spec.ts holds the decode contract).
    return (
      <span data-part="cell-date" title={dateOnlyValue(value)} className="truncate whitespace-nowrap">
        {formatCalendarDate(value, context.locale)}
      </span>
    );
  }

  if (column.semantic === 'email') {
    return <MonoText data-part="cell-email" className="truncate">{String(value)}</MonoText>;
  }
  // A `file` block, and a value this page's resolve call recognised.
  // Everything else about this column keeps rendering exactly as it did — an
  // unresolved value falls through to the link branch below, which is what a
  // foreign URL in a file column should look like.
  if (column.file !== undefined && value !== null && value !== undefined && String(value).trim() !== '') {
    if (column.file.multiple === true) {
      /*
       * A LIST column: the first file's chip, plus a count of the
       * rest. A row is one line high, so showing every chip would either wrap
       * the row or truncate to the same thing this says explicitly.
       *
       * Falls through to the link branch when NOTHING in the list resolved,
       * which is the same rule the single-value branch follows: a column full
       * of foreign links renders as it did before the block existed.
       */
      const refs = parseRefList(value);
      const resolvedRefs = refs
        .map((ref) => context.files?.get(ref))
        .filter((file): file is ResolvedFile => file !== undefined && file !== null);
      const first = resolvedRefs[0];
      if (first !== undefined) {
        return (
          <span data-part="cell-file-list" className="inline-flex min-w-0 items-center gap-1.5">
            <FileCell column={column} file={first} context={context} />
            {refs.length > 1 ? (
              <span
                data-part="cell-file-more"
                className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-xs text-fg-muted"
                // The names of what the badge is counting, so the row does not
                // have to be opened to find out.
                title={resolvedRefs
                  .slice(1)
                  .map((file) => file.filename)
                  .join(', ')}
              >
                {`+${String(refs.length - 1)}`}
              </span>
            ) : null}
          </span>
        );
      }
    } else {
      const resolved = context.files?.get(String(value));
      if (resolved !== undefined && resolved !== null) {
        return <FileCell column={column} file={resolved} context={context} />;
      }
    }
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
    return <MonoText data-part="cell-percent" className="truncate">{Number.isFinite(amount) ? `${String(amount)}%` : String(value)}</MonoText>;
  }

  if (column.logicalType === 'json') {
    return <MonoText className="truncate text-caption text-fg-muted">{JSON.stringify(value)}</MonoText>;
  }

  if (column.mono || column.semantic === 'pk-id' || column.semantic === 'external-id' || column.logicalType === 'uuid' || isPlainNumber(column)) {
    return <MonoText className="truncate">{String(value)}</MonoText>;
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
