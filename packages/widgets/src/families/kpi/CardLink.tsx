// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A metric card that leads somewhere: with an `href`, the whole card is one
 * button — named by its title and value, reachable by keyboard — that asks
 * the host to open the route (widgets never navigate themselves). Without
 * one, the card is exactly what it was.
 */

import type { ReactNode } from 'react';

import type { WidgetEvent } from '../../registry/types.js';

export function CardLink({
  href,
  name,
  onEvent,
  children,
}: {
  href: string | undefined;
  name: string;
  onEvent: (event: WidgetEvent) => void | Promise<unknown>;
  children: ReactNode;
}) {
  if (href === undefined || href === '') return <>{children}</>;
  return (
    <button
      type="button"
      aria-label={name}
      className="block h-full w-full rounded-[inherit] text-start hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      data-href={href}
      onClick={() => void onEvent({ type: 'drill-through', href })}
    >
      {children}
    </button>
  );
}
