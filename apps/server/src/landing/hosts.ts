// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A LANDING PAGE ANSWERS, AND WHICH OF ITS ADDRESSES IS THE ONE.
 *
 * A page has no domain of its own: every host mapped to the add-on pages
 * (`surfaces.pageHosts`, each with its home page) serves every page, and so
 * does the public address (`system.publicOrigin`). One of those is the page's
 * canonical address, the one search engines index and shared links name:
 *
 *  1. the mapped pages host whose home this page is;
 *  2. else the first mapped pages host, by name (Postgres and MySQL keep a
 *     setting's keys in an order of their own, not the order they were saved
 *     in, so "the first saved" would differ between engines);
 *  3. else the public address's host.
 *
 * A mapped pages host is served over https (a page is only served while the
 * public address is an https one the outside can reach).
 */
import { normalizeHost } from '../security/csrf.js';

/** A mapped pages host, normalised, with its home page. */
export interface PagesHost {
  host: string;
  home: string;
}

/** The hosts mapped to the add-on pages, normalised, by name. */
export function pagesHostsByName(mapped: Readonly<Record<string, { home: string }>>): PagesHost[] {
  return Object.entries(mapped)
    .map(([host, mapping]) => ({ host: normalizeHost(host), home: mapping.home }))
    .sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
}

/** A page's path under the pages door. */
export function pagePath(slug: string): string {
  return `/x/pages/${slug}`;
}

/** One address of a page: its host, its URL there, and whether that host's `/` goes to it. */
export interface PageAddress {
  host: string;
  url: string;
  home: boolean;
}

/** Every address a page answers on: each mapped pages host by name, then the public address (never a home). */
export function pageAddresses(hosts: readonly PagesHost[], publicOrigin: string | null, slug: string): PageAddress[] {
  const path = pagePath(slug);
  const out: PageAddress[] = hosts.map((one) => ({ host: one.host, url: `https://${one.host}${path}`, home: one.home === path }));
  if (publicOrigin !== null) out.push({ host: normalizeHost(new URL(publicOrigin).host), url: `${publicOrigin}${path}`, home: false });
  return out;
}

/** The page's canonical address (see the header), or null while it answers nowhere. */
export function canonicalAddress(addresses: readonly PageAddress[]): PageAddress | null {
  return addresses.find((one) => one.home) ?? addresses[0] ?? null;
}
