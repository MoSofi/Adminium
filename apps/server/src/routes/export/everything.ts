// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Export everything" (Studio → Server settings → Export everything):
 *
 *  - `POST /export/zip` starts making the file and answers its one-time id;
 *  - `GET  /export/zip` says how far the caller's file is (the page's
 *    "Preparing your file… N%"), or that it is ready, with its name and size;
 *  - `GET  /export/zip/:id` sends the file once, then deletes it.
 *
 * Super Admin only, in a signed-in browser session: the file holds every
 * person's account and every page, so neither another role nor an API key may
 * ask for it, and the id is bound to the session that started it. Start and
 * download are both audited. The rules about the file itself (what it holds,
 * one at a time, ten minutes, the boot sweep) live in `export/everything.ts`.
 */
import { createReadStream } from 'node:fs';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { audited } from '../../audit/coverage.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../errors.js';
import { ExportBusyError, type ExportBinding, type ExportEverything } from '../../export/everything.js';
import { tagRoutes } from '../../security/route-audience.js';

const exportView = z.discriminatedUnion('state', [
  z.object({ id: z.string(), state: z.literal('preparing'), percent: z.number().int().min(0).max(100) }),
  z.object({
    id: z.string(),
    state: z.literal('ready'),
    percent: z.literal(100),
    /** What the browser saves it as, e.g. `hollis-bakery-2026-11-10.zip`. */
    fileName: z.string(),
    bytes: z.number().int().nonnegative(),
    /** Epoch ms: after this the file is deleted and the id finds nothing. */
    expiresAt: z.number().int(),
  }),
  z.object({ id: z.string(), state: z.literal('failed'), message: z.string() }),
  z.object({ id: z.string(), state: z.literal('expired') }),
]);

export const exportEverythingReply = z.object({ export: exportView.nullable() });

const idParams = z.object({ id: z.string().regex(/^[0-9a-f]{32}$/) });

export interface ExportEverythingRoutesDeps {
  exports: ExportEverything;
}

export function exportEverythingRoutes(deps: ExportEverythingRoutesDeps): FastifyPluginAsyncZod {
  return async (app) => {
    // For the instance's own people, not the public: kept while the public pages are hidden (`security/route-audience.ts`).
    tagRoutes(app, 'staff');
    /** The caller, if they are a Super Admin signed in with a session; refused otherwise. */
    const superAdminSession = async (request: FastifyRequest): Promise<ExportBinding> => {
      const set = await app.rbac.resolve(request); // 401 when nobody is signed in
      if (!set.superAdmin) {
        await app.rbac.audit(request, { category: 'rbac', action: 'permission.denied', changes: { after: { permission: 'super-admin', method: request.method, url: request.url } } });
        throw new ForbiddenError('Only a Super Admin exports everything.', 'FORBIDDEN', { reason: 'SUPER_ADMIN' });
      }
      if (request.user === null || request.session === null) {
        throw new ForbiddenError('Export everything from a signed-in browser, not with an API key.', 'FORBIDDEN', { reason: 'SESSION' });
      }
      return { userId: request.user.id, sessionId: request.session.id };
    };

    app.post(
      '/export/zip',
      {
        config: { audit: audited('rbac') },
        schema: { response: { 202: exportEverythingReply } },
      },
      async (request, reply) => {
        const binding = await superAdminSession(request);
        try {
          const started = await deps.exports.start(binding);
          await app.rbac.audit(request, { category: 'export', action: 'export.everything.start', changes: { after: { id: started.id } } });
          return reply.code(202).send({ export: started });
        } catch (error) {
          if (error instanceof ExportBusyError) throw new ConflictError(error.message, 'CONFLICT', { reason: 'BUSY' });
          throw error;
        }
      },
    );

    app.get('/export/zip', { schema: { response: { 200: exportEverythingReply } } }, async (request) => ({
      export: await deps.exports.current(await superAdminSession(request)),
    }));

    app.get('/export/zip/:id', { schema: { params: idParams } }, async (request, reply) => {
      const binding = await superAdminSession(request);
      const taken = await deps.exports.take(request.params.id, binding);
      if (taken === 'unknown') throw new NotFoundError('There is no export with that id for this session.');
      if (taken === 'preparing') throw new ConflictError('The file is still being made.', 'CONFLICT', { reason: 'PREPARING' });
      if (taken === 'gone') throw new AppError(410, 'EXPORT_EXPIRED', 'This download has expired or was used. Download everything again.');
      await app.rbac.audit(request, { category: 'export', action: 'export.everything.download', changes: { after: { id: request.params.id, bytes: taken.bytes } } });
      const stream = createReadStream(taken.path);
      // Sent in full or cut short, the file goes: the id was spent when the download began.
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        void taken.release();
      };
      stream.once('close', release);
      reply.raw.once('close', release);
      const safeName = taken.fileName.replaceAll(/["\\\r\n]/g, '_');
      return reply
        .header('content-type', 'application/zip')
        .header('content-length', String(taken.bytes))
        .header('content-disposition', `attachment; filename="${safeName}"`)
        .header('cache-control', 'no-store')
        .send(stream);
    });
  };
}
