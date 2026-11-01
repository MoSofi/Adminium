// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WEBSITES THAT MAY SHOW A FORM IN A FRAME ("Your websites").
 *
 * The list feeds two things and nothing else: the `frame-ancestors` of a form
 * drawn in frame mode, and the origins the frame-mode page answers the
 * website loader's messages from. It never opens the public API and never
 * reaches the credentialed CORS list: the frame's own calls go to its own
 * host, same-origin.
 *
 * Each entry is an origin, `https://shop.example`, in lower case with no
 * path and no default port. Until the Privacy page's "Your websites" tab
 * keeps the list, it is empty, so a form refuses every frame.
 */
import type { MetaDb } from '@adminium/meta';

/** The listed websites' origins, as a page's policy names them. */
export type ListedWebsites = () => Promise<readonly string[]>;

/** The list kept for this install. Empty until the websites setting exists. */
export function listedWebsitesOf(meta: MetaDb): ListedWebsites {
  // The list will be read from this store's settings; until it is kept there, none is listed.
  void meta;
  return async () => [];
}
