// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO THE BUSINESS IS, as the people whose details it keeps read it.
 *
 * One name, read the same way by everything a stranger sees: the pay page
 * and its mails, the marketing mail's footer, the mail door's pages. In this
 * order, the first that is set:
 *
 *   1. the pay page's own shop name (Studio → Payments → the pay page);
 *   2. the privacy setting "Business name" (the controller);
 *   3. the workspace's name (`branding.appName`);
 *   4. the host of the public address (the pay address, else the server's).
 *
 * A name that is still the software's own ("Adminium", the workspace's name
 * nobody changed) counts as not set: a stranger never reads it.
 *
 * Beside it, the privacy notice's address (https only) and the sender's
 * postal address, each null while it is not set.
 */
import { paymentSettingsRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { payAddress } from '../payments/links.js';
import { normalizePublicOrigin } from '../security/public-origin.js';

/** The pay page's settings document (`routes/payments/ways.ts` `PAY_PAGE_DOC`): only its name is read here. */
export const PAY_PAGE_SETTINGS_DOC = 'pay-page';
const payPageNameSchema = z.object({ shopName: z.string() }).passthrough();

/** The workspace's name until an operator gives it one: never a business's. */
export const SOFTWARE_NAME = 'Adminium';

/** Whether a name may stand for the business: set, and not the software's own. */
function usable(name: unknown): name is string {
  return typeof name === 'string' && name.trim() !== '' && name.trim() !== SOFTWARE_NAME;
}

/** The host of an address, or null. */
function hostOf(address: string | null | undefined): string | null {
  if (address === null || address === undefined || address === '') return null;
  try {
    return new URL(address).hostname || null;
  } catch {
    return null;
  }
}

export interface BusinessNameParts {
  /** The pay page's own name, as saved. */
  payPage: string | null;
  /** The privacy setting "Business name". */
  setting: string | null;
  /** The workspace's name. */
  workspace: string | null;
  /** The public address the name falls back to: the pay address, else the server's. */
  origin: string | null;
}

/** The one order, on parts already read: the pay page, the setting, the workspace, the host; empty when none. */
export function pickBusinessName(parts: BusinessNameParts): string {
  for (const name of [parts.payPage, parts.setting, parts.workspace]) if (usable(name)) return name.trim();
  return hostOf(parts.origin) ?? '';
}

/**
 * The business's name, as every page a stranger sees spells it.
 * `origin` is the last fallback a caller may know better (a page's own public address).
 */
export async function businessName(meta: MetaDb, opts: { origin?: string | null | undefined } = {}): Promise<string> {
  const settings = settingsRepo(meta);
  const page = await paymentSettingsRepo(meta).get(PAY_PAGE_SETTINGS_DOC, payPageNameSchema).catch(() => null);
  const [setting, workspace] = await Promise.all([settings.get('privacy.businessName'), settings.get('branding.appName')]);
  const parts: BusinessNameParts = { payPage: page?.shopName ?? null, setting, workspace, origin: null };
  const named = pickBusinessName(parts);
  if (named !== '') return named;
  const origin = (await payAddress(meta)) ?? (opts.origin === undefined || opts.origin === null ? null : normalizePublicOrigin(opts.origin));
  return pickBusinessName({ ...parts, origin });
}

/** The privacy notice: whose it is (the setting alone, never a fallback) and where it is; each null while not set. */
export interface PrivacyNotice {
  businessName: string | null;
  noticeUrl: string | null;
}

export async function privacyNoticeOf(meta: MetaDb): Promise<PrivacyNotice> {
  const settings = settingsRepo(meta);
  const [name, url] = await Promise.all([settings.get('privacy.businessName'), settings.get('privacy.noticeUrl')]);
  return { businessName: usable(name) ? name.trim() : null, noticeUrl: typeof url === 'string' && url.trim() !== '' ? url.trim() : null };
}

/**
 * Whether a new public form or chat may open: only once the privacy notice
 * is set, its business name and its address both. (Today's public pages, the
 * apps' checkouts and bookings, are not asked: they were open before this
 * setting existed.)
 */
export async function privacyNoticeReady(meta: MetaDb): Promise<boolean> {
  const notice = await privacyNoticeOf(meta);
  return notice.businessName !== null && notice.noticeUrl !== null;
}

/** The sender's postal address, or null while it is not set. */
export async function senderPostalAddress(meta: MetaDb): Promise<string | null> {
  const value = await settingsRepo(meta).get('email.postalAddress');
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
