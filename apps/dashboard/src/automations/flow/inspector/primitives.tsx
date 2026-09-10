// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector's two shapes, in a leaf module: a labelled field, and the
 * Condition card's panel (`designs/Automation Rules.dc.html` 117-136).
 *
 * They live here rather than beside the inspector because every settings
 * card imports them AND the inspector imports every settings card — the two
 * would be a cycle, which `check-deps` refuses. A leaf both sides reach is
 * the fix, and it is the honest shape anyway: these are the inspector's
 * vocabulary, not its behaviour.
 */

import type { ReactNode } from 'react';

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  /**
   * Set it for a COMPOSITE control (`Combobox`), which a wrapping `<label>`
   * cannot name: the same id goes on the control, the way `FormField` wires
   * one. A plain `<input>`/`<select>` needs none — the wrapper names it.
   */
  htmlFor?: string | undefined;
  children: ReactNode;
}): ReactNode {
  if (htmlFor !== undefined) {
    return (
      <div className="block">
        <label htmlFor={htmlFor} className="mb-1.5 block text-[11.5px] font-bold">
          {label}
        </label>
        {children}
      </div>
    );
  }
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-bold">{label}</span>
      {children}
    </label>
  );
}

/** The Condition card's anatomy, reused by every settings card (comp 125-136). */
export function Card({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-2.5 rounded-[13px] border border-border bg-surface-2 p-3.5">
      <div className="text-[11.5px] font-bold">{title}</div>
      {children}
    </div>
  );
}
