/**
 * THE COMPOSITION ROOT (01-architecture.md §4: "All four deployment modes run
 * the identical `@adminium/server` process; only the wrapper differs").
 *
 * `buildServer` is the Fastify *skeleton* — logger, error envelope, auth, static,
 * and the handful of resources that need no injected services (system/auth/me/
 * bootstrap/setup/about). Every other resource is a FACTORY over injected
 * services (`connectionsRoutes({ manager, meta })`, `llmRoutes({ … })`, …),
 * because 01 §2.3 forbids the route tree from reaching out and constructing a
 * `ConnectionManager` or importing `@adminium/widgets` on its own. Somebody has
 * to do that construction. This module is that somebody, and it is the ONLY one.
 *
 * WHY IT EXISTS. It used to be `scripts/demo-v01.mjs` — a demo script — which
 * meant `adminium start`, `adminium init`'s final boot and the Docker CMD all
 * served a hollow API: the SPA loaded, setup created the super admin, and then
 * the connect wizard's `POST /api/v1/connections` 404'd, because the plugin that
 * answers it was only ever registered by a script nobody runs in production. The
 * dashboard calls 17 `/api/v1` namespaces; the skeleton serves 6. This module
 * closes that gap so the M10 exit criterion — "`npx adminium` (or `docker run`)
 * on a clean machine → first-run wizard → create super admin → connect any of the
 * 3 engines → generated app" — is met by the shipped artifact and not only by a
 * script in the repo.
 *
 * DEGRADATION. The LLM surface is the one optional part: `LLM_ALLOWED_TEMPLATES`
 * / `LLM_ALLOWED_WIDGETS` come from `@adminium/widgets` (01 §2.3: the server tree
 * may not import it), loaded by file path at runtime. When that load fails the
 * `/llm` routes are skipped and everything else boots — the demo script's
 * behavior, kept, because a missing AI vocabulary must not cost you your CRUD.
 */

import { llmKeyCryptoFromSecret, type AllowedVocabularies } from '@adminium/llm';
import { settingsRepo } from '@adminium/meta';

import { buildServer, type AdminiumServer } from './app.js';
import type { Env } from './config/env.js';
import { decryptSecret, deriveKey, encryptSecret } from './config/secrets.js';
import type { ConnectionManager } from './connections/manager.js';
import { UndoStore } from './crud/undo.js';
import { registerJobsAndRealtime, type JobsAndRealtime } from './jobs/register.js';
import type { ApplyService } from './llm/apply-service.js';
import type { CollectRunStats } from './llm/prompt-service.js';
import { createProviderResolver } from './llm/provider-resolver.js';
import type { RunService } from './llm/run-service.js';
import { rbacPlugin } from './plugins/rbac.js';
import { permissionSetAllows, resolvePermissionSet } from './rbac/resolver.js';
import { API_PREFIX } from './routes/index.js';
import { apiKeysRoutes } from './routes/api-keys/index.js';
import { auditRoutes } from './routes/audit/index.js';
import { desktopSessionRoutes } from './routes/auth/desktop-session.js';
import { connectionsRoutes } from './routes/connections/index.js';
import { dataRoutes } from './routes/data/index.js';
import { generateRoutes } from './routes/generate/index.js';
import { llmRoutes } from './routes/llm/index.js';
import { meViewsRoutes } from './routes/me-views/index.js';
import { onboardingRoutes } from './routes/onboarding/index.js';
import { pagesRoutes } from './routes/pages/index.js';
import { rolesRoutes } from './routes/roles/index.js';
import { schemaRoutes } from './routes/schema/index.js';
import { schemaImportRoutes } from './routes/schema-import/index.js';
import { settingsRoutes } from './routes/settings/index.js';
import { viewsRoutes } from './routes/views/index.js';
import { widgetDataRoutes } from './routes/widget-data/index.js';
import { createTelemetryService } from './telemetry/service.js';
import { APP_VERSION } from './version.js';
import type { MetaStoreHandle } from './meta/store.js';

/**
 * Daily, at 04:00 UTC, with an hour of jitter (below). Telemetry is the least
 * urgent thing this process does; a daily ping is what the payload documents
 * (`telemetry/payload.ts`) and nothing downstream reads it sooner. Runs on the
 * existing croner scheduler rather than a `setInterval`, per BRIEF §3 (no
 * external scheduler, and no second timing mechanism either).
 */
