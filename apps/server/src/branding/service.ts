// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workspace branding, resolved from the settings registry — the one place
 * `branding.*` becomes the shape clients render.
 *
 * Two routes read it and must never disagree: the super-admin
 * `GET /settings/workspace` (what the identity form edits) and the PUBLIC
 * `GET /branding` (what the sign-in screen paints before anyone is signed in).
 *
 * `logoFileId` is a portable registry key, so it CAN arrive from another
 * instance's config bundle and point at bytes this instance never had. That is
 * why the id is resolved through `adminium_files` here rather than trusted:
 * a dangling or soft-deleted id resolves to "no logo" — the built-in mark —
 * instead of a broken image on every screen of the app.
 */
import { filesRepo, settingsRepo, type MetaDb } from '@adminium/meta';

/**
 * Realtime event on the `config-changed` channel. Branding is the only
 * settings section that is painted on every screen at once, so a write has to
 * reach signed-in sessions rather than waiting for the next cold load.
 */
export const BRANDING_UPDATED = 'settings.branding.updated';

export interface BrandingView {
  appName: string;
  /** `/api/v1/branding/logo?v=<fileId>`, or null when no logo is stored. */
  logoUrl: string | null;
  showVersion: boolean;
}

/** The stamped URL clients fetch bytes from; the stamp busts caches on replace. */
export function logoUrlFor(fileId: string): string {
  return `/api/v1/branding/logo?v=${encodeURIComponent(fileId)}`;
}

/** The stored logo file, or null when unset / dangling / soft-deleted. */
export async function resolveLogoFile(meta: MetaDb) {
  const fileId = await settingsRepo(meta).get('branding.logoFileId');
  if (typeof fileId !== 'string' || fileId === '') return null;
  const file = await filesRepo(meta).findById(fileId);
  if (file === null || file.deletedAt !== null) return null;
  return file;
}

export async function readBranding(meta: MetaDb): Promise<BrandingView> {
  const settings = settingsRepo(meta);
  const [appName, showVersion, logo] = await Promise.all([
    settings.get('branding.appName'),
    settings.get('branding.showVersion'),
    resolveLogoFile(meta),
  ]);
  return {
    appName,
    logoUrl: logo === null ? null : logoUrlFor(logo.id),
    showVersion,
  };
}
