import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';

import { cn } from '../../lib/cn.js';
import { MonoText } from '../mono-text/MonoText.js';

export interface BreadcrumbItem {
  /** Segment text. */
  label: ReactNode;
  /** Link target; the last (current) item usually omits it. */
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  /** Render the segment in JetBrains Mono (record ids, table names). */
  mono?: boolean | undefined;
}

export interface BreadcrumbsProps extends Omit<ComponentPropsWithRef<'nav'>, 'children'> {
  items: readonly BreadcrumbItem[];
  /** Accessible name for the nav (required — i18n, e.g. "Breadcrumb"). */
  label: string;
}

/**
 * Breadcrumbs — links + chevron separators (RTL-mirrored), optional mono
 * segments, `nav > ol` semantics with `aria-current="page"` on the last item
 * (research/design-system.md §3 Tier 3).
 */
export function Breadcrumbs({ items, label, className, ...props }: BreadcrumbsProps) {
  return (
    <nav aria-label={label} className={cn('min-w-0', className)} {...props}>
      <ol className="flex min-w-0 items-center gap-1.5 text-body-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const content = item.mono ? <MonoText>{item.label}</MonoText> : item.label;
          return (
            <Fragment key={index}>
              <li className="min-w-0">
                {item.href !== undefined || item.onClick !== undefined ? (
                  <a
                    href={item.href}
                    onClick={
                      item.onClick === undefined
                        ? undefined
                        : (event) => {
                            if (item.href === undefined) event.preventDefault();
                            item.onClick?.();
                          }
                    }
                    aria-current={isLast ? 'page' : undefined}
                    className={cn(
                      'block max-w-[240px] truncate rounded-sm font-semibold transition-colors duration-100',
                      isLast ? 'text-fg' : 'text-fg-muted hover:text-fg',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    )}
                  >
                    {content}
                  </a>
                ) : (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={cn(
                      'block max-w-[240px] truncate font-semibold',
                      isLast ? 'text-fg' : 'text-fg-muted',
                    )}
                  >
                    {content}
                  </span>
                )}
              </li>
              {isLast ? null : (
                <li aria-hidden="true" className="shrink-0 text-fg-subtle">
                  <ChevronRight className="size-3.5 rtl:-scale-x-100" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
