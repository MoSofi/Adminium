// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every address outside Adminium that the Shipping page links to (S1-F13).
 *
 * None carries a query string, so no referral or tracking tag leaves with a
 * click, and each opens with `rel="noopener noreferrer"`, so a private admin
 * host's address is not sent to the company either.
 *
 * WHAT IS PROVED. `signUp` is proved by Shippo's own redirect (T11). `billing`,
 * `api`, `carriers` and `webhooks` are the design's best reading and are NOT
 * proved: their deep paths stay unconfirmed until the owner's signed-in walk
 * (T11, `manual-walks.md`), which records the final addresses here.
 * `dhlSite` is DHL's public home on purpose: it is not the developer portal,
 * which would suggest DHL can be connected (D7).
 */
export const SHIPPING_LINKS = {
  /** Proved (T11). */
  signUp: 'https://apps.goshippo.com/join',
  /** Unproved until the signed-in walk. */
  billing: 'https://apps.goshippo.com/settings/billing',
  /** Unproved until the signed-in walk. */
  api: 'https://apps.goshippo.com/settings/api',
  /** Unproved until the signed-in walk. */
  carriers: 'https://apps.goshippo.com/settings/carriers',
  /** Unproved until the signed-in walk. The design pointed this at the API page, against its own label (L5). */
  webhooks: 'https://apps.goshippo.com/settings/webhooks',
  dhlSite: 'https://www.dhl.com/',
} as const;
