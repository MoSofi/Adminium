// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which page this is, from its address: a form (`/x/forms/<slug>`), drawn
 * for a website's frame with `?frame=1`; a live chat's window
 * (`/x/chat/<addOn>`), drawn for the website loader's frame with `?frame=1`;
 * a landing page (`/x/pages/<slug>`), never in a frame; anything else is
 * "not available".
 *
 * Of the query, only `frame`, `lang`, a survey's `t`, `preview` (the
 * builder's look at a draft, or "Try the chat", which send nothing), a
 * landing page's preview `page` (its row's key) and the form's own hidden
 * values are ever read; the rest is ignored.
 */
export type XRoute =
  | { kind: 'form'; slug: string; frame: boolean; lang: string | null; token: string | null; query: URLSearchParams; preview?: true }
  | { kind: 'chat'; addOn: string; frame: boolean; lang: string | null; preview?: true }
  | { kind: 'page'; slug: string; frame: false; lang: string | null; query: URLSearchParams; preview?: { page: string | null } }
  | { kind: 'none'; frame: boolean; lang: string | null };

/** The third part of `/x/<door>/<name>`, decoded; undefined for any other address or a name that does not decode. */
function nameIn(parts: readonly string[], door: string): string | undefined {
  if (parts[0] !== 'x' || parts[1] !== door || parts.length !== 3) return undefined;
  try {
    const name = decodeURIComponent(parts[2]!);
    return name === 'api' ? undefined : name;
  } catch {
    return undefined;
  }
}

export function routeOf(path: string, search: string): XRoute {
  const query = new URLSearchParams(search);
  const frame = query.get('frame') === '1';
  const lang = query.get('lang');
  const preview = query.get('preview') === '1' ? { preview: true as const } : {};
  const parts = path.split('/').filter(Boolean);
  const addOn = nameIn(parts, 'chat');
  if (addOn !== undefined) return { kind: 'chat', addOn, frame, lang, ...preview };
  const page = nameIn(parts, 'pages');
  // A landing page is drawn on its own page only: `frame=1` asks for nothing there.
  if (page !== undefined) return { kind: 'page', slug: page, frame: false, lang, query, ...(query.get('preview') === '1' ? { preview: { page: query.get('page') } } : {}) };
  const slug = nameIn(parts, 'forms');
  if (slug === undefined) return { kind: 'none', frame, lang };
  return { kind: 'form', slug, frame, lang, token: query.get('t'), query, ...preview };
}
