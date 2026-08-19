// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Publish the WidgetFrame heading's id so descendants can point at it.
 *
 * Exists so a scrollable region inside a widget can be named by the words
 * already on screen — the card's own `<h3>` — instead of an invented string.
 * Naming a region "Connection diagnostics" while the visible heading says
 * "Connection check" gives screen-reader users a second vocabulary for the same
 * thing, and costs a new key in eight locales for the privilege.
 *
 * `null` outside a frame (frameless mode, `hasHeader: false`, bare stories), in
 * which case the consumer falls back to its own label.
 */
import { createContext, useContext, type ReactNode } from 'react';

const WidgetHeadingContext = createContext<string | null>(null);

export function WidgetHeadingProvider({
  id,
  children,
}: {
  id: string | null;
  children: ReactNode;
}) {
  return <WidgetHeadingContext.Provider value={id}>{children}</WidgetHeadingContext.Provider>;
}

/** The frame heading's id, or `null` when there is no titled frame above. */
export function useWidgetHeadingId(): string | null {
  return useContext(WidgetHeadingContext);
}
