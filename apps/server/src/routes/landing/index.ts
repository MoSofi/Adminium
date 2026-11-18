// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LANDING PAGES ADD-ON, FOR STAFF: what its editor asks the engine about
 * its pages, under the person's own grants on the add-on's pages table.
 *
 *   POST /landing/:addOn/pictures?page=          a picture for a page: a file of Files (`{ "file": <id> }`)
 *                                                or the picture's bytes as the body; kept as the page's own
 *                                                cleaned copy (`landing/pictures.ts`), answered with its id
 *   GET  /landing/:addOn/pictures/:file?page=    one of a page's own pictures, for the editor's canvas
 *   GET  /landing/:addOn/status?page=            what the editor's blocked cards and its page settings say:
 *                                                the install, the zone view days are counted in and how
 *                                                long counts are kept, reach, notice, the public address,
 *                                                the pages hosts and,
 *                                                for a page, its address on each and whether it is that
 *                                                host's home
 *
 * Who may:
 *  - a picture for a page: who may change the add-on's pages
 *    (`table:<conn>:<pages>:update`), and only for a page of that table. A
 *    file of Files only when the person may read it by the files routes' own
 *    rule (`files/read-rule.ts`), on the page's own database, never one a
 *    record keeps in a secret or a personal column, and never another
 *    person's upload no record took yet: a file they may not read and one that
 *    is not there get the same 404;
 *  - a page's picture and the status: who may read the add-on's pages.
 *  - every route: a role held to some of the pages is refused, as a reader
 *    of view counts is: a page is named here by its key.
 *
 * Only a signed-in person (or a staff key) asks. `?install=` names the
 * install when the add-on is on more than one database.
 */
import { connectionTenantConfig, filesRepo, settingsRepo, type MetaDb, type StoredFile } from '@adminium/meta';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { isRowLimited } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';
import { storedPublicOrigin } from '../../email/door-reach.js';
import { AppError, ForbiddenError, NotFoundError, ValidationFailedError } from '../../errors.js';
import { FileNotFoundError } from '../../files/drivers/driver.js';
import { fileReadRule, type FileReadRuleDeps } from '../../files/read-rule.js';
import type { FileStore } from '../../files/store.js';
import { formsReach, proxyUncheckedOf, type FormsReachFacts } from '../../forms/reach.js';
import type { LandingAddOn, LandingCatalog, PageRow } from '../../landing/catalog.js';
import { canonicalAddress, pageAddresses, pagesHostsByName } from '../../landing/hosts.js';
import { keepPagePicture, LANDING_PICTURE_KIND, pagePictureOf, PagePictureRefused, PICTURE_REFUSED_WORDS } from '../../landing/pictures.js';
import { REACHABILITY_STATES } from '../../payments/reachability.js';
import { privacyNoticeReady } from '../../privacy/business.js';
import { isLandingSlug } from '@adminium/add-on-contracts/landing';
import { pictureHeaders, PICTURE_MAX_BYTES, PICTURE_PIPELINE, readCapped, type PictureMime } from '../../public-api/picture.js';

export interface LandingStaffDeps extends FileReadRuleDeps {
  meta: MetaDb;
  catalog: LandingCatalog;
  storage: Pick<FileStore, 'read' | 'write'>;
  /** The hosts mapped to the add-on pages, each with its home (`surfaces.pageHosts`). */
  pageHosts: () => Promise<Readonly<Record<string, { home: string }>>>;
  /** Whether a record keeps a file in a secret or a personal column (`files/read-limited.ts`). Absent: none does. */
  privateFile?: ((file: StoredFile) => Promise<'secret' | 'personal' | null>) | undefined;
  /** The facts the reach answer reads (the doors' own). */
  reach: FormsReachFacts;
  now?: () => number;
}

/** The largest body taken: a picture past the public limit is read far enough to be refused in words, not cut off by the parser. */
const PICTURE_BODY_LIMIT = PICTURE_MAX_BYTES + 2 * 1024 * 1024;

const params = z.object({ addOn: z.string().min(1).max(80) });
const pictureParams = params.extend({ file: z.string().min(1).max(64) });
const pageQuery = z.object({ page: z.string().min(1).max(64), install: z.string().min(1).max(64).optional(), filename: z.string().trim().min(1).max(200).optional() });
const statusQuery = z.object({ page: z.string().min(1).max(64).optional(), install: z.string().min(1).max(64).optional() });

