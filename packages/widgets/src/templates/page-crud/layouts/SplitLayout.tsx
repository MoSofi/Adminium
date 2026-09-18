// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SPLIT PANE — the comp's booking dialog (`designs/Create Dialogs.dc.html`
 * 318–360, 320–321).
 *
 * ─── It is a section boundary, not a pixel grid ────────────────────────────
 *
 * The comp is `grid-template-columns: 1.1fr 1fr` with a rule between two hard
 * coded halves. Here the FIRST section is the left pane and everything after it
 * is the right, so which fields go where is something the document says rather
 * than something the layout decides. A form with one section renders as one
 * pane and nothing is lost — which is what makes the preset safe to turn on for
 * a page whose sections nobody has arranged yet.
 *
 * ─── One column below `sm` ─────────────────────────────────────────────────
 *
 * Two panes of a 820px dialog do not fit a phone; they stack, left pane first,
 * and the rule becomes the border between them. A calendar squeezed into half
 * of 390px is a grid of 20px cells nobody can hit.
 */
import type { ReactNode } from 'react';

export interface SplitPane {
  id: string;
  label?: string | undefined;
  intro?: string | undefined;
  content: ReactNode;
}

export interface SplitLayoutProps {
  panes: readonly SplitPane[];
}

export function SplitLayout({ panes }: SplitLayoutProps) {
  const [left, ...rest] = panes;
  if (left === undefined) return null;
  return (
    <div
      className="grid min-w-0 grid-cols-1 sm:grid-cols-[1.1fr_1fr]"
      data-testid="form-split-layout"
    >
      <Pane pane={left} className="border-b border-border pb-5 sm:border-b-0 sm:border-e sm:pb-0 sm:pe-5" />
      {rest.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-4 pt-5 sm:ps-5 sm:pt-0">
          {rest.map((pane) => (
            <Pane key={pane.id} pane={pane} />
          ))}
        </div>
      )}
    </div>
  );
}

function Pane({ pane, className }: { pane: SplitPane; className?: string | undefined }) {
  return (
    <section className={className === undefined ? 'flex min-w-0 flex-col gap-3' : `flex min-w-0 flex-col gap-3 ${className}`}>
      {pane.label === undefined ? null : (
        <h3 className="text-[11px] font-bold uppercase tracking-[0.05em] text-fg-subtle">{pane.label}</h3>
      )}
      {pane.intro === undefined ? null : <p className="text-body-sm text-fg-muted">{pane.intro}</p>}
      {pane.content}
    </section>
  );
}
