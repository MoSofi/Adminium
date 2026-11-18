// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one call a landing page makes for itself (`/x/pages/api/<slug>`): what
 * the page draws, as the pages door answers it
 * (`apps/server/src/routes/pages-door/index.ts`). Its Form blocks then talk
 * to the forms door (`../api.ts`), its pictures load from the addresses given
 * here; every call stays under `/x/` on this host, which the page's policy
 * holds it to.
 *
 *   GET /x/pages/api/<slug>                     the live page, with this host's cookies ("Per visitor")
 *   GET /x/pages/api/<slug>?preview=1[&page=…]  its draft, for staff, with their own session
 *
 * A page that is not there, a draft, one switched off, all answer 404 with
 * the business alone: "not available".
 */
import type { LandingPage } from '@adminium/add-on-contracts/landing';

import { XApiError, type XBusiness, type XForm, type XVisitor } from '../api.js';

/** A form a Form block draws, as the forms door serves it, in the page's language. */
export interface PageForm {
  slug: string;
  form: XForm;
  today: string;
}

export type XLandingPage =
  | {
      state: 'live';
      business: XBusiness;
      accent: string;
      /** The page row's key: what its Form blocks ask and send with (`?on=`). */
      key: string;
      language: string;
      dir: 'ltr' | 'rtl';
      page: LandingPage;
      /** By forms add-on, then by the form's row key: the form, or null when it is left out of the page. */
      forms: Record<string, Record<string, PageForm | null>>;
      /** Each picture's address, by its file id. */
      pictures: Record<string, string>;
      /** Each linked page's address, by its key; null while that page is not live. */
      links: Record<string, string | null>;
      visitor?: XVisitor;
      preview?: true;
    }
  | { state: 'unavailable'; business: XBusiness; accent: string };

export async function fetchLandingPage(slug: string, preview?: { page: string | null }): Promise<XLandingPage> {
  const query = new URLSearchParams();
  if (preview !== undefined) {
    query.set('preview', '1');
    if (preview.page !== null) query.set('page', preview.page);
  }
  const search = query.toString();
  const response = await fetch(`/x/pages/api/${encodeURIComponent(slug)}${search === '' ? '' : `?${search}`}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (!response.ok && response.status !== 404) throw new XApiError(response.status);
  const body = (await response.json()) as XLandingPage;
  return response.status === 404 ? { state: 'unavailable', business: body.business, accent: body.accent } : body;
}
