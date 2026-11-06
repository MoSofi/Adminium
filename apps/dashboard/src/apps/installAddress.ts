// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An install's address. The same app or add-on may be installed once per
 * database: the first install keeps the plain key (`invoices`), a later one
 * is `<key>~<slug>` (`invoices~kiln`) in every dashboard address that names
 * it (its Studio page, its add-on pages, its screens).
 */

/** `invoices~kiln` → `{ key: 'invoices', slug: 'kiln' }`; a plain key has the slug `''`. */
export function splitAddress(address: string): { key: string; slug: string } {
  const at = address.indexOf('~');
  return at < 0 ? { key: address, slug: '' } : { key: address.slice(0, at), slug: address.slice(at + 1) };
}

/** The address an install is opened at: its own, else `key` or `key~slug`. */
export function addressOf(install: { key: string; slug?: string | undefined; address?: string | undefined }): string {
  if (install.address !== undefined) return install.address;
  return install.slug === undefined || install.slug === '' ? install.key : `${install.key}~${install.slug}`;
}