export const landingPictureReply = z.object({
  data: z.object({
    /** The page's own copy: what its document's `picture.file` names. */
    id: z.string(),
    mime: z.string(),
    sizeBytes: z.number().int(),
  }),
});

/** One host a page answers on, and its address there. */
const pageAddress = z.object({
  host: z.string(),
  /** The page's address on that host (`https://<host>/x/pages/<slug>`). */
  url: z.string(),
  /** Whether that host's `/` goes to this page. */
  home: z.boolean(),
});

export const landingStatusReply = z.object({
  data: z.object({
    /** The add-on's install (`adminium_manifests.id`): what its pages' views are counted under (`GET /api/v1/views?installId=`). */
    installId: z.string(),
    /** The business's time zone the view days are counted in: its database's, else UTC. */
    timeZone: z.string(),
    /** How many months view counts are kept (`privacy.viewCountsMonths`). */
    viewCountsMonths: z.number().int(),
    /** "Can visitors reach your public pages?": the doors' own answer for this request; `state` is the reach words' code. */
    reach: z.object({ state: z.enum(REACHABILITY_STATES), proxyUnchecked: z.boolean() }),
    /** Whether the privacy notice is set: a page is not served until it is. */
    notice: z.boolean(),
    /** This server's public address (`system.publicOrigin`); null while unset. */
    publicOrigin: z.string().nullable(),
    /** The hosts mapped to the add-on pages, by name, each with its home page. */
    hosts: z.array(z.object({ host: z.string(), home: z.string() })),
    /** For `?page=`: its slug, its state, its address on each pages host and on the public address, and its canonical address. */
    page: z
      .object({
        key: z.string(),
        slug: z.string().nullable(),
        state: z.string().nullable(),
        /** Each pages host, then the public address's (never a home). Empty while the slug is not a page address. */
        addresses: z.array(pageAddress),
        /** Where search engines and shared links are sent: the host it is home of, else the first pages host, else the public address. */
        canonical: z.string().nullable(),
        /** The hosts whose home it is: switching it off leaves their `/` on "not available". */
        homeOf: z.array(z.string()),
      })
      .nullable(),
  }),
});

const libraryBody = z.object({ file: z.string().min(1).max(64) }).strict();

function requireUserId(request: FastifyRequest): string {
  const id = request.user?.id;
  if (id === undefined) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  return id;
}

function refused(why: PagePictureRefused['why']): never {
  throw new ValidationFailedError(PICTURE_REFUSED_WORDS, { reason: 'picture-refused', why, maxBytes: PICTURE_MAX_BYTES });
}

