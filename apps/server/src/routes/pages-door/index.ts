// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PAGES DOOR — a landing page a stranger sees at `/x/pages/<slug>`,
 * served like the forms door: always registered, on every host a customer
 * one included, and gated per request by whether the outside can reach this
 * server.
 *
 *   GET /x/pages/:slug                       the page (the `x` bundle), with its head written here;
 *                                            `?preview=1` its draft, for staff who may read the add-on's pages
 *   GET /x/pages/api/:slug                   what the page draws: its document, its language, the business,
 *                                            the forms its Form blocks name, its pictures' and links' addresses
 *   GET /x/pages/api/:slug/pictures/:file    one of the page's own pictures, while the page is live
 *
 * ─── THE RULES IT KEEPS ────────────────────────────────────────────────────
 * - Every request asks first whether the outside can reach this server (the
 *   forms door's rule, `forms/reach.ts`, `proxy-hidden` included): while it
 *   fails, every page is "not available", every call the same 404.
 * - A page that is a draft, switched off, unknown, no longer parses, of a
 *   package nobody vouches for, of an add-on switched off, or while the
 *   privacy notice is unset answers exactly as one that does not exist
 *   (`landing/catalog.ts`).
 * - Every route is public (`security/route-audience.ts`), hidden with every
 *   other public door while the operator holds them back.
 * - Every answer carries the `/x/` doors' headers (`../x-door/headers.ts`):
 *   a page is framed by nobody (a preview by this host alone), and is
 *   `noindex` save a live page asked on its canonical host (below). A trial's
 *   `noindex, nofollow` wins over everything (`trial/public-pages.ts`).
 *
 * ─── THE HEAD (`../x-door/head.ts`) ────────────────────────────────────────
 * A link preview runs no script, so the page's language and direction, its
 * title, its description, `og:*`, `twitter:card` and its canonical address
 * are written into the HTML here, every value escaped. The canonical host is
 * the mapped pages host whose home this page is; else the first mapped pages
 * host (by name: the settings' key order is not kept by Postgres and MySQL);
 * else the host of the public address (`system.publicOrigin`). A live page is
 * indexable only on that host: on any other (the staff host, an app's
 * customer domain) it keeps `noindex` and names the canonical address. Its
 * sharing picture goes out as an absolute `og:image` on that host.
 *
 * ─── THE PICTURES (`landing/pictures.ts`) ──────────────────────────────────
 * A picture is served only when the page is live, its published document
 * names the file, and the file is one of that page's own copies: a file id of
 * Files, of another page, or of a page switched off answers 404. It carries
 * the public picture's headers (`public-api/picture.ts`): kept five minutes,
 * then asked again by its tag, so a page taken down stops showing it. A
 * preview's picture is a draft's: `private, no-store`, no
 * `Access-Control-Allow-Origin`, and readable by this site alone, so no
 * shared cache in front of the server keeps it for the next asker.
 *
 * A live page's data (its forms, its links' addresses, the business day) is
 * kept {@link PAGE_DATA_MS} per page and dropped on any write to a pages or
 * forms table; the counter and the banner's block are per request.
 *
 * ─── COUNTING ───────────────────────────────────────────────────────────────
 * A live page's data read counts one `page` view (`views/counter.ts`: bots
 * and prefetches left out, one per address and page every half hour, nothing
 * while counting is off), and carries the banner's block at "Per visitor"
 * (`views/visitor.ts`). Its HTML, a preview, a picture and a page that is not
 * available count nothing.
 *
 * ─── THE PREVIEW ───────────────────────────────────────────────────────────
 * `?preview=1` (and the row's `page` key, where two rows share a slug) on the
 * page, its data and its pictures draws the page's DRAFT, whatever its state,
 * Milo's marks allowed: only for a signed-in person (the dashboard's own
 * session, on this host) who may read the add-on's pages table whole (a role
 * held to some of its rows is refused). Every other request is a stranger's,
 * whatever cookie it carries (`../x-door/stranger.ts`). It is not
 * held to whether the outside can reach the server, it may be framed by this
 * host alone, it is always `noindex`, and it writes and counts nothing.
 */