export const TELEMETRY_SCHEDULE_NAME = 'telemetry-ping';
export const TELEMETRY_CRON = '0 4 * * *';
/** De-synchronize a fleet so a self-host cohort does not ping in lockstep. */
export const TELEMETRY_JITTER_MS = 60 * 60 * 1000;

export interface ComposeServerOptions {
  env: Env;
  /** The opened meta store — `meta` for the services, `url` for §3.1 checks. */
  metaStore: MetaStoreHandle;
  /** The shared source-database connection pool/registry (01 §3). */
  manager: ConnectionManager;
  runService: RunService;
  applyService: ApplyService;
  /**
   * The `@adminium/widgets` allow-lists. `null` ⇒ the `/llm` resource is skipped
   * (see the module header) — everything else is registered regardless.
   */
  allowed: AllowedVocabularies | null;
  /** §4.2 statistics collector for the prompt builder. */
  collectStats?: CollectRunStats | undefined;
  /** Dashboard build directory; omitted ⇒ API only. */
  staticRoot?: string | undefined;
  /** Passed through to {@link buildServer} (tests silence it with `false`). */
  logger?: boolean | undefined;
  /** Report telemetry on the scheduler. Default true; tests turn it off. */
  telemetry?: boolean | undefined;
}

export interface ComposedServer {
  app: AdminiumServer;
  /** The jobs/realtime handle — hub, worker, scheduler (see `jobs/register.ts`). */
  jobs: JobsAndRealtime;
  /** True when the `/llm` resource was registered (i.e. `allowed` was present). */
  llmEnabled: boolean;
  /**
   * True when `POST /auth/desktop-session` was registered (11-electron.md §5).
   * Reported rather than inferred: whether that route exists is the single most
   * security-relevant fact about a composed server, and a caller (or a test)
   * asking "did the boot-token door get opened?" should not have to re-derive
   * the answer from the same two env vars this module already read.
   */
  desktopSessionEnabled: boolean;
}

/**
 * Mirror `config.json`'s §2.3 `singleUser` into the setting the §5 route reads.
 *
 * §5: "only while `config.singleUser` is true (mirrored into `adminium_settings`
 * … by the server at boot)". The desktop main process owns `config.json` and the
 * child cannot read it (different process, different lifetime, and §2.3 makes the
 * main process its only writer), so the env var IS the mirror channel — see
 * `config/env.ts`. Unset ⇒ this does nothing at all, deliberately: absent input
 * must not be read as `false` and quietly overwrite an answer the user gave.
 */
async function mirrorDesktopSingleUser(meta: MetaStoreHandle['meta'], value: boolean): Promise<void> {
  await settingsRepo(meta).set('desktop.singleUser', value, { updatedBy: null });
}

/**
 * Build the COMPLETE server: skeleton + RBAC + jobs/realtime + every resource
 * the dashboard calls. Does not listen — the caller decides that (`startServer`
 * for the CLI, a test's `inject` for the suites).
 */
