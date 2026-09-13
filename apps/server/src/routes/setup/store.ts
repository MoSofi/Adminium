// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two setup routes that touch a DATABASE: `POST /api/v1/setup/probe` and
 * `POST /api/v1/setup/adopt` (45-onboarding.md 45-T11).
 *
 * ── WHY THEY EXIST ──────────────────────────────────────────────────────────
 * Point a second install at a database that already runs Adminium and, until
 * now, nothing noticed until the storage step — after an account had been
 * created — where the relocation refused with "the target database already
 * contains Adminium data". The wizard asks the question at the CONNECT step
 * instead, which means asking it before there is a session to ask it with.
 *
 * ── WHY THAT IS SAFE ────────────────────────────────────────────────────────
 * Both are gated exactly as `POST /setup/super-admin` is, and by the same fact:
 * `isBootstrapRequired` is false forever after the first account exists, so
 * this pair lives in a window that closes permanently and never re-opens — the
 * same window in which an unauthenticated caller can already create the
 * instance's super admin, which is strictly more power than either of these.
 * They share that route's credential-facing rate-limit bucket, and both are
 * audited: on a set-up instance a call here is somebody probing, and that is
 * worth a row even though the caller is told nothing but 409.
 *
 * The probe reports `adminium_` tables and nothing else — no row counts, no
 * schema, no server version. An un-bootstrapped instance must not be usable as
 * a database scanner.
 *
 * ── ADOPT COPIES NOTHING ────────────────────────────────────────────────────
 * `/meta/relocate` moves a store into an empty database. Adopting is the other
 * direction and much simpler: write the §7.2 bootstrap file pointing at a store
 * that is already there and restart onto it. Nothing is copied, nothing is
 * dropped, and the local store this instance booted on stays on disk. The
 * operator lands on `/login`, where their existing account is.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';

import { probeAdminiumTables } from '@adminium/meta';

import { audited, auditExempt } from '../../audit/coverage.js';
import { auditAuth } from '../../auth/audit.js';
import { readBootstrap, writeBootstrap } from '../../config/bootstrap.js';
import { dsnCryptoFromSecret } from '../../connections/crypto.js';
import type { Env } from '../../config/env.js';
import { AppError, ConflictError } from '../../errors.js';
import { connectMetaStore, metaEngineFromUrl, MetaUrlError } from '../../meta/store.js';
import { metaUrlCryptoFromSecret } from '../../meta/store.js';
import type { OnMetaRelocated } from '../../meta/relocate.js';
import { SetupClosedError, type SetupService } from '../../setup/service.js';
import { RATE_LIMIT_BUCKETS } from '../auth/index.js';
import { HEALTH_PATH } from '../meta/index.js';
import {
  setupAdoptBody,
  setupAdoptReply,
  setupProbeBody,
  setupProbeReply,
  type SetupAdoptReply,
  type SetupProbeReply,
} from './schema.js';
import type { MetaDb } from '@adminium/meta';

export interface SetupStoreRoutesDeps {
  service: SetupService;
  env: Env;
  /** Present ⇒ adopting can restart the server; absent ⇒ only the probe mounts. */
  onMetaRelocated?: OnMetaRelocated | undefined;
}

/** Open a caller-supplied DSN read-only-ish: no migrations, nothing written. */
async function withTarget<T>(dsn: string, run: (meta: MetaDb) => Promise<T>): Promise<T> {
  const engine = metaEngineFromUrl(dsn);
  const target = await connectMetaStore({ url: dsn, engine, source: 'bootstrap' }, { poolSize: 1 });
  try {
    return await run(target.meta);
  } finally {
    await target.close();
  }
}

/**
 * Can this instance's secret read what that store encrypted?
 *
 * Password hashes are not encrypted, so adopting under a different
 * `ADMINIUM_SECRET` still signs the operator in — what it loses is every stored
 * DSN and API key. Saying which of those two futures they are choosing is the
 * difference between an informed adoption and a surprise.
 */
async function secretReadsStore(meta: MetaDb, secret: string): Promise<boolean | null> {
  const row = await meta.db
    .selectFrom('adminium_connections')
    .select(['dataDsnEncrypted'])
    .limit(1)
    .executeTakeFirst()
    .catch(() => undefined);
  const encrypted = row?.dataDsnEncrypted;
  if (typeof encrypted !== 'string' || encrypted === '') return null;
  try {
    dsnCryptoFromSecret(secret).decrypt(encrypted);
    return true;
  } catch {
    return false;
  }
}

