// SPDX-License-Identifier: AGPL-3.0-only
import { Braces, Database, Hash, LayoutDashboard, Table2, Tag as TagIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The `chip-cloud` icon vocabulary (annex §3: "string array (+ optional icon per
 * chip)"). Separated from `tables-tail-lib.ts` so that module stays JSX-free and
 * the registry-metadata graph (`tables-tail-config.ts`) never pulls
 * `lucide-react` into the eager chunk (04 §2.3; the `media/media-icons`
 * convention).
 *
 * The map is CLOSED on purpose: a chip's `icon` is data (a discovered table
 * name's kind, a merge variable's type), and data must never be able to name an
 * arbitrary icon — an unknown key falls back to the hash glyph rather than
 * reaching into the icon package.
 */

const CHIP_ICONS: Record<string, ReactNode> = {
  table: <Table2 />,
  database: <Database />,
  entity: <TagIcon />,
  variable: <Braces />,
  dashboard: <LayoutDashboard />,
  default: <Hash />,
};

/** Glyph for an untrusted chip icon key; unknown keys get the default glyph. */
export function chipIcon(key: string | undefined): ReactNode {
  if (key === undefined) return CHIP_ICONS.default;
  return CHIP_ICONS[key] ?? CHIP_ICONS.default;
}

/** Whether a chip icon key is in the closed vocabulary (used by the tests). */
export function isKnownChipIcon(key: string): boolean {
  return key !== 'default' && Object.hasOwn(CHIP_ICONS, key);
}
