// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The assistant's own shape in the thread: a 28 px accent avatar and a white
 * card beside it, with the corner nearest the avatar squared off.
 *
 * Shared by the greeting, the question back and the working card, because
 * they are the same object saying different things — and a reader who had to
 * learn three shapes for one speaker would be learning nothing.
 *
 * `bare` drops the card for the result, which brings its own (the avatar
 * column stays, so the card lines up under the ones above it).
 */
import { cn } from '@adminium/ui';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

export interface AssistantBubbleProps {
  children: ReactNode;
  /** Render only the avatar column and the child, with no card around it. */
  bare?: boolean;
  /** Keep the column but draw no avatar — for a card that continues the one above. */
  spacer?: boolean;
  className?: string;
  /** A handle for the e2e and axe specs, which cannot select on Arabic text. */
  testId?: string;
}

export function AssistantBubble({ children, bare, spacer, className, testId }: AssistantBubbleProps) {
  return (
    <div data-testid={testId} className={cn('flex items-start gap-[11px]', className)}>
      {spacer === true ? (
        <div className="w-7 shrink-0" />
      ) : (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-accent text-accent-fg">
          <Sparkles className="size-3.5" aria-hidden="true" />
        </div>
      )}
      {bare === true ? (
        children
      ) : (
        <div className="min-w-0 flex-1 rounded-lg rounded-ss-[5px] border border-border bg-surface px-4 py-3.5 shadow-card">
          {children}
        </div>
      )}
    </div>
  );
}
