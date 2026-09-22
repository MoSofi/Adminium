// SPDX-License-Identifier: AGPL-3.0-only
import type * as React from 'react';

import { cn } from '../../lib/cn.js';

/** The six public API methods, in the order every list shows them. */
export const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'BATCH'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Each method's tone, as the utilities a component composes. GET, POST, PATCH
 * and DELETE wear the semantic tones; PUT and BATCH have their own pair
 * (`--method-put`, `--method-batch`). Literal strings, so Tailwind emits them.
 *
 * `solid` is the tint pre-composited over `--surface` — a chip's contrast must
 * be a property of the chip, not of whatever it lands on (tokens.css, THE
 * OPAQUE CHIP TINTS). `dot` is the method's solid colour, for the explorer
 * rail's 6 px dots.
 */
export const METHOD_TONE: Readonly<Record<HttpMethod, { text: string; solid: string; border: string; dot: string }>> = {
  GET: { text: 'text-info', solid: 'bg-info-soft-solid', border: 'border-info', dot: 'bg-info' },
  POST: { text: 'text-pos', solid: 'bg-pos-soft-solid', border: 'border-pos', dot: 'bg-pos' },
  PATCH: { text: 'text-warn', solid: 'bg-warn-soft-solid', border: 'border-warn', dot: 'bg-warn' },
  PUT: { text: 'text-method-put', solid: 'bg-method-put-soft-solid', border: 'border-method-put', dot: 'bg-method-put' },
  DELETE: { text: 'text-danger', solid: 'bg-danger-soft-solid', border: 'border-danger', dot: 'bg-danger' },
  BATCH: {
    text: 'text-method-batch',
    solid: 'bg-method-batch-soft-solid',
    border: 'border-method-batch',
    dot: 'bg-method-batch',
  },
};

export interface MethodBadgeProps extends Omit<React.ComponentPropsWithRef<'span'>, 'style' | 'children'> {
  method: HttpMethod;
  /** `sm` 9.5 px, padding 2/5 (tables, pills); `md` 10 px, padding 3/7 (headings). */
  size?: 'sm' | 'md';
  /** 5 px on the keys page; the explorer draws 6 px. */
  radius?: 5 | 6;
}

/**
 * An HTTP method, as the API Keys and API explorer comps draw it:
 * JetBrains Mono, .04em tracking, the method's colour on its tint.
 *
 * Weight 600, not the comp's 700: the comp loads JetBrains Mono at 400–600
 * only, so its 700 RENDERS at 600, and 600 is what the comp shows.
 * Line-height `normal`, stated here because a badge is often
 * placed inside something that sets another.
 */
export function MethodBadge({ method, size = 'sm', radius = 5, className, ...props }: MethodBadgeProps) {
  const tone = METHOD_TONE[method];
  return (
    <span
      data-method={method}
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap font-mono font-semibold tracking-[.04em]',
        size === 'sm' ? 'px-[5px] py-[2px] text-[9.5px]' : 'px-[7px] py-[3px] text-[10px]',
        // AFTER the size: tailwind-merge drops a line-height that precedes a
        // font-size, since `text-*` may carry one of its own.
        'leading-[normal]',
        radius === 5 ? 'rounded-[5px]' : 'rounded-[6px]',
        tone.text,
        tone.solid,
        className,
      )}
      {...props}
    >
      {method}
    </span>
  );
}
