// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two lines the snippet maker prints for an app's screen: the loader and
 * the element it fills (`apps/dashboard/x/embed.js` is the contract).
 *
 * The element carries a plain link to the same screen, so a website whose
 * frame is refused or switched off still gets the visitor there. In `button`
 * mode the element IS that link: the site's own button.
 */
export type SnippetMode = 'inline' | 'button' | 'floating';

/** The most letters a launcher's words may have. */
export const LABEL_MAX = 28;

export interface SnippetInput {
  /** This server's public address. */
  origin: string;
  /** `data-adminium-app`: the key, or `<key>~<copy>`. */
  app: string;
  /** The side's own address on this server. */
  mount: string;
  path: string;
  /** A query for the path, when a value was chosen. */
  choice: { query: string; value: string } | null;
  mode: SnippetMode;
  /** The launcher's words, and the plain link's. */
  words: string;
}

/** Text for an attribute or a link's words. */
function escaped(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
}

export function pathOf(path: string, choice: SnippetInput['choice']): string {
  return choice === null ? path : `${path}?${choice.query}=${encodeURIComponent(choice.value)}`;
}

export function snippetOf(input: SnippetInput): string {
  const path = pathOf(input.path, input.choice);
  const words = escaped(input.words.trim().slice(0, LABEL_MAX));
  const href = escaped(`${input.origin}${input.mount}${path === '/' ? '/' : path}`);
  const data = `data-adminium-app="${escaped(input.app)}" data-path="${escaped(path)}" data-mode="${input.mode}"`;
  const loader = `<script src="${escaped(input.origin)}/x/embed.js" async></script>`;
  if (input.mode === 'button') return `${loader}\n<a ${data} data-label="${words}" href="${href}">${words}</a>`;
  const label = input.mode === 'floating' ? ` data-label="${words}"` : '';
  return `${loader}\n<div ${data}${label}><a href="${href}">${words}</a></div>`;
}
