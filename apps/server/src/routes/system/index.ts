/** System routes: GET /healthz and GET /system/info (mounted under /api/v1). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { healthz, systemInfo } from './handlers.js';
import { systemHealthzReply, systemInfoReply } from './schema.js';

export const systemRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/healthz', { schema: { response: { 200: systemHealthzReply } } }, async () => healthz());

  app.get(
    '/system/info',
    { schema: { response: { 200: systemInfoReply } } },
    async () => systemInfo(),
  );
};
