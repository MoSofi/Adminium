// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The country a local phone number is read in, when the SMS account has not
 * chosen one: the `phone.defaultCountry` setting. A stored value the phone
 * library does not know reads as none, so a local number is refused rather
 * than read in the wrong country.
 */
import { settingsRepo, type MetaDb } from '@adminium/meta';

import { parsePhone } from '../phone/index.js';

/** Whether the phone library knows this country. Any valid number will do: only the country is being asked about. */
export function isKnownCountry(country: string): boolean {
  const answer = parsePhone('+14155552671', country);
  return /^[A-Z]{2}$/.test(country) && (answer.ok || answer.reason !== 'bad-country');
}

export function storedDefaultCountry(meta: MetaDb): () => Promise<string | null> {
  const settings = settingsRepo(meta);
  return async () => {
    const value = await settings.get('phone.defaultCountry');
    return typeof value === 'string' && isKnownCountry(value) ? value : null;
  };
}
