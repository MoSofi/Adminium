/**
 * Route registration (08-server-api.md §1.2): each resource directory under
 * `src/routes/<resource>/` exports a plugin; all of them mount here under the
 * single `/api/v1` prefix. New resources (auth, users, data, …) join this list
 * in later waves.
 */
import type { FastifyInstance } from 'fastify';

import { systemRoutes } from './system/index.js';

export const API_PREFIX = '/api/v1';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (api) => {
      await api.register(systemRoutes);
    },
    { prefix: API_PREFIX },
  );
}