export function landingStaffRoutes(deps: LandingStaffDeps): FastifyPluginAsyncZod {
  const { meta, catalog } = deps;
  const now = deps.now ?? Date.now;
  const { canRead } = fileReadRule(deps);

  /**
   * The add-on a request names, for someone who holds `action` on its pages
   * table, whole: 404 when it is not installed, 403 without the grant, and 403
   * for a role held to some of its pages (a page is named by its key here, so
   * one it does not reach would be read or changed past the limit).
   */
  async function addOnFor(app: FastifyInstance, request: FastifyRequest, addOn: string, install: string | undefined, action: 'read' | 'update'): Promise<LandingAddOn> {
    const found = await catalog.forStaff(addOn, install);
    if (found === null) throw new NotFoundError(`"${addOn}" is not an installed landing pages add-on.`);
    if (!(await request.can(`table:${found.connectionId}:${found.pagesTable}:${action}`))) {
      throw new ForbiddenError(action === 'read' ? 'Only someone who may read the pages reads this.' : 'Only someone who may change the pages adds a picture to one.', 'TABLE_FORBIDDEN', { reason: `landing-pages-${action}` });
    }
    const set = await app.rbac.resolve(request);
    if (set.superAdmin !== true) {
      const view = await loadSnapshotView(meta, found.connectionId, { forOthers: true }).catch(() => null);
      const context = view === null ? null : await rowLimitContextOf(meta, set, found.connectionId, view.model);
      if (context !== null && isRowLimited(context, found.pagesTable, action)) {
        throw new ForbiddenError('You may reach only some of the pages, so this is not shown.', 'TABLE_FORBIDDEN', { reason: 'row-limit' });
      }
    }
    return found;
  }

  /** One page of the add-on by its key: 404 when there is none. */
  async function pageOf(addOn: LandingAddOn, key: string): Promise<PageRow> {
    const row = await catalog.pageByKey(addOn, key);
    if (row === null) throw new NotFoundError(`There is no page ${key}.`);
    return row;
  }

  /** A file of Files, read by the files routes' rule, as the bytes of a page's picture; 404 for one the person may not read, alike. */
  async function libraryBytes(request: FastifyRequest, userId: string, addOn: LandingAddOn, fileId: string): Promise<{ bytes: Buffer; filename: string; from: string }> {
    const missing = (): NotFoundError => new NotFoundError(`File ${fileId} not found.`);
    const source = await filesRepo(meta).findById(fileId);
    // A person's upload, or another page's own picture (its pages table is then the record it hangs on).
    if (source === null || (source.kind !== 'upload' && source.kind !== LANDING_PICTURE_KIND) || source.deletedAt !== null) throw missing();
    // On the page's own database: a file of another one, or of none, is not copied across.
    if (source.entityConnectionId !== addOn.connectionId) throw missing();
    if (!(await canRead(request, source))) throw missing();
    // An upload no record took yet is its uploader's alone.
    if (source.attachedAt === null && source.uploadedBy !== userId) throw missing();
    // A secret column's file is copied by nobody, and a personal one never onto a page anybody reads.
    const kept = (await deps.privateFile?.(source)) ?? null;
    if (kept !== null) throw missing();
    if (source.sizeBytes > PICTURE_MAX_BYTES) refused('size');
    try {
      return { bytes: await readCapped(await deps.storage.read(source), PICTURE_MAX_BYTES), filename: source.filename, from: source.id };
    } catch (error) {
      if (error instanceof FileNotFoundError) throw missing();
      // Grown past the limit since it was written down: refused in words.
      refused('size');
    }
  }

  return async (app) => {
    // The bytes of a picture, whatever type the browser says: read here, judged by what they are.
    app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: PICTURE_BODY_LIMIT }, (_request, body, done) => {
      done(null, body);
    });

    app.post(
      '/landing/:addOn/pictures',
      {
        preHandler: [app.requireAuth],
        bodyLimit: PICTURE_BODY_LIMIT,
        // A copy writes bytes as an upload does, so it spends the uploads' budget.
        config: { rateLimitBucket: 'upload', audit: audited('rbac') },
        schema: {
          tags: ['landing'],
          summary: 'Keep a picture for a landing page',
          description:
            'A picture for one page of a landing pages add-on: a file of Files (`{ "file": <id> }`, one the person may read) or the picture as the body. Kept as the page’s own cleaned copy (PNG, JPEG, WebP or GIF, at most 5 MB; never SVG), and answered with its id. For someone who may change the add-on’s pages.',
          params,
          querystring: pageQuery,
          response: { 201: landingPictureReply },
        },
      },
      async (request, reply) => {
        const userId = requireUserId(request);
        const addOn = await addOnFor(app, request, request.params.addOn, request.query.install, 'update');
        const page = await pageOf(addOn, request.query.page);
        const body = request.body;
        let source: { bytes: Buffer; filename: string; from: string | null };
        if (Buffer.isBuffer(body)) {
          source = { bytes: body, filename: request.query.filename ?? 'picture', from: null };
        } else {
          const asked = libraryBody.safeParse(body);
          if (!asked.success) throw new ValidationFailedError('Send a picture, or name a file of Files as `file`.', { reason: 'picture-missing' });
          source = await libraryBytes(request, userId, addOn, asked.data.file);
        }
        let kept: StoredFile;
        try {
          kept = await keepPagePicture({ meta, storage: deps.storage }, { bytes: source.bytes, filename: source.filename, owner: { connectionId: addOn.connectionId, pagesTable: addOn.pagesTable, page: page.key, pk: addOn.pk }, uploadedBy: userId, at: now() });
        } catch (error) {
          if (error instanceof PagePictureRefused) refused(error.why);
          throw error;
        }
        await app.rbac.audit(request, {
          category: 'data',
          action: 'landing.picture',
          connectionId: addOn.connectionId,
          changes: { after: { addOn: addOn.addOn, page: page.key, file: kept.id, ...(source.from === null ? {} : { from: source.from }), sizeBytes: kept.sizeBytes } },
        });
        return reply.status(201).send({ data: { id: kept.id, mime: kept.mime, sizeBytes: kept.sizeBytes } });
      },
    );

    app.get(
      '/landing/:addOn/pictures/:file',
      {
        preHandler: [app.requireAuth],
        schema: {
          tags: ['landing'],
          summary: 'One picture of a landing page, for its editor',
          description: 'The bytes of one of a page’s own pictures, as strangers are served them once the page is live. For someone who may read the add-on’s pages.',
          params: pictureParams,
          querystring: pageQuery.omit({ filename: true }),
        },
      },
      async (request, reply) => {
        const addOn = await addOnFor(app, request, request.params.addOn, request.query.install, 'read');
        const page = await pageOf(addOn, request.query.page);
        const file = await pagePictureOf(meta, { connectionId: addOn.connectionId, pagesTable: addOn.pagesTable, page: page.key }, request.params.file);
        if (file === null) throw new NotFoundError(`File ${request.params.file} not found.`);
        let bytes: Buffer;
        try {
          bytes = await readCapped(await deps.storage.read(file), PICTURE_MAX_BYTES);
        } catch {
          throw new NotFoundError(`File ${request.params.file} not found.`);
        }
        const headers = pictureHeaders({ mime: file.mime as PictureMime, etag: `"${PICTURE_PIPELINE}-${file.sha256}"` }, 'picture', bytes.length);
        // The person's own read: kept by their browser alone, and by no other site.
        const { 'access-control-allow-origin': _anyone, 'cross-origin-resource-policy': _anywhere, ...own } = headers;
        return reply.headers({ ...own, 'cache-control': 'private, max-age=60' }).send(bytes);
      },
    );

    app.get(
      '/landing/:addOn/status',
      {
        preHandler: [app.requireAuth],
        schema: {
          tags: ['landing'],
          summary: 'What a landing pages editor shows about where its pages answer',
          description:
            'Whether strangers can reach the pages, whether the privacy notice is set, the public address, the hosts mapped to the add-on pages and, for a page, its address on each and whether it is that host’s home. For someone who may read the add-on’s pages.',
          params,
          querystring: statusQuery,
          response: { 200: landingStatusReply },
        },
      },
      async (request) => {
        const addOn = await addOnFor(app, request, request.params.addOn, request.query.install, 'read');
        const [answer, notice, publicOrigin, mapped, tenant, viewCountsMonths] = await Promise.all([
          formsReach(meta, deps.reach, request),
          privacyNoticeReady(meta),
          storedPublicOrigin(meta),
          deps.pageHosts().catch(() => ({})),
          connectionTenantConfig(meta, addOn.connectionId),
          settingsRepo(meta).get('privacy.viewCountsMonths'),
        ]);
        const hosts = pagesHostsByName(mapped);
        let page: z.infer<typeof landingStatusReply>['data']['page'] = null;
        if (request.query.page !== undefined) {
          const row = await pageOf(addOn, request.query.page);
          const slug = isLandingSlug(row.slug) ? row.slug : null;
          const addresses = slug === null ? [] : pageAddresses(hosts, publicOrigin, slug);
          page = {
            key: row.key,
            slug,
            state: typeof row.state === 'string' ? row.state : null,
            addresses,
            canonical: canonicalAddress(addresses)?.url ?? null,
            homeOf: addresses.filter((one) => one.home).map((one) => one.host),
          };
        }
        return {
          data: {
            installId: addOn.installId,
            // The zone the counter counts days in (`views/wiring.ts` `zoneOfInstall`).
            timeZone: tenant?.timezone ?? 'UTC',
            viewCountsMonths,
            reach: { state: answer.state, proxyUnchecked: proxyUncheckedOf(deps.reach, request) },
            notice,
            publicOrigin,
            hosts,
            page,
          },
        };
      },
    );
  };
}
