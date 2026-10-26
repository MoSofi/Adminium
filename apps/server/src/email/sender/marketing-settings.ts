// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two words of the sender a marketing mail prints in its locked footer:
 * the postal address and the business's name.
 *
 * Neither is a setting of its own yet. The privacy settings (the business's
 * name as the controller, its postal address) arrive with the privacy notice;
 * until then:
 *   - the postal address reads as not set, so every marketing send is
 *     refused with `no-postal-address` (the law in many countries asks for it
 *     in every marketing mail, and a mail without it is never sent);
 *   - the business's name is the workspace's name (`branding.appName`), the
 *     name every mail's banner already carries.
 *
 * Every send path reads them through here, so the privacy settings change
 * these two functions and nothing else.
 */
import { settingsRepo, type MetaDb } from '@adminium/meta';

/** The sender's postal address, or null while it is not set. */
export async function postalAddressOf(_meta: MetaDb): Promise<string | null> {
  return null;
}

/** The business a marketing mail is from, as its footer names it. */
export async function businessNameOf(meta: MetaDb): Promise<string> {
  const name = await settingsRepo(meta).get('branding.appName');
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : 'Adminium';
}
