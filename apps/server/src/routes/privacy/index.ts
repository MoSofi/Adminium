// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Privacy: the privacy notice, the sender's postal address, and one person's
 * data by their address (no screens yet; the privacy page reads these).
 *
 *   GET  /privacy/notice                 the business name and the privacy notice's address
 *   PUT  /privacy/notice                 change them (the address: https only)
 *   GET  /privacy/notice/public          what a page a stranger sees links: the name strangers read, the notice's address
 *   GET  /privacy/postal-address         the sender's postal address (the marketing mail settings)
 *   PUT  /privacy/postal-address         change it
 *   POST /privacy/find                   everything kept about one address, source by source (counts and keys)
 *   POST /privacy/what-stays             what an erasure would leave, and why
 *   GET  /privacy/keeping                how long things are kept
 *   POST /privacy/exports                "Download everything": a .zip, written by a job
 *   GET  /privacy/exports                the downloads this person asked for
 *   GET  /privacy/exports/:id            one of them
 *   GET  /privacy/exports/:id/download   its file, for the person who asked alone
 *
 * ─── Who may ───────────────────────────────────────────────────────────────
 * Everything about a person, and the notice, under the privacy action
 * (`system:privacy:manage`), which only the Super Admin holds unless it is
 * granted on purpose: it reads every people table whole, past the role's
 * table and row limits. A person's data is asked for and downloaded by a
 * signed-in person, never with an API key. The postal address sits on the
 * marketing mail settings and rides their grant, `settings.manage`.
 *
 * ─── What is never written down ────────────────────────────────────────────
 * The address searched for. Every search and download is audited with the
 * counts found and the keyed hash of the address; it goes in a request body,
 * never a URL; the export's row and job keep it hashed and sealed. While the
 * address keys cannot be read (`ADMINIUM_SECRET` changed), a search answers
 * 503 rather than "nothing found".
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { filesRepo, isHttpsPageUrl, privacyExportsRepo, settingsRepo, type EnqueueJobInput, type MetaDb, type PrivacyExport } from '@adminium/meta';

import { audited } from '../../audit/coverage.js';
import { AddressKeysLockedError, type ConsentService } from '../../consent/index.js';
import { sealAddress } from '../../consent/keys.js';
import type { ConnectionManager } from '../../connections/manager.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationFailedError } from '../../errors.js';
import type { FileStore } from '../../files/store.js';
import { businessName, privacyNoticeOf, senderPostalAddress } from '../../privacy/business.js';
import { countsOf, PRIVACY_EXPORT_KIND, personHash } from '../../privacy/export.js';
import { keepingRows } from '../../privacy/keeping.js';
import { findPerson, searchAddress, type PersonFound } from '../../privacy/sources.js';
import { whatStays } from '../../privacy/what-stays.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  keepingReply,
  postalAddressBody,
  postalAddressReply,
  privacyAddressBody,
  privacyExportCreateReply,
  privacyExportListReply,
  privacyExportParams,
  privacyExportReply,
  privacyFindReply,
  privacyNoticeBody,
  privacyNoticeReply,
  publicNoticeReply,
  whatStaysReply,
} from './schema.js';

export interface PrivacyRoutesDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  consent: ConsentService;
  storage: FileStore;
  secret: string;
  enqueue: (input: EnqueueJobInput) => Promise<{ id: string }>;
}

/** The signed-in person asking: never an API key. */
function personOf(request: FastifyRequest): string {
  if (request.apiKeyPrincipal != null) throw new ForbiddenError('A person’s data is asked for by a signed-in person, never with an API key.', 'FORBIDDEN', { reason: 'api-key' });
  const id = (request as unknown as { user?: { id?: string } }).user?.id;
  if (id === undefined) throw new UnauthorizedError();
  return id;
}

/** A text field as kept: trimmed, and null when empty. */
function blankAsNull(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value.trim();
}

function exportView(row: PrivacyExport) {
  return { id: row.id, status: row.status, counts: row.counts, createdAt: row.createdAt, completedAt: row.completedAt, expiresAt: row.expiresAt };
}

