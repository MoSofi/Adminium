// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COMPANY'S FACTS FROM ITS OWN WEBSITE, AS THE ENGINE READ IT.
 *
 * The engine's reader (`net/website-reader.ts`) reads one page and hands
 * back typed fields only: the site's name and its own description, its
 * Organization blocks, generic addresses and switchboard numbers. This
 * turns them into the facts a fill may offer: the name, "about" (the site's
 * description, never its body text), the website itself (the address read,
 * https only), the first switchboard number and the address. Add-on code is
 * never handed the page for this: the engine reads and maps it itself.
 *
 * What it says to the person, when the page was not read, is one of four
 * sentences, never why in detail (that goes to the log): a site that asks
 * tools not to read it, an answer that is no web page, a site that could not
 * be reached, and a site that sends visitors to another one, which the
 * person may agree to and ask again.
 */
import { companyFactsSchema, type CompanyFacts, type WebsitePage } from '@adminium/add-on-contracts';

import type { WebsiteReadOutcome } from '../net/website-reader.js';

/** What the person is told when the website was not read. */
export function websiteWords(outcome: Exclude<WebsiteReadOutcome, { outcome: 'read' }>): string {
  switch (outcome.outcome) {
    case 'asks':
      return `This website sends visitors to ${outcome.host}.`;
    case 'refused-by-site':
      return 'This website asks tools not to read it.';
    case 'not-a-page':
      return "This address isn't a web page we can read.";
    case 'unreachable':
      return "Couldn't reach the website.";
  }
}

/** The facts a page gives, each kept only where it is one the contract takes. */
export function pageFacts(page: WebsitePage): CompanyFacts {
  const first = page.jsonLd[0];
  const out: CompanyFacts = {};
  const keep = <K extends keyof CompanyFacts>(key: K, value: CompanyFacts[K] | undefined) => {
    if (value === undefined) return;
    const one = companyFactsSchema.shape[key].safeParse(value);
    if (one.success) out[key] = one.data as CompanyFacts[K];
  };
  const name = page.name?.trim() || first?.name?.trim();
  keep('name', name === '' ? undefined : name);
  const about = page.about?.trim();
  keep('about', about === undefined || about === '' ? first?.about : about);
  try {
    const read = new URL(page.finalUrl);
    // The website is the site read, over https only; the page it was read from is its source.
    if (read.protocol === 'https:') {
      keep('website', read.origin);
      keep('sourceUrl', read.href);
    }
  } catch {
    // An address the reader could not have read: nothing to keep.
  }
  keep('phone', page.phones[0] ?? first?.phone);
  keep('address', page.address ?? first?.address);
  keep('number', first?.number);
  keep('activity', first?.activity);
  return out;
}
