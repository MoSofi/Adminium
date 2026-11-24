// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE YOU CAN TEXT (comp X15): what each country asks before a business can
 * text there, as the providers' own guidance says it.
 *
 * Only three of these columns are rules Adminium enforces, and they are the
 * server's: no text of any kind to +86, no marketing where replies do not work
 * (`NO_REPLY_COUNTRIES`), and a confirmed yes for marketing in Germany. The
 * rest is what the business arranges with its provider. Adminium cannot see a
 * registration, approve one or speed one up, so a row says what is needed and
 * never claims a state.
 */
import { t } from '../../i18n/t.js';
import { NO_REPLY_COUNTRIES } from './textCounter.js';

export interface TextCountry {
  code: string;
  dial: string;
  /** What the providers can send from there: a number, or a sender name. Null for +86. */
  route: 'number' | 'name' | null;
  /** Whether a person there can answer by text. */
  replies: boolean;
  /** No text of any kind. */
  blocked?: true;
  /** What must be arranged with the provider first: `needed`, or nothing. */
  registration: 'needed' | 'none' | 'blocked';
}

export const TEXT_COUNTRIES: readonly TextCountry[] = [
  { code: 'US', dial: '+1', route: 'number', replies: true, registration: 'needed' },
  { code: 'CA', dial: '+1', route: 'number', replies: true, registration: 'none' },
  { code: 'GB', dial: '+44', route: 'name', replies: true, registration: 'none' },
  { code: 'DE', dial: '+49', route: 'name', replies: true, registration: 'none' },
  { code: 'DK', dial: '+45', route: 'name', replies: true, registration: 'none' },
  { code: 'FR', dial: '+33', route: 'name', replies: true, registration: 'needed' },
  { code: 'ES', dial: '+34', route: 'name', replies: true, registration: 'needed' },
  { code: 'CZ', dial: '+420', route: 'name', replies: true, registration: 'needed' },
  { code: 'AU', dial: '+61', route: 'name', replies: true, registration: 'needed' },
  { code: 'HK', dial: '+852', route: 'name', replies: true, registration: 'needed' },
  { code: 'IN', dial: '+91', route: 'name', replies: true, registration: 'needed' },
  { code: 'AE', dial: '+971', route: 'name', replies: false, registration: 'needed' },
  { code: 'EG', dial: '+20', route: 'name', replies: false, registration: 'none' },
  { code: 'SA', dial: '+966', route: 'name', replies: false, registration: 'needed' },
  { code: 'TW', dial: '+886', route: 'number', replies: false, registration: 'none' },
  { code: 'CN', dial: '+86', route: null, replies: false, blocked: true, registration: 'blocked' },
];

/** The country's name in this person's language. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Whether marketing may go there at all (N2, N3). */
export const marketingAllowed = (country: TextCountry): boolean => country.blocked !== true && !NO_REPLY_COUNTRIES.has(country.code);

/** What each country asks for, in one line. */
export function countryNote(code: string): string {
  switch (code) {
    case 'US':
      return t('studio:texts.country.US', '10DLC or toll-free registration. Texts are not sent until it is approved. It can take days to weeks.');
    case 'CA':
      return t('studio:texts.country.CA', 'No sender names. Use a long code, a verified toll-free number or a short code.');
    case 'GB':
    case 'DE':
    case 'DK':
      return t('studio:texts.country.nameFree', 'Sender names need no registration.');
    case 'FR':
      return t('studio:texts.country.FR', 'Register your sender name. Sources disagree, so treat it as required.');
    case 'ES':
      return t('studio:texts.country.ES', 'Unregistered sender names are blocked.');
    case 'CZ':
      return t('studio:texts.country.CZ', 'T-Mobile and O2 block unregistered names. Register for full coverage.');
    case 'AU':
      return t('studio:texts.country.AU', 'Unregistered names arrive labelled “Unverified”.');
    case 'HK':
      return t('studio:texts.country.HK', 'Sender names need registration. Replies work.');
    case 'IN':
      return t('studio:texts.country.IN', 'The domestic route needs DLT registration.');
    case 'AE':
      return t('studio:texts.country.AE', 'Registered sender names only. No numbers or links in the text.');
    case 'EG':
      return t('studio:texts.country.EG', 'Replies are not supported.');
    case 'SA':
      return t('studio:texts.country.SA', 'Registered sender names only. A local Saudi business needs a local provider.');
    case 'TW':
      return t('studio:texts.country.TW', 'The brand name must open each text. Links need allowlisting.');
    default:
      return '';
  }
}
