// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The line a screen shows while it is narrowed to one installed app (the
 * address's `app`, as an entry of the app's section opens it): what is shown,
 * and the way back to everything. The screen's own words are passed in, so
 * each keeps its catalogue.
 */
import { Button, cn } from '@adminium/ui';
import { Filter } from 'lucide-react';

export function AppFilterNote({ text, clear, onClear, className }: { text: string; clear: string; onClear?: (() => void) | undefined; className?: string }) {
  return (
    <div role="status" data-testid="app-filter-note" className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2 px-3.5 py-2 text-[13px] text-fg-muted', className)}>
      <Filter className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{text}</span>
      {onClear === undefined ? null : (
        <Button variant="ghost" size="sm" onClick={onClear} data-testid="app-filter-clear">
          {clear}
        </Button>
      )}
    </div>
  );
}
