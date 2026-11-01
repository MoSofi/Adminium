// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FORMS DOOR — the pages a stranger sees at `/x/`, served like the pay
 * page: always registered, on every host a customer one included, and gated
 * per request by whether the outside can reach this server.
 *
 *   GET  /x/forms/:slug                    the form's page (the `x` bundle); `?frame=1` draws it for a website's frame
 *   GET  /x/forms/api/:slug                what a stranger is shown of the form, in one of its languages
 *   GET  /x/forms/api/:slug/challenge      the human check, bound to the form (solved when Send is pressed)
 *   POST /x/forms/api/:slug/answers        kept for the answer door: 404 until it is built
 *   POST /x/forms/api/:slug/files          kept for the file door: 404 until it is built
 *   GET  /x/api/logo                       the business's logo (the pay page's)
 *   GET  /x/assets/*                       the bundle's own hashed files, and nothing else
 *   GET  /x/embed.js                       the website loader: draws a form in a frame on the owner's site
 *   GET  /x/*                              anything else: "This page isn't available"
 *
 * ─── THE RULES IT KEEPS ────────────────────────────────────────────────────
 * - Every request asks first whether the outside can reach this server, with
 *   the pay page's own check (`payments/reachability.ts`) about the server's
 *   public address, `proxy-hidden` included: behind a proxy that is not
 *   trusted every stranger would look like the proxy, and a form's limits
 *   count strangers by address. While it fails, every page is "not
 *   available", every API call the same 404, and nothing is written. The
 *   public API's own setting (`ADMINIUM_PUBLIC_API_ORIGINS`) is never read:
 *   a form needs no public API.
 * - A form that is not live answers exactly as one that does not exist
 *   (`forms/catalog.ts`), save a closed one, which says it is closed.
 * - A stranger is never shown what an answer becomes, who is told, or the
 *   form's hourly cap (`forms/view.ts`).
 * - Every answer carries the page's own content policy ({@link xContentPolicy}),
 *   set in this plugin's `onSend`, after the global hooks: scripts, styles and
 *   fonts from `/x/assets/` on this host only. A form drawn for a frame may be
 *   framed by the websites the owner listed ("Your websites"), and by nobody
 *   when none is listed; everything else by nobody. The dashboard's own
 *   `X-Frame-Options` is taken off here: the policy's `frame-ancestors` says it.
 * - Nothing is cached but the hashed files (and the loader, for minutes), and
 *   no referrer leaves.
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

import { localeFromTag, type LocaleId } from '@adminium/i18n';
import { createServerI18n } from '@adminium/i18n/server';
import { filesRepo, paymentSettingsRepo, type MetaDb } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { auditExempt } from '../../audit/coverage.js';
import type { FormsCatalog, LiveForm } from '../../forms/catalog.js';
import { formsReach } from '../../forms/reach.js';
import type { ListedWebsites } from '../../forms/websites.js';
import { businessToday, formLanguageFor, strangerBusiness, strangerForm } from '../../forms/view.js';
import { loadOverrideMap } from '../../i18n/server-i18n.js';
import { bcp47 } from '../../i18n/bcp47.js';
import type { FileStore } from '../../files/store.js';
import { negotiateLocale, X_PREFIX } from '../../plugins/surfaces.js';
import { issueChallenge, PROOF_DIFFICULTY, proofKey } from '../../public-api/proof.js';
import { PAY_PAGE_DOC, payPageSchema } from '../payments/ways.js';

export interface FormsDoorDeps {
  meta: MetaDb;
  catalog: FormsCatalog;
  /** `ADMINIUM_SECRET`: what a form's human check is signed under. */
  secret: string;
  /** The logo's bytes. */
  storage: Pick<FileStore, 'read'>;
  /** The websites that may frame a form ("Your websites"). */
  websites: ListedWebsites;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  now?: () => number;
}

/** A form's harder human check: four more zero bits, about sixteen times the work. */
export const HARDER_DIFFICULTY = PROOF_DIFFICULTY + 4;

/** The key a form's human check is bound to: the add-on that holds it and the form's own row. */
export function formProofKeyId(live: Pick<LiveForm, 'addOn' | 'id'>): string {
  return `form:${live.addOn}:${live.id}`;
}

/** How long a browser may keep the loader: a change reaches the owner's site within minutes. */
export const EMBED_MAX_AGE_SECONDS = 300;

const ASSET_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const LOGO_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * The policy every answer of the door carries, for the origin it was asked
 * on. `framers` are the origins that may frame this answer: none, unless it
 * is a form drawn for a frame and the owner listed websites.
 */
