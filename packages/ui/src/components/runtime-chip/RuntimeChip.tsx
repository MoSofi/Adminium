// SPDX-License-Identifier: AGPL-3.0-only
import { Database, HardDrive, Unplug, Wifi, type LucideIcon } from 'lucide-react';

import { cn } from '../../lib/cn.js';
import { badgeVariants } from '../badge/Badge.js';
import type { Tone } from '../badge/Badge.js';

/**
 * The four states of the desktop runtime chip (11-electron.md §8.1), verbatim
 * from that table's rows:
 *
 *   | State                                    | Chip                        | Tone        |
 *   | Local DBs only, no sharing               | `Local` (hard-drive icon)   | muted       |
 *   | LAN share active                         | `Local · Sharing on LAN`    | accent-soft |
 *   | Connected to a remote source DB, net up  | `Local + remote DB`         | muted       |
 *   | Remote source DB unreachable             | `Remote DB offline`         | warn        |
 *
 * They are an ENUM rather than a bag of booleans because the chip shows exactly
 * one, and the precedence between them is a product decision that belongs in one
 * place — see the dashboard's `runtimeChipState()`, which owns it. A component
 * that took `{ lanShare, hasRemoteDb, remoteDbDown }` would re-litigate that
 * precedence inside every render, in a package with no way to test the answer.
 */
export type RuntimeChipState = 'local' | 'lan-share' | 'remote-db' | 'remote-db-offline';

interface StateStyle {
  icon: LucideIcon;
  tone: Tone;
}

/**
 * §8.1's tone column, mapped onto the shared `Tone` vocabulary (03 §3.3):
 * "muted" is `neutral` (surface-3 + fg-muted), "accent-soft" is `accent`
 * (accent-soft + accent), "warn" is `warn`. No new tints — the whole point of
 * the vocabulary is that a chip cannot invent a colour.
 *
 * ICONS: `hard-drive` for `local` is specified. The rest follow
 * `System States.dc.html`, whose "Database unreachable" state is a
 * `database` glyph, and whose disconnected idiom is a slashed/broken plug —
 * hence `Unplug` for the warn state, so the two remote states differ by more
 * than colour at 11px. (They also differ by label, which is what keeps this
 * clear of WCAG 1.4.1; the icon is belt and braces.)
 */
const STATE_STYLES: Readonly<Record<RuntimeChipState, StateStyle>> = Object.freeze({
  local: { icon: HardDrive, tone: 'neutral' },
  'lan-share': { icon: Wifi, tone: 'accent' },
  'remote-db': { icon: Database, tone: 'neutral' },
  'remote-db-offline': { icon: Unplug, tone: 'warn' },
});

export interface RuntimeChipProps {
  state: RuntimeChipState;
  /**
   * The chip's text — ALREADY LOCALIZED. This package carries no `t()`: every
   * component here takes its copy as props (see `StatusPill`), which is what
   * lets `@adminium/ui` stay free of an i18n dependency and lets Storybook
   * render it without booting one.
   */
  label: string;
  /**
   * §8.1: "accent-soft; click → LAN panel". Supplying this renders a real
   * `<button>` — not a `<span>` with a click handler — so the chip is reachable
   * by keyboard and announced as actionable. Omit it and the chip is inert
   * presentation, which is the honest rendering of the three states that have
   * nowhere to go.
   */
  onClick?: (() => void) | undefined;
  /**
   * Longer copy for the hover/AT description — e.g. which connection is down.
   * Rendered as `title` + `aria-description` rather than a Tooltip so the chip
   * stays a leaf this package can render without a TooltipProvider; the topbar
   * wraps it in one where richer copy is wanted.
   */
  description?: string | undefined;
  className?: string | undefined;
}

/**
 * The desktop runtime chip: what this Adminium is, and whether its data is
 * where you think it is (11-electron.md §8.1). Sits in the topbar next to the
 * environment area, desktop only.
 *
 * Fed by `GET /api/v1/system/info` + a connection-health poll — never by the
 * preload bridge (§8.1 is explicit, and §4 explains why: the server is the
 * authority for feature gating, the bridge only for native affordances).
 */
export function RuntimeChip({ state, label, onClick, description, className }: RuntimeChipProps) {
  const { icon: Icon, tone } = STATE_STYLES[state];
  const content = (
    <>
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      {label}
    </>
  );
  const shared = {
    'data-part': 'runtime-chip',
    'data-state': state,
    ...(description === undefined ? {} : { title: description }),
  };

  if (onClick === undefined) {
    return (
      <span {...shared} className={cn(badgeVariants({ tone }), className)}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      {...shared}
      onClick={onClick}
      className={cn(
        badgeVariants({ tone }),
        'cursor-pointer transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
    >
      {content}
    </button>
  );
}
