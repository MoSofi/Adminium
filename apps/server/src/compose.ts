// SPDX-License-Identifier: AGPL-3.0-only
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
import {
  auditRepo,
  exportsRepo,
  filesRepo,
  jobsRepo,
  passwordResetsRepo,
  sessionsRepo,
  settingsRepo,
  type EnqueueJobInput,
} from '@adminium/meta';

import { buildServer, type AdminiumServer } from './app.js';
import type { Env } from './config/env.js';
import { decryptSecret, deriveKey, encryptSecret } from './config/secrets.js';
import { dsnCryptoFromSecret } from './connections/crypto.js';
import { createBridgeStore, createPairingCode } from './bridge/store.js';
import { registerIntrospectJob } from './connections/introspect.js';
import type { ConnectionManager } from './connections/manager.js';
import { UndoStore } from './crud/undo.js';
import { seedBuiltinEmailTemplates } from './email/builtins.js';
import { emailSecretKey } from './email/config.js';
import { configureEmailRuntime } from './email/send.js';
import { createFileStorage } from './files/storage.js';
import { registerJobsAndRealtime, type JobsAndRealtime } from './jobs/register.js';
import {
  SCHEDULED_REPORTS_POLL_CRON,
  SCHEDULED_REPORTS_POLL_NAME,
  enqueueDueReports,
} from './jobs/report-run.js';
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
import { desktopRoutes } from './routes/desktop/index.js';
import { demoSeedScriptPath } from './desktop/demo-seed.js';
import { desktopDemoRoutes } from './routes/desktop-demo/index.js';
import { desktopLanRoutes } from './routes/desktop-lan/index.js';
import { desktopLocalDbRoutes } from './routes/desktop-local-db/index.js';
import { desktopCapabilityRoutes } from './routes/desktop-capabilities/index.js';
import { brandingRoutes } from './routes/branding/index.js';
import { bridgeRoutes } from './routes/bridge/index.js';
import { metaRoutes } from './routes/meta/index.js';
import { connectionsRoutes } from './routes/connections/index.js';
import { dataRoutes } from './routes/data/index.js';
import { emailTemplatesRoutes } from './routes/email-templates/index.js';
import { exportsRoutes } from './routes/exports/index.js';
import { generateRoutes } from './routes/generate/index.js';
import { importsRoutes } from './routes/imports/index.js';
import { llmRoutes } from './routes/llm/index.js';
import { meViewsRoutes } from './routes/me-views/index.js';
import { notificationsRoutes } from './routes/notifications/index.js';
import { onboardingRoutes } from './routes/onboarding/index.js';
import { pagesRoutes } from './routes/pages/index.js';
import { permissionsRoutes } from './routes/permissions/index.js';
import { rolesRoutes } from './routes/roles/index.js';
import { scheduledReportsRoutes } from './routes/scheduled-reports/index.js';
import { schemaRoutes } from './routes/schema/index.js';
import { schemaImportRoutes } from './routes/schema-import/index.js';
import { searchRoutes } from './routes/search/index.js';
import { i18nRoutes } from './routes/i18n/index.js';
import { settingsRoutes } from './routes/settings/index.js';
import { usersRoutes } from './routes/users/index.js';
import { viewsRoutes } from './routes/views/index.js';
import { widgetDataRoutes } from './routes/widget-data/index.js';
import { createTelemetryService } from './telemetry/service.js';
import { APP_VERSION } from './version.js';
import type { OnMetaRelocated } from './meta/relocate.js';
import { sqlitePathFromUrl, type MetaStoreHandle } from './meta/store.js';

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

/**
 * Daily export-retention sweep (M7-T07): flips `ready` → `expired` on
 * `adminium_exports` rows past `expires_at`, then GCs the expired artifacts'
 * BYTES (`filesRepo.markDeleted` + `storage.remove`) so a snapshot never
 * outlives the "kept for 30 days, then expire" promise on disk. Offset from
 * the telemetry ping so the two dailies never contend.
 */