export function privacyRoutes(deps: PrivacyRoutesDeps): FastifyPluginAsyncZod {
  const { meta, secret } = deps;
  const settings = settingsRepo(meta);
  const exports = privacyExportsRepo(meta);

  /** The search, with locked keys refused rather than read as "nothing found". */
  async function find(address: string): Promise<PersonFound> {
    try {
      return await findPerson(deps, address);
    } catch (error) {
      if (error instanceof AddressKeysLockedError) throw new AppError(503, 'ADDRESS_KEYS_LOCKED', error.message);
      throw error;
    }
  }

  async function hashOf(address: string) {
    try {
      return await personHash(meta, secret, address);
    } catch (error) {
      if (error instanceof AddressKeysLockedError) throw new AppError(503, 'ADDRESS_KEYS_LOCKED', error.message);
      throw error;
    }
  }

  async function noticeReply() {
    const notice = await privacyNoticeOf(meta);
    return { data: { ...notice, ready: notice.businessName !== null && notice.noticeUrl !== null, shownName: await businessName(meta) } };
  }

  /** One of this person's own downloads, or 404 (somebody else's reads as none at all). */
  async function ownExport(request: FastifyRequest, id: string): Promise<PrivacyExport> {
    const userId = personOf(request);
    const row = await exports.findById(id);
    if (row === null || row.requestedBy !== userId) throw new NotFoundError('No such download.');
    return row;
  }

  return async (app) => {
    const privacy = app.rbac.require(PERMISSIONS.privacyManage);
    const actingUserId = (request: FastifyRequest) => (request.apiKeyPrincipal == null ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null) : null);

    // ── the privacy notice ──────────────────────────────────────────────────
    app.get('/privacy/notice', { preHandler: privacy, schema: { response: { 200: privacyNoticeReply } } }, async () => noticeReply());

    app.put(
      '/privacy/notice',
      { preHandler: privacy, config: { audit: audited('rbac') }, schema: { body: privacyNoticeBody, response: { 200: privacyNoticeReply } } },
      async (request) => {
        const businessName = blankAsNull(request.body.businessName);
        const noticeUrl = blankAsNull(request.body.noticeUrl);
        if (noticeUrl !== null && !isHttpsPageUrl(noticeUrl)) throw new ValidationFailedError('Use an https:// address for the privacy notice, such as https://www.example.com/privacy.', { field: 'noticeUrl' });
        const before = await privacyNoticeOf(meta);
        const at = app.rbac.now();
        if (before.businessName !== businessName) await settings.set('privacy.businessName', businessName, { updatedBy: actingUserId(request), at });
        if (before.noticeUrl !== noticeUrl) await settings.set('privacy.noticeUrl', noticeUrl, { updatedBy: actingUserId(request), at });
        await app.rbac.audit(request, { category: 'settings', action: 'privacy.notice.update', changes: { before: { ...before }, after: { businessName, noticeUrl } } });
        return noticeReply();
      },
    );

    // What a page a stranger sees links to: no sign-in, as the sign-in page's branding is read.
    app.get('/privacy/notice/public', { schema: { response: { 200: publicNoticeReply } } }, async () => {
      const notice = await privacyNoticeOf(meta);
      return { data: { businessName: await businessName(meta), noticeUrl: notice.noticeUrl } };
    });

    // ── the sender's postal address (the marketing mail settings) ───────────
    app.get('/privacy/postal-address', { preHandler: app.rbac.require(PERMISSIONS.settingsManage), schema: { response: { 200: postalAddressReply } } }, async () => ({
      data: { postalAddress: await senderPostalAddress(meta) },
    }));

    app.put(
      '/privacy/postal-address',
      { preHandler: app.rbac.require(PERMISSIONS.settingsManage), config: { audit: audited('rbac') }, schema: { body: postalAddressBody, response: { 200: postalAddressReply } } },
      async (request) => {
        const postalAddress = blankAsNull(request.body.postalAddress);
        const before = await senderPostalAddress(meta);
        if (before !== postalAddress) await settings.set('email.postalAddress', postalAddress, { updatedBy: actingUserId(request), at: app.rbac.now() });
        await app.rbac.audit(request, { category: 'settings', action: 'privacy.postal-address.update', changes: { before: { postalAddress: before }, after: { postalAddress } } });
        return { data: { postalAddress } };
      },
    );

    // ── one person's data ───────────────────────────────────────────────────
    app.post(
      '/privacy/find',
      { preHandler: privacy, config: { audit: audited('rbac'), rateLimitBucket: 'privacy-find' }, schema: { body: privacyAddressBody, response: { 200: privacyFindReply } } },
      async (request) => {
        personOf(request);
        const address = searchAddress(request.body.address);
        const found = await find(address);
        await app.rbac.audit(request, { category: 'data', action: 'privacy.find', changes: { after: { address: await hashOf(address), counts: countsOf(found.sources) } } });
        return {
          data: {
            address: found.address,
            found: found.sources.length > 0,
            person: found.person,
            sources: found.sources.map(({ rows: _rows, ...view }) => view),
          },
        };
      },
    );

    app.post(
      '/privacy/what-stays',
      { preHandler: privacy, config: { audit: audited('rbac'), rateLimitBucket: 'privacy-find' }, schema: { body: privacyAddressBody, response: { 200: whatStaysReply } } },
      async (request) => {
        personOf(request);
        const address = searchAddress(request.body.address);
        const items = await whatStays(meta, await find(address));
        await app.rbac.audit(request, { category: 'data', action: 'privacy.what-stays', changes: { after: { address: await hashOf(address), items: items.length } } });
        return { data: { items } };
      },
    );

    app.get('/privacy/keeping', { preHandler: privacy, schema: { response: { 200: keepingReply } } }, async () => ({
      data: { rows: await keepingRows((key) => settings.get(key)) },
    }));

    // ── "Download everything" ───────────────────────────────────────────────
    app.post(
      '/privacy/exports',
      { preHandler: privacy, config: { audit: audited('rbac'), rateLimitBucket: 'privacy-export' }, schema: { body: privacyAddressBody, response: { 202: privacyExportCreateReply } } },
      async (request, reply) => {
        const userId = personOf(request);
        const address = searchAddress(request.body.address);
        const hash = await hashOf(address);
        const row = await exports.create({ requestedBy: userId, address: hash }, app.rbac.now());
        const job = await deps.enqueue({ kind: PRIVACY_EXPORT_KIND, payload: { exportId: row.id, userId, address: sealAddress(secret, address) }, maxAttempts: 1 });
        await app.rbac.audit(request, { category: 'export', action: 'privacy.export.request', changes: { after: { exportId: row.id, address: hash } } });
        return reply.status(202).send({ data: { ...exportView(row), jobId: job.id } });
      },
    );

    app.get('/privacy/exports', { preHandler: privacy, schema: { response: { 200: privacyExportListReply } } }, async (request) => ({
      data: (await exports.listFor(personOf(request))).map(exportView),
    }));

    app.get('/privacy/exports/:id', { preHandler: privacy, schema: { params: privacyExportParams, response: { 200: privacyExportReply } } }, async (request) => ({
      data: exportView(await ownExport(request, request.params.id)),
    }));

    app.get(
      '/privacy/exports/:id/download',
      { preHandler: privacy, config: { audit: audited('rbac'), rateLimitBucket: 'privacy-export' }, schema: { params: privacyExportParams } },
      async (request, reply) => {
        const row = await ownExport(request, request.params.id);
        if (row.status === 'expired' || (row.expiresAt !== null && row.expiresAt < app.rbac.now())) throw new AppError(410, 'EXPORT_EXPIRED', 'This download has expired: ask for a new one.');
        if (row.status !== 'ready' || row.fileId === null) throw new ConflictError(`The download is ${row.status}.`, 'CONFLICT', { status: row.status });
        const file = await filesRepo(meta).findById(row.fileId);
        if (file === null || file.deletedAt !== null) throw new NotFoundError('The download is no longer stored.');
        await app.rbac.audit(request, { category: 'export', action: 'privacy.export.download', changes: { after: { exportId: row.id, address: row.address, counts: row.counts } } });
        const stream = await deps.storage.read(file);
        return reply
          .header('content-type', 'application/zip')
          .header('content-length', String(file.sizeBytes))
          .header('content-disposition', `attachment; filename="${file.filename.replaceAll(/["\\\r\n]/g, '_')}"`)
          .header('cache-control', 'no-store')
          .send(stream);
      },
    );
  };
}
