// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A group's heading. The gallery draws it above its grid (comp
 * 233-239): a 26 px accent-soft icon tile, the label, the sub-line and a
 * hairline that takes the rest of the width. The list draws it as a dense row
 * INSIDE the table (comp 290-294): the glyph in accent with no tile, on a
 * surface-2 band.
 */
import { invoiceIcon } from '../icons.js';

export interface GroupHeaderProps {
  /** A name for `invoiceIcon`: the topic's glyph, or `languages`. */
  glyph: string;
  label: string;
  sub: string;
}

export function GroupHeader({ glyph, label, sub }: GroupHeaderProps) {
  const Glyph = invoiceIcon(glyph);
  return (
    <div data-testid="invoices-group-header" className="mb-[13px] flex items-center gap-2.5">
      <div className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Glyph className="size-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <h2 className="truncate text-[13.5px] font-extrabold tracking-[-.01em] text-fg">{label}</h2>
        <div data-testid="invoices-group-sub" className="text-[11px] text-fg-subtle">
          {sub}
        </div>
      </div>
      <div className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

/** The list's band between two runs of rows (comp 290-294); one cell spanning the table. */
export function ListGroupRow({ glyph, label, sub }: GroupHeaderProps) {
  const Glyph = invoiceIcon(glyph);
  return (
    <div role="row" data-testid="invoices-group-header" className="border-b border-border bg-surface-2">
      <div role="cell" aria-colspan={4} className="flex items-center gap-[9px] px-[18px] py-[9px]">
        <Glyph className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
        <h2 className="text-[12px] font-extrabold text-fg">{label}</h2>
        <span data-testid="invoices-group-sub" className="text-[11px] text-fg-subtle">
          {sub}
        </span>
      </div>
    </div>
  );
}
