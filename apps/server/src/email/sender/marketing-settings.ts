// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two words of the sender a marketing mail prints in its locked footer:
 * the postal address and the business's name.
 *
 *   - the postal address is the setting "Postal address" (the marketing mail
 *     settings); while it is not set every marketing send is refused with
 *     `no-postal-address` (the law in many countries asks for it in every
 *     marketing mail, and a mail without it is never sent);
 *   - the business's name is the one name every page a stranger sees uses
 *     (`privacy/business.ts`): the pay page's, the privacy settings' "Business
 *     name", the workspace's, then the public address's host.
 *
 * Every send path reads them through here.
 */
import type { MetaDb } from '@adminium/meta';

import { businessName, senderPostalAddress } from '../../privacy/business.js';

/** The sender's postal address, or null while it is not set. */
export async function postalAddressOf(meta: MetaDb): Promise<string | null> {
  return senderPostalAddress(meta);
}

/** The business a marketing mail is from, as its footer names it. */
export async function businessNameOf(meta: MetaDb): Promise<string> {
  return businessName(meta);
}