export function setupStoreRoutes(deps: SetupStoreRoutesDeps): FastifyPluginAsyncZod {
  const { service, env, onMetaRelocated } = deps;

  return async (app) => {
    /** The once-only gate, shared with `/setup/super-admin`. */
    /** Non-null under `requireMeta` — the preHandler 503s before a handler runs. */
    const meta = (): MetaDb => {
      if (app.authContext === null) {
        throw new AppError(503, 'META_NOT_CONFIGURED', 'No meta store is configured.');
      }
      return app.authContext.meta;
    };

    const requireSetupOpen = async (request: Parameters<typeof auditAuth>[1], action: string): Promise<void> => {
      if ((await service.state()).required) return;
      await auditAuth(meta(), request, {
        action,
        actorId: null,
        // No principal and no submitted identity: the DSN is the only thing
        // this call carried and it is not going in an audit row.
        actorLabel: 'anonymous',
      }).catch(() => undefined);
      throw new ConflictError('Setup has already been completed. Sign in instead.', 'CONFLICT');
    };

    app.post(
      '/setup/probe',
      {
        preHandler: [app.requireMeta],
        config: {
          rateLimitBucket: RATE_LIMIT_BUCKETS.login,
          // A POST that reads a catalogue and writes nothing. The one thing
          // here worth a row is the REFUSAL — a probe against a set-up instance
          // is somebody knocking — and that is written by hand below, on the
          // same path `/setup/super-admin`'s refusal takes.
          audit: auditExempt('Reads the target catalogue; writes nothing. The 409 refusal is audited by hand.'),
        },
        schema: { body: setupProbeBody, response: { 200: setupProbeReply } },
      },
      async (request): Promise<SetupProbeReply> => {
        await requireSetupOpen(request, 'setup_probe_denied');
        const dsn = request.body.dsn.trim();
        try {
          return await withTarget(dsn, async (meta) => {
            const { present, occupied } = await probeAdminiumTables(meta);
            const secretMatches =
              occupied.length === 0 ? null : await secretReadsStore(meta, env.ADMINIUM_SECRET);
            return { data: { reachable: true, reason: null, tables: present, occupied, secretMatches } };
          });
        } catch (error) {
          if (error instanceof MetaUrlError) throw new AppError(400, 'META_DSN_INVALID', error.message);
          // A database that will not answer is not this route's problem to
          // explain — the wizard tests the DSN properly once a session exists.
          // Saying "could not reach it" here keeps the probe advisory.
          return {
            data: {
              reachable: false,
              reason: error instanceof Error ? error.message : 'The database did not answer.',
              tables: [],
              occupied: [],
              secretMatches: null,
            },
          };
        }
      },
    );

    if (onMetaRelocated === undefined) return;

    app.post(
      '/setup/adopt',
      {
        preHandler: [app.requireMeta],
        config: { rateLimitBucket: RATE_LIMIT_BUCKETS.login, audit: audited('auth') },
        schema: { body: setupAdoptBody, response: { 200: setupAdoptReply } },
      },
      async (request): Promise<SetupAdoptReply> => {
        await requireSetupOpen(request, 'setup_adopt_denied');
        const dsn = request.body.dsn.trim();

        // Pinned by the environment ⇒ the bootstrap file would be ignored, and
        // writing one that nothing reads is worse than refusing.
        if (env.ADMINIUM_META_URL !== undefined && env.ADMINIUM_META_URL !== '') {
          throw new ConflictError(
            'This instance pins its meta store with ADMINIUM_META_URL, so it cannot adopt another.',
            'CONFLICT',
          );
        }

        let engine;
        try {
          engine = metaEngineFromUrl(dsn);
        } catch (error) {
          throw new AppError(400, 'META_DSN_INVALID', (error as Error).message);
        }

        // Adopting an EMPTY database would leave this instance pointed at
        // nothing, with the store it booted on stranded — that is a relocation,
        // and the wizard offers it as one.
        const occupied = await withTarget(dsn, async (meta) => (await probeAdminiumTables(meta)).occupied);
        if (occupied.length === 0) {
          throw new AppError(
            422,
            'META_PLACEMENT_INVALID',
            'That database holds no Adminium data to adopt.',
          );
        }

        const existing = await readBootstrap(env.ADMINIUM_DATA_DIR);
        await writeBootstrap(env.ADMINIUM_DATA_DIR, {
          v: 1,
          metaUrl: metaUrlCryptoFromSecret(env.ADMINIUM_SECRET).encrypt(dsn),
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          instanceId: existing?.instanceId ?? randomUUID(),
        });

        await auditAuth(meta(), request, {
          action: 'setup_adopted_store',
          actorId: null,
          actorLabel: 'anonymous',
          changes: { after: { engine } },
        }).catch(() => undefined);

        // The same hand-off `/meta/relocate` uses: reply first, restart after.
        // `retiredSqlitePath: null` — adopting retires nothing. The store this
        // instance booted on stays exactly where it is, which is what makes an
        // adoption undoable: delete the bootstrap file and it comes back.
        onMetaRelocated({ url: dsn, engine, retiredSqlitePath: null });
        return { data: { engine, restarting: true, healthPath: HEALTH_PATH } };
      },
    );
  };
}

export { SetupClosedError };
