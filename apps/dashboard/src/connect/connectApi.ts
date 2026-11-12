// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The calls behind "Connect Supabase" (server: `routes/connect/`). None of
 * them carries a connection string; the password one carries the password
 * typed for an existing project, to this instance only.
 */
import { api } from '../app/api.js';
import type { SystemInfo } from '../app/capabilities.js';
import type { ConnectReturn } from './connectReturn.js';

export type ConnectProviderId = 'supabase';

export interface ConnectedConnection {
  id: string;
  name: string;
  engine: 'postgres';
  readOnly: boolean;
  introspected: boolean;
}

export type ConnectResult =
  | { status: 'connected'; connection: ConnectedConnection }
  | { status: 'needs-password'; pendingId: string; project: string | null };

/** Whether this instance offers `provider` (the operator set its connect address). Hidden until the answer arrives. */
export function offersProvider(info: Pick<SystemInfo, 'connect'> | undefined, provider: ConnectProviderId): boolean {
  return info?.connect?.some((entry) => entry.provider === provider) === true;
}

export const connectApi = {
  /** A new hand-off: the operator's page to send the browser to. */
  start: async (provider: ConnectProviderId): Promise<string> => (await api.post<{ redirectUrl: string }>('/api/v1/connect/start', { provider })).redirectUrl,
  /** The browser is back: redeem its code. */
  finish: (back: ConnectReturn): Promise<ConnectResult> => api.post<ConnectResult>('/api/v1/connect/return', back),
  /** An existing project's password, typed here. */
  complete: (pendingId: string, password: string): Promise<ConnectResult> => api.post<ConnectResult>('/api/v1/connect/complete', { pendingId, password }),
};

/** Send the browser to the operator. A seam, so tests can watch it instead of leaving the page. */
export const leaveFor = {
  go: (url: string): void => {
    window.location.assign(url);
  },
};
