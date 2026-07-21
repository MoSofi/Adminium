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
/**
 * The §13 offer is only satisfied by a link that actually reaches the source,
 * so this must name the repository that hosts it: github.com/MoSofi/Adminium.
 * The `adminium/adminium` slug belongs to an unrelated third party — pointing
 * the offer there would send users to a stranger's empty repo.
 */
export const SOURCE_URL = 'https://github.com/MoSofi/Adminium';
export const LICENSE_URL = 'https://github.com/MoSofi/Adminium/blob/main/LICENSE';

export interface AboutRoutesDeps {
  meta: MetaDb;
  updates: UpdateCheckService;
  version?: string | undefined;
}

/**
 * The newest applied migration name, or `null` when there is none or the read
 * fails (11-electron.md §13's About version field).
 *
 * NEVER THROWS, for the reason `smtpConfigured` in the system route does not: a
 * meta-store blip must not take the whole About payload — including `version`
 * and the AGPL source offer, which are the compliance artifact — down with it.
 * `null` is the honest "unknown" the desktop panel already renders as a
 * fallback. `adminium_migrations.name` is the same row `readMetaMigrationVersion`
 * reads for a §9 backup manifest, so the two agree by construction.
 */
async function latestMetaMigration(meta: MetaDb): Promise<string | null> {
  try {
    const rows = await meta.db
      .selectFrom('adminium_migrations')
      .select('name')
      .orderBy('name', 'desc')
      .limit(1)
      .execute();
    return rows[0]?.name ?? null;
  } catch {
    return null;
  }
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
        const [telemetryEnabled, updateCheckEnabled, metaMigrationVersion] = await Promise.all([
          settings.get('telemetry.enabled'),
          settings.get('updates.checkEnabled'),
          latestMetaMigration(meta),
        ]);
        return {
          data: {
            version,
            license: LICENSE_SPDX,
            sourceUrl: SOURCE_URL,
            licenseUrl: LICENSE_URL,
            metaEngine: meta.dialect,
            metaMigrationVersion,
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
