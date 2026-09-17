// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The UI kit's layout pieces: `Page`, `Card`, `Stack` and `Grid`. Thin on
 * purpose: the design system's own components with the few props a project
 * page needs, so a kit change never follows an internal one by accident.
 */

import type { ReactNode } from 'react';
import { Card as UiCard, CardBody, CardHeader, cn } from '@adminium/ui';
import type { CardProps, GridProps, PageProps, Space, StackProps } from '@adminium/server/ui';

import { PageActions } from '../../shell/PageActionsProvider.js';

const GAP: Record<Space, string> = {
  none: 'gap-0',
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
  xl: 'gap-8',
};

const ALIGN = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
} as const;

const JUSTIFY = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const;

const COLUMNS = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
  6: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
} as const;

/** The page body. Its title, description and actions go to the top bar. */
export function Page({ title, description, actions, children }: PageProps): ReactNode {
  return (
    <div className="flex flex-col gap-6" data-testid="project-page-body">
      <PageActions
        {...(title === undefined ? {} : { title })}
        {...(description === undefined ? {} : { subtitle: description })}
      >
        {actions}
      </PageActions>
      {children}
    </div>
  );
}

export function Card({ title, description, actions, padded = true, children }: CardProps): ReactNode {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;
  return (
    <UiCard padded={false}>
      {hasHeader ? (
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title === undefined ? null : <h2 className="text-card-title text-fg">{title}</h2>}
            {description === undefined ? null : <p className="text-body-sm text-fg-muted">{description}</p>}
          </div>
          {actions === undefined ? null : <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </CardHeader>
      ) : null}
      {padded ? <CardBody>{children}</CardBody> : children}
    </UiCard>
  );
}

export function Stack({
  direction = 'column',
  gap = 'md',
  align,
  justify,
  wrap = false,
  children,
}: StackProps): ReactNode {
  return (
    <div
      className={cn(
        'flex min-w-0',
        direction === 'row' ? 'flex-row' : 'flex-col',
        GAP[gap],
        align === undefined ? null : ALIGN[align],
        justify === undefined ? null : JUSTIFY[justify],
        wrap ? 'flex-wrap' : null,
      )}
    >
      {children}
    </div>
  );
}

export function Grid({ columns = 2, gap = 'md', children }: GridProps): ReactNode {
  return <div className={cn('grid min-w-0', COLUMNS[columns], GAP[gap])}>{children}</div>;
}