export const EXPORTS_RETENTION_SCHEDULE_NAME = 'exports-retention-sweep';
export const EXPORTS_RETENTION_CRON = '30 4 * * *';

/**
 * Daily META-STORE retention sweep — the one that keeps a self-host install
 * from growing forever.
 *
 * WHAT WAS WRONG. `sessionsRepo`, `passwordResetsRepo`, `jobsRepo` and
 * `auditRepo` each ship a `gc()` written against the BRIEF §8 retention policy,
 * and NOTHING called any of them. Every login wrote a session row that outlived
 * its own expiry forever; every scheduled-report tick and every export left a
 * finished `adminium_jobs` row behind; the audit log grew one row per mutation
 * for the life of the instance. Meanwhile `retention.auditLogDays` and
 * `retention.jobsDays` were writable from Settings and read by nobody — a
 * control that adjusts nothing, which is worse than no control.
 *
 * ONE schedule for all four, not four schedules: they run in the same store,
 * take milliseconds, and a single `retention-gc` name is one thing to find in
 * `scheduler.names()` when an operator asks why a table shrank overnight.
 *
 * 03:00, NOT 04:00, and that hour is not free real estate: the telemetry ping
 * is `0 4 * * *` with up to 60 minutes of jitter, so it owns 04:00–05:00
 * entirely, and the exports sweep sits at 04:30 inside that window. A third
 * daily in there would contend with both on the same meta store.
 */
