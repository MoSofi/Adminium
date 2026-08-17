// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The capability grant table + device descriptors, as the dashboard reaches them
 * (11-electron.md §12). Two feeds, one per side of the process boundary — the
 * same split `desktop/lanShare.ts` makes and for the same reason:
 *
 *  - **The server** owns the grant table (`adminium_settings`, §1 principle 2),
 *    so consent, revoke, and the current grant list are REST calls here.
 *  - **The bridge** owns the device descriptors — status (`stub`/`available`) and
 *    method list — because only the main process holds the providers (§4's
 *    `capabilities.list()`). Off-desktop there is no bridge; `model.ts`'s
 *    `capabilityStatuses` turns that absence into §12's `unavailable`.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';
import { getDesktopApi } from '../../lib/desktop-runtime.js';
import type { CapabilityDescriptor } from './model.js';

/** One consented grant (`routes/desktop-capabilities/schema.ts`). */
export interface CapabilityGrant {
  manifestId: string;
  capabilityId: string;
  grantedAt: number;
}

/** The identity written by consent / removed by revoke. */
export interface CapabilityGrantRef {
  manifestId: string;
  capabilityId: string;
}

const GRANTS_PATH = '/api/v1/desktop/capability-grants';

export const CAPABILITY_GRANTS_QUERY_KEY = ['desktop', 'capability-grants'] as const;

export function capabilityGrantsQuery() {
  return queryOptions({
    queryKey: CAPABILITY_GRANTS_QUERY_KEY,
    queryFn: async (): Promise<CapabilityGrant[]> =>
      (await api.get<{ data: { grants: CapabilityGrant[] } }>(GRANTS_PATH)).data.grants,
    // Grants change only through this panel (consent/revoke), so no polling —
    // the mutations invalidate this key themselves.
    staleTime: Infinity,
    // Super-Admin + loopback only; a non-super-admin gets one 403 and no loop.
    retry: false,
  });
}

/** The consent step: authorize `ref.manifestId` to use `ref.capabilityId`. */
export async function grantCapability(ref: CapabilityGrantRef): Promise<CapabilityGrant> {
  return (await api.post<{ data: { grant: CapabilityGrant } }>(GRANTS_PATH, ref)).data.grant;
}

/** The revoke control. Idempotent — revoking an absent grant is not an error. */
export async function revokeCapability(ref: CapabilityGrantRef): Promise<boolean> {
  return (await api.delete<{ data: { removed: boolean } }>(GRANTS_PATH, ref)).data.removed;
}

/**
 * The device descriptors from §4's bridge, or `null` off-desktop (no bridge).
 * `model.ts`'s `capabilityStatuses` is what turns `null` into §12's `unavailable`.
 */
export async function readCapabilityDescriptors(): Promise<CapabilityDescriptor[] | null> {
  const desktop = getDesktopApi();
  if (desktop === null) return null;
  return desktop.capabilities.list();
}

export const CAPABILITY_DESCRIPTORS_QUERY_KEY = ['desktop', 'capability-descriptors'] as const;

export function capabilityDescriptorsQuery() {
  return queryOptions({
    queryKey: CAPABILITY_DESCRIPTORS_QUERY_KEY,
    queryFn: readCapabilityDescriptors,
    // The provider set is fixed for a boot — it cannot change without a relaunch.
    staleTime: Infinity,
    retry: false,
  });
}
