/**
 * About resource (M10-T04): `GET /api/v1/about` and
 * `GET /api/v1/about/update-check`.
 *
 * Backs the in-app About screen — version, AGPL-3.0 + the §13 source offer
 * (01-architecture.md §9.3: "the AGPL §13 source offer is satisfied by linking
 * to the public repo … from the instance footer ('About' screen, M10 scope)"),
 * the meta-store engine, and the self-host update-available notice.
 *
 * Session-gated: the version string is a fingerprinting aid, so an anonymous
 * visitor to a self-hosted instance does not get to read which build (and thus
 * which unpatched CVEs) it is running. `GET /healthz` stays public for probes.
 *
 * `/about/update-check` is separate from `/about` on purpose: About must render
 * instantly from local state, while the update check may make an outbound call
 * (only when `updates.checkEnabled` — see ../../telemetry/update-check.ts for
 * why that is its own preference). Opted out ⇒ `{ status: 'disabled' }` and no
 * network, so the notice cannot become a beacon.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { settingsRepo, type MetaDb } from '@adminium/meta';

import { APP_VERSION } from '../../version.js';
import type { UpdateCheckService } from '../../telemetry/update-check.js';
import { aboutReply, aboutUpdateCheckReply, type AboutReply, type AboutUpdateCheckReply } from './schema.js';

/** AGPL-3.0-only — matches every workspace package.json `license` field. */
export const LICENSE_SPDX = 'AGPL-3.0-only';
export const SOURCE_URL = 'https://github.com/adminium/adminium';
export const LICENSE_URL = 'https://github.com/adminium/adminium/blob/main/LICENSE';

export interface AboutRoutesDeps {
  meta: MetaDb;
  updates: UpdateCheckService;
  version?: string | undefined;
}

export function aboutRoutes(deps: AboutRoutesDeps): FastifyPluginAsyncZod {
  const { meta, updates } = deps;
  const version = deps.version ?? APP_VERSION;
  const settings = settingsRepo(meta);

  return async (app) => {
    app.get(
      '/about',
      {
        preHandler: [app.requireMeta, app.requireAuth],
        schema: { response: { 200: aboutReply } },
      },
      async (): Promise<AboutReply> => {
        const [telemetryEnabled, updateCheckEnabled] = await Promise.all([
          settings.get('telemetry.enabled'),
          settings.get('updates.checkEnabled'),
        ]);
        return {
          data: {
            version,
            license: LICENSE_SPDX,
            sourceUrl: SOURCE_URL,
            licenseUrl: LICENSE_URL,
            metaEngine: meta.dialect,
            node: process.version,
            telemetry: { enabled: telemetryEnabled },
            updates: { checkEnabled: updateCheckEnabled },
          },
        };
      },
    );

    app.get(
      '/about/update-check',
      {
        preHandler: [app.requireMeta, app.requireAuth],
        schema: { response: { 200: aboutUpdateCheckReply } },
      },
      async (): Promise<AboutUpdateCheckReply> => ({ data: await updates.check() }),
    );
  };
}