export const RETENTION_GC_SCHEDULE_NAME = 'retention-gc';
export const RETENTION_GC_CRON = '0 3 * * *';

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
  /**
   * Passed through to {@link buildServer}: collect an OpenAPI document for
   * `app.swagger()`. Only `scripts/openapi.mjs` sets it — the spec has to be
   * generated from the COMPLETE route tree, and this module is the only thing
   * that assembles one.
   */
  openapi?: boolean | undefined;
  /** Report telemetry on the scheduler. Default true; tests turn it off. */
  telemetry?: boolean | undefined;
  /**
   * The host that can restart this process against a moved meta store
   * (`cli/relocation-host.ts`). Its presence is what registers
   * `routes/meta` — see that module's header for why a topology unable to
   * restart must not offer the route at all.
   */
  onMetaRelocated?: OnMetaRelocated | undefined;
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
  /**
   * True when `GET /desktop/lan-share` was registered (11-electron.md §8.3) —
   * i.e. this is the Electron shell's child. Mirrors
   * {@link ComposedServer.desktopSessionEnabled} and is reported for the same
   * reason: which desktop-only doors a composed server opened is a fact a caller
   * should read rather than re-derive.
   */
  desktopLanEnabled: boolean;
  /**
   * True when `POST /desktop/local-database` was registered (§6 step 2 card 1).
   */
  desktopLocalDbEnabled: boolean;
  /**
   * True when `POST /desktop/demo-database` was registered (§6 step 2 card 4) —
   * i.e. desktop runtime AND a seed script to run. The wizard hides the card
   * when this is false, which is why the two flags are reported separately
   * rather than as one "desktop extras" boolean.
   */
  desktopDemoEnabled: boolean;
  /**
   * True when `POST /desktop/backup` was registered (§9). Reported for the same
   * reason as its siblings: the shell's BackupCoordinator drives the File menu
   * and the 03:00 scheduler off this route, so "does the door exist" is a fact a
   * caller reads rather than re-derives.
   */
  desktopBackupEnabled: boolean;
  /**
   * True when the §12 capability grant routes were registered. Reported for the
   * same reason as its siblings: the dashboard's consent/revoke UI and the
   * main-process `CapabilityHost` both reach `adminium_settings` through this
   * door, so whether it exists is a fact a caller reads rather than re-derives.
   */
  desktopCapabilitiesEnabled: boolean;
  /**
   * The one-time pairing code `routes/bridge` requires, or null when the bridge
   * was not registered (`ADMINIUM_BRIDGE_ORIGINS` unset).
   *
   * Reported rather than logged: the code is the user's consent token for a
   * cross-origin hand-off, so exactly one thing should ever render it — the CLI
   * line that tells the person at the keyboard what to type. Putting it through
   * the logger would scatter it into log files and log shippers.
   */
  bridgePairingCode: string | null;
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
    ...(opts.openapi === undefined ? {} : { openapi: opts.openapi }),
  });

  await app.register(rbacPlugin, { meta });

  // EMAIL (v1 SMTP wave). Two boot-time facts, both cheap:
  //
  // 1. The master secret reaches the email layer here and nowhere else. It
  //    opens the sealed `email.send` job envelope AND `email.smtp.passEncrypted`;
  //    the notification writer is called from producers all over the server
  //    that have no `Env`, so threading it through each of them would scatter a
  //    credential to serve one optional side effect.
  // 2. A fresh install has ZERO rows in `adminium_email_templates` — nothing
  //    seeds them — so without this a password-reset mail would have no body to
  //    render. Idempotent natural-key upserts, one indexed read per built-in
  //    key once seeded, which is why it is safe on EVERY boot.
  //
  // Seeding is best-effort: a meta store that cannot take the seed (a partially
  // migrated relocation target, say) must still serve CRUD. Email degrades; the
  // product does not fail to boot over it.
  configureEmailRuntime({ secret: env.ADMINIUM_SECRET });
  try {
    await seedBuiltinEmailTemplates(meta, Date.now());
  } catch (error) {
    app.log.warn(
      { err: error },
      'could not seed the built-in email templates — email bodies may be missing',
    );
  }

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

  // Artifact storage for the data-io pipeline (M7-T07): exports, imports and
  // scheduled-report snapshots all live under `<dataDir>/files/`.
  const storage = createFileStorage({ dataDir: env.ADMINIUM_DATA_DIR });

  const jobs = await registerJobsAndRealtime(app, {
    meta,
    resolveUser: (req) => req.user ?? null,
    // Registers the export-run / import-run / report-run handlers on the shared
    // registry — the same instances the exports/imports routes receive below.
    dataIo: { manager, storage },
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
    // Claims the `email.send` kind (jobs/email-send.ts). Registered
    // unconditionally: whether mail actually goes out is decided by the
    // `email.smtp` SETTING at enqueue time, not by boot configuration.
    email: { secret: env.ADMINIUM_SECRET },
    ...(llm === null ? {} : { llm: { resolve: llm.resolve } }),
  });

  // The `introspect` job kind (08 §2.4): without this, POST
  // /connections/:id/introspect silently falls back to its synchronous
  // dev/test path (30s request-thread budget) in every deployment and the
  // wizard's job-polling branch never runs.
  registerIntrospectJob(jobs.registry, { manager, meta });

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

  /**
   * §8.3's share panel, behind gate 1 of `routes/desktop-lan/index.ts`.
   *
   * ONE condition, unlike the boot-token door above, and the asymmetry is
   * deliberate. That route needs a token to exchange, so a desktop boot without
   * one has nothing to serve. This one reports on the SOCKET this process is
   * bound to, which every desktop boot has — including (especially) a
   * loopback-only one, where the honest answer `active: false` is what tells the
   * panel that a toggle the user flipped has not taken effect.
   */
  const desktopLan = env.ADMINIUM_RUNTIME === 'desktop';

  /**
   * §6 step 2's two server-side source cards — "Create a new local database"
   * (card 1) and "Explore the demo database" (card 4).
   *
   * Both are gated on the runtime for the same reason, and it is not the §5
   * reason: neither mints a credential, and both do exactly what
   * `POST /connections` does, under the same `system:connections:manage` grant.
   * What makes them desktop-only is their SUBJECT. Both write into
   * `<dataDir>/databases/`, a directory that exists because the Electron shell
   * created it and passed `ADMINIUM_DATA_DIR` (§2.2 step 5). On Docker that path
   * is inside a container, so a database created there is one the user can
   * neither find with a file dialog, back up, nor delete — a button that appears
   * to work and produces something unreachable.
   *
   * The demo carries a second condition, and it is load-bearing in the same way
   * the boot token is for §5: with no seed script there is nothing to run, so the
   * route would be an unreachable surface and the wizard hides the card instead
   * of offering a demo it cannot seed.
   */
  const desktopLocalDb = env.ADMINIUM_RUNTIME === 'desktop';
  // `demoSeedScriptPath` rather than the condition inline: `/system/info`'s
  // `desktopDemo` flag reports whether this route exists, and the wizard gates
  // its fourth source card on that answer. Two spellings of one condition is a
  // card that offers a 404 (or hides a working one) the day they diverge.
  const seedScriptPath = demoSeedScriptPath(env);
  const desktopDemo = seedScriptPath === null ? null : { seedScriptPath };

  /**
   * §9's backup, behind gate 1 of `routes/desktop/index.ts` (the route's own
   * header documents gates 2 and 3 — loopback peer, then `settings:manage`).
   *
   * One condition, like the LAN panel and for the same reason: every desktop
   * boot has data to back up. What makes it desktop-only is `<dataDir>/backups`
   * and `config.json` — self-host's answer to "back up my instance" is
   * `adminium export-zip` plus whatever backs up its Postgres.
   *
   * `metaPath` is derived rather than passed because §2.1 makes it an invariant:
   * the meta store is ALWAYS local SQLite on desktop (`ADMINIUM_META_DSN=
   * sqlite:<dataDir>/meta.db`, §2.2 step 5), even when the source DB is a remote
   * Postgres. `metaStore.url` is therefore the one true answer to "which file is
   * the live meta store", and asking the caller to repeat it would let the two
   * drift — the backup would snapshot a file the server is not using.
   */
  const desktopBackup = env.ADMINIUM_RUNTIME === 'desktop';

  /**
   * §12's capability grant table, behind gate 1 of
   * `routes/desktop-capabilities/index.ts`. One condition, like its siblings:
   * every desktop boot can install an app that declares a capability, so the
   * consent/revoke door and the grant reader the `CapabilityHost` calls both
   * need to exist. Off-desktop there is no host and no hardware, so §12's answer
   * there is "every capability `unavailable`" — a claim the SPA makes, not a
   * grant table.
   */
  const desktopCapabilities = env.ADMINIUM_RUNTIME === 'desktop';

  /**
   * The local bridge (`routes/bridge`), which lets adminium.dev hand this
   * instance a connection string instead of dead-ending at "copy this command".
   *
   * OFF unless `ADMINIUM_BRIDGE_ORIGINS` names the origins allowed to do it —
   * `adminium --bridge` is the only thing that sets it. Absent, the routes are
   * never registered, so there is no door to probe rather than a door that
   * refuses. The pairing code is minted here, once per boot: a code that
   * survived a restart would be a long-lived shared secret sitting in a file,
   * which is precisely what a consent token must not be.
   */
  const bridge =
    env.ADMINIUM_BRIDGE_ORIGINS === undefined
      ? null
      : { origins: env.ADMINIUM_BRIDGE_ORIGINS, pairingCode: createPairingCode(), store: createBridgeStore() };

  await app.register(
    async (api) => {
      if (desktopSession !== null) {
        await api.register(desktopSessionRoutes({ meta, bootToken: desktopSession.bootToken }));
      }
      // AFTER `rbacPlugin` above, which is what `app.rbac.require` needs to
      // exist at registration time — the reason this lives here and not in
      // `buildServer`'s route block, where `settingsManage` could not be
      // enforced at all.
      if (desktopLan) {
        await api.register(desktopLanRoutes({ meta, env }));
      }
      // Also after `rbacPlugin`: both guard on `system:connections:manage`.
      if (desktopLocalDb) {
        await api.register(desktopLocalDbRoutes({ manager, dataDir: env.ADMINIUM_DATA_DIR }));
      }
      if (desktopDemo !== null) {
        await api.register(
          desktopDemoRoutes({
            manager,
            dataDir: env.ADMINIUM_DATA_DIR,
            seedScriptPath: desktopDemo.seedScriptPath,
          }),
        );
      }
      // Also after `rbacPlugin`: guards on `system:settings:manage`.
      if (desktopBackup) {
        await api.register(
          desktopRoutes({
            meta,
            crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET),
            dataDir: env.ADMINIUM_DATA_DIR,
            metaPath: sqlitePathFromUrl(opts.metaStore.url),
          }),
        );
      }
      // Also after `rbacPlugin`: all three verbs guard on `system:settings:manage`.
      if (desktopCapabilities) {
        await api.register(desktopCapabilityRoutes({ meta }));
      }
      // Also after `rbacPlugin`: both verbs guard on `system:settings:manage`.
      // Registered only when a host exists to perform the restart the relocation
      // ends in — see `routes/meta/index.ts`.
      if (opts.onMetaRelocated !== undefined) {
        await api.register(
          metaRoutes({
            metaStore: opts.metaStore,
            env,
            onMetaRelocated: opts.onMetaRelocated,
          }),
        );
      }
      if (bridge !== null) {
        await api.register(
          bridgeRoutes({
            meta,
            origins: bridge.origins,
            pairingCode: bridge.pairingCode,
            store: bridge.store,
            version: APP_VERSION,
          }),
        );
      }
      await api.register(connectionsRoutes({ manager, meta }));
      await api.register(schemaRoutes({ manager, meta }));
      await api.register(dataRoutes({ manager, meta, undoStore }));
      // M7 data-io + reports/notifications (T5/T6): exports and imports share
      // the jobs pipeline wired above; scheduled reports ride the same registry
      // via the poll schedule below.
      const enqueueDataIo = (input: EnqueueJobInput) => jobs.enqueue(input);
      await api.register(exportsRoutes({ meta, manager, storage, enqueue: enqueueDataIo }));
      await api.register(importsRoutes({ meta, manager, storage, enqueue: enqueueDataIo }));
      await api.register(notificationsRoutes({ meta, hub: jobs.hub }));
      await api.register(scheduledReportsRoutes({ meta }));
      await api.register(emailTemplatesRoutes({ meta }));
      await api.register(generateRoutes({ manager, meta }));
      await api.register(schemaImportRoutes());
      await api.register(pagesRoutes({ meta }));
      // ⌘K global search (08 §2.9, M4-T06): pages by title + records via the
      // crud quick-search path, RBAC/PII-filtered like the data routes.
      await api.register(searchRoutes({ manager, meta }));
      await api.register(widgetDataRoutes({ manager, meta }));
      await api.register(
        // `emailKey` is passed explicitly rather than letting the route derive it
        // from `process.env`: the composition root already holds the parsed env,
        // and a route reading process.env directly is invisible to the desktop and
        // CLI wrappers that build their own Env (01 §2.3).
        settingsRoutes({ meta, emailKey: emailSecretKey(env.ADMINIUM_SECRET) }),
      );
      // Branding rides with settings but owns the bytes half (logo storage)
      // and the two PUBLIC reads the sign-in screen paints itself with.
      await api.register(brandingRoutes({ meta, storage }));
      await api.register(i18nRoutes({ meta }));
      await api.register(viewsRoutes({ meta }));
      await api.register(meViewsRoutes({ meta }));
      await api.register(onboardingRoutes({ meta }));
      await api.register(rolesRoutes);
      await api.register(usersRoutes);
      await api.register(permissionsRoutes);
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

  // Scheduled-reports poll (M7 T6): every minute, enqueue a `report-run` job
  // per due report. `enqueueDueReports` dedupes per occurrence
  // (`report-run:<id>:<nextRunAt>`), so overlapping ticks collapse; the
  // scheduler's own no-overlap guard rides on top.
  jobs.scheduler.registerSchedule(SCHEDULED_REPORTS_POLL_NAME, SCHEDULED_REPORTS_POLL_CRON, async () => {
    await enqueueDueReports(meta, (input) => jobs.enqueue(input));
  });

  // Export retention (M7-T07): daily `ready` → `expired` sweep past
  // `expires_at`, then byte GC — expired snapshots (potentially unmasked PII)
  // must not persist on disk past the promised retention window. `remove` is
  // idempotent and the worklist re-derives from rows, so a crash mid-pass
  // self-heals on the next tick.
  jobs.scheduler.registerSchedule(EXPORTS_RETENTION_SCHEDULE_NAME, EXPORTS_RETENTION_CRON, async () => {
    const repo = exportsRepo(meta);
    await repo.expireDue();
    const files = filesRepo(meta);
    for (const artifact of await repo.listExpiredArtifacts()) {
      await files.markDeleted(artifact.fileId);
      await storage.remove(artifact.storageKey);
    }
  });

  // Meta-store retention (BRIEF §8). Every deletion is logged with its count:
  // a GC that runs silently is indistinguishable from a GC that is not running,
  // and "why is adminium_audit_log 4 GB" is exactly the question an operator
  // asks six months in, when there is nothing left to read.
  //
  // `retention.exportsDays` is deliberately absent — the exports sweep above
  // owns that lifecycle, including the artifact bytes on disk, which this pass
  // knows nothing about.
  jobs.scheduler.registerSchedule(RETENTION_GC_SCHEDULE_NAME, RETENTION_GC_CRON, async () => {
    const settings = settingsRepo(meta);
    const at = Date.now();

    // Fixed-policy, so they read no setting: a session past its own `expires_at`
    // and a used/expired reset token are not retained data, they are dead rows.
    // Both `gc()` implementations keep revoked/expired rows for 24 h so an
    // audit trail of "you were logged out" survives the day it happened.
    const sessions = await sessionsRepo(meta).gc(at);
    const passwordResets = await passwordResetsRepo(meta).gc(at);

    const jobsDays = await settings.get('retention.jobsDays');
    const finishedJobs = await jobsRepo(meta).gc(at, jobsDays);

    // The audit log is the one table where deleting is a policy decision rather
    // than hygiene, so `retention.auditArchive` gets a veto. It promises
    // "archive audit batches to adminium_files before deleting" and no archiver
    // exists yet; honouring the delete half alone would destroy exactly the rows
    // the operator asked to keep. Skipping instead means the table grows — a
    // problem you can still fix — and says so in the log.
    const auditLogDays = await settings.get('retention.auditLogDays');
    const auditArchive = await settings.get('retention.auditArchive');
    const auditEntries = auditArchive ? null : await auditRepo(meta).gc(at, auditLogDays);

    app.log.info(
      { sessions, passwordResets, jobs: finishedJobs, auditEntries, jobsDays, auditLogDays },
      auditArchive
        ? 'retention sweep complete — audit log skipped, retention.auditArchive is on and archiving is not implemented'
        : 'retention sweep complete',
    );
  });

  // The manager owns live source-DB pools; the server owns the manager's
  // lifetime once it is listening (the CLI hands it over at `startServer`).
  app.addHook('onClose', async () => {
    await manager.disposeAll();
  });

  return {
    app,
    jobs,
    llmEnabled: llm !== null,
    desktopSessionEnabled: desktopSession !== null,
    desktopLanEnabled: desktopLan,
    desktopLocalDbEnabled: desktopLocalDb,
    desktopDemoEnabled: desktopDemo !== null,
    desktopBackupEnabled: desktopBackup,
    desktopCapabilitiesEnabled: desktopCapabilities,
    bridgePairingCode: bridge?.pairingCode ?? null,
  };
}
