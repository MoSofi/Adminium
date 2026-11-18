// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE `/x/` SHELL'S HEADER AND FOOTER, the same on a form's page and on a
 * landing page: the business's logo (or its initial) and name over the page;
 * its name, where to write, its privacy notice and, at "Per visitor",
 * "Cookie choice" under it. Never the software's name.
 */
import type { ReactNode } from 'react';
import { useT } from '@adminium/i18n/react';

import type { XBusiness } from './api.js';
import { MailLink } from './FormBody.js';

/** The tile that stands in for a business with no logo: the first mark of its first two words. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}&]/u.test(word));
  return words
    .slice(0, 2)
    .map((word) => [...word].find((char) => /[\p{L}\p{N}&]/u.test(char)) ?? '')
    .join('');
}

/** The header: the logo or its initial, the name, and whatever the page adds at its end (a form's language menu). */
export function XHeader({ business, children }: { business: XBusiness; children?: ReactNode }): ReactNode {
  return (
    <header className="x-header">
      <div className="x-header-inner">
        {business.hasLogo ? (
          <img className="x-logo" src="/x/api/logo" alt="" />
        ) : monogram(business.name) === '' ? null : (
          <span className="x-monogram" aria-hidden="true" dir="ltr">
            {monogram(business.name)}
          </span>
        )}
        <bdi className="x-business">{business.name}</bdi>
        {children}
      </div>
    </header>
  );
}

/** The footer: the legal name, where to write, the privacy notice, and "Cookie choice" when the page asks per visitor. */
export function XFooter({ business, onCookieChoice }: { business: XBusiness; onCookieChoice?: (() => void) | undefined }): ReactNode {
  const t = useT();
  return (
    <footer className="x-footer">
      <div className="x-footer-inner">
        {business.name === '' ? null : <bdi>{business.legalName ?? business.name}</bdi>}
        {business.email === null ? null : (
          <span>
            {t('x:footer.questions', 'Questions? Write to')} <MailLink email={business.email} />
          </span>
        )}
        {business.privacyNotice === null ? null : (
          <a href={business.privacyNotice} target="_blank" rel="noreferrer">
            {t('x:footer.privacyNotice', 'Privacy notice')}
          </a>
        )}
        {onCookieChoice === undefined ? null : (
          <button type="button" className="x-cookie-choice" onClick={onCookieChoice}>
            {t('x:banner.cookieChoice', 'Cookie choice')}
          </button>
        )}
      </div>
    </footer>
  );
}
