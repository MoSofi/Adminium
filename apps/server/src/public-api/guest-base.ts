// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where an app's guest side lives, for a link Adminium puts in an email: the
 * app's own customer host when the operator mapped one, else the server's
 * public address with `/apps/<key>/customer`, else nowhere.
 *
 * ── NEVER THE REQUEST'S HOST ───────────────────────────────────────────────
 * A link in an email is only as trustworthy as the host it names. The Host
 * header of the request that asked for the email is the asker's to choose, so
 * a link built from it can point a sign-in at a look-alike page — the reset
 * link poisoning class. This reads only what the operator set: the mapped
 * domains and `system.publicOrigin`. With neither, there is no link to send,
 * and the caller says so to staff instead of guessing.
 */
import { settingsRepo, type MetaDb } from '@adminium/meta';

import type { DomainMapping } from '../surfaces/settings.js';

export interface GuestBaseDeps {
  meta: MetaDb;
  /**
   * The app's own customer host, when the caller already holds the domain
   * map (the surfaces' cache). Absent, the stored map is read.
   */
  hostFor?: ((appKey: string) => Promise<string | undefined>) | undefined;
}

/** The host mapped to an app's customer side (not an extra tenant's), in a domain map. */
export function customerHostIn(domains: Readonly<Record<string, DomainMapping>>, appKey: string): string | undefined {
  return Object.entries(domains).find(([, target]) => target.appKey === appKey && target.side === 'customer' && target.instance === undefined)?.[0];
}

/** The mapped customer host, read from the stored domain map. */
async function storedCustomerHost(meta: MetaDb, appKey: string): Promise<string | undefined> {
  const domains = (await settingsRepo(meta).get('surfaces.domains')) as Record<string, DomainMapping> | null | undefined;
  return domains === null || domains === undefined ? undefined : customerHostIn(domains, appKey);
}

/** The base every link into an app's guest side starts with, or null when there is none. */
export async function guestBase(deps: GuestBaseDeps, appKey: string): Promise<string | null> {
  const host = await (deps.hostFor ?? ((key: string) => storedCustomerHost(deps.meta, key)))(appKey);
  if (host !== undefined) return `https://${host}`;
  const origin = await settingsRepo(deps.meta).get('system.publicOrigin');
  return typeof origin === 'string' && origin !== '' ? `${origin.replace(/\/+$/, '')}/apps/${appKey}/customer` : null;
}
