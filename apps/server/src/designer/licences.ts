// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a picture's licence asks of the person, in four badges and two
 * neutral ones.
 *
 * A source answers with its own code ("by", "by-sa", "cc0"); the person reads
 * a badge and one sentence. The badge is decided here, from the code alone,
 * and the page words it in the person's language. Each badge says what is
 * asked, never that nothing is: a Pexels or Unsplash picture comes with a
 * condition ("do not sell it as it is"), so it has a badge of its own.
 *
 *  - `no-credit`: CC0 and the Public Domain Mark;
 *  - `host`: the source's own licence (Pexels, Unsplash);
 *  - `credit`: CC BY. The credit is drawn at the foot of every screen that
 *    shows the picture, under "Picture credits", by the side's `Picture`;
 *  - `credit-same`: CC BY-SA, hidden from a search until the person asks;
 *  - `own`: a picture the person uploaded;
 *  - `template`: a picture that came with the person's site template.
 *
 * A search result whose code is none of the first four is dropped: an
 * unknown licence is never shown as a known one. The two neutral badges are
 * for pictures that never came from a search.
 */

export const LICENCE_CODES = ['cc0', 'pdm', 'by', 'by-sa', 'pexels', 'unsplash', 'own', 'template'] as const;
export type LicenceCode = (typeof LICENCE_CODES)[number];

export const LICENCE_BADGES = ['no-credit', 'host', 'credit', 'credit-same', 'own', 'template'] as const;
export type LicenceBadge = (typeof LICENCE_BADGES)[number];

/** The badges a search may be narrowed to, in the order the filter shows them. */
export const SEARCH_BADGES = ['no-credit', 'host', 'credit', 'credit-same'] as const satisfies readonly LicenceBadge[];
export type SearchBadge = (typeof SEARCH_BADGES)[number];

/** What a search shows until the person ticks more: everything but "Credit + same licence". */
export const DEFAULT_BADGES: readonly SearchBadge[] = ['no-credit', 'host', 'credit'];

const BADGE: Readonly<Record<LicenceCode, LicenceBadge>> = {
  cc0: 'no-credit',
  pdm: 'no-credit',
  by: 'credit',
  'by-sa': 'credit-same',
  pexels: 'host',
  unsplash: 'host',
  own: 'own',
  template: 'template',
};

export const badgeOf = (code: LicenceCode): LicenceBadge => BADGE[code];

/** Whether the licence asks for the creator's name beside the picture. */
export const creditAsked = (code: LicenceCode): boolean => code === 'by' || code === 'by-sa';

export const isLicenceCode = (value: unknown): value is LicenceCode => typeof value === 'string' && (LICENCE_CODES as readonly string[]).includes(value);

export interface Licence {
  code: LicenceCode;
  badge: LicenceBadge;
  /** The licence's own name, as its owner writes it: "CC BY 2.0", "CC0 1.0", "Pexels licence". */
  name: string;
}

const VERSION = /^\d{1,2}(?:\.\d{1,2})?$/;

/**
 * The licence of a search result, from the code its source gave; null for a
 * code that is none of the ones a search may show, which drops the result.
 */
export function searchLicence(source: string, code: unknown, version?: unknown): Licence | null {
  if (source === 'Pexels') return { code: 'pexels', badge: 'host', name: 'Pexels licence' };
  if (source === 'Unsplash') return { code: 'unsplash', badge: 'host', name: 'Unsplash licence' };
  if (source !== 'Openverse' || typeof code !== 'string') return null;
  const raw = code.trim().toLowerCase();
  const v = typeof version === 'string' && VERSION.test(version.trim()) ? ` ${version.trim()}` : '';
  // Each by the name its owner gives it: "CC0 1.0" and "Public Domain Mark 1.0", never "CC CC0" or "CC PDM".
  if (raw === 'cc0') return { code: 'cc0', badge: 'no-credit', name: `CC0${v === '' ? ' 1.0' : v}` };
  if (raw === 'pdm') return { code: 'pdm', badge: 'no-credit', name: `Public Domain Mark${v === '' ? ' 1.0' : v}` };
  if (raw === 'by') return { code: 'by', badge: 'credit', name: `CC BY${v}` };
  if (raw === 'by-sa') return { code: 'by-sa', badge: 'credit-same', name: `CC BY-SA${v}` };
  return null;
}
