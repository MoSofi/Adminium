// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/MonoText.js';

export interface KeyValueRowProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Muted label ("Region"). */
  label: ReactNode;
  /** Value content ("eu-west-1"). */
  children?: ReactNode;
  /** Render the value in JetBrains Mono (ids, hosts, amounts). */
  mono?: boolean | undefined;
}

/** One divider row: muted label at the start, emphasized value at the end. */
export function KeyValueRow({ label, mono = false, className, children, ...props }: KeyValueRowProps) {
  return (
    <div
      data-part="key-value-row"
      className={cn('flex items-center justify-between gap-4 px-4 py-2.5', className)}
      {...props}
    >
      <span className="shrink-0 text-body-sm text-fg-muted">{label}</span>
      <span className="min-w-0 truncate text-end text-body-sm font-semibold text-fg">
        {mono ? <MonoText>{children}</MonoText> : children}
      </span>
    </div>
  );
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean | undefined;
}

export interface KeyValueListProps extends ComponentPropsWithRef<'div'> {
  /** Data-driven rows; alternatively compose `KeyValueRow` children. */
  items?: readonly KeyValueItem[] | undefined;
}

/**
 * KeyValueList — bordered rounded container with hairline-divided label/value
 * rows; the review/summary list used in wizard confirm steps, detail panes
 * and billing summaries (research/design-system.md §3 Tier 3).
 */
export function KeyValueList({ items, className, children, ...props }: KeyValueListProps) {
  return (
    <div
      className={cn('divide-y divide-border rounded-lg border border-border bg-surface', className)}
      {...props}
    >
      {items?.map((item, index) => (
        <KeyValueRow key={index} label={item.label} mono={item.mono}>
          {item.value}
        </KeyValueRow>
      ))}
      {children}
    </div>
  );
}
