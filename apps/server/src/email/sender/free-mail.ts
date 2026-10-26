// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Free-mail domains: addresses anyone can sign up for, at a domain the sender
 * does not own.
 *
 * Marketing mail from such an address is refused: the sender cannot publish
 * the domain's DKIM key or DMARC record, and the big mailboxes publish DMARC
 * policies (Gmail, Yahoo, Outlook) that tell receivers to reject mail sent in
 * their name through anyone else's server.
 *
 * ─── Where the list comes from ─────────────────────────────────────────────
 * Curated by hand on 2026-10-26: the consumer mail domains of the large
 * mailbox providers, worldwide and in the eight languages Adminium speaks
 * (the US and UK, Germany, France, Czechia, Denmark, the Arab world, mainland
 * China and Taiwan), plus the large ISPs' mailboxes. Spot-checked against the
 * HubSpot-derived free-mail list at github.com/Kikobeats/free-email-domains
 * (MIT). That list is not shipped whole: it holds thousands of throwaway and
 * long-dead domains, and refusing a sender is a strong act, so this list
 * keeps to domains whose owner is plainly a mailbox provider.
 *
 * A family (`hotmail`, `yahoo`, `gmx`, …) covers the provider's country
 * domains: `hotmail.co.uk`, `yahoo.fr`, `gmx.at`. It is read as the family's
 * name followed by one or two short labels (`.fr`, `.co.uk`, `.com.br`).
 */

/** Exact domains. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google
  'gmail.com',
  'googlemail.com',
  // Microsoft
  'msn.com',
  'passport.com',
  // Yahoo and AOL
  'ymail.com',
  'rocketmail.com',
  'aol.com',
  'aim.com',
  'verizon.net',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // Proton, Tuta, Zoho, Fastmail and other independent providers
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  'tutanota.com',
  'tutanota.de',
  'tutamail.com',
  'tuta.io',
  'tuta.com',
  'zoho.com',
  'zohomail.com',
  'zohomail.eu',
  'fastmail.com',
  'fastmail.fm',
  'hey.com',
  'mail.com',
  'email.com',
  'gmx.com',
  'posteo.de',
  'posteo.net',
  'mailbox.org',
  'disroot.org',
  'hushmail.com',
  // Germany
  'web.de',
  't-online.de',
  'freenet.de',
  'arcor.de',
  // France
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'laposte.net',
  'sfr.fr',
  'neuf.fr',
  'bbox.fr',
  // Italy, Spain, Netherlands, Belgium
  'libero.it',
  'virgilio.it',
  'tiscali.it',
  'alice.it',
  'telefonica.net',
  'ziggo.nl',
  'kpnmail.nl',
  'telenet.be',
  'skynet.be',
  // Czechia
  'seznam.cz',
  'email.cz',
  'post.cz',
  'centrum.cz',
  'atlas.cz',
  'volny.cz',
  // Denmark and the Nordics
  'mail.dk',
  'ofir.dk',
  'stofanet.dk',
  'post.tele.dk',
  'online.no',
  // Poland
  'wp.pl',
  'o2.pl',
  'interia.pl',
  'onet.pl',
  'op.pl',
  // Russia and neighbours
  'mail.ru',
  'inbox.ru',
  'list.ru',
  'bk.ru',
  'internet.ru',
  'ya.ru',
  'rambler.ru',
  'ukr.net',
  // Mainland China
  'qq.com',
  'foxmail.com',
  '163.com',
  '126.com',
  'yeah.net',
  'sina.com',
  'sina.cn',
  'sohu.com',
  'aliyun.com',
  '139.com',
  '189.cn',
  // Taiwan and Hong Kong
  'pchome.com.tw',
  'seed.net.tw',
  'hinet.net',
  'msa.hinet.net',
  'netvigator.com',
  // Korea and Japan
  'naver.com',
  'daum.net',
  'hanmail.net',
  'nate.com',
  'docomo.ne.jp',
  'ezweb.ne.jp',
  'softbank.ne.jp',
  // India
  'rediffmail.com',
  // The Arab world and Türkiye
  'maktoob.com',
  'link.net',
  // The UK and Ireland
  'btinternet.com',
  'btopenworld.com',
  'sky.com',
  'virginmedia.com',
  'ntlworld.com',
  'blueyonder.co.uk',
  'talktalk.net',
  'tiscali.co.uk',
  'eircom.net',
  // North America
  'comcast.net',
  'att.net',
  'sbcglobal.net',
  'bellsouth.net',
  'cox.net',
  'charter.net',
  'earthlink.net',
  'optonline.net',
  'shaw.ca',
  'rogers.com',
  'sympatico.ca',
  'videotron.ca',
  // Latin America, Australia, New Zealand
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'ig.com.br',
  'prodigy.net.mx',
  'bigpond.com',
  'bigpond.net.au',
  'optusnet.com.au',
  'xtra.co.nz',
]);

/** Families: the provider's name before its country domains. */
export const FREE_MAIL_FAMILIES: ReadonlySet<string> = new Set(['hotmail', 'outlook', 'live', 'windowslive', 'yahoo', 'gmx', 'yandex', 'aol']);

/** One or two short labels after a family name: `.com`, `.fr`, `.co.uk`, `.com.br`. */
const COUNTRY_SUFFIX = /^[a-z]{2,3}(\.[a-z]{2,3})?$/;

/** The domain part of an address, in lower case, without a trailing dot; null when there is none. */
export function domainOfAddress(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at < 1) return null;
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  return domain.length === 0 ? null : domain;
}

/** Whether a domain is a free-mail domain. */
export function isFreeMailDomain(domain: string): boolean {
  const clean = domain.trim().toLowerCase().replace(/\.$/, '');
  if (FREE_MAIL_DOMAINS.has(clean)) return true;
  const dot = clean.indexOf('.');
  return dot > 0 && FREE_MAIL_FAMILIES.has(clean.slice(0, dot)) && COUNTRY_SUFFIX.test(clean.slice(dot + 1));
}

/** Whether an address is at a free-mail domain. */
export function isFreeMail(address: string): boolean {
  const domain = domainOfAddress(address);
  return domain !== null && isFreeMailDomain(domain);
}
