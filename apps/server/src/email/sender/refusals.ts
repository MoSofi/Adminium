// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When a marketing send is refused because of its sender or this server's
 * setup. Each refusal is a code the screens put in words (the send dialog's
 * list of problems, each with its fix); this module says none of the words.
 *
 * In the order the send dialog lists them:
 *   - `no-postal-address`: the sender's postal address is not set. The law in
 *     many countries asks for it in every marketing mail (CAN-SPAM, and the
 *     EU's e-commerce rules);
 *   - `free-mail-from`: the From is at a free-mail domain (`free-mail.ts`);
 *     nothing about DNS is checked then, since the sender owns none of it;
 *   - `dns-unchecked`: DNS could not be asked, so DMARC could not be checked;
 *   - `no-dmarc`: the From's domain has no DMARC record;
 *   - `not-aligned`: the domain has DMARC, but no DKIM key of Adminium's that is
 *     published in DNS and aligned with the From (relaxed alignment). Adminium
 *     signs marketing mail itself so that the one-click unsubscribe headers are
 *     covered whatever the mail service does; an unpublished key would fail
 *     DMARC;
 *   - `no-public-address`: this server has no public address
 *     (`system.publicOrigin`), or it cannot be reached from outside, so the
 *     unsubscribe link in every marketing mail would not work.
 */
import { dkimFound, dmarcOf, DnsCheckError, type DkimDnsState, type DmarcResult, type TxtLookup } from './dns.js';
import { domainOfAddress, isFreeMail } from './free-mail.js';

export const MARKETING_REFUSALS = ['no-postal-address', 'free-mail-from', 'dns-unchecked', 'no-dmarc', 'not-aligned', 'no-public-address'] as const;
export type MarketingRefusal = (typeof MARKETING_REFUSALS)[number];

export interface MarketingSettings {
  /** The sender's postal address; null or blank when not set. */
  postalAddress: string | null;
  /** `system.publicOrigin`. */
  publicOrigin: string | null;
  /** False when this server's address is known not to be reachable from outside (the mail door's reachability check). */
  reachable?: boolean;
}

/** What DNS said about the sender's domain; `unchecked` when DNS could not be asked. */
export interface SenderFacts {
  dmarc: DmarcResult | 'unchecked';
  /** Adminium's key for the domain and whether DNS publishes it; null when there is no key. */
  dkim: { domain: string; state: DkimDnsState } | 'unchecked' | null;
}

/** Every refusal that applies, in the dialog's order. */
export function marketingRefusals(sender: string, settings: MarketingSettings, facts: SenderFacts): MarketingRefusal[] {
  const out: MarketingRefusal[] = [];
  if (settings.postalAddress === null || settings.postalAddress.trim() === '') out.push('no-postal-address');
  const domain = domainOfAddress(sender);
  if (domain === null || isFreeMail(sender)) {
    out.push('free-mail-from');
  } else if (facts.dmarc === 'unchecked' || facts.dkim === 'unchecked') {
    out.push('dns-unchecked');
  } else if (facts.dmarc.policy === null) {
    out.push('no-dmarc');
  } else if (facts.dkim === null || facts.dkim.state !== 'found' || !facts.dmarc.aligned(domain, facts.dkim.domain)) {
    out.push('not-aligned');
  }
  if (settings.publicOrigin === null || settings.publicOrigin.trim() === '' || settings.reachable === false) out.push('no-public-address');
  return out;
}

/** The first refusal that applies, or null when the send may go. */
export function marketingRefusal(sender: string, settings: MarketingSettings, facts: SenderFacts): MarketingRefusal | null {
  return marketingRefusals(sender, settings, facts)[0] ?? null;
}

/**
 * Ask DNS what `marketingRefusals` needs about a sender: the domain's DMARC,
 * and whether Adminium's key for it (when it has one) is published.
 */
export async function senderFacts(
  lookup: TxtLookup,
  sender: string,
  key: { domain: string; selector: string; publicKey: string } | null,
): Promise<SenderFacts> {
  const domain = domainOfAddress(sender);
  if (domain === null || isFreeMail(sender)) return { dmarc: 'unchecked', dkim: null };
  const ask = async <T>(question: () => Promise<T>): Promise<T | 'unchecked'> => {
    try {
      return await question();
    } catch (error) {
      if (error instanceof DnsCheckError) return 'unchecked';
      throw error;
    }
  };
  const dmarc = await ask(() => dmarcOf(lookup, domain));
  if (key === null) return { dmarc, dkim: null };
  const state = await ask(() => dkimFound(lookup, key.domain, key.selector, key.publicKey));
  return { dmarc, dkim: state === 'unchecked' ? 'unchecked' : { domain: key.domain, state } };
}
