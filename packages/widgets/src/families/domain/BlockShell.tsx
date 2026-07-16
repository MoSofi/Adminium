import { EmptyState } from '@adminium/ui';
import type { ReactNode } from 'react';

/**
 * TRACK BUILDER — presentational primitives shared by the 22 `block-*` document
 * blocks (annex §13). Not registry widgets themselves: they are the paper-surface
 * vocabulary (a section wrapper, the money row, the empty card) the blocks are
 * assembled from, kept here so 22 blocks agree on their spacing, type scale and
 * empty copy instead of drifting apart.
 *
 * PAPER SURFACE: blocks render inside `document-canvas`'s paper pane, so they
 * carry no card chrome of their own — `WidgetFrame` supplies it when a block is
 * placed standalone on a grid, and the canvas supplies the section outline when
 * it is composed. That is why these primitives are transparent by default.
 */

/** Every block's empty card — one shape, per-widget copy (04 §4). */
export function BlockEmpty({ title, body }: { title?: string | undefined; body?: string | undefined }) {
  return <EmptyState compact preset="no-data" title={title ?? 'Nothing to show'} body={body} />;
}

/**
 * A labelled block section. `label` is already-translated copy from config (04
 * §2 — widgets are locale-agnostic).
 */
export function BlockSection({
  label,
  testId,
  block,
  children,
}: {
  label?: string | undefined;
  testId?: string | undefined;
  block: string;
  children: ReactNode;
}) {
  return (
    <section data-widget={block} data-testid={testId} className="w-full">
      {label !== undefined && (
        <h3 className="mb-2 text-micro uppercase text-fg-subtle">{label}</h3>
      )}
      {children}
    </section>
  );
}

/**
 * One money line: label at the inline start, mono figure at the inline end.
 *
 * RTL: the row is a flex with `justify-between`, and the figure is `text-end` —
 * both logical, so the whole row mirrors under `dir="rtl"` with no physical
 * direction utility anywhere (the repo bans `ml-`/`pr-`/`left-`/`right-`).
 */
export function MoneyRow({
  label,
  value,
  tone = 'default',
  emphasis = false,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'default' | 'pos' | 'accent' | 'muted';
  emphasis?: boolean;
  testId?: string | undefined;
}) {
  const valueTone =
    tone === 'pos'
      ? 'text-pos'
      : tone === 'accent'
        ? 'text-accent'
        : tone === 'muted'
          ? 'text-fg-subtle'
          : 'text-fg';
  return (
    <div
      data-part="money-row"
      data-testid={testId}
      className={`flex items-baseline justify-between gap-4 py-1.5 ${
        emphasis ? 'border-t border-border pt-2.5' : ''
      }`}
    >
      <span className={`text-body-sm ${emphasis ? 'font-bold text-fg' : 'text-fg-muted'}`}>{label}</span>
      <span
        className={`font-mono tabular-nums text-end ${valueTone} ${
          emphasis ? 'text-section font-bold' : 'text-body-sm'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** A callout box — the tinted banner shape behind loyalty/recurring/late-fees. */
export function BlockCallout({
  tone,
  icon,
  children,
  block,
  testId,
}: {
  tone: 'accent' | 'pos' | 'warn' | 'info' | 'muted';
  icon?: ReactNode;
  children: ReactNode;
  block: string;
  testId?: string | undefined;
}) {
  const skin =
    tone === 'pos'
      ? 'bg-pos-soft text-fg'
      : tone === 'warn'
        ? 'bg-warn-soft text-fg'
        : tone === 'info'
          ? 'bg-info-soft text-fg'
          : tone === 'accent'
            ? 'bg-accent-soft text-fg'
            : 'bg-surface-2 text-fg';
  const iconTone =
    tone === 'pos'
      ? 'text-pos'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'info'
          ? 'text-info'
          : tone === 'accent'
            ? 'text-accent'
            : 'text-fg-subtle';
  return (
    <div
      data-widget={block}
      data-testid={testId}
      className={`flex items-center gap-3 rounded-md px-3 py-2.5 ${skin}`}
    >
      {icon !== undefined && <span className={`shrink-0 ${iconTone}`}>{icon}</span>}
      <div className="min-w-0 flex-1 text-body-sm">{children}</div>
    </div>
  );
}

/**
 * Fill a `{placeholder}` template with already-translated values.
 *
 * The blocks' templated copy ("Recurring — {freq} · Next on {next} · {count}
 * cycles") arrives from config as ONE translated string with placeholders, so
 * translators control word order — the block must never concatenate fragments,
 * which is exactly what breaks in RTL and in languages that reorder clauses.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
