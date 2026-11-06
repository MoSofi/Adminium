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

/**
 * The host mapped to an app's customer side, in a domain map: the bare
 * install's (no instance), or a later install's (its slug is its instance).
 */
export function customerHostIn(domains: Readonly<Record<string, DomainMapping>>, appKey: string, slug = ''): string | undefined {
  return Object.entries(domains).find(([, target]) => target.appKey === appKey && target.side === 'customer' && (target.instance ?? '') === slug)?.[0];
}

/** The mapped customer host, read from the stored domain map. */
async function storedCustomerHost(meta: MetaDb, appKey: string, slug = ''): Promise<string | undefined> {
  const domains = (await settingsRepo(meta).get('surfaces.domains')) as Record<string, DomainMapping> | null | undefined;
  return domains === null || domains === undefined ? undefined : customerHostIn(domains, appKey, slug);
}

/**
 * The base every link into an install's guest side starts with, or null when
 * there is none. A later install's guests are at its own address
 * (`/apps/<key>/<slug>/customer`): a mail about a kiln row never links
 * into fernhill's.
 */
export async function guestBase(deps: GuestBaseDeps, appKey: string, slug = ''): Promise<string | null> {
  const host = slug === '' ? await (deps.hostFor ?? ((key: string) => storedCustomerHost(deps.meta, key)))(appKey) : await storedCustomerHost(deps.meta, appKey, slug);
  if (host !== undefined) return `https://${host}`;
  const origin = await settingsRepo(deps.meta).get('system.publicOrigin');
  return typeof origin === 'string' && origin !== '' ? `${origin.replace(/\/+$/, '')}/apps/${appKey}/${slug === '' ? '' : `${slug}/`}customer` : null;
}

/**
 * The address slug of an app's install on one database: `''` for the install
 * that owns the bare addresses, its own slug for a later one, null when the
 * app is not installed there.
 */
export async function installSlugOn(meta: MetaDb, appKey: string, connectionId: string): Promise<string | null> {
  const row = await meta.db
    .selectFrom('adminium_manifests')
    .select('instanceSlug')
    .where('manifestKey', '=', appKey)
    .where('kind', '=', 'app')
    .where('connectionId', '=', connectionId)
    .executeTakeFirst();
  return row?.instanceSlug ?? null;
}

/**
 * The guest base of an app's install on one database: a key, a sign-in link
 * or a mail of Kiln's links into Kiln's guest side, never Fernhill's. Null
 * when the app is not installed there, as when it has no address.
 */
export async function guestBaseOn(deps: GuestBaseDeps, appKey: string, connectionId: string): Promise<string | null> {
  const slug = await installSlugOn(deps.meta, appKey, connectionId);
  return slug === null ? null : await guestBase(deps, appKey, slug);
}

/** Whether the server's public address is set: what a later install's guest links start with until a host is mapped to it. */
export async function hasPublicOrigin(meta: MetaDb): Promise<boolean> {
  const origin = await settingsRepo(meta).get('system.publicOrigin');
  return typeof origin === 'string' && origin !== '';
}