export function xContentPolicy(origin: string, framers: readonly string[] = []): string {
  const assets = `${origin}${X_PREFIX}/assets/`;
  return [
    "default-src 'none'",
    `script-src ${assets}`,
    `style-src ${assets}`,
    `font-src ${assets}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    framers.length === 0 ? "frame-ancestors 'none'" : `frame-ancestors ${framers.join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const UNBUILT = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Form</title></head><body><p>This page isn’t available right now.</p></body></html>';

const slugParams = z.object({ slug: z.string().min(1).max(120) });
const pageQuery = z.object({ frame: z.string().max(8).optional(), lang: z.string().max(20).optional() }).passthrough();

function originOf(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Whether this answer is a form's page drawn for a website's frame. */
function framedPage(request: FastifyRequest): boolean {
  const [path = '', query = ''] = request.url.split('?');
  return /^\/x\/forms\/[^/]+$/.test(path) && new URLSearchParams(query).get('frame') === '1';
}

export function formsDoorRoutes(deps: FormsDoorDeps): FastifyPluginAsyncZod {
  const { meta, catalog } = deps;
  const now = deps.now ?? Date.now;
  const key = proofKey(deps.secret);

  async function reachable(request: FastifyRequest): Promise<boolean> {
    return (await formsReach(meta, deps, request)).state === 'reachable';
  }

  /** The form a request names, as strangers may be served it now; never live while the outside cannot reach the server. */
  async function lookUp(request: FastifyRequest, slug: string) {
    if (!(await reachable(request))) return { state: 'unavailable' as const };
    const found = await catalog.find(slug);
    // A named survey is answered by invitation only: no open link draws it.
    if (found.state === 'live' && found.live.form.settings.survey?.mode === 'named') return { state: 'unavailable' as const };
    return found;
  }

  return async (app) => {
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

    // Last word on the headers of everything this plugin answers.
    app.addHook('onSend', async (request, reply, payload) => {
      const framers = framedPage(request) ? await deps.websites() : [];
      void reply.header('content-security-policy', xContentPolicy(originOf(request), framers));
      void reply.header('referrer-policy', 'no-referrer');
      void reply.header('x-content-type-options', 'nosniff');
      void reply.header('x-robots-tag', 'noindex');
      // The policy's frame-ancestors decides who may frame a form; the dashboard's own header would refuse every website.
      reply.removeHeader('x-frame-options');
      if (!request.url.startsWith(`${X_PREFIX}/assets/`) && !request.url.startsWith(`${X_PREFIX}/embed.js`)) void reply.header('cache-control', 'no-store');
      return payload;
    });

    /** The language engine words are drawn in for a browser with no script: asked, else the browser's, else English. */
    function wordsLocale(request: FastifyRequest): LocaleId {
      const asked = (request.query as { lang?: unknown } | undefined)?.lang;
      if (typeof asked === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(asked)) {
        const found = localeFromTag(asked);
        if (bcp47(found) === asked) return found;
      }
      return negotiateLocale(request.headers['accept-language']) ?? 'en_US';
    }

    /** What a browser with JavaScript off reads instead of the page: the page's state, and where to write. */
    async function noscriptFor(request: FastifyRequest, state: 'live' | 'closed' | 'unavailable'): Promise<string> {
      const locale = wordsLocale(request);
      const i18n = await createServerI18n({ locale, overrides: await loadOverrideMap(meta, locale) });
      const t = (k: string, fallback: string, args: Record<string, string> = {}) => i18n.t(k, { defaultValue: fallback, ...args });
      const { business } = await strangerBusiness(meta);
      const title =
        state === 'live' ? t('x:ending.noScript', 'This form needs JavaScript.') : state === 'closed' ? t('x:ending.closed', 'This form is closed.') : t('x:ending.unavailable', 'This page isn’t available.');
      const write = business.email === null ? '' : `<p>${escapeHtml(t('x:ending.noScriptWrite', 'You can also write to {email}.', { email: business.email }))}</p>`;
      return `<p><strong>${escapeHtml(title)}</strong></p>${write}`;
    }

    /** The bundle's page, with the state's own words for a browser with no script. */
    async function page(request: FastifyRequest, reply: FastifyReply, state: 'live' | 'closed' | 'unavailable'): Promise<FastifyReply> {
      const root = await xRoot();
      if (root === null) return reply.status(503).type('text/html; charset=utf-8').send(UNBUILT);
      const html = await readFile(join(root, 'index.html'), 'utf8');
      let noscript: string | null = null;
      try {
        noscript = await noscriptFor(request, state);
      } catch {
        // The built sentence stays: the page itself still works.
      }
      const body = noscript === null ? html : html.replace(/<noscript>[\s\S]*?<\/noscript>/, () => `<noscript>${noscript}</noscript>`);
      return reply
        .status(state === 'unavailable' ? 404 : 200)
        .type('text/html; charset=utf-8')
        .send(body);
    }

    /** "Not available", as an API call is answered: one body, whatever the reason. */
    async function unavailable(reply: FastifyReply): Promise<FastifyReply> {
      return reply.status(404).send({ state: 'unavailable', ...(await strangerBusiness(meta)) });
    }

    app.get('/x/forms/:slug', { config: { rateLimitBucket: 'forms-door' }, schema: { hide: true, params: slugParams, querystring: pageQuery } }, async (request, reply) => {
      const found = await lookUp(request, request.params.slug);
      return page(request, reply, found.state);
    });

    app.get('/x/forms/api/:slug', { config: { rateLimitBucket: 'forms-door' }, schema: { hide: true, params: slugParams, querystring: pageQuery } }, async (request, reply) => {
      const found = await lookUp(request, request.params.slug);
      if (found.state === 'unavailable') return unavailable(reply);
      const shared = await strangerBusiness(meta);
      if (found.state === 'closed') return { state: 'closed', ...shared };
      const { live } = found;
      const language = formLanguageFor(live.form.definition, request.query.lang, request.headers['accept-language']);
      const frame = request.query.frame === '1';
      return {
        state: 'live',
        ...shared,
        form: strangerForm(live.form, language),
        today: await businessToday(meta, live.connectionId, now()),
        // Only a frame asks which websites it may answer: the loader's first message must come from one.
        ...(frame ? { frameOrigins: [...(await deps.websites())] } : {}),
      };
    });

    app.get('/x/forms/api/:slug/challenge', { config: { rateLimitBucket: 'forms-door' }, schema: { hide: true, params: slugParams } }, async (request, reply) => {
      if (!(await reachable(request))) return unavailable(reply);
      const found = await lookUp(request, request.params.slug);
      const live = found.state === 'live' ? found.live : null;
      // An unknown form still gets a challenge: the answer must not tell which forms exist.
      return issueChallenge(key, live === null ? 'form:none' : formProofKeyId(live), 'form', now(), live?.form.settings.limits.harder === true ? HARDER_DIFFICULTY : PROOF_DIFFICULTY);
    });

    // Kept for the answer door and the file door: nothing is taken here yet, and nothing is written.
    for (const part of ['answers', 'files'] as const) {
      app.post(
        `/x/forms/api/:slug/${part}`,
        {
          config: {
            rateLimitBucket: 'forms-door',
            csrf: 'origin',
            audit: auditExempt('a stranger sending a form: the answer row is the record; a stranger is not an actor the audit log names'),
          },
          schema: { hide: true, params: slugParams },
        },
        async (_request, reply) => unavailable(reply),
      );
    }

    app.get('/x/api/logo', { config: { rateLimitBucket: 'forms-door' }, schema: { hide: true } }, async (request, reply) => {
      if (!(await reachable(request))) return reply.status(404).send();
      const settings = await paymentSettingsRepo(meta).get(PAY_PAGE_DOC, payPageSchema).catch(() => null);
      if (settings?.logoFileId == null) return reply.status(404).send();
      const file = await filesRepo(meta).findById(settings.logoFileId);
      if (file === null || !LOGO_TYPES.has(file.mime) || file.deletedAt !== null) return reply.status(404).send();
      return reply.type(file.mime).send(await deps.storage.read(file));
    });

    app.get('/x/assets/*', { config: { rateLimitBucket: 'forms-door' }, schema: { hide: true } }, async (request, reply) => {
      const root = await xRoot();
      const wanted = (request.params as { '*': string })['*'];
      const type = ASSET_TYPES[extname(wanted)];
      if (root === null || type === undefined || !/^[A-Za-z0-9._/-]{1,200}$/.test(wanted) || wanted.includes('..')) return reply.status(404).send();
      const base = join(root, 'assets');
      const file = normalize(join(base, wanted));
      if (!file.startsWith(`${base}${sep}`)) return reply.status(404).send();
      try {
        if (!(await stat(file)).isFile()) return reply.status(404).send();
      } catch {
        return reply.status(404).send();
      }
      // The names carry a hash of what is in them: kept for good.
      return reply.type(type).header('cache-control', 'public, max-age=31536000, immutable').send(createReadStream(file));
    });

    app.get('/x/embed.js', { config: { rateLimitBucket: 'forms-door' }, schema: { hide: true } }, async (_request, reply) => {
      const root = await xRoot();
      let script: string;
      try {
        if (root === null) throw new Error('not built');
        script = await readFile(join(root, 'embed.js'), 'utf8');
      } catch {
        return reply.status(404).send();
      }
      return reply
        .type('text/javascript; charset=utf-8')
        .header('cache-control', `public, max-age=${String(EMBED_MAX_AGE_SECONDS)}`)
        // The owner's website loads it with a plain <script src>: from another origin, so not same-origin only.
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(script);
    });

    // Everything else under the door: not here, and never the dashboard's page.
    const elsewhere = async (request: FastifyRequest, reply: FastifyReply) => page(request, reply, 'unavailable');
    app.get('/x', { config: { rateLimitBucket: 'forms-door' }, schema: { hide: true } }, elsewhere);
    app.get('/x/*', { config: { rateLimitBucket: 'forms-door' }, schema: { hide: true } }, elsewhere);
  };
}
