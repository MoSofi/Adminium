// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Host-drawn table cells.
 *
 * The cell chain in `cells.tsx` is closed on purpose: every treatment is a
 * branch with its own alignment and formatter. A host that wants to draw some
 * cells itself provides a renderer here, and every table below it asks that
 * renderer first. Two hosts use it: the dashboard, for a column whose spec
 * names a project widget (`widget: "project.flag-cell"`, 49 §6.3), and the
 * project UI kit's `DataTable`, for a column with a `render` function.
 *
 * A renderer returns `undefined` for the cells it leaves alone. Providers
 * nest: the inner one is asked first, then the outer one, so a kit table
 * inside a page still draws the page's project cells.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { GridColumnSpec, GridRow } from './column-spec.js';

export type CustomCellRenderer = (column: GridColumnSpec, row: GridRow) => ReactNode | undefined;

const CustomCellContext = createContext<CustomCellRenderer | null>(null);

export interface CustomCellProviderProps {
  render: CustomCellRenderer;
  children: ReactNode;
}

/** Pass a stable `render` (a memo): every cell below re-renders when it changes. */
export function CustomCellProvider({ render, children }: CustomCellProviderProps) {
  const outer = useContext(CustomCellContext);
  const value = useMemo<CustomCellRenderer>(
    () =>
      outer === null
        ? render
        : (column, row) => {
            const drawn = render(column, row);
            return drawn === undefined ? outer(column, row) : drawn;
          },
    [outer, render],
  );
  return <CustomCellContext.Provider value={value}>{children}</CustomCellContext.Provider>;
}

/** The renderer in force, or null when no host draws cells. */
export function useCustomCellRenderer(): CustomCellRenderer | null {
  return useContext(CustomCellContext);
}
