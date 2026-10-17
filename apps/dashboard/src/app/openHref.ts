// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Following an address the SERVER wrote: a notice's link, an entry of an
 * app's section that is not a page, a search hit that opens in its app.
 *
 * Two kinds, told apart by the address alone. The dashboard's own
 * (`/exports`, `/automations?app=crm`, `/a/crm/deals/12`) is followed in
 * place. An app's staff side on its own address (`/apps/crm/staff/deals/12`,
 * or a mapped host) is not this bundle's to draw: it opens as a document, in a
 * new tab, as the section's "Open the staff screens" always did.
 *
 * Anything else is not followed: no `javascript:`, no `//host`, no relative
 * address. An absolute address is only ever http(s).
 */

/** An address this bundle draws: a path of its own, never the app mounts under `/apps/`. */
export function isDashboardPath(href: string): boolean {
  // eslint-disable-next-line no-control-regex -- a control character in an address is exactly what is refused
  return /^\/(?![/\\])/.test(href) && !/[\\\u0000-\u001f]/.test(href) && !href.startsWith('/apps/');
}

/** An address that opens as a document: an app's mount on this server, or an http(s) address. */
export function isDocumentHref(href: string): boolean {
  // eslint-disable-next-line no-control-regex -- a control character in an address is exactly what is refused
  if (/[\\\u0000-\u001f]/.test(href)) return false;
  return /^\/apps\/[^/\\]/.test(href) || /^https?:\/\/[^/\\]/i.test(href);
}

export function openHref(href: string, push: (path: string) => void): void {
  if (isDashboardPath(href)) push(href);
  else if (isDocumentHref(href)) window.open(href, '_blank', 'noopener');
}
