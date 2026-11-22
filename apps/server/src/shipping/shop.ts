// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What one app install has for shipping: the carriers attached to it, which
 * one it uses, and where its parcels leave from.
 *
 * The carrier in use is the one chosen, for as long as it is attached. Switched
 * off, it stays the choice and a quote says so. Taken away, the shop has none
 * until its owner chooses again: labels are never moved to another carrier's
 * account by itself. With nothing ever chosen, a shop with exactly one carrier
 * uses it, and two attached is a question for the owner, not a sort order.
 */
import { SHIPPING_CARRIER_CONTRACT } from '@adminium/add-on-contracts';
import { addOnManifestSchema } from '@adminium/manifest';
import { shippingRepo, type InstalledManifest, type ManifestsRepo, type MetaDb } from '@adminium/meta';

import { installOnConnection } from '../installs/resolve.js';
import { readShipFrom, shipFromMissing, type ShipFrom } from './addresses.js';
import { carrierLocked } from './locks.js';

export interface AttachedCarrier {
  key: string;
  name: string;
  locked: boolean;
  /** Installed on this database, switched on, and on for this app. */
  on: boolean;
  /** A key is saved. Read without decrypting it, and never asked of a locked carrier. */
  connected: boolean;
}

export interface ShopShipping {
  carriers: AttachedCarrier[];
  activeCarrier: string | null;
  shipFrom: ShipFrom | null;
  shipFromMissing: string[];
}

type CarrierReads = Pick<ManifestsRepo, 'attachedToHost' | 'findInScope' | 'credentialStatus'>;

function providesCarrier(document: unknown): { name: string } | null {
  const parsed = addOnManifestSchema.safeParse(document);
  if (!parsed.success) return null;
  return (parsed.data.addOn.provides ?? []).some((entry) => entry.contract === SHIPPING_CARRIER_CONTRACT) ? { name: parsed.data.name } : null;
}

/** The delivery companies attached to this app install, in key order. */
export async function attachedCarriers(manifests: CarrierReads, app: InstalledManifest, connectionId: string): Promise<AttachedCarrier[]> {
  const out: AttachedCarrier[] = [];
  for (const addOn of await manifests.attachedToHost(app.row.manifestKey, app.row.id)) {
    const carrier = providesCarrier(addOn.document);
    if (carrier === null) continue;
    const key = addOn.row.manifestKey;
    const locked = carrierLocked(key);
    // The install this database would really use, so what is shown is what a quote would do.
    const here = await installOnConnection(manifests as ManifestsRepo, key, connectionId);
    const attachment = addOn.attachments.find((one) => one.attachedTo === app.row.manifestKey && one.hostInstall === app.row.id);
    const on = here !== null && here.row.status === 'installed' && attachment !== undefined && attachment.disabledAt === null;
    const connected = !locked && here !== null && (await manifests.credentialStatus(here.row.id)) !== null;
    out.push({ key, name: carrier.name, locked, on, connected });
  }
  return out;
}

export function chooseActive(stored: string | null, carriers: readonly AttachedCarrier[]): string | null {
  if (stored !== null) return carriers.some((carrier) => carrier.key === stored) ? stored : null;
  return carriers.length === 1 ? carriers[0]!.key : null;
}

export async function shopShipping(meta: MetaDb, manifests: CarrierReads, app: InstalledManifest, connectionId: string): Promise<ShopShipping> {
  const settings = await shippingRepo(meta).settings(app.row.id);
  const carriers = await attachedCarriers(manifests, app, connectionId);
  const shipFrom = readShipFrom(settings?.shipFrom ?? null);
  return { carriers, activeCarrier: chooseActive(settings?.activeCarrier ?? null, carriers), shipFrom, shipFromMissing: shipFromMissing(shipFrom) };
}
