// SPDX-License-Identifier: AGPL-3.0-only
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleAlert,
  Clock,
  Compass,
  Database,
  FileQuestion,
  Inbox,
  Loader2,
  Lock,
  Plug,
  Search,
  ServerCrash,
  Settings,
  ShieldAlert,
  Wifi,
  WifiOff,
  Wrench,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { STATE_HERO_VIEWS } from './system-lib.js';
import type { StateHeroViewId } from './system-lib.js';

/**
 * The `system` family's CLOSED glyph vocabulary (annex §12). Separated from
 * `system-lib.ts` so that module stays JSX-free and the registry-metadata graph
 * (`system-config.ts`) never pulls `lucide-react` into the eager chunk
 * (04 §2.3; the `media/media-icons` + `feeds/feed-icons` convention).
 *
 * WHY A CLOSED MAP: config carries an icon NAME (a string that survives JSON
 * round-trips into the page manifest), never a component. Resolving it through a
 * fixed map means a stored config — or a payload — can never make a widget
 * render an arbitrary icon, and the family's lucide imports stay statically
 * analysable for tree-shaking.
 */

const SYSTEM_ICONS: Record<string, ReactNode> = {
  alert: <CircleAlert />,
  ban: <Ban />,
  check: <CheckCircle2 />,
  clock: <Clock />,
  compass: <Compass />,
  database: <Database />,
  inbox: <Inbox />,
  lock: <Lock />,
  plug: <Plug />,
  search: <Search />,
  settings: <Settings />,
  shield: <ShieldAlert />,
  spinner: <Loader2 />,
  'server-crash': <ServerCrash />,
  warning: <AlertTriangle />,
  wifi: <Wifi />,
  'wifi-off': <WifiOff />,
  wrench: <Wrench />,
  question: <FileQuestion />,
};

/** Resolve a config icon name to a glyph; unknown/absent names render nothing. */
export function systemIcon(name: string | undefined): ReactNode | undefined {
  if (name === undefined) return undefined;
  return SYSTEM_ICONS[name];
}

/** The built-in `state-hero` glyph per view id (annex §12 `stateMap` defaults). */
const STATE_HERO_ICON: Record<StateHeroViewId, ReactNode> = {
  '404': <Compass />,
  '500': <ServerCrash />,
  offline: <WifiOff />,
  forbidden: <Lock />,
  maintenance: <Wrench />,
  'conn-error': <Database />,
};

export function stateHeroIcon(view: StateHeroViewId): ReactNode {
  return STATE_HERO_ICON[view];
}

/** Every id the closed vocabulary accepts — used by the family's tests. */
export const SYSTEM_ICON_NAMES: readonly string[] = Object.keys(SYSTEM_ICONS);

export { STATE_HERO_VIEWS };
