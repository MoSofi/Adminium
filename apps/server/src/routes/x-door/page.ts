// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PAGE OF EVERY `/x/` DOOR — the bundle's `index.html`, with words for a
 * browser that runs no script.
 *
 * Every door draws its stranger's page from the one `x` bundle (a form, a
 * chat, a landing page), so each serves the same file; only what a browser
 * with JavaScript off reads differs, the head a door writes for its page
 * (`head.ts`: its language, title and sharing tags, and whether it may be
 * indexed), and the status (404 for a page that is not available). Each door
 * makes its pages with {@link xPages} inside its own plugin.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { localeFromTag, type LocaleId } from '@adminium/i18n';
import { createServerI18n } from '@adminium/i18n/server';
import type { MetaDb } from '@adminium/meta';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { strangerBusiness } from '../../forms/view.js';
import { bcp47 } from '../../i18n/bcp47.js';
import { loadOverrideMap } from '../../i18n/server-i18n.js';
import { negotiateLocale } from '../../plugins/surfaces.js';
import { escapeHtml, withHead, type XHead } from './head.js';

/** The page while the bundle is not built: plain words, nothing to load. */
const UNBUILT = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Form</title></head><body><p>This page isn’t available right now.</p></body></html>';

export { escapeHtml };

/** A page's state, as its words for a browser with no script say it. */
export type XPageState = 'live' | 'closed' | 'unavailable';

/** One sentence of the `x` namespace, and its English. */
export interface XWord {
  key: string;
  fallback: string;
}

/** What a browser with no script reads for each state a door's page may be in. */
export type XPageWords = Readonly<Record<XPageState, XWord>>;

/** The pages of one door, inside its own plugin. */
export function xPages(app: FastifyInstance, meta: MetaDb, words: XPageWords) {
  /** Where the built bundle is, or null while it is not built. */
  async function xRoot(): Promise<string | null> {
    const spa = (app as unknown as { spaRoot: string | null }).spaRoot;
    if (spa === null || spa === undefined) return null;
    const root = join(spa, 'x');
    try {
      return (await stat(join(root, 'index.html'))).isFile() ? root : null;
    } catch {
      return null;
    }
  }

  /**
   * The language engine words are drawn in for a browser with no script: the
   * page's own (a landing page is written in one), else the one asked, else
   * the browser's, else English.
   */
  function wordsLocale(request: FastifyRequest, own?: string): LocaleId {
    for (const asked of [own, (request.query as { lang?: unknown } | undefined)?.lang]) {
      if (typeof asked === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(asked)) {
        const found = localeFromTag(asked);
        if (bcp47(found) === asked) return found;
      }
    }
    return negotiateLocale(request.headers['accept-language']) ?? 'en_US';
  }

  /** What a browser with JavaScript off reads instead of the page: the page's state, and where to write. */
  async function noscriptFor(request: FastifyRequest, state: XPageState, own?: string): Promise<string> {
    const locale = wordsLocale(request, own);
    const i18n = await createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
    const t = (k: string, fallback: string, args: Record<string, string> = {}) => i18n.t(k, { defaultValue: fallback, ...args });
    const { business } = await strangerBusiness(meta);
    const title = t(words[state].key, words[state].fallback);
    const write = business.email === null ? '' : `<p>${escapeHtml(t('x:ending.noScriptWrite', 'You can also write to {email}.', { email: business.email }))}</p>`;
    return `<p><strong>${escapeHtml(title)}</strong></p>${write}`;
  }

  /** The bundle's page, with the state's own words for a browser with no script, and the head the door wrote for it (none: the file's own). */
  async function page(request: FastifyRequest, reply: FastifyReply, state: XPageState, head?: XHead): Promise<FastifyReply> {
    const root = await xRoot();
    if (root === null) return reply.status(503).type('text/html; charset=utf-8').send(UNBUILT);
    const html = await readFile(join(root, 'index.html'), 'utf8');
    let noscript: string | null = null;
    try {
      noscript = await noscriptFor(request, state, head?.lang);
    } catch {
      // The built sentence stays: the page itself still works.
    }
    const swapped = noscript === null ? html : html.replace(/<noscript>[\s\S]*?<\/noscript>/, () => `<noscript>${noscript}</noscript>`);
    const body = head === undefined ? swapped : withHead(swapped, head);
    return reply
      .status(state === 'unavailable' ? 404 : 200)
      .type('text/html; charset=utf-8')
      .send(body);
  }

  return { xRoot, page, wordsLocale };
}
