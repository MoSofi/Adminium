import { Check, CircleAlert } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';

import { cn } from '../../lib/cn.js';
import { Spinner } from '../spinner/Spinner.js';

/**
 * The autosave phases. `dirty` is the annex's "Unsaved changes" pill
 * (research/widget-registry.md §12 `autosave-indicator`: warn dot "Unsaved
 * changes" → spinner "Saving…" → green check "All changes saved"), shown while
 * edits sit inside the host's debounce window. `idle` remains the no-edits-yet
 * phase and still renders nothing.
 */
export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface AutosaveIndicatorProps extends ComponentPropsWithRef<'div'> {
  status: AutosaveStatus;
  /** "Saving…" (required — i18n). */
  savingLabel: string;
  /** "All changes saved" (required — i18n). */
  savedLabel: string;
  /** "Unsaved changes" — required only if you ever pass `status="dirty"`. */
  dirtyLabel?: string | undefined;
  /** "Couldn't save" — required only if you ever pass `status="error"`. */
  errorLabel?: string | undefined;
}

/**
 * AutosaveIndicator — "Unsaved changes / Saving… / All changes saved" pill with
 * a fade transition between states, announced politely via `aria-live`
 * (research/design-system.md §3 Tier 3). `idle` renders an empty live region
 * (layout kept stable).
 */
export function AutosaveIndicator({
  status,
  savingLabel,
  savedLabel,
  dirtyLabel,
  errorLabel,
  className,
  ...props
}: AutosaveIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-status={status}
      className={cn('inline-flex h-6 items-center', className)}
      {...props}
    >
      {status === 'idle' ? null : (
        <span
          key={status}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-caption font-semibold',
            'animate-[nb-fade_.24s_cubic-bezier(.2,.7,.3,1)]',
            status === 'error' ? 'text-danger' : 'text-fg-muted',
          )}
        >
          {status === 'dirty' ? (
            <>
              {/* Warn dot rather than a glyph — the annex's "unsaved" affordance. */}
              <span data-part="autosave-dot" className="size-1.5 rounded-full bg-warn" aria-hidden="true" />
              {dirtyLabel}
            </>
          ) : status === 'saving' ? (
            <>
              <Spinner size="sm" className="size-3" />
              {savingLabel}
            </>
          ) : status === 'saved' ? (
            <>
              <Check className="size-3 text-pos" aria-hidden="true" />
              {savedLabel}
            </>
          ) : (
            <>
              <CircleAlert className="size-3" aria-hidden="true" />
              {errorLabel}
            </>
          )}
        </span>
      )}
    </div>
  );
}
