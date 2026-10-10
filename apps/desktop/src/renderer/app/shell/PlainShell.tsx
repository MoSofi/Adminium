// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The plain shell every screen before a project shares: the mark and the
 * name, then one centred column. No theme or language control (they follow the
 * app's saved choice).
 */
import { ArrowLeft, Hexagon } from 'lucide-react';
import type { ReactNode } from 'react';

export function PlainShell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <div className="flex shrink-0 items-center gap-2.5 px-7 py-[18px]">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-[8px] bg-accent text-accent-fg shadow-[0_2px_8px_color-mix(in_srgb,var(--accent)_40%,transparent)]"
        >
          <Hexagon className="size-4" />
        </span>
        <span className="text-[15px] font-extrabold tracking-[-0.02em]">Adminium</span>
      </div>
      {/* The screens measure themselves against this area, not the window: a narrow one stacks Start's cards. */}
      <main className="@container flex min-h-0 flex-1 justify-center overflow-auto px-7 pb-16 pt-5">
        <div className="flex w-full max-w-[640px] flex-col">{children}</div>
      </main>
    </div>
  );
}

/** "Back": the arrow follows the reading direction. */
export function BackLink({ label, onBack }: { label: string; onBack: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-7 inline-flex cursor-pointer items-center gap-1.5 self-start rounded-[9px] border-0 bg-transparent px-0.5 py-1 text-[13px] font-bold text-fg-muted hover:text-accent"
    >
      <span className="adm-mirror flex" aria-hidden="true">
        <ArrowLeft className="size-[15px]" />
      </span>
      {label}
    </button>
  );
}
