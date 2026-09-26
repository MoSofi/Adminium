// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an add-on card and an app card share about a catalogue row: its tile,
 * and when it last changed.
 *
 * THE TILE draws the catalogue's own icon when the row has one — an app's
 * icon as SVG path data (Lucide-style strokes), an add-on's two-letter
 * monogram — inside the token `IconTile` the rest of Studio uses. The site's
 * tint is not applied: 02-design-system forbids raw hex, so the tile keeps its
 * token tone and only the drawing is the app's. A row only the disk knows
 * (a bundled or uploaded package) has neither, and keeps the generic glyph.
 */
import { IconTile } from '@adminium/ui';
import type { ReactNode } from 'react';

import { getI18nInstance } from '../i18n/t.js';

export function CatalogTile({
  iconPaths,
  monogram,
  fallback,
}: {
  iconPaths?: string[] | null | undefined;
  monogram?: string | null | undefined;
  fallback: ReactNode;
}) {
  if (iconPaths !== undefined && iconPaths !== null && iconPaths.length > 0) {
    return (
      <IconTile>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
          aria-hidden
        >
          {iconPaths.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </IconTile>
    );
  }
  if (monogram !== undefined && monogram !== null && monogram !== '') {
    return (
      <IconTile>
        <span className="text-caption font-bold" aria-hidden>
          {monogram}
        </span>
      </IconTile>
    );
  }
  return <IconTile>{fallback}</IconTile>;
}

/** "20 Sept 2026", in the reader's language, or null when the row has no date. */
export function catalogDate(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  // The day the site recorded, in UTC: the same day it shows on its own pages.
  return new Intl.DateTimeFormat(getI18nInstance()?.language ?? 'en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(at);
}

/** An add-on key as a person reads it, for a line that names one: `add-on-invoices` → "Invoices". */
export function addOnNameOf(key: string): string {
  const bare = key.replace(/^add-on-/, '').replace(/-/g, ' ');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}
