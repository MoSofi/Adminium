// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which page this is, from its address: a form (`/x/forms/<slug>`), drawn
 * for a website's frame with `?frame=1`; a live chat's window
 * (`/x/chat/<addOn>`), drawn for the website loader's frame with `?frame=1`;
 * anything else is "not available".
 *
 * Of the query, only `frame`, `lang`, a survey's `t`, `preview` (the
 * builder's look at a draft, or "Try the chat", which send nothing) and the
 * form's own hidden values are ever read; the rest is ignored.
 */
export type XRoute =
  | { kind: 'form'; slug: string; frame: boolean; lang: string | null; token: string | null; query: URLSearchParams; preview?: true }
  | { kind: 'chat'; addOn: string; frame: boolean; lang: string | null; preview?: true }
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
  const slug = nameIn(parts, 'forms');
  if (slug === undefined) return { kind: 'none', frame, lang };
  return { kind: 'form', slug, frame, lang, token: query.get('t'), query, ...preview };
}
