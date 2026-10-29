// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A picture's licence, as the person reads it: four badges for pictures a
 * search found, two neutral ones for pictures that came from the person or
 * their template, and one for a picture made with AI, each with
 * the one sentence of what it asks. The badge is
 * decided by the server from the source's own code; the words are here.
 */
import { CircleCheck, LayoutTemplate, Repeat, Sparkles, Upload, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '../../../i18n/t.js';
import type { LicenceCode } from '../../api.js';

export type LicenceBadge = 'no-credit' | 'host' | 'credit' | 'credit-same' | 'own' | 'template' | 'made';
/** The badges a search may be narrowed to, in the order the filter shows them. */
export const SEARCH_BADGES = ['no-credit', 'host', 'credit', 'credit-same'] as const satisfies readonly LicenceBadge[];
export type SearchBadge = (typeof SEARCH_BADGES)[number];
/** What a search shows until the person ticks more: everything but "Credit + same licence". */
export const DEFAULT_BADGES: readonly SearchBadge[] = ['no-credit', 'host', 'credit'];

export function badgeOf(code: LicenceCode): LicenceBadge {
  if (code === 'cc0' || code === 'pdm') return 'no-credit';
  if (code === 'pexels' || code === 'unsplash' || code === 'pixabay') return 'host';
  if (code === 'by') return 'credit';
  if (code === 'by-sa') return 'credit-same';
  return code;
}

/** The source a host licence names. */
const hostOf = (code: LicenceCode): string => (code === 'unsplash' ? 'Unsplash' : code === 'pixabay' ? 'Pixabay' : 'Pexels');

/** The badge's own words: "{Source} licence" names who grants it. */
export function badgeName(badge: LicenceBadge, source: string): string {
  switch (badge) {
    case 'no-credit':
      return t('designer:pictureDialog.badge.noCredit', 'No credit needed');
    case 'host':
      return t('designer:pictureDialog.badge.host', '{source} licence', { source });
    case 'credit':
      return t('designer:pictureDialog.badge.credit', 'Credit needed');
    case 'credit-same':
      return t('designer:pictureDialog.badge.creditSame', 'Credit + same licence');
    case 'own':
      return t('designer:pictureDialog.badge.own', 'Your picture');
    case 'template':
      return t('designer:pictureDialog.badge.template', 'From your template');
    case 'made':
      return t('designer:pictureDialog.badge.made', 'Made with AI');
  }
}

/** What the licence asks, in one sentence; none for the person's own picture. */
export function badgeSentence(badge: LicenceBadge, source: string): string | null {
  switch (badge) {
    case 'no-credit':
      return t('designer:pictureDialog.sentence.noCredit', 'Use and change it freely. No credit is needed.');
    case 'host':
      return t('designer:pictureDialog.sentence.host', 'Use it under {source}’s licence. No credit is needed, though it is kind. Do not sell it as it is.', { source });
    case 'credit':
      return t('designer:pictureDialog.sentence.credit', 'Credit the creator. Adminium shows the credit at the foot of the page, under Picture credits.');
    case 'credit-same':
      return t('designer:pictureDialog.sentence.creditSame', 'Credit the creator. If you edit the picture file itself, share your edited file under the same licence.');
    case 'own':
      return null;
    case 'template':
      return t('designer:pictureDialog.sentence.template', 'Its licence is the template’s. Check the template’s licence file.');
    case 'made':
      return t('designer:pictureDialog.sentence.made', 'Made with AI from words. Check the service’s terms before you sell it as it is.');
  }
}

const TONE: Readonly<Record<LicenceBadge, string>> = {
  'no-credit': 'bg-pos-soft text-pos',
  host: 'bg-pos-soft text-pos',
  credit: 'bg-info-soft text-info',
  'credit-same': 'bg-warn-soft text-warn',
  own: 'bg-surface-3 text-fg-muted',
  template: 'bg-surface-3 text-fg-muted',
  made: 'bg-surface-3 text-fg-muted',
};

const ICON: Readonly<Record<LicenceBadge, ReactNode>> = {
  'no-credit': <CircleCheck aria-hidden="true" className="size-3" />,
  host: <CircleCheck aria-hidden="true" className="size-3" />,
  credit: <UserRound aria-hidden="true" className="size-3" />,
  'credit-same': <Repeat aria-hidden="true" className="size-3" />,
  own: <Upload aria-hidden="true" className="size-3" />,
  template: <LayoutTemplate aria-hidden="true" className="size-3" />,
  made: <Sparkles aria-hidden="true" className="size-3" />,
};

/** A licence's badge: a pill in its tone, with its icon. */
export function LicenceBadgePill({ code, withIcon = true }: { code: LicenceCode; withIcon?: boolean }): ReactNode {
  const badge = badgeOf(code);
  return (
    <span data-part="licence-badge" className={`inline-flex items-center gap-[5px] self-start whitespace-nowrap rounded-full px-[9px] py-[3px] text-caption font-bold leading-[1.4] ${TONE[badge]}`}>
      {withIcon ? ICON[badge] : null}
      {badgeName(badge, hostOf(code))}
    </span>
  );
}

/** The badge's name of a code, as a tile's name says it. */
export const licenceName = (code: LicenceCode): string => badgeName(badgeOf(code), hostOf(code));
export const licenceSentence = (code: LicenceCode): string | null => badgeSentence(badgeOf(code), hostOf(code));
