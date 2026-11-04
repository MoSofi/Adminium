// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether this address is an app's staff address, as its branding says —
 * asked by a sign-in that has just succeeded, before it decides where to go.
 *
 * The sign-in screen draws with whatever branding has arrived, and starts
 * neutral until it does. A person quick enough (a saved password, a test) can
 * sign in before it arrives; read from the screen, the address would then
 * look like the dashboard's own, and the sign-in would push the dashboard's
 * shell over an address that belongs to the app. So the branding is waited
 * for here (already there, it costs nothing). One that cannot be read leaves
 * the answer as the screen had it.
 */
import type { QueryClient } from '@tanstack/react-query';

import { brandingQuery, type BrandingData } from '../app/branding.js';

export async function addressSurface(client: QueryClient, drawn: BrandingData['surface']): Promise<BrandingData['surface']> {
  try {
    return (await client.ensureQueryData(brandingQuery())).surface;
  } catch {
    return drawn;
  }
}