import { formBlocksOf, pageLinks, pagePictures, parseLandingPage, type LandingPage } from '@adminium/add-on-contracts/landing';
import type { MetaDb } from '@adminium/meta';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { storedPublicOrigin } from '../../email/door-reach.js';
import type { FileStore } from '../../files/store.js';
import type { FormsCatalog } from '../../forms/catalog.js';
import { isNamedSurvey } from '../../forms/invitation.js';
import { formsReach } from '../../forms/reach.js';
import { businessToday, strangerBusiness, strangerForm, type StrangerForm } from '../../forms/view.js';
import { pageLanguageOf, type LandingAddOn, type LandingCatalog, type LivePage, type PageRow } from '../../landing/catalog.js';
import { canonicalAddress, pageAddresses, pagesHostsByName, type PageAddress } from '../../landing/hosts.js';
import { pagePictureOf } from '../../landing/pictures.js';
import { matchesTag, pictureHeaders, PICTURE_MAX_BYTES, PICTURE_PIPELINE, readCapped, type PictureMime } from '../../public-api/picture.js';
import { normalizeHost } from '../../security/csrf.js';
import { tagRoutes } from '../../security/route-audience.js';
import type { ViewCounter } from '../../views/counter.js';
import type { VisitorDoor } from '../../views/visitor.js';
import { jsonOf } from '../../forms/catalog.js';
import { framedPageOf, xDoorHeaders } from '../x-door/headers.js';
import { mayPreview } from '../x-door/preview-reader.js';
import { strangerDoor } from '../x-door/stranger.js';
import { directionOf, ogLocaleOf, type XHead } from '../x-door/head.js';
import { xPages, type XPageWords } from '../x-door/page.js';

export interface PagesDoorDeps {
  meta: MetaDb;
  catalog: LandingCatalog;
  /** The live forms a Form block names, as the forms door serves them. */
  forms: Pick<FormsCatalog, 'byKey'>;
  /** A picture's bytes. */
  storage: Pick<FileStore, 'read'>;
  /** The hosts mapped to the add-on pages, each with its home (`surfaces.pageHosts`). */
  pageHosts: () => Promise<Readonly<Record<string, { home: string }>>>;
  /** A live page's views are counted (`views/counter.ts`); absent, nothing is counted. */
  views?: Pick<ViewCounter, 'count'> | undefined;
  /** "Per visitor": the banner's words and the visitor's cookie (`views/visitor.ts`); absent, nothing of it. */
  visitors?: Pick<VisitorDoor, 'block'> | undefined;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  now?: () => number;
}

/** What a browser with no script reads on a landing page, by its state. */
const PAGES_PAGE_WORDS: XPageWords = {
  live: { key: 'x:pages.noScript', fallback: 'This page needs JavaScript.' },
  closed: { key: 'x:ending.unavailable', fallback: 'This page isn’t available.' },
  unavailable: { key: 'x:ending.unavailable', fallback: 'This page isn’t available.' },
};

/** How long a live page's data is kept, per page: dropped sooner on any write to a pages or forms table. */
export const PAGE_DATA_MS = 30_000;
/** The most pages whose data is kept at once. */
const PAGE_DATA_MAX = 500;

/** No landing page is drawn in a website's frame. */
const PAGES_FRAMED: readonly RegExp[] = [];

const slugParams = z.object({ slug: z.string().min(1).max(120) });
const pictureParams = z.object({ slug: z.string().min(1).max(120), file: z.string().min(1).max(64) });
const pageQuery = z.object({ preview: z.string().max(8).optional(), page: z.string().max(64).optional() }).passthrough();

/** A form a Form block draws: as the forms door serves it, in the page's language. */
export interface PageForm {
  slug: string;
  form: StrangerForm;
  today: string;
}

/** What the page's data read answers: everything the bundle draws the page from. */
export interface PageData {
  state: 'live';
  /** The page row's key. */
  key: string;
  language: string;
  dir: 'ltr' | 'rtl';
  page: LandingPage;
  /** By forms add-on, then by the form row's key: the form, or null when it is not live or has no version in the page's language. */
  forms: Record<string, Record<string, PageForm | null>>;
  /** Each picture the page names, by its file id: its address under this door. */
  pictures: Record<string, string>;
  /** Each page a link names, by its key: its address, or null while it is not live. */
  links: Record<string, string | null>;
  preview?: true;
}

