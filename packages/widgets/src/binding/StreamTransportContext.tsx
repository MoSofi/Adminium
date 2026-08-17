// SPDX-License-Identifier: AGPL-3.0-only
/**
 * React context carrying the app's realtime {@link StreamTransport} (04 §5.3).
 * The host app (`apps/dashboard`) constructs the concrete WS/SSE transport once
 * and provides it here; `useWidgetStream` reads it for bound stream widgets.
 * Absent a provider, bound widgets stay disconnected (demo/unbound widgets
 * build their own deterministic transport and never touch this context).
 */

import { createContext, useContext, type ReactNode } from 'react';

import type { StreamTransport } from './stream-types.js';

const StreamTransportContext = createContext<StreamTransport | null>(null);

export interface StreamTransportProviderProps {
  transport: StreamTransport | null;
  children: ReactNode;
}

/** Provide the realtime stream transport to descendant stream widgets. */
export function StreamTransportProvider({ transport, children }: StreamTransportProviderProps) {
  return <StreamTransportContext.Provider value={transport}>{children}</StreamTransportContext.Provider>;
}

/** The provided transport, or `null` when no provider is mounted. */
export function useStreamTransport(): StreamTransport | null {
  return useContext(StreamTransportContext);
}
