// SPDX-License-Identifier: AGPL-3.0-only
import type * as React from 'react';

import { cn } from '../../lib/cn.js';
import { inputVariants } from '../input/index.js';

export interface TextareaProps
  extends Omit<React.ComponentPropsWithRef<'textarea'>, 'style'> {
  /** Danger border + focus ring + `aria-invalid`. */
  error?: boolean | undefined;
  /** JetBrains Mono text (JSON snippets, env values). */
  mono?: boolean | undefined;
  /**
   * Grow with content (CSS `field-sizing: content`; zero-JS — supported by
   * the Chromium engines Adminium targets, gracefully a fixed-height
   * textarea elsewhere). Combine with `min-h-*`/`max-h-*` classes to bound it.
   */
  autoResize?: boolean | undefined;
}

/**
 * Multi-line input with the exact `Input` chrome
 * (research/design-system.md §3 Tier 2).
 */
export function Textarea({ className, error = false, mono = false, autoResize = false, ...props }: TextareaProps) {
  return (
    <textarea
      {...(error ? { 'aria-invalid': true as const, 'data-invalid': '' } : {})}
      className={cn(
        inputVariants({ mono }),
        'h-auto min-h-[76px] py-2 leading-relaxed',
        autoResize ? 'field-sizing-content resize-none' : 'resize-y',
        className,
      )}
      {...props}
    />
  );
}
