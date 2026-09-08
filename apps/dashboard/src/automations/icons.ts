// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The automation surfaces' private icon vocabulary, resolved through a LOCAL
 * map of static imports (the rule `gen-icon-core.mjs` documents, and the
 * email and invoice surfaces' own `icons.ts`).
 *
 * Roughly forty glyphs ride this feature: five node kinds, six picker
 * actions, four logic tiles, seven run statuses, five trace tones, the two
 * KPI strips and the flow header's controls. Every route here is behind
 * `React.lazy`, so resolving those names through `lucideByName` would either
 * pull them into the ENTRY chunk's core set — paid by every user on every
 * cold boot, for a page most of them never open — or fetch lucide's whole
 * 133 KiB catalogue the first time somebody opens a rule. This map keeps the
 * modules inside the automations chunks, and the file list under
 * SWEEP_IGNORE is what tells the generator these `icon:` literals are
 * already accounted for.
 */
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Check,
  ChevronDown,
  CircleCheckBig,
  CircleStop,
  CircleX,
  Clock,
  Copy,
  Filter,
  GitBranch,
  Hash,
  History,
  Hourglass,
  Loader,
  Mail,
  Minus,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  SquarePlus,
  Timer,
  Trash2,
  TrendingDown,
  TrendingUp,
  Webhook,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { lucideByName } from '../lib/lucide.js';

export const AUTOMATION_ICONS: Readonly<Record<string, LucideIcon>> = {
  // node kinds + the per-action glyphs (model/vocabulary.ts)
  zap: Zap,
  filter: Filter,
  'git-branch': GitBranch,
  timer: Timer,
  'circle-stop': CircleStop,
  mail: Mail,
  bell: Bell,
  'square-plus': SquarePlus,
  pencil: Pencil,
  webhook: Webhook,
  hash: Hash,
  // the two KPI strips (comp 199-200; Workflow Logs 189-195)
  workflow: Workflow,
  'circle-check-big': CircleCheckBig,
  'circle-x': CircleX,
  clock: Clock,
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  // run + trace statuses (D9)
  loader: Loader,
  hourglass: Hourglass,
  minus: Minus,
  check: Check,
  x: X,
  // the controls
  plus: Plus,
  play: Play,
  'refresh-cw': RefreshCw,
  copy: Copy,
  'trash-2': Trash2,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  'chevron-down': ChevronDown,
  history: History,
};

/** A name outside the map still resolves through the lazy catalogue. */
export function automationIcon(name: string): LucideIcon {
  return AUTOMATION_ICONS[name] ?? lucideByName(name);
}
