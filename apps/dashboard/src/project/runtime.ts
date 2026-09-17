// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Publishing the dashboard's React, and the project UI kit, on the host
 * runtime global (`@adminium/add-on-contracts/runtime`), before any project
 * bundle is imported (49-developer-projects.md §6.1).
 *
 * A project bundle's `react`, `react/jsx-runtime`, `react-dom` and
 * `@adminiumjs/adminium/ui` imports were replaced at build time by shims that
 * read this global, so the page renders with this app's one React and its own
 * components.
 *
 * The kit is imported here, lazily: it pulls in the grid, the form controls
 * and the data hooks, and the entry chunk is on a ratchet
 * (`scripts/check-entry-budget.mjs`). Only a server with project code ever
 * gets this far.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { installAddOnRuntime } from '@adminium/add-on-contracts/runtime';

let installing: Promise<void> | null = null;

export function ensureProjectRuntime(): Promise<void> {
  installing ??= import('./kit/index.js').then(
    ({ projectUiKit }) => {
      installAddOnRuntime({
        react: React as unknown as Readonly<Record<string, unknown>>,
        jsx: { jsx, jsxs, Fragment },
        reactDom: ReactDOM as unknown as Readonly<Record<string, unknown>>,
        ui: projectUiKit as unknown as Readonly<Record<string, unknown>>,
      });
    },
    (error: unknown) => {
      // A failed chunk must not stay failed: the next load tries again.
      installing = null;
      throw error;
    },
  );
  return installing;
}

/** Test seam. */
export function resetProjectRuntime(): void {
  installing = null;
}
