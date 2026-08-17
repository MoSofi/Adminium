// SPDX-License-Identifier: AGPL-3.0-only
import {
  AlertTriangle,
  Info,
  Lightbulb,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { ReactElement } from 'react';

import type { InsightIcon } from './kpi-lib.js';

/**
 * `kpi` family icon ELEMENTS (annex §1 `auto-insights`: sparkles glyph + the
 * per-insight tone icon). Split out of `kpi-lib.ts` because that module is the
 * PURE leaf the registry's eager metadata graph reaches through `kpi-config.ts`
 * — JSX here would drag lucide-react into the eager chunk (04 §2.3). Only the
 * component files import this.
 */

const INSIGHT_GLYPHS: Record<InsightIcon, () => ReactElement> = {
  sparkles: () => <Sparkles />,
  'trend-up': () => <TrendingUp />,
  'trend-down': () => <TrendingDown />,
  alert: () => <AlertTriangle />,
  info: () => <Info />,
  target: () => <Target />,
  zap: () => <Zap />,
  lightbulb: () => <Lightbulb />,
};

/** The glyph for a narrowed insight icon key (`insightIconOf` guarantees the key). */
export function insightIcon(icon: InsightIcon): ReactElement {
  return INSIGHT_GLYPHS[icon]();
}

/** The family's headline glyph — the auto-insights card header. */
export function sparklesIcon(): ReactElement {
  return <Sparkles />;
}