/** The form's own language that is the page's, by its tag (any case); null when the form is not written in it. */
function formLanguageMatching(languages: readonly string[], language: string): string | null {
  return languages.find((one) => one.toLowerCase() === language.toLowerCase()) ?? null;
}

export function pagesDoorRoutes(deps: PagesDoorDeps): FastifyPluginAsyncZod {
  const { meta, catalog } = deps;
  const now = deps.now ?? Date.now;

  async function reachable(request: FastifyRequest): Promise<boolean> {
    return (await formsReach(meta, deps, request)).state === 'reachable';
  }

  /** The page a request names, as strangers may be served it now; never while the outside cannot reach the server. */
  async function liveFor(request: FastifyRequest, slug: string): Promise<LivePage | null> {
    if (!(await reachable(request))) return null;
    const found = await catalog.find(slug);
    return found.state === 'live' ? found.live : null;
  }

  /** The requests answered with a preview: framed by this host alone. */
  const previewing = new WeakSet<FastifyRequest>();
  /** The requests answered with a live page on its canonical host: these may be indexed. */
  const indexable = new WeakSet<FastifyRequest>();
  /** The requests answered with a picture: its own policy and cache time. */
  const pictures = new WeakSet<FastifyRequest>();

  /**
   * A page's draft for its preview: only for a signed-in person who may read
   * its pages table whole (a role held to some pages is refused,
   * `../x-door/preview-reader.ts`); null for everyone else, and for a draft
   * that does not parse.
   */
  async function previewOf(request: FastifyRequest, slug: string, key: string | undefined): Promise<{ addOn: LandingAddOn; row: PageRow; page: LandingPage; language: string } | null> {
    if (request.user === null || request.user === undefined || request.session === null || request.session === undefined) return null;
    const found = await catalog.draft(slug, key);
    if (found === null || !(await mayPreview(meta, request, found.addOn.connectionId, found.addOn.pagesTable))) return null;
    const parsed = parseLandingPage(jsonOf(found.row.draft) ?? null);
    const language = pageLanguageOf(found.row.language);
    if (!parsed.ok || language === null) return null;
    previewing.add(request);
    return { addOn: found.addOn, row: found.row, page: parsed.page, language };
  }

  /** The address a live page is canonical on (`landing/hosts.ts`); null while there is none (no pages host, no public address). */
  async function canonicalOf(slug: string): Promise<PageAddress | null> {
    const hosts = pagesHostsByName(await deps.pageHosts().catch(() => ({})));
    return canonicalAddress(pageAddresses(hosts, await storedPublicOrigin(meta), slug));
  }

  /** Where a page's picture is served from, under this door. */
  const pictureAddress = (slug: string, file: string, preview: string | null): string =>
    `/x/pages/api/${encodeURIComponent(slug)}/pictures/${encodeURIComponent(file)}${preview === null ? '' : `?preview=1&page=${encodeURIComponent(preview)}`}`;

  /** The head of a page: its words always, its sharing tags and canonical address only for a live one. */
  async function headOf(request: FastifyRequest, page: LandingPage, language: string, live: { slug: string } | null): Promise<XHead> {
    const head: XHead = { lang: language, dir: directionOf(language), title: page.title, description: page.description, indexable: false };
    if (live === null) return head;
    const canonical = await canonicalOf(live.slug);
    if (canonical === null) return head;
    const origin = new URL(canonical.url).origin;
    const picture = page.picture?.file;
    head.share = { url: canonical.url, locale: ogLocaleOf(language), ...(picture === undefined ? {} : { image: `${origin}${pictureAddress(live.slug, picture, null)}` }) };
    head.indexable = request.host !== undefined && normalizeHost(request.host) === canonical.host;
    return head;
  }

  /** The forms the page's Form blocks name, each as the forms door serves it, in the page's language (or null). */
  async function formsOf(page: LandingPage, language: string): Promise<PageData['forms']> {
    const out: PageData['forms'] = {};
    for (const block of formBlocksOf(page)) {
      const byAddOn = (out[block.addOn] ??= {});
      if (block.form in byAddOn) continue;
      const found = await deps.forms.byKey(block.addOn, block.form);
      // Live only, never a named survey (it opens by invitation alone), and in the page's own language (else left out).
      const own = found.state === 'live' && !isNamedSurvey(found.live.form) ? formLanguageMatching(found.live.form.definition.languages, language) : null;
      byAddOn[block.form] =
        found.state === 'live' && own !== null
          ? { slug: found.live.slug, form: strangerForm(found.live.form, own as never), today: await businessToday(meta, found.live.connectionId, now()) }
          : null;
    }
    return out;
  }

  /** The addresses of the pages its links name: a live page of the same add-on, else null. Only the rows it names are read. */
  async function linksOf(page: LandingPage, addOn: Pick<LandingAddOn, 'connectionId' | 'pagesTable' | 'pk'>): Promise<PageData['links']> {
    const keys = [...new Set(pageLinks(page).flatMap(({ link }) => (link.kind === 'page' ? [link.key] : [])))];
    if (keys.length === 0) return {};
    const live = new Map<string, string>();
    for (const one of await catalog.livePagesOf(addOn, keys)) if (!live.has(one.key)) live.set(one.key, one.slug);
    return Object.fromEntries(keys.map((key) => [key, live.has(key) ? `/x/pages/${encodeURIComponent(live.get(key)!)}` : null]));
  }

  /** Everything the bundle draws a page from. */
  async function dataOf(input: { slug: string; key: string; language: string; page: LandingPage; addOn: Pick<LandingAddOn, 'connectionId' | 'pagesTable' | 'pk'>; preview: boolean }): Promise<PageData> {
    const { slug, key, language, page } = input;
    return {
      state: 'live',
      key,
      language,
      dir: directionOf(language),
      page,
      forms: await formsOf(page, language),
      pictures: Object.fromEntries(pagePictures(page).map((file) => [file, pictureAddress(slug, file, input.preview ? key : null)])),
      links: await linksOf(page, input.addOn),
      ...(input.preview ? { preview: true as const } : {}),
    };
  }

  /**
   * A live page's data, kept {@link PAGE_DATA_MS} per slug: a flood of
   * strangers reading one page reads its forms, its links and its business
   * day once in that time, not once a request. Dropped at once when the
   * catalog says the pages changed (any write to a landing pages table or a
   * forms table, `catalog.changes`). The counter and the banner's block stay
   * per request.
   */
  const dataCache = new Map<string, { at: number; generation: number; data: Promise<PageData> }>();
  function liveData(live: LivePage): Promise<PageData> {
    const at = now();
    const generation = catalog.changes();
    const id = JSON.stringify([live.installId, live.key, live.slug]);
    const kept = dataCache.get(id);
    if (kept !== undefined && kept.generation === generation && at - kept.at < PAGE_DATA_MS) return kept.data;
    if (dataCache.size >= PAGE_DATA_MAX) {
      for (const [one, entry] of dataCache) if (entry.generation !== generation || at - entry.at >= PAGE_DATA_MS) dataCache.delete(one);
      if (dataCache.size >= PAGE_DATA_MAX) dataCache.clear();
    }
    const data = dataOf({ slug: live.slug, key: live.key, language: live.language, page: live.page, addOn: { connectionId: live.connectionId, pagesTable: live.pagesTable, pk: live.pk }, preview: false });
    dataCache.set(id, { at, generation, data });
    // A read that failed is not kept.
    data.catch(() => dataCache.delete(id));
    return data;
  }

  return async (app) => {
    // Doors anybody may open: hidden with the other public pages (`security/route-audience.ts`).
    tagRoutes(app, 'public');
    // A stranger's door: a signed-in person's session or key is let go, a preview's read aside (`../x-door/stranger.ts`).
    strangerDoor(app);
    // Last word on the headers of everything this plugin answers (`../x-door/headers.ts`).
    xDoorHeaders(app, {
      framed: framedPageOf(PAGES_FRAMED),
      websites: async () => [],
      previewing: (request) => previewing.has(request),
      indexable: (request) => indexable.has(request),
      ownHeaders: (request) => pictures.has(request),
    });
    const { page: drawPage } = xPages(app, meta, PAGES_PAGE_WORDS);

    /** "Not available", as an API call is answered: one body, whatever the reason. */
    async function unavailable(reply: FastifyReply): Promise<FastifyReply> {
      return reply.status(404).send({ state: 'unavailable', ...(await strangerBusiness(meta)) });
    }

    const door = { rateLimitBucket: 'pages-door' as const };

    app.get('/x/pages/:slug', { config: door, schema: { hide: true, params: slugParams, querystring: pageQuery } }, async (request, reply) => {
      const { slug } = request.params;
      if (request.query.preview !== undefined) {
        const draft = request.query.preview === '1' ? await previewOf(request, slug, request.query.page) : null;
        if (draft === null) return drawPage(request, reply, 'unavailable');
        return drawPage(request, reply, 'live', await headOf(request, draft.page, draft.language, null));
      }
      const live = await liveFor(request, slug);
      if (live === null) return drawPage(request, reply, 'unavailable');
      const head = await headOf(request, live.page, live.language, live);
      if (head.indexable) indexable.add(request);
      return drawPage(request, reply, 'live', head);
    });

    app.get('/x/pages/api/:slug', { config: door, schema: { hide: true, params: slugParams, querystring: pageQuery } }, async (request, reply) => {
      const { slug } = request.params;
      if (request.query.preview !== undefined) {
        const draft = request.query.preview === '1' ? await previewOf(request, slug, request.query.page) : null;
        if (draft === null) return unavailable(reply);
        // The draft, marks and all, drawn for its editor: nothing is counted.
        const data = await dataOf({ slug, key: draft.row.key, language: draft.language, page: draft.page, addOn: draft.addOn, preview: true });
        return { ...(await strangerBusiness(meta)), ...data };
      }
      const live = await liveFor(request, slug);
      if (live === null) return unavailable(reply);
      const data = await liveData(live);
      // Counted here, where only a browser running the page asks: never the page's HTML, which a link preview fetches.
      deps.views?.count({ installId: live.installId, kind: 'page', thing: live.key, request });
      // The banner, at "Per visitor": a landing page is always the install's own page, never in a frame.
      const visitor = deps.visitors === undefined ? {} : await deps.visitors.block(request, { language: live.language, framed: false });
      return { ...(await strangerBusiness(meta)), ...visitor, ...data };
    });

    app.get('/x/pages/api/:slug/pictures/:file', { config: door, schema: { hide: true, params: pictureParams, querystring: pageQuery } }, async (request, reply) => {
      const { slug, file: fileId } = request.params;
      const none = () => reply.status(404).send();
      let owner: { connectionId: string; pagesTable: string; page: string; preview: boolean } | null = null;
      if (request.query.preview !== undefined) {
        const draft = request.query.preview === '1' ? await previewOf(request, slug, request.query.page) : null;
        if (draft !== null && pagePictures(draft.page).includes(fileId)) owner = { connectionId: draft.addOn.connectionId, pagesTable: draft.addOn.pagesTable, page: draft.row.key, preview: true };
      } else {
        const live = await liveFor(request, slug);
        // Only a file the live page's published document names: never one because its id was asked.
        if (live !== null && pagePictures(live.page).includes(fileId)) owner = { connectionId: live.connectionId, pagesTable: live.pagesTable, page: live.key, preview: false };
      }
      if (owner === null) return none();
      const file = await pagePictureOf(meta, owner, fileId);
      if (file === null) return none();
      pictures.add(request);
      // The bytes are the cleaned copy (`landing/pictures.ts`): its tag is the pipeline's and its hash, as a cleaned public picture's.
      const picture = { mime: file.mime as PictureMime, etag: `"${PICTURE_PIPELINE}-${file.sha256}"` };
      const preview = owner.preview;
      // A draft's picture is the editor's own read: kept by no cache (a shared one would hand it to anyone), read by no other site.
      const headersOf = (bytes?: number) => {
        const headers = pictureHeaders(picture, 'picture', bytes);
        if (!preview) return headers;
        const { 'access-control-allow-origin': _anyone, ...own } = headers;
        return { ...own, 'cache-control': 'private, no-store', 'cross-origin-resource-policy': 'same-origin' };
      };
      if (matchesTag(request.headers['if-none-match'], picture.etag)) {
        reply.headers(headersOf());
        return reply.code(304).send();
      }
      let bytes: Buffer;
      try {
        bytes = await readCapped(await deps.storage.read(file), PICTURE_MAX_BYTES);
      } catch {
        pictures.delete(request);
        return none();
      }
      reply.headers(headersOf(bytes.length));
      return reply.send(bytes);
    });
  };
}
