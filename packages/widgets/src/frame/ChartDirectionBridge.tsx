// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bridges the resolved app direction into `@adminium/charts`'
 * `ChartDirectionContext` so every chart mirrors its chrome (categorical bar
 * order, legend/tooltip/axis side) under RTL while keeping time axes LTR
 * (10-i18n-theming.md §5.5). Charts default their context to `'ltr'`, so
 * without this bridge they never mirror even on an RTL page — the "RTL-aware"
 * claim would be claim-only at the app level.
 *
 * Direction comes from `useTheme().dir` — the same resolved value `ThemeProvider`
 * stamps on `<html>` and drives the Radix `DirectionProvider` from — so it stays
 * live across a locale switch and needs only a `<ThemeProvider>` ancestor (not
 * `<I18nProvider>`). Mount once, high in the app tree.
 */
import { useTheme } from '@adminium/ui';
import type { ReactNode } from 'react';

import { ChartDirectionContext } from '@adminium/charts';

export interface ChartDirectionBridgeProps {
  children: ReactNode;
}

export function ChartDirectionBridge({ children }: ChartDirectionBridgeProps) {
  const { dir } = useTheme();
  return <ChartDirectionContext.Provider value={dir}>{children}</ChartDirectionContext.Provider>;
}
