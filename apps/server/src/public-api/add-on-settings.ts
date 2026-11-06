// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The settings of an add-on a signed-in person may read through an app's own
 * key — its `publicSettings` (the payment instructions, a letterhead), with
 * their defaults, never a secret one.
 *
 * ── WHY BEHIND A SIGN-IN ───────────────────────────────────────────────────
 * The app's customer config is public: anyone may ask for it, with no sign-in,
 * so it says only that an add-on is there. A studio's bank details beside its
 * name, served to any scraper, are the raw material of a payment-diversion
 * email; served to a client who proved their mailbox, they are how that client
 * pays. So this read needs a verified session on the app's own key.
 *
 * ── WHICH ADD-ONS ──────────────────────────────────────────────────────────
 * Only one the key's app names in its `addOns` (requires or suggests) AND has
 * attached, switched on and installed. Every other key — another app's add-on,
 * one this app never asked for, one detached — reads as if it did not exist.
 */
import { installOnConnection, installsOf } from '../installs/resolve.js';
import { namedAddOns, type AddOnNeeds } from '@adminium/manifest';
import { addOnSettingsRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { settingValuesWithDefaults } from '../apps/settings-values.js';

type DeclaredSettings = Parameters<typeof settingValuesWithDefaults>[0];

/** `GET /public/add-ons/:key/settings`. */
export const addOnSettingsParams = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, 'an add-on key') });
export const addOnSettingsReply = z.object({ data: z.object({ settings: z.record(z.string(), z.unknown()) }) });

/**
 * The public settings of `addOnKey` as the app `appKey` has it on the
 * presented key's database, or null when it is not that app's to show. The
 * app's install there, and the add-on install attached to it: Kiln's
 * customers read Kiln's payment instructions, never Fernhill's. Never 409:
 * a public route resolves by the key's database alone.
 */
export async function publicAddOnSettings(meta: MetaDb, appKey: string, addOnKey: string, connectionId: string): Promise<Record<string, unknown> | null> {
  const installs = installsOf(meta);
  const app = await installs.findInScope(appKey, connectionId);
  if (app === null || app.row.kind !== 'app' || app.row.status !== 'installed') return null;
  const needs = (app.document as { addOns?: AddOnNeeds } | null)?.addOns;
  if (!namedAddOns(needs).some((need) => need.key === addOnKey)) return null;

  const addOn = await installOnConnection(installs, addOnKey, connectionId);
  if (addOn === null || addOn.row.kind !== 'add-on' || addOn.row.status !== 'installed') return null;
  if (!addOn.attachments.some((attachment) => attachment.attachedTo === appKey && attachment.hostInstall === app.row.id && attachment.disabledAt === null)) return null;
  const document = addOn.document as { settings?: DeclaredSettings; addOn?: { publicSettings?: string[] } } | null;
  const declared = (document?.settings ?? []).filter((setting) => setting.secret !== true);
  // Only what the add-on's author marked for a browser, and never a secret, whatever a manifest lists.
  const shown = new Set((document?.addOn?.publicSettings ?? []).filter((name) => declared.some((setting) => setting.key === name)));
  const values = settingValuesWithDefaults(declared, await addOnSettingsRepo(meta).valuesForInstall(addOn.row.id));
  return Object.fromEntries(Object.entries(values).filter(([name]) => shown.has(name)));
}
