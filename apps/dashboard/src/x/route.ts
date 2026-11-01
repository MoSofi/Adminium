// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which page this is, from its address: a form (`/x/forms/<slug>`), drawn
 * for a website's frame with `?frame=1`; anything else is "not available".
 *
 * Of the query, only `frame`, `lang`, a survey's `t` and the form's own
 * hidden values are ever read; the rest is ignored.
 */
export type XRoute =
  | { kind: 'form'; slug: string; frame: boolean; lang: string | null; token: string | null; query: URLSearchParams }
  | { kind: 'none'; frame: boolean; lang: string | null };

export function routeOf(path: string, search: string): XRoute {
  const query = new URLSearchParams(search);
  const frame = query.get('frame') === '1';
  const lang = query.get('lang');
  const parts = path.split('/').filter(Boolean);
  let slug: string | undefined;
  try {
    slug = parts[0] === 'x' && parts[1] === 'forms' && parts.length === 3 ? decodeURIComponent(parts[2]!) : undefined;
  } catch {
    slug = undefined;
  }
  if (slug === undefined || slug === 'api') return { kind: 'none', frame, lang };
  return { kind: 'form', slug, frame, lang, token: query.get('t'), query };
}
