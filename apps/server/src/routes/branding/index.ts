/**
 * Branding resource — the white-label chrome (Adminium ships as a product an
 * operator rebrands, so the rail wordmark, the logo mark and the version chip
 * are all configuration, not constants).
 *
 * - `GET    /branding`        — PUBLIC. Name + logo URL + version-chip flag.
 * - `GET    /branding/logo`   — PUBLIC. The stored logo bytes.
 * - `POST   /branding/logo`   — raw image body → files storage (kind
 *   `branding`) + `branding.logoFileId`. `system:settings:manage`.
 * - `DELETE /branding/logo`   — back to the built-in mark. Same guard.
 *
 * WHY THE READS ARE PUBLIC: the sign-in screen is the first surface anyone
 * sees, and a white label that only applies AFTER you authenticate is not a
 * white label. Neither route discloses anything a signed-out visitor could not
 * already read off that screen — the app's own name and mark. The version
 * string is deliberately NOT here: `showVersion` travels, the number itself
 * stays in the authenticated bootstrap payload.
 *
 * Uploads are sniffed, not trusted: the declared content-type only selects a
 * parser, and `sniffLogo` re-derives the type from the leading bytes. A file
 * that lies about what it is never reaches storage, so the mime this route
 * later serves the bytes back with is one it verified itself.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { filesRepo, newId, settingsRepo, type MetaDb } from '@adminium/meta';

import { BRANDING_UPDATED, logoUrlFor, readBranding, resolveLogoFile } from '../../branding/service.js';
import { NotFoundError, ValidationFailedError } from '../../errors.js';
import type { FileStorage } from '../../files/storage.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import {
  LOGO_BODY_LIMIT,
  LOGO_MIME_TYPES,
  LOGO_UPLOAD_CONTENT_TYPES,
  brandingLogoQuery,
  brandingLogoUploadQuery,
  brandingReply,
  type LogoMime,
} from './schema.js';

export interface BrandingRoutesDeps {
  meta: MetaDb;
  storage: FileStorage;
}

/**
 * The real type of `bytes`, from the bytes themselves — `null` when they are
 * not an image this route accepts.
 *
 * Magic numbers per format; SVG is text, so it is recognised by its root
 * element after any XML prolog/comments/BOM, and only within the first chunk
 * (an `<svg>` that appears 4 KiB into a file is not an SVG document).
 */
export function sniffLogo(bytes: Buffer): LogoMime | null {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const ascii = bytes.subarray(0, 12).toString('latin1');
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  const head = bytes.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<!--') || head.startsWith('<svg')) {
    return head.includes('<svg') ? 'image/svg+xml' : null;
  }
  return null;
}

export function brandingRoutes(deps: BrandingRoutesDeps): FastifyPluginAsyncZod {
  const { meta, storage } = deps;
  const files = filesRepo(meta);
  const settings = settingsRepo(meta);

  return async (app) => {
    // Raw image bodies, this plugin's scope only (same encapsulation as the
    // CSV parser in routes/imports).
    for (const mime of LOGO_UPLOAD_CONTENT_TYPES) {
      app.addContentTypeParser(mime, { parseAs: 'buffer' }, (_request, body, done) => {
        done(null, body);
      });
    }

    /** Same "a key is not a person" rule the sibling settings writes use. */
    function actingUserId(request: FastifyRequest): string | null {
      return request.apiKeyPrincipal === null ? (request.user?.id ?? null) : null;
    }

    /** Retire the current logo: registry key cleared, row soft-deleted, bytes dropped. */
    async function clearCurrentLogo(): Promise<boolean> {
      const current = await resolveLogoFile(meta);
      if (current === null) return false;
      await files.markDeleted(current.id);
      // Unlike an export artifact, a retired logo has no reader left the
      // moment the key stops pointing at it — so the bytes go now rather than
      // waiting for a GC pass to notice.
      await storage.remove(current.storageKey);
      return true;
    }

    app.get('/branding', { schema: { response: { 200: brandingReply } } }, async () =>
      ({ data: await readBranding(meta) }),
    );

    app.get('/branding/logo', { schema: { querystring: brandingLogoQuery } }, async (request, reply) => {
      const file = await resolveLogoFile(meta);
      if (file === null) throw new NotFoundError('No logo is set for this workspace.');

      // sha256 is already the content's identity — a free, exact ETag.
      const etag = `"${file.sha256}"`;
      if (request.headers['if-none-match'] === etag) return reply.status(304).send();

      const stream = await storage.read(file.storageKey);
      return reply
        .header('content-type', file.mime)
        .header('content-length', String(file.sizeBytes))
        .header('etag', etag)
        // Short max-age + ETag: the URL carries a `?v=` stamp, but a client
        // that drops the query (or a bare hit) must not be stuck with a logo
        // the workspace has since replaced.
        .header('cache-control', 'public, max-age=300, must-revalidate')
        // An SVG logo is a document that could carry script. It is only ever
        // rendered in an `<img>`, which never executes it; these three headers
        // make direct navigation to this URL inert as well.
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', 'inline')
        .send(stream);
    });

    app.post(
      '/branding/logo',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        bodyLimit: LOGO_BODY_LIMIT,
        schema: { querystring: brandingLogoUploadQuery, response: { 201: brandingReply } },
      },
      async (request, reply) => {
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.byteLength === 0) {
          throw new ValidationFailedError(
            `Send the image as a raw body with one of these content types: ${LOGO_MIME_TYPES.join(', ')}.`,
            {},
          );
        }
        const mime = sniffLogo(body);
        if (mime === null) {
          throw new ValidationFailedError(
            'That file is not a PNG, JPEG, WebP, GIF or SVG image.',
            {},
          );
        }

        const at = app.rbac.now();
        const before = await readBranding(meta);
        await clearCurrentLogo();

        const fileId = newId('file');
        const written = await storage.write(fileId, body);
        await files.create(
          {
            id: fileId,
            filename: request.query.filename,
            mime,
            sizeBytes: written.sizeBytes,
            sha256: written.sha256,
            kind: 'branding',
            uploadedBy: actingUserId(request),
          },
          at,
        );
        await settings.set('branding.logoFileId', fileId, { updatedBy: actingUserId(request), at });

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'settings.branding.logo.update',
          changes: {
            before: { logoUrl: before.logoUrl },
            after: { logoUrl: logoUrlFor(fileId), mime, sizeBytes: written.sizeBytes },
          },
        });
        if (app.hasDecorator('realtime')) {
          app.realtime.publish('config-changed', BRANDING_UPDATED, {}, at);
        }

        return reply.status(201).send({ data: await readBranding(meta) });
      },
    );

    app.delete(
      '/branding/logo',
      {
        preHandler: app.rbac.require(PERMISSIONS.settingsManage),
        schema: { response: { 200: brandingReply } },
      },
      async (request) => {
        const at = app.rbac.now();
        const before = await readBranding(meta);
        const had = await clearCurrentLogo();
        if (had) {
          await settings.set('branding.logoFileId', null, {
            updatedBy: actingUserId(request),
            at,
          });
        }

        await app.rbac.audit(request, {
          category: 'settings',
          action: 'settings.branding.logo.remove',
          changes: { before: { logoUrl: before.logoUrl }, after: { logoUrl: null } },
        });
        if (app.hasDecorator('realtime')) {
          app.realtime.publish('config-changed', BRANDING_UPDATED, {}, at);
        }

        return { data: await readBranding(meta) };
      },
    );
  };
}
