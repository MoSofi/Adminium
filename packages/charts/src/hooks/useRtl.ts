// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chart direction context (04-widget-registry.md §7.4). Wave B widget
 * wrappers bridge the i18n `dir` into this context (or pass `dir` straight to
 * a chart); inside the charts package the policy is applied per scale:
 * categorical x mirrors, time x never does (10-i18n-theming.md §5.5).
 */
import { createContext, useContext } from 'react';

export type ChartDir = 'ltr' | 'rtl';

export const ChartDirectionContext = createContext<ChartDir>('ltr');

/** Resolved direction: explicit prop wins, then the nearest provider ('ltr' default). */
export function useChartDir(override?: ChartDir): ChartDir {
  const inherited = useContext(ChartDirectionContext);
  return override ?? inherited;
}

/** Convenience boolean used by geometry callers. */
export function useRtl(override?: ChartDir): boolean {
  return useChartDir(override) === 'rtl';
}