export async function composeServer(opts: ComposeServerOptions): Promise<ComposedServer> {
  const { env, manager, runService, applyService, allowed } = opts;
  const meta = opts.metaStore.meta;

  const app = await buildServer({
    env,
    metaDb: meta,
    ...(opts.staticRoot === undefined ? {} : { staticRoot: opts.staticRoot }),
    ...(opts.logger === undefined ? {} : { logger: opts.logger }),
  });

  await app.register(rbacPlugin, { meta });

  // LLM assist (M6, 06-llm-assist.md §10.5). Only the vocabulary is optional;
  // the key crypto and the resolver are cheap and pure.
  const llm =
    allowed === null
      ? null
      : (() => {
          const keyCrypto = llmKeyCryptoFromSecret(env.ADMINIUM_SECRET, {
            deriveKey,
            encryptSecret,
            decryptSecret,
          });
          return {
            keyCrypto,
            resolve: createProviderResolver({
              meta,
              keyCrypto,
              allowedTemplates: allowed.templates,
              allowedWidgets: allowed.widgets,
            }),
          };
        })();

  const jobs = await registerJobsAndRealtime(app, {
    meta,
    resolveUser: (req) => req.user ?? null,
    // The realtime hub authorizes a SUBSCRIBED USER, not a request, so it cannot
    // reuse `request.can()` (which caches per request and needs a principal on
    // one). It goes through the same resolver + the same decision function the
    // route guards use — `resolvePermissionSet` → `permissionSetAllows`, including
    // the super-admin bypass — so a channel can never grant what a route denies.
    can: async (user, permission) =>
      permissionSetAllows(
        // `label` is only ever read for audit `actor_label`; a channel
        // subscription writes no audit entry, so the id is the whole principal.
        await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.id }),
        permission,
      ),
    ...(llm === null ? {} : { llm: { resolve: llm.resolve } }),
  });

  const undoStore = new UndoStore();

  /**
   * THE DESKTOP AUTO-LOGIN DOOR (11-electron.md §5) — the one route in the
   * product that mints a super-admin session without a password.
   *
   * Both conditions are load-bearing, and the AND is the point:
   *
   *  - `ADMINIUM_RUNTIME=desktop` — §5 registers this "only when" the Electron
   *    shell is the wrapper. Every other deployment (self-host, Docker, npx, and
   *    every test that does not opt in) composes a server with NO such route:
   *    `/auth/desktop-session` 404s there, which is a stronger guarantee than any
   *    runtime check inside a handler could make.
   *  - a boot token — a desktop boot without one has nothing to exchange, so the
   *    route would be an unreachable surface. §2.2 mints a fresh token per boot;
   *    absence means the shell chose not to (or could not), and the app lands on
   *    the normal login screen.
   *
   * The mirror runs first so the route's own §5 policy gate reads THIS boot's
   * answer rather than the last one's.
   */
  const desktopSession =
    env.ADMINIUM_RUNTIME === 'desktop' && env.ADMINIUM_BOOT_TOKEN !== undefined
      ? { bootToken: env.ADMINIUM_BOOT_TOKEN }
      : null;
  if (env.ADMINIUM_RUNTIME === 'desktop' && env.ADMINIUM_DESKTOP_SINGLE_USER !== undefined) {
    await mirrorDesktopSingleUser(meta, env.ADMINIUM_DESKTOP_SINGLE_USER);
  }

  await app.register(
    async (api) => {
      if (desktopSession !== null) {
        await api.register(desktopSessionRoutes({ meta, bootToken: desktopSession.bootToken }));
      }
      await api.register(connectionsRoutes({ manager, meta }));
      await api.register(schemaRoutes({ manager, meta }));
      await api.register(dataRoutes({ manager, meta, undoStore }));
      await api.register(generateRoutes({ manager, meta }));
      await api.register(schemaImportRoutes());
      await api.register(pagesRoutes({ meta }));
      await api.register(widgetDataRoutes({ manager, meta }));
      await api.register(settingsRoutes({ meta }));
      await api.register(viewsRoutes({ meta }));
      await api.register(meViewsRoutes({ meta }));
      await api.register(onboardingRoutes({ meta }));
      await api.register(rolesRoutes);
      await api.register(apiKeysRoutes);
      await api.register(auditRoutes);
      if (llm !== null && allowed !== null) {
        await api.register(
          llmRoutes({
            meta,
            runService,
            applyService,
            keyCrypto: llm.keyCrypto,
            allowed,
            ...(opts.collectStats === undefined ? {} : { collectStats: opts.collectStats }),
          }),
        );
      }
    },
    { prefix: API_PREFIX },
  );

  // Telemetry (M10-T04). OPT-IN: `report()` reads `telemetry.enabled` FIRST and
  // returns before building a payload, so an instance that has not consented
  // makes zero network calls — the property `telemetry-network-isolation.test.ts`
  // pins. Registering the schedule is not consent; the schedule ticking on an
  // opted-out instance is a no-op read of one settings row.
  if (opts.telemetry !== false) {
    const telemetry = createTelemetryService({
      meta,
      version: APP_VERSION,
      envOverride: env.ADMINIUM_TELEMETRY,
    });
    jobs.scheduler.registerSchedule(
      TELEMETRY_SCHEDULE_NAME,
      TELEMETRY_CRON,
      async () => {
        await telemetry.report();
      },
      { jitterMs: TELEMETRY_JITTER_MS },
    );
  }

  // The manager owns live source-DB pools; the server owns the manager's
  // lifetime once it is listening (the CLI hands it over at `startServer`).
  app.addHook('onClose', async () => {
    await manager.disposeAll();
  });

  return { app, jobs, llmEnabled: llm !== null, desktopSessionEnabled: desktopSession !== null };
}
