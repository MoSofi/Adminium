/**
 * The desktop capability grant table (11-electron.md §12), over `adminium_settings`.
 *
 * §1 principle 2 puts the meta store on the server's side of the process
 * boundary, so grant reads and writes live here and the main-process
 * `CapabilityHost` reaches them over the loopback REST API (`routes/
 * desktop-capabilities`). Grants are a SET keyed by `{ manifestId, capabilityId }`:
 *
 *  - granting twice is idempotent — the consent step records an authorization,
 *    not a counter, so a re-install of the same app must not stack rows;
 *  - revoking removes exactly the one identity;
 *  - the whole array round-trips through `settingsRepo`, so its Zod schema
 *    (`capabilityGrantsSchema`) validates every write and a corrupt row can never
 *    be persisted.
 *
 * CONCURRENCY: each mutation is a read-modify-write of the single settings row.
 * Two truly-simultaneous grants could lose one. That is acceptable here and only
 * here — consent and revoke are deliberate, one-at-a-time admin actions on a
 * single-user desktop reached over loopback, not a hot write path — and it is the
 * same read-modify-write every other array-valued setting already accepts.
 */

import { settingsRepo, type CapabilityGrant, type MetaDb } from '@adminium/meta';

/** The `adminium_settings` key; camelCased per the registry convention (§12 note). */
const GRANTS_KEY = 'desktop.capabilityGrants' as const;

/** The identity of a grant — everything but its timestamp. */
export interface GrantRef {
  manifestId: string;
  capabilityId: string;
}

function isSameGrant(grant: CapabilityGrant, ref: GrantRef): boolean {
  return grant.manifestId === ref.manifestId && grant.capabilityId === ref.capabilityId;
}

/** Every consented grant, newest write order preserved. */
export async function listGrants(meta: MetaDb): Promise<CapabilityGrant[]> {
  return [...(await settingsRepo(meta).get(GRANTS_KEY))];
}

/** True when `ref` is already granted — the check `CapabilityHost.invoke` makes. */
export async function isGranted(meta: MetaDb, ref: GrantRef): Promise<boolean> {
  const grants = await settingsRepo(meta).get(GRANTS_KEY);
  return grants.some((grant) => isSameGrant(grant, ref));
}

/**
 * Idempotent add. Returns the grant that is now in the table — the existing one
 * if this identity was already granted, otherwise the newly written one.
 */
export async function addGrant(
  meta: MetaDb,
  ref: GrantRef,
  opts: { now?: number; updatedBy?: string | null } = {},
): Promise<CapabilityGrant> {
  const repo = settingsRepo(meta);
  const current = await repo.get(GRANTS_KEY);
  const existing = current.find((grant) => isSameGrant(grant, ref));
  if (existing !== undefined) return existing;
  const grant: CapabilityGrant = {
    manifestId: ref.manifestId,
    capabilityId: ref.capabilityId,
    grantedAt: opts.now ?? Date.now(),
  };
  await repo.set(GRANTS_KEY, [...current, grant], { updatedBy: opts.updatedBy ?? null });
  return grant;
}

/** Remove a grant. Returns true when a row was actually removed (revoke is a no-op otherwise). */
export async function removeGrant(
  meta: MetaDb,
  ref: GrantRef,
  opts: { updatedBy?: string | null } = {},
): Promise<boolean> {
  const repo = settingsRepo(meta);
  const current = await repo.get(GRANTS_KEY);
  const next = current.filter((grant) => !isSameGrant(grant, ref));
  if (next.length === current.length) return false;
  await repo.set(GRANTS_KEY, next, { updatedBy: opts.updatedBy ?? null });
  return true;
}
