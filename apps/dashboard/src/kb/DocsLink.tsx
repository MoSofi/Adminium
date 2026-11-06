// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A screen's link to the docs page that explains it.
 *
 * Each call site passes `docsUrl(…)` a literal page and anchor, so the docs
 * contract test can read every one out of the source and check the page and
 * its heading exist.
 */
import { cn } from '@adminium/ui';
import type { ReactNode } from 'react';

export function DocsLink({ href, className, children }: { href: string; className?: string | undefined; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn('inline-flex items-center gap-1 text-body-sm font-bold text-accent hover:underline', className)}>
      {children}
    </a>
  );
}
