// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Widgets from outside the registry.
 *
 * The registry (`registry/index.ts`) is a closed, typed map built once. A host
 * app that has widgets of its own, today the dashboard with a project's
 * `widgets/*.tsx` cards (`project.<name>`), provides a resolver here. Everything that looks a widget up by id asks the
 * registry first and this resolver second, so a registry id can never be
 * shadowed, and an id neither knows still renders the `widget-missing` card.
 * A resolved widget's `descriptionKey` is not read: its text is not in the
 * catalogue, so `WidgetHost` shows no info popover for it.
 *
 * Context rather than a registration call, for the reason
 * `WidgetRuntimeContext.tsx` gives: the set is a property of the running app,
 * and a module-level registry would make two suites in one process fight over
 * it.
 */

import { createContext, useContext, type ReactNode } from 'react';

import type { WidgetDefinition } from '../registry/types.js';

export type ExternalWidgetResolver = (widgetId: string) => WidgetDefinition | undefined;

const ExternalWidgetsContext = createContext<ExternalWidgetResolver | null>(null);

export interface ExternalWidgetsProviderProps {
  /** Pass a stable function (a memo): every widget below re-renders when it changes. */
  resolve: ExternalWidgetResolver;
  children: ReactNode;
}

export function ExternalWidgetsProvider({ resolve, children }: ExternalWidgetsProviderProps) {
  return <ExternalWidgetsContext.Provider value={resolve}>{children}</ExternalWidgetsContext.Provider>;
}

/** The host's resolver, or null when the host has no widgets of its own. */
export function useExternalWidgetResolver(): ExternalWidgetResolver | null {
  return useContext(ExternalWidgetsContext);
}
