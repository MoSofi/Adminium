// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE COMPOSITION ROOT ("All four deployment modes run the identical
 * `@adminium/server` process; only the wrapper differs").
 *
 * `buildServer` is the Fastify *skeleton* — logger, error envelope, auth, static,
 * and the handful of resources that need no injected services (system/auth/me/
 * bootstrap/setup/about). Every other resource is a FACTORY over injected
 * services (`connectionsRoutes({ manager, meta })`, `llmRoutes({ … })`, …),
 * because forbids the route tree from reaching out and constructing a
 * `ConnectionManager` or importing `@adminium/widgets` on its own. Somebody has
 * to do that construction. This module is that somebody, and it is the ONLY one.
 *
 * WHY IT EXISTS. It used to be `scripts/demo-v01.mjs` — a demo script — which
 * meant `adminium start`, `adminium try`'s final boot and the Docker CMD all
 * served a hollow API: the SPA loaded, setup created the super admin, and then
 * the connect wizard's `POST /api/v1/connections` 404'd, because the plugin that
 * answers it was only ever registered by a script nobody runs in production. The
 * dashboard calls 17 `/api/v1` namespaces; the skeleton serves 6. This module
 * closes that gap so the M10 exit criterion — "`npx @adminiumjs/adminium` (or
 * `docker run`)
 * on a clean machine → first-run wizard → create super admin → connect any of the
 * 3 engines → generated app" — is met by the shipped artifact and not only by a
 * script in the repo.
 *
 * DEGRADATION. The LLM surface is the one optional part: `LLM_ALLOWED_TEMPLATES`
 * / `LLM_ALLOWED_WIDGETS` come from `@adminium/widgets` (the server tree may not
 * import it), loaded by file path at runtime. When that load fails the `/llm`
 * routes are skipped and everything else boots — the demo script's behavior,
 * kept, because a missing AI vocabulary must not cost you your CRUD.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { llmKeyCryptoFromSecret, type AllowedVocabularies } from '@adminium/llm';
import { isAddOnManifest, validateManifest } from '@adminium/manifest';
import {
  documentProfilesRepo,
  addOnSettingsRepo,
  connectionTenantConfig,
  auditRepo,
  automationRunsRepo,
  DAY_MS,
  destinationsRepo,
  exportsRepo,
  HOUR_MS,
  filesRepo,
  jobsRepo,
  manifestsRepo,
  pagesRepo,
  passwordResetsRepo,
  publicApiStateRepo,
  publicRequestStatsRepo,
  publicChallengesRepo,
  publicProofsRepo,
  publicSessionsRepo,
  sessionsRepo,
  settingsRepo,
  type EnqueueJobInput,
  type InstalledManifest,
} from '@adminium/meta';

import { buildServer, type AdminiumServer, type BuildServerOptions } from './app.js';
import type { HostedSurface } from './cli/surfaces-root.js';
import type { Env } from './config/env.js';
import { decryptSecret, deriveKey, encryptSecret } from './config/secrets.js';
import { seedStorageDestination } from './config/storage-seed.js';
import { dsnCryptoFromSecret } from './connections/crypto.js';
import { createBridgeStore, createPairingCode } from './bridge/store.js';
import { registerIntrospectJob } from './connections/introspect.js';
import type { ConnectionManager } from './connections/manager.js';
import { UndoStore } from './crud/undo.js';
import { seedBuiltinEmailTemplates } from './email/builtins.js';
import { emailSecretKey } from './email/config.js';
import { configureEmailRuntime } from './email/send.js';
import { createCatalogClient } from './add-ons/catalog.js';
import { addOnCredentialCryptoFromSecret } from './add-ons/credential-crypto.js';
import { addOnHttpClientFor } from './add-ons/egress.js';
import {
  buildAddOnRuntime,
  importServerHalf,
  type AddOnRuntimeState,
} from './add-ons/runtime.js';
import { createDocumentPipeline } from './documents/compose.js';
import { syncTriggersForAddOn } from './documents/trigger-sync.js';
import { documentRoutes } from './routes/documents/index.js';
import { adoptInvoicesAddOn } from './add-ons/adopt-invoices.js';
import {
  createAddOnStore,
  installedNotInStore,
  packageIsInStore,
  seedBundledPackages,
  type AddOnStore,
} from './add-ons/store.js';
import { createPackageCopies } from './add-ons/package-copies.js';
import { createInstalledApps } from './apps/installed.js';
import { createAppSchemaTarget } from './apps/schema-target.js';
import { createAppCatalogClient } from './apps/catalog.js';
import { createAppStore } from './apps/store.js';
import { createColumnBlockReader } from './files/column-blocks.js';
import { createProjectService, isConfigWrite, type ProjectServerOptions } from './project/service.js';
import { createActionRunner } from './project/code/actions.js';
import { createProjectDb, type ProjectDbScope } from './project/code/db.js';
import { createHookRunner, type ProjectLogFn } from './project/code/hooks.js';
import { createProjectCodeRuntime } from './project/code/runtime.js';
import type { CodeProblem } from './project/code/load.js';
import { hasCodePage, type ClientBuild } from './project/client-build.js';
import { PAGES_DIR } from './project/paths.js';
import { createProjectClientHost } from './project/client-host.js';
import { applyProjectPages } from './project/project-pages.js';
import { NO_RECORD_HOOKS, createWriteService } from './crud/write-service.js';
import { createDestinationResolver } from './files/destinations.js';
import { createFileReconciler } from './files/reconcile.js';
import { FILES_DIR } from './files/drivers/local.js';
import { storageCryptoFromSecret } from './files/crypto.js';
import { createSpool } from './files/spool.js';
import { createFileStore } from './files/store.js';
import { registerSampleDataHandler, type SampleDataDeps } from './apps/sample-data.js';
import {
  enqueueCatalogRefresh,
  registerAddOnAcquireHandlers,
} from './jobs/add-on-acquire.js';
import { enqueueAppCatalogRefresh, registerAppAcquireHandlers } from './jobs/app-acquire.js';
import { registerAddOnEventHandlers } from './jobs/add-on-events.js';
import { registerJobsAndRealtime, type JobsAndRealtime } from './jobs/register.js';
import { registerAutomationRunHandler } from './jobs/automation-run.js';
import { automationsRoutes } from './routes/automations/index.js';
import { automationRunsRoutes } from './routes/automations/runs.js';
import { createAutomations, decorateAutomations } from './automations/register.js';
import { OUTBOX_SCAN_SCHEDULE_NAME, createOutboxProducers } from './outbox/producers.js';
import { OUTBOX_SEND_JOB_KIND, OUTBOX_SWEEP_SCHEDULE_NAME, createOutboxSender, registerOutboxSendHandler } from './outbox/sender.js';
import { emitRecordEvent, publishChildWrite } from './crud/after-record-write.js';
import { createSignInLinkMinter } from './public-api/sign-in-link-minter.js';
import { addressKey } from './public-api/claim-code.js';
import { withOutboxMoves } from './outbox/moves.js';
import {
  AUTOMATION_POLL_CRON,
  AUTOMATION_SCHEDULE_JITTER_MS,
  AUTOMATION_SCHEDULE_SCAN_NAME,
  AUTOMATION_WATCH_JITTER_MS,
  AUTOMATION_WATCH_SCHEDULE_NAME,
} from './automations/kinds.js';
import { pollWatchedTables } from './automations/watch.js';
import { scanDueSchedules } from './automations/schedule.js';
import {
  SCHEDULED_REPORTS_POLL_CRON,
  SCHEDULED_REPORTS_POLL_NAME,
  enqueueDueReports,
} from './jobs/report-run.js';
import type { ApplyService } from './llm/apply-service.js';
import type { CollectRunStats } from './llm/prompt-service.js';
import { sweepAssistantSessions } from './assistant/retention.js';
import { createProviderResolver } from './llm/provider-resolver.js';
import { resolveProviderClient } from './routes/llm/config-service.js';
import { assistantRoutes } from './routes/assistant/index.js';
import type { RunService } from './llm/run-service.js';
import { rbacPlugin } from './plugins/rbac.js';
import { NO_SURFACE_SETTINGS } from './surfaces/settings.js';
import { allowedForScreensOnly, appConnections, screensOnlyError } from './apps/screens-only.js';
import { permissionSetAllows, resolvePermissionSet } from './rbac/resolver.js';
import { API_PREFIX } from './routes/index.js';
import { apiKeysRoutes } from './routes/api-keys/index.js';
import { createAddOnSchemaTarget } from './add-ons/schema-target.js';
import { addOnRoutes } from './routes/add-ons/index.js';
import { auditRoutes } from './routes/audit/index.js';
import { desktopSessionRoutes } from './routes/auth/desktop-session.js';
import { desktopRoutes } from './routes/desktop/index.js';
import { demoSeedScriptPath } from './desktop/demo-seed.js';
import { desktopDemoRoutes } from './routes/desktop-demo/index.js';
import { desktopLanRoutes } from './routes/desktop-lan/index.js';
import { desktopLocalDbRoutes } from './routes/desktop-local-db/index.js';
import { desktopCapabilityRoutes } from './routes/desktop-capabilities/index.js';
import { apiDocsRoutes } from './routes/api-docs/index.js';
import { brandingRoutes } from './routes/branding/index.js';
import { bridgeRoutes } from './routes/bridge/index.js';
import { metaRoutes } from './routes/meta/index.js';
import { setupStoreRoutes } from './routes/setup/store.js';
import { createSetupService } from './setup/service.js';
import { hashPassword } from './auth/passwords.js';
import { connectionsRoutes } from './routes/connections/index.js';
import { dataRoutes } from './routes/data/index.js';
import { emailTemplatesRoutes } from './routes/email-templates/index.js';
import { exportsRoutes } from './routes/exports/index.js';
import { filesRoutes } from './routes/files/index.js';
import { generateRoutes } from './routes/generate/index.js';
import { importsRoutes } from './routes/imports/index.js';
import { invoicesRoutes } from './routes/invoices/index.js';
import { reportDocumentsRoutes } from './routes/report-documents/index.js';
import { llmRoutes } from './routes/llm/index.js';
import { meViewsRoutes } from './routes/me-views/index.js';
import { notificationsRoutes } from './routes/notifications/index.js';
import { onboardingRoutes } from './routes/onboarding/index.js';
import { pagesRoutes } from './routes/pages/index.js';
import { projectRoutes } from './routes/project/index.js';
import { permissionsRoutes } from './routes/permissions/index.js';
import { rolesRoutes } from './routes/roles/index.js';
import { scheduledReportsRoutes } from './routes/scheduled-reports/index.js';
import { schemaDdlRoutes } from './routes/schema-ddl/index.js';
import { optionListsRoutes } from './routes/option-lists/index.js';
import { schemaRoutes } from './routes/schema/index.js';
import { schemaImportRoutes } from './routes/schema-import/index.js';
import { searchRoutes } from './routes/search/index.js';
import { storageRoutes } from './routes/storage/index.js';
import { i18nRoutes } from './routes/i18n/index.js';
import { settingsRoutes } from './routes/settings/index.js';
import { usersRoutes } from './routes/users/index.js';
import { viewsRoutes } from './routes/views/index.js';
import { widgetDataRoutes } from './routes/widget-data/index.js';
import { WidgetDataCache } from './widget-data/cache.js';
import { createTelemetryService } from './telemetry/service.js';
import { APP_VERSION } from './version.js';
import { publicApiRegistrationBlocked, publicRoutes } from './routes/public/index.js';
import { publicAdminRoutes } from './routes/public-admin/index.js';
import { appRoutes } from './routes/apps/index.js';
import { surfacesAdminRoutes } from './routes/surfaces-admin/index.js';
import { createApiCatalogue, metaCatalogueSource } from './public-api/catalogue.js';
import { createPublicApiGate } from './public-api/enabled.js';
import { createEndpointService } from './public-api/endpoint-service.js';
import { writeStores } from './crud/write-stores.js';
import { createPublicResolver, createPublicViews, createRevisionWatch } from './public-api/runtime.js';
import { createRequestStats } from './public-api/stats.js';
import type { OnMetaRelocated } from './meta/relocate.js';
import { sqlitePathFromUrl, type MetaStoreHandle } from './meta/store.js';

/**
 * Daily, at 04:00 UTC, with an hour of jitter (below). Telemetry is the least
 * urgent thing this process does; a daily ping is what the payload documents
 * (`telemetry/payload.ts`) and nothing downstream reads it sooner. Runs on the
 * existing croner scheduler rather than a `setInterval`, per BRIEF (no
 * external scheduler, and no second timing mechanism either).
 */
export const TELEMETRY_SCHEDULE_NAME = 'telemetry-ping';
export const TELEMETRY_CRON = '0 4 * * *';
/** De-synchronize a fleet so a self-host cohort does not ping in lockstep. */
export const TELEMETRY_JITTER_MS = 60 * 60 * 1000;

/**
 * Daily add-on catalog refresh, offset an hour from the telemetry ping so
 * the two dailies never contend.
 *
 * The tick is a NO-OP on the vast majority of installs: the handler asks the
 * catalog client whether it is enabled before anything else, and the answer is
 * false unless somebody turned the switch on — so what the schedule costs an
 * air-gapped deployment is one settings read a day. It is registered
 * unconditionally for the same reason the telemetry schedule is: registering a
 * schedule is not consent, and a schedule that only exists once you consent is
 * a schedule that silently does not exist when you revoke consent and grant it
 * again without a restart.
 *
 * The bundled set (D3) is what makes the Add-ons page useful in the meantime.
 */
export const CATALOG_REFRESH_SCHEDULE_NAME = 'add-on-catalog-refresh';
export const CATALOG_REFRESH_CRON = '0 5 * * *';
/** Same fleet-desynchronization reasoning as the telemetry ping. */
export const CATALOG_REFRESH_JITTER_MS = 60 * 60 * 1000;

/**
 * Daily app catalog refresh (b G8-D3), half an hour after the add-on one so the
 * two never contend. The same terms: a no-op unless `ADMINIUM_NETWORK_FEATURES`
 * and `apps.catalogEnabled` are both on, and registered unconditionally because
 * registering a schedule is not consent.
 */
export const APP_CATALOG_REFRESH_SCHEDULE_NAME = 'app-catalog-refresh';
export const APP_CATALOG_REFRESH_CRON = '30 5 * * *';

/**
 * Where the image and the desktop build park the bundled add-on tarballs (D3).
 * Relative to the process CWD, which for the container is `/app`; absent on a
 * dev checkout, where {@link seedBundledPackages} is simply a no-op.
 */
export const BUNDLED_ADD_ONS_DIR = process.env['ADMINIUM_BUNDLED_ADD_ONS'] ?? './add-ons-bundle';
/**
 * Apps shipped with the build.
 *
 * The same shape the add-on bundle takes — a directory of `<key>-<version>.tgz`
 * beside a `.tgz.integrity` — and it exists for the same reason: an instance
 * that can only ever use what came with the image is a SUPPORTED configuration,
 * not a degraded one. It is also what lets the browse surface show real apps
 * before anything is published to a registry.
 */
export const BUNDLED_APPS_DIR = process.env['ADMINIUM_BUNDLED_APPS'] ?? './apps-bundle';

/**
 * Daily export-retention sweep: flips `ready` → `expired` on
 * `adminium_exports` rows past `expires_at`, then GCs the expired artifacts'
 * BYTES (`filesRepo.markDeleted` + `storage.remove`) so a snapshot never
 * outlives the "kept for 30 days, then expire" promise on disk. Offset from
 * the telemetry ping so the two dailies never contend.
 */
export const EXPORTS_RETENTION_SCHEDULE_NAME = 'exports-retention-sweep';
export const EXPORTS_RETENTION_CRON = '30 4 * * *';

/**
 * Daily FILES sweep. Two halves, and they are different lifecycles that
 * happen to run on one tick:
 *
 *  1. UNATTACHED uploads older than `files.unattachedHours` are trashed. These
 *     are the create form that was abandoned and the tab that was closed — a
 *     file nobody ever pointed a record at. Without this half, every abandoned
 *     upload is stored forever with nothing to find it by.
 *  2. TRASHED files older than `retention.filesTrashDays` have their bytes
 *     removed and their rows purged — through each file's OWN destination, not
 *     the current default, because a file written before a bucket was
 *     configured still lives on this server's disk.
 *
 * Offset from the exports sweep so the two never contend for the same driver.
 */
export const FILES_RETENTION_SCHEDULE_NAME = 'files-retention-sweep';
export const FILES_RETENTION_CRON = '45 4 * * *';

/**
 * Daily META-STORE retention sweep — the one that keeps a self-host install
 * from growing forever.
 *
 * WHAT WAS WRONG. `sessionsRepo`, `passwordResetsRepo`, `jobsRepo` and
 * `auditRepo` each ship a `gc()` written against the BRIEF retention policy,
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

/** Minute flush of the public API's request counts. */
export const PUBLIC_STATS_FLUSH_NAME = 'public-request-stats-flush';
export const RETENTION_GC_CRON = '0 3 * * *';

export interface ComposeServerOptions {
  env: Env;
  /** The opened meta store — `meta` for the services, `url` for checks. */
  metaStore: MetaStoreHandle;
  /** The shared source-database connection pool/registry. */
  manager: ConnectionManager;
  runService: RunService;
  applyService: ApplyService;
  /**
   * The `@adminium/widgets` allow-lists. `null` ⇒ the `/llm` resource is skipped
   * (see the module header) — everything else is registered regardless.
   */
  allowed: AllowedVocabularies | null;
  /** Statistics collector for the prompt builder. */
  collectStats?: CollectRunStats | undefined;
  /** Dashboard build directory; omitted ⇒ API only. */
  staticRoot?: string | undefined;
  /** Hosted app surfaces (`plugins/surfaces.ts`); omitted ⇒ none mounted. */
  surfaces?: readonly HostedSurface[] | undefined;
  /**
   * Passed through to {@link buildServer}: tests silence it with `false`, or
   * hand in a pino instance to read what the boot logged.
   */
  logger?: BuildServerOptions['logger'];
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
  /**
   * The project folder this server runs, when there is one (`adminium start`
   * inside a project, and `adminium dev`). Registers `/project` and keeps the
   * folder's page and schema files in step with this server.
   */
  project?: ProjectServerOptions | undefined;
}

export interface ComposedServer {
  app: AdminiumServer;
  /** The jobs/realtime handle — hub, worker, scheduler (see `jobs/register.ts`). */
  jobs: JobsAndRealtime;
  /** True when the `/llm` resource was registered (i.e. `allowed` was present). */
  llmEnabled: boolean;
  /**
   * True when `POST /auth/desktop-session` was registered. Reported rather than
   * inferred: whether that route exists is the single most security-relevant
   * fact about a composed server, and a caller (or a test) asking "did the
   * boot-token door get opened?" should not have to re-derive the answer from
   * the same two env vars this module already read.
   */
  desktopSessionEnabled: boolean;
  /**
   * True when `GET /desktop/lan-share` was registered — i.e. this is the
   * Electron shell's child. Mirrors {@link ComposedServer.desktopSessionEnabled}
   * and is reported for the same reason: which desktop-only doors a composed
   * server opened is a fact a caller should read rather than re-derive.
   */
  desktopLanEnabled: boolean;
  /**
   * True when `POST /desktop/local-database` was registered (card 1).
   */
  desktopLocalDbEnabled: boolean;
  /**
   * True when `POST /desktop/demo-database` was registered (card 4) — i.e.
   * desktop runtime AND a seed script to run. The wizard hides the card when
   * this is false, which is why the two flags are reported separately rather
   * than as one "desktop extras" boolean.
   */
  desktopDemoEnabled: boolean;
  /**
   * True when `POST /desktop/backup` was registered. Reported for the same
   * reason as its siblings: the shell's BackupCoordinator drives the File menu
   * and the 03:00 scheduler off this route, so "does the door exist" is a fact a
   * caller reads rather than re-derives.
   */
  desktopBackupEnabled: boolean;
  /**
   * True when the capability grant routes were registered. Reported for the
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
 * Mirror `config.json`'s `singleUser` into the setting the route reads.
 *
 * "only while `config.singleUser` is true (mirrored into `adminium_settings` …
 * by the server at boot)". The desktop main process owns `config.json` and the
 * child cannot read it (different process, different lifetime, makes the main
 * process its only writer), so the env var IS the mirror channel — see
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

  /*
   * Installed apps, created BEFORE the server so the surfaces plugin can hold
   * the registry it will read per request.
   *
   * The first read is best-effort for the same reason the add-on store's prune
   * is: a meta store that cannot be queried yet is a real problem, but it is
   * not a reason to refuse to start a server whose other features do not need
   * one. An empty registry serves nothing extra and the next install refreshes
   * it.
   */
  const appStore = createAppStore({ dataDir: env.ADMINIUM_DATA_DIR });
  /*
   * ONE app catalog client for the routes and the acquisition jobs, so the gate
   * the page is told about and the gate a job obeys cannot disagree (48 G8-D3).
   * Constructing it makes no call: every method checks
   * `ADMINIUM_NETWORK_FEATURES` and `apps.catalogEnabled` before a URL exists,
   * pinned by `app-network-isolation.test.ts`.
   */
  const appCatalog = createAppCatalogClient({
    meta,
    networkFeatures: env.ADMINIUM_NETWORK_FEATURES,
  });
  const appManifests = manifestsRepo(meta, addOnCredentialCryptoFromSecret(env.ADMINIUM_SECRET));
  /** Forget which apps have an outbox; set once the producers exist below. */
  let outboxesChanged = (): void => {};
  const installedApps = createInstalledApps({
    store: appStore,
    // Every install, update, switch and uninstall refreshes this list, so the
    // app emails' producers look again at which apps are live.
    list: async () => {
      outboxesChanged();
      return (await appManifests.list('app')).map((installed) => ({
        key: installed.row.manifestKey,
        version: installed.row.version,
        status: installed.row.status,
      }));
    },
  });

  const app = await buildServer({
    env,
    metaDb: meta,
    installedApps,
    ...(opts.staticRoot === undefined ? {} : { staticRoot: opts.staticRoot }),
    ...(opts.surfaces === undefined ? {} : { surfaces: opts.surfaces }),
    ...(opts.logger === undefined ? {} : { logger: opts.logger }),
    ...(opts.openapi === undefined ? {} : { openapi: opts.openapi }),
  });

  await app.register(rbacPlugin, { meta });

  /*
   * SCREENS-ONLY PEOPLE (a till's cashier) reach the API for what their app's
   * screens need and nothing else. Here, straight after the rbac plugin and
   * before any route scope below exists, so it reaches every one of them; the
   * bootstrap, registered earlier, refuses them itself.
   */
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/') || request.user == null || request.apiKeyPrincipal != null) return;
    const set = await app.rbac.resolve(request);
    if (set.screensOnly === null) return;
    const settings = app.surfaceSettings === null ? NO_SURFACE_SETTINGS : await app.surfaceSettings.read();
    const connections = await appConnections(meta, settings, set.screensOnly);
    if (allowedForScreensOnly(request.method, request.url, connections)) return;
    throw screensOnlyError(settings, set.screensOnly, request);
  });

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

  // LLM assist (M6). Only the vocabulary is optional;
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
              // The unknown-icon check. Documented since M6 as fed by
              // `@adminium/ui`'s `LUCIDE_ICON_NAMES`, and until now fed by
              // nothing: the symbol did not exist and this call never passed the
              // option, so the check silently skipped and a model could store any
              // string it liked as a table's icon. `loadAllowedVocabularies`
              // carries the manifest now, as data (the server may not import ui).
              ...(allowed.icons === undefined ? {} : { allowedIcons: allowed.icons }),
            }),
          };
        })();

  // THE ONE BYTE SEAM. Everything Adminium
  // stores goes through it: exports, imports, scheduled-report snapshots, the
  // branding logo, imported schema files and uploads.
  //
  // With no destination configured it is byte-identical to what shipped before
  // wave 0024 — `<dataDir>/files/<file_ULID>`, the same flat key grammar that
  // IS the traversal guard. Configure a destination in Studio (or seed one from
  // the environment) and every NEW file of every kind follows it (D18), which
  // is what makes a host with no persistent disk viable at all.
  const storageCrypto = storageCryptoFromSecret(env.ADMINIUM_SECRET);
  const destinationResolver = createDestinationResolver({
    repo: destinationsRepo(meta, storageCrypto),
    localRoot: resolve(env.ADMINIUM_DATA_DIR, FILES_DIR),
  });
  // The first-boot destination seed, and it has TWO CALL SITES
  // deliberately.
  //
  // `cli/commands/start.ts` calls it too, and earlier, because on the CLI path
  // `composeServer` runs late — after the source seed, which generates pages,
  // and a generation run writes files. A destination named in the environment
  // has to be the default BEFORE the first artifact of that boot is written, so
  // the CLI cannot wait for this line.
  //
  // This line is the one that covers everybody else. The desktop app boots
  // `composeServer` directly (`apps/desktop/src/server/index.ts`) and never
  // goes through `start.ts`, so without it `ADMINIUM_STORAGE_URL` and the
  // `AWS_*` quartet were read by nothing outside the CLI — on the one host with
  // the least reason to care and none of the ephemeral-disk hosts the seed was
  // written for. Paying for it twice costs one indexed read: the seed returns
  // before touching the store when nothing is configured, and ANY existing
  // destination row makes it a no-op — and one log line, see below.
  //
  // Best-effort, like the template seed above. The seed catches its own
  // failures — an unmigrated store included — so this is the composition root's
  // own belt rather than the only one: nothing about optional storage
  // configuration is worth refusing to serve CRUD over.
  //
  // `log` goes to DEBUG here, and only here. On the CLI path `start.ts` has
  // already said what happened, in the operator's terminal, before this server
  // existed — so at `info` this second call would print a line contradicting
  // the first ("seeded from ADMINIUM_STORAGE_URL" immediately followed by
  // "ADMINIUM_STORAGE_URL ignored — this instance already has a storage
  // destination"), on every boot of exactly the ephemeral-disk hosts the seed
  // was written for. Anything from this call that an operator must act on is a
  // `warn`, and that still reaches them.
  try {
    await seedStorageDestination({
      meta,
      crypto: storageCrypto,
      env,
      log: (message) => {
        app.log.debug(message);
      },
      warn: (message) => {
        app.log.warn(message);
      },
    });
  } catch (error) {
    app.log.warn({ err: error }, 'could not seed the storage destination from the environment');
  }
  /*
   * Sample data reaches the operator's database, the app store and the Files
   * library, and tells open dashboards when it lands. The Files library's store
   * is created just below, so it is read lazily.
   */
  const sampleDataDeps: SampleDataDeps = {
    meta,
    manager,
    store: appStore,
    get files() {
      return storage;
    },
    publish: async (connectionId) => {
      if (app.hasDecorator('realtime')) {
        app.realtime.publish('config-changed', 'config-changed', {
          connectionId,
          configVersion: await pagesRepo(meta).configVersion(),
        });
      }
    },
  };
  const storage = createFileStore({
    spool: createSpool({ dataDir: env.ADMINIUM_DATA_DIR }),
    destinations: destinationResolver,
    files: filesRepo(meta),
  });
  // Which columns hold files, and the hook that keeps `adminium_files` in step
  // with what those columns say. One reader, shared by the upload
  // route (which asks about ONE column) and the reconcile hook (which asks
  // about a whole table), so both see the same cache.
  const columnBlocks = createColumnBlockReader(meta);

  // A project folder's sync. Its write hook is added here, before the API
  // routes are registered, because a Fastify scope only inherits the hooks
  // that existed when it was created.
  const project =
    opts.project === undefined
      ? null
      : createProjectService({
          meta,
          ...opts.project,
          onApplied: () => {
            columnBlocks.clear();
            if (!app.hasDecorator('realtime')) return;
            void pagesRepo(meta)
              .configVersion()
              .then((configVersion) => {
                app.realtime.publish('config-changed', 'config-changed', { connectionId: null, configVersion });
              })
              .catch(() => undefined);
          },
        });
  if (project !== null) {
    app.addHook('onResponse', async (request, reply) => {
      if (reply.statusCode < 400 && isConfigWrite(request.method, request.routeOptions.url)) {
        project.databaseChanged();
      }
    });
    app.addHook('onReady', async () => {
      project.start();
    });
    app.addHook('onClose', async () => {
      await project.close();
    });
  }
  const fileReconciler = createFileReconciler({
    meta,
    blocks: columnBlocks,
    destinations: destinationResolver,
    logger: app.log,
  });

  /*
   * The project's own code: hooks around every record write, and actions.
   * Never on the desktop app, which has no project, and never without a
   * project folder, which is how `adminium try` starts. Every write path
   * below is handed `recordWrites`, so the hooks see all of them.
   */
  /*
   * The project's pages and widgets ride the same runtime: each
   * `pages/<slug>.tsx` gets a page row, and under `adminium dev` a rebuild
   * rewrites those rows and tells open dashboards to load the new files.
   */
  const pageProblems: CodeProblem[] = [];
  const applyClientBuild = async (client: ClientBuild): Promise<void> => {
    if (opts.project === undefined) return;
    const { root } = opts.project;
    const applied = await applyProjectPages(meta, client.pages, {
      hasCodePage: (slug) => hasCodePage(root, slug),
      hasPageFile: (slug) => existsSync(join(root, PAGES_DIR, `${slug}.json`)),
    });
    pageProblems.splice(0, pageProblems.length, ...applied.problems.map((problem) => ({ ...problem, at: Date.now() })));
    for (const problem of applied.problems) opts.project.warn(`${problem.source}: ${problem.message}`);
    for (const slug of applied.removed) opts.project.log(`Removed the page /p/${slug}; its file is gone.`);
    for (const slug of applied.adopted) {
      opts.project.log(`The page /p/${slug} now runs its code from pages/; it keeps its grants and views.`);
    }
  };
  const projectCode =
    opts.project === undefined || env.ADMINIUM_RUNTIME === 'desktop'
      ? null
      : createProjectCodeRuntime({
          root: opts.project.root,
          mode: opts.project.mode,
          log: opts.project.log,
          warn: opts.project.warn,
          onClientChanged: async (client) => {
            await applyClientBuild(client);
            if (!app.hasDecorator('realtime')) return;
            app.realtime.publish('config-changed', 'project-changed', { digest: client.digest });
          },
        });
  const projectKeys = new Map<string, { key: string | null; at: number }>();
  const projectKeyOf = async (connectionId: string): Promise<string | null> => {
    const cached = projectKeys.get(connectionId);
    if (cached !== undefined && Date.now() - cached.at < 10_000) return cached.key;
    const key = await manager.mustFind(connectionId).then(
      (connection) => connection.projectKey,
      () => null,
    );
    projectKeys.set(connectionId, { key, at: Date.now() });
    return key;
  };
  const projectLog: ProjectLogFn = (level, message, data) => {
    app.log[level]({ project: data }, message);
  };
  const projectDb = (scope: ProjectDbScope) =>
    createProjectDb({ app, meta, manager, writes: () => recordWrites, files: fileReconciler }, scope);
  const hookRunner =
    projectCode === null
      ? null
      : createHookRunner({
          code: () => projectCode.current(),
          keyOf: projectKeyOf,
          db: ({ database, target, context }) =>
            projectDb({ database, raw: target.db, dialect: target.dialect, context }),
          log: projectLog,
          failures: projectCode.failures,
        });
  /*
   * ONE widget-data result cache for the process: the widget-data routes serve
   * from it, and every write path (`afterRecordWrite`, bulk, undo, public,
   * import) drops the written table from it — otherwise a refetch right after
   * a write is answered from the 30 s cache and the new row stays invisible.
   */
  const widgetDataCache = new WidgetDataCache();
  app.decorate('widgetDataCache', widgetDataCache);
  const recordWrites = createWriteService({
    // An app's outbox table takes only the moves a person may make: a sent message is never queued again.
    hooks: () => withOutboxMoves(hookRunner ?? NO_RECORD_HOOKS, { meta, outboxes: () => outboxProducers.all() }),
    // A running number counts in the meta store; a venue's clock is its connection's.
    ...writeStores(meta),
    // An update of a table an app's email watches for a change reads the row first.
    watched: (connectionId, tableId) => outboxProducers.watches(connectionId, tableId),
  });
  /*
   * AN APP'S EMAILS. The producers queue rows in an installed app's outbox
   * table from its writes and, once a minute, for its reminders. Decorated
   * here, before any route, because every write reaches them through
   * `emitRecordEvent`.
   */
  const outboxProducers = createOutboxProducers({
    meta,
    manager,
    viewFor: (connectionId) => publicViews.viewFor(connectionId),
    writes: recordWrites,
    logger: app.log,
    announce: (connectionId, table, row, action = 'create') => {
      publishChildWrite(app, { connectionId, table, action, pk: Object.fromEntries(table.primaryKey.map((c) => [c, row[c]])), row });
    },
    // A row was queued: send it now rather than at the next minute's sweep.
    onQueued: (appKey) => {
      void jobs.enqueue({ kind: OUTBOX_SEND_JOB_KIND, payload: { app: appKey }, dedupeKey: `${OUTBOX_SEND_JOB_KIND}:${appKey}` }).catch((error: unknown) => {
        app.log.warn({ err: error, appKey }, 'the app email send job could not be queued; the sweep will send it');
      });
    },
  });
  outboxesChanged = () => {
    outboxProducers.reset();
  };
  app.decorate('outbox', outboxProducers);
  let signInLinkMinter: ReturnType<typeof createSignInLinkMinter> | undefined;
  const outboxSender = createOutboxSender({
    meta,
    manager,
    viewFor: (connectionId) => publicViews.viewFor(connectionId),
    writes: recordWrites,
    live: () => outboxProducers.live(),
    logger: app.log,
    // The app's guest side on its own host, when the operator mapped one.
    hostFor: async (appKey) => {
      const settings = app.surfaceSettings === null ? NO_SURFACE_SETTINGS : await app.surfaceSettings.read();
      return Object.entries(settings.domains).find(([, target]) => target.appKey === appKey && target.side === 'customer' && target.instance === undefined)?.[0];
    },
    // The app's staff side on its own host, for a notice's link to the desk.
    staffHostFor: async (appKey) => {
      const settings = app.surfaceSettings === null ? NO_SURFACE_SETTINGS : await app.surfaceSettings.read();
      return Object.entries(settings.domains).find(([, target]) => target.appKey === appKey && target.side === 'staff' && target.instance === undefined)?.[0];
    },
    // The change a sent message makes reaches the rules, the other producers and every screen.
    emit: (event) => emitRecordEvent(app, event),
    // A template's `attach`: the sender draws (or reuses) the document through the same pipeline as every door.
    documents: () => documents,
    // `{{signInLink}}`: a one-use link for the recipient's own identity row, minted at send time.
    // Made at the first send: the public views it reads are composed further down.
    signInLinks: {
      mint: (input) =>
        (signInLinkMinter ??= createSignInLinkMinter({ meta, manager, views: publicViews, crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET), addressSecret: addressKey(env.ADMINIUM_SECRET) })).mint(input),
    },
    announce: (connectionId, table, row) => {
      publishChildWrite(app, { connectionId, table, action: 'update', pk: Object.fromEntries(table.primaryKey.map((c) => [c, row[c]])), row });
    },
    secret: env.ADMINIUM_SECRET,
  });
  app.decorate('outboxSender', outboxSender);
  const projectActions =
    projectCode === null
      ? null
      : createActionRunner({ app, meta, manager, code: () => projectCode.current(), db: projectDb, log: projectLog });
  if (projectCode !== null) {
    app.addHook('onReady', async () => {
      projectCode.start();
    });
    app.addHook('onClose', async () => {
      projectCode.close();
    });
  }
  const projectClient = project === null ? null : createProjectClientHost({ meta, runtime: projectCode });
  if (projectClient !== null) app.decorate('projectClient', projectClient);

  // The add-on package store: a sibling of
  // `files/` under the same data dir, so downloaded packages survive an image
  // upgrade on the named volume the way exports and backups already do.
  //
  // Two things happen at boot and neither touches the network. Orphaned temp
  // directories from an unpack that was interrupted (SIGKILL mid-write, a full
  // disk) are pruned, because an atomic-rename staging scheme leaks exactly
  // that on a hard stop. Then the image's bundled set (D3) is seeded
  // copy-if-absent, with every hash re-verified on the way in — which is what
  // makes an air-gapped install able to browse and install with no registry at
  // all. Both are best-effort: a data dir that cannot be written is a real
  // problem, but it is not a reason to refuse to start a server whose other
  // features do not need one.
  /*
   * First read of the installed-app registry. AWAITED, not fire-and-forget: a
   * request that arrives before it resolves would see an empty registry and get
   * a 404 for an app that is installed — a boot-time race that would reproduce
   * once in a hundred restarts and read as an install bug.
   */
  try {
    const serving = await installedApps.refresh();
    if (serving.length > 0) {
      app.log.info({ surfaces: serving.length }, 'serving installed app surfaces');
    }
  } catch (error) {
    app.log.warn({ err: error }, 'could not read installed apps; none will be served');
  }

  /*
   * The bundled app set, staged into the store before anything asks for it.
   * Best-effort in the same way the add-on seed below is: a missing directory
   * is the normal case for a from-source run, and a corrupt entry costs its own
   * package rather than the boot.
   *
   * Kept, not voided: the missing-package report at the end of this function
   * waits for it.
   */
  const appSeed = appStore
    .pruneTemp()
    .then(async (pruned) => {
      if (pruned > 0) app.log.info({ pruned }, 'pruned orphaned app staging directories');
      const seed = await seedBundledPackages(
        appStore,
        resolve(BUNDLED_APPS_DIR),
        (m, d) => app.log.warn(d, m),
        'app',
      );
      if (seed.seeded.length > 0) {
        app.log.info({ seeded: seed.seeded }, 'seeded bundled apps');
        /*
         * The registry was read above, BEFORE this seed. On an empty data
         * directory — every redeploy on a host with no persistent disk — an
         * installed app the seed has just put back would otherwise stay
         * unserved until the next install or uninstall.
         */
        try {
          await installedApps.refresh();
        } catch (error) {
          app.log.warn({ err: error }, 'could not read installed apps; none will be served');
        }
      }
      if (seed.failed.length > 0) app.log.warn({ failed: seed.failed }, 'bundled apps failed to seed');
    })
    .catch((error: unknown) => {
      app.log.warn({ err: error }, 'could not seed bundled apps');
    });

  const addOnStore = createAddOnStore({ dataDir: env.ADMINIUM_DATA_DIR });
  /*
   * Kept, not voided: the boot-time runtime build waits for it (see
   * `rebuildAddOnRuntime` below), and so does the missing-package report.
   */
  const addOnSeed = addOnStore
    .pruneTemp()
    .then(async (pruned) => {
      if (pruned > 0) app.log.info({ pruned }, 'pruned orphaned add-on staging directories');
      const seed = await seedBundledPackages(addOnStore, resolve(BUNDLED_ADD_ONS_DIR), (m, d) =>
        app.log.warn(d, m),
      );
      if (seed.seeded.length > 0) app.log.info({ seeded: seed.seeded }, 'seeded bundled add-ons');
      if (seed.failed.length > 0) app.log.error({ failed: seed.failed }, 'bundled add-ons failed to seed');

      /*
       * THE INVOICE SURFACE'S UPGRADE PATH.
       *
       * It was built into the dashboard through 0.2.11 and is an add-on's page
       * now. A workspace that authored documents keeps its rows either way, so
       * the upgrade installs the bundled add-on for those workspaces and leaves
       * every other one alone. Runs after the seed because it installs what the
       * seed just put on disk; wrapped, because an instance that cannot adopt
       * must still boot.
       */
      try {
        const outcome = await adoptInvoicesAddOn({
          meta,
          store: addOnStore,
          crypto: addOnCredentialCryptoFromSecret(env.ADMINIUM_SECRET),
          countDocuments: async () => {
            const row = await meta.db
              .selectFrom('adminium_invoice_documents')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .executeTakeFirst();
            return Number(row?.count ?? 0);
          },
        });
        if (outcome.adopted) {
          app.log.info(
            { addOn: 'invoices', version: outcome.version },
            'installed the invoices add-on for this workspace: its documents were authored before the surface moved out of the dashboard',
          );
        }
      } catch (err: unknown) {
        app.log.warn({ err }, 'could not adopt the invoices add-on; install it from Studio');
      }
    })
    .catch((err: unknown) => {
      app.log.warn({ err }, 'add-on store could not be prepared');
    });

  /*
   * THE LIVE ADD-ON RUNTIME, HELD.
   *
   * `runtime.ts` has always claimed a rebuild on install; the build below was
   * the only one, and its result was not kept anywhere — so nothing could read
   * it "rebuild whole after each of the three routes" had nowhere to put the
   * new state. This holder is that place. It starts null, which is correct
   * rather than a gap: the build is fire-and-forget at boot, and a render that
   * arrives before it finishes gets `provider-missing` — a SKIP with a reason,
   * not a failure.
   */
  let addOnRuntime: AddOnRuntimeState | null = null;

  /**
   * Rebuild the add-on runtime WHOLE.
   *
   * Called at boot and again after every install, upgrade, enable/disable and
   * uninstall. Whole and never patched: a partially-updated provider map is
   * worse than a stale one, because a stale one is at least consistent with
   * itself. The declaration is here, above every caller, because the boot path
   * and the routes must run the SAME function — two rebuild implementations
   * would be two chances to forget a step.
   */
  let rebuildAddOnRuntime: () => Promise<void> = () => Promise.resolve();

  /*
   * The document pipeline. Assembled ONCE and handed to both entry points —
   * the queued job below and the automation step further down — so "the same
   * profile produces the same document however it was asked for" is one
   * object rather than two that agree today.
   */
  const documents = createDocumentPipeline({
    meta,
    manager,
    storage,
    runtime: () => addOnRuntime,
    // Step 8's delivery reports here. The outcome is on the register row
    // either way — this is for whoever is watching the queue.
    logger: app.log,
  });

  const jobs = await registerJobsAndRealtime(app, {
    meta,
    documents,
    resolveUser: (req) => req.user ?? null,
    // Registers the export-run / import-run / report-run handlers on the shared
    // registry — the same instances the exports/imports routes receive below.
    dataIo: { manager, storage, storageCrypto, writes: recordWrites, widgetCache: widgetDataCache },
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
    // A message an app's outbox row asked for that fails for good turns the row `failed`.
    email: { secret: env.ADMINIUM_SECRET, storage, onGiveUp: (report, error) => outboxSender.markUndelivered(report, error) },
    ...(llm === null ? {} : { llm: { resolve: llm.resolve } }),
    // The assistant's turn runner. The GUARDED resolver, not the enrichment
    // job's: it re-checks the stored base URL against the outbound guard at the
    // moment it dials, so a metadata address planted in settings is refused
    // rather than fetched.
    ...(llm === null
      ? {}
      : {
          assistant: {
            manager,
            resolveClient: () => resolveProviderClient(settingsRepo(meta), llm.keyCrypto),
            // The same resolver + decision function the route guards use, for
            // a user rather than a request — a turn runs long after its
            // request is gone.
            can: async (userId: string | null, permission: string) =>
              userId === null
                ? false
                : permissionSetAllows(
                    await resolvePermissionSet(meta, { kind: 'user', id: userId, label: userId }),
                    permission,
                  ),
          },
        }),
  });

  // The `introspect` job kind: without this, POST
  // /connections/:id/introspect silently falls back to its synchronous
  // dev/test path (30s request-thread budget) in every deployment and the
  // wizard's job-polling branch never runs.
  registerIntrospectJob(jobs.registry, { manager, meta });

  /*
   * THE RULE ENGINE.
   *
   * Decorated BEFORE the data routes are registered, because
   * `crud/after-record-write.ts` guards on `hasDecorator('automations')` and a
   * write that reached the seam before this point would be dispatched to
   * nothing. Two croner names tick every minute alongside the scheduled-report
   * poll, jittered apart so three schedules do not land on the same second.
   */
  const automations = createAutomations({
    meta,
    manager,
    enqueue: (input: EnqueueJobInput) => jobs.enqueue(input),
    log: app.log,
  });
  decorateAutomations(app, automations);
  registerAutomationRunHandler(jobs.registry, {
    meta,
    manager,
    app,
    writes: recordWrites,
    secret: env.ADMINIUM_SECRET,
    storage,
    // The `document.render` step's way to the pipeline (D55). Without it a
    // rule with that step refuses with a sentence rather than throwing from
    // inside the renderer.
    documents,
    hub: jobs.hub,
    enqueue: (input: EnqueueJobInput) => jobs.enqueue(input),
  });
  jobs.scheduler.registerSchedule(
    AUTOMATION_WATCH_SCHEDULE_NAME,
    AUTOMATION_POLL_CRON,
    async () => {
      const tick = await pollWatchedTables({
        meta,
        manager,
        enqueue: (input: EnqueueJobInput) => jobs.enqueue(input),
        countRelated: automations.countRelated,
        log: app.log,
      });
      if (tick.runsStarted > 0) app.log.info(tick, 'automation watch tick');
    },
    { jitterMs: AUTOMATION_WATCH_JITTER_MS },
  );
  registerOutboxSendHandler(jobs.registry, outboxSender);
  jobs.scheduler.registerSchedule(
    OUTBOX_SWEEP_SCHEDULE_NAME,
    AUTOMATION_POLL_CRON,
    async () => {
      const settled = await outboxSender.sweep();
      if (settled > 0) app.log.info({ settled }, 'app emails sent');
    },
    { jitterMs: AUTOMATION_WATCH_JITTER_MS },
  );
  jobs.scheduler.registerSchedule(
    OUTBOX_SCAN_SCHEDULE_NAME,
    AUTOMATION_POLL_CRON,
    async () => {
      const queued = await outboxProducers.scan();
      if (queued > 0) app.log.info({ queued }, 'app reminders queued');
    },
    { jitterMs: AUTOMATION_WATCH_JITTER_MS },
  );
  jobs.scheduler.registerSchedule(
    AUTOMATION_SCHEDULE_SCAN_NAME,
    AUTOMATION_POLL_CRON,
    async () => {
      const tick = await scanDueSchedules({
        meta,
        manager,
        enqueue: (input: EnqueueJobInput) => jobs.enqueue(input),
        log: app.log,
      });
      if (tick.runsStarted > 0 || tick.capped > 0) app.log.info(tick, 'automation schedule tick');
    },
    { jitterMs: AUTOMATION_SCHEDULE_JITTER_MS },
  );

  const undoStore = new UndoStore();

  /**
   * THE DESKTOP AUTO-LOGIN DOOR — the one route in the
   * product that mints a super-admin session without a password.
   *
   * Both conditions are load-bearing, and the AND is the point:
   *
   * - `ADMINIUM_RUNTIME=desktop` — registers this "only when" the Electron shell
   *  is the wrapper. Every other deployment (self-host, Docker, npx, and every
   *  test that does not opt in) composes a server with NO such route:
   *  `/auth/desktop-session` 404s there, which is a stronger guarantee than any
   *  runtime check inside a handler could make.
   *  - a boot token — a desktop boot without one has nothing to exchange, so the
   *    route would be an unreachable surface. A fresh token is minted per boot;
   *    absence means the shell chose not to (or could not), and the app lands on
   *    the normal login screen.
   *
   * The mirror runs first so the route's own policy gate reads THIS boot's
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
   * The share panel, behind gate 1 of `routes/desktop-lan/index.ts`.
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
   * The two server-side source cards — "Create a new local database" (card
   * 1) and "Explore the demo database" (card 4).
   *
   * Both are gated on the runtime for the same reason, and it is not the reason:
   * neither mints a credential, and both do exactly what `POST /connections`
   * does, under the same `system:connections:manage` grant. What makes them
   * desktop-only is their SUBJECT. Both write into `<dataDir>/databases/`, a
   * directory that exists because the Electron shell created it and passed
   * `ADMINIUM_DATA_DIR`. On Docker that path is inside a container, so a
   * database created there is one the user can neither find with a file dialog,
   * back up, nor delete — a button that appears to work and produces something
   * unreachable.
   *
   * The demo carries a second condition, and it is load-bearing in the same way
   * the boot token is for: with no seed script there is nothing to run, so the
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
   * The backup, behind gate 1 of `routes/desktop/index.ts` (the route's own
   * header documents gates 2 and 3 — loopback peer, then `settings:manage`).
   *
   * One condition, like the LAN panel and for the same reason: every desktop
   * boot has data to back up. What makes it desktop-only is `<dataDir>/backups`
   * and `config.json` — self-host's answer to "back up my instance" is
   * `adminium export-zip` plus whatever backs up its Postgres.
   *
   * `metaPath` is derived rather than passed because makes it an invariant: the
   * meta store is ALWAYS local SQLite on desktop (`ADMINIUM_META_DSN=
   * sqlite:<dataDir>/meta.db`), even when the source DB is a remote Postgres.
   * `metaStore.url` is therefore the one true answer to "which file is the live
   * meta store", and asking the caller to repeat it would let the two drift —
   * the backup would snapshot a file the server is not using.
   */
  const desktopBackup = env.ADMINIUM_RUNTIME === 'desktop';

  /**
   * The capability grant table, behind gate 1 of
   * `routes/desktop-capabilities/index.ts`. One condition, like its siblings:
   * every desktop boot can install an app that declares a capability, so the
   * consent/revoke door and the grant reader the `CapabilityHost` calls both
   * need to exist. Off-desktop there is no host and no hardware, so answer there
   * is "every capability `unavailable`" — a claim the SPA makes, not a grant
   * table.
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

  /*
   * The public API's runtime gate, created here rather than beside the public
   * routes because BOTH namespaces need it: `routes/public` reads it on every
   * request, and `routes/public-admin` must be able to invalidate it the moment
   * an operator flips the toggle — otherwise the control appears not to work
   * for a cache TTL and invites a second click.
   */
  /*
   * The key resolver, for the same reason. `routes/public` resolves every
   * request through it; `routes/public-admin` must empty it on revoke, rotate
   * and scope edit. It used to be built inside the public plugin, where the
   * admin routes' `invalidateResolver` could not reach it, so a revoked key
   * kept working for up to the cache TTL.
   */
  const publicViews = createPublicViews(meta);
  const publicResolver = createPublicResolver(meta, publicViews);
  // Saving endpoints and making keys: one service for the API keys page and
  // the app installer, so both check against the same views.
  const endpointService = createEndpointService({
    meta,
    viewFor: publicViews.viewFor,
    tenantConfigOf: async (connectionId) => (await connectionTenantConfig(meta, connectionId)) ?? undefined,
    invalidate: (keyId) => {
      publicResolver.invalidate(keyId);
    },
  });
  /*
   * What `/api-docs` lists. Memoized for ≤ 30 s and emptied by the
   * same events that empty the key cache, since both answer "what may a key
   * call?".
   */
  const apiCatalogue = createApiCatalogue(metaCatalogueSource(meta, (id) => publicViews.viewFor(id)), {
    onError: (connectionId, error) => {
      app.log.warn({ err: error, connectionId }, 'api-docs: a connection was left out; its schema could not be read');
    },
  });
  // Another process's revoke or endpoint save reaches this one's key cache on
  // the gate's next refresh.
  const publicRevision = publicApiStateRepo(meta);
  const watchPublicRevision = createRevisionWatch(
    () => publicRevision.read(),
    () => {
      publicResolver.invalidate();
      apiCatalogue.invalidate();
    },
  );
  /*
   * "Requests · 24h". Counted in memory, flushed every minute and on
   * shutdown by adding to the hour's stored bucket.
   */
  const publicStatsRepo = publicRequestStatsRepo(meta);
  const publicStats = createRequestStats({
    add: (count) => publicStatsRepo.add(count),
    onError: (error) => {
      app.log.warn({ err: error }, 'public API request counts could not be written; this minute is dropped');
    },
  });
  const publicGate = createPublicApiGate({
    read: async () => {
      await watchPublicRevision();
      return (await settingsRepo(meta).get('publicApi.enabled')) === true;
    },
  });
  /*
   * The documentation page's own switch, through the same
   * fail-closed, short-TTL gate: the catalogue answers strangers too.
   */
  const docsGate = createPublicApiGate({
    read: async () => (await settingsRepo(meta).get('publicApi.docsEnabled')) === true,
  });

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
      // The rest of `/setup` is registered in `buildServer` (routes/setup/index.ts);
      // these two need the composed env and the relocation host, which only exist
      // here. They gate on the same once-only setup window — see routes/setup/store.ts.
      await api.register(
        setupStoreRoutes({
          service: createSetupService({ meta, hashPassword }),
          env,
          ...(opts.onMetaRelocated === undefined ? {} : { onMetaRelocated: opts.onMetaRelocated }),
        }),
      );
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
      await api.register(
        connectionsRoutes({
          manager,
          meta,
          // Every key's compiled scope carries the connection's zone and currency.
          onTenantChanged: () => {
            publicResolver.invalidate();
            apiCatalogue.invalidate();
          },
        }),
      );
      await api.register(schemaRoutes({ manager, meta }));
      // The answers a column accepts, named once. Registered
      // beside the schema routes because a list and the rule that names it are
      // edited with the same grant.
      await api.register(optionListsRoutes({ meta }));
      await api.register(
        schemaDdlRoutes({ manager, meta, crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET) }),
      );
      await api.register(dataRoutes({ manager, meta, undoStore, files: fileReconciler, writes: recordWrites }));
      // M7 data-io + reports/notifications (T5/T6): exports and imports share
      // the jobs pipeline wired above; scheduled reports ride the same registry
      // via the poll schedule below.
      const enqueueDataIo = (input: EnqueueJobInput) => jobs.enqueue(input);
      await api.register(exportsRoutes({ meta, manager, storage, enqueue: enqueueDataIo }));
      await api.register(importsRoutes({ meta, manager, storage, enqueue: enqueueDataIo }));
      await api.register(notificationsRoutes({ meta, hub: jobs.hub }));
      await api.register(scheduledReportsRoutes({ meta }));
      // `onRulesChanged` is what keeps the matcher's in-memory index honest:
      // a rule saved through this route is matched by the next write.
      await api.register(
        automationsRoutes({
          meta,
          manager,
          secret: env.ADMINIUM_SECRET,
          enqueue: (input: EnqueueJobInput) => jobs.enqueue(input),
          onRulesChanged: () => automations.matcher.onRulesChanged(),
          runner: { storage, hub: jobs.hub, writes: recordWrites },
        }),
      );
      await api.register(automationRunsRoutes({ meta }));
      await api.register(
        emailTemplatesRoutes({ meta, storage, cancelRunningJob: (jobId) => jobs.worker.requestCancel(jobId) }),
      );
      // The authored `/invoices` surface — the same deps shape as the
      // email documents; rendering is a later wave's.
      await api.register(invoicesRoutes({ meta }));
      // The authored `/report-builder` surface — the same deps shape as the
      // invoice documents. NOT scheduled reports.
      await api.register(reportDocumentsRoutes({ meta }));
      await api.register(generateRoutes({ manager, meta }));
      await api.register(schemaImportRoutes());
      // The block cache is derived from page config, so a page write must drop
      // it — otherwise a column configured as a file column is invisible to the
      // next upload for up to 30 seconds.
      await api.register(pagesRoutes({ meta, onPageChanged: () => { columnBlocks.clear(); } }));
      if (project !== null) {
        await api.register(
          projectRoutes({
            project,
            ...(projectCode === null || projectActions === null || projectClient === null
              ? {}
              : {
                  code: {
                    runtime: projectCode,
                    actions: projectActions,
                    client: projectClient,
                    pageProblems: () => pageProblems,
                  },
                }),
          }),
        );
      }
      // ⌘K global search: pages by title + records via the crud quick-search
      // path, RBAC/PII-filtered like the data routes.
      await api.register(searchRoutes({ manager, meta }));
      await api.register(widgetDataRoutes({ manager, meta, cache: widgetDataCache }));
      await api.register(
        // `emailKey` is passed explicitly rather than letting the route derive it
        // from `process.env`: the composition root already holds the parsed env,
        // and a route reading process.env directly is invisible to the desktop and
        // CLI wrappers that build their own Env.
        settingsRoutes({ meta, emailKey: emailSecretKey(env.ADMINIUM_SECRET) }),
      );
      // Branding rides with settings but owns the bytes half (logo storage)
      // and the two PUBLIC reads the sign-in screen paints itself with.
      await api.register(brandingRoutes({ meta, storage }));
      // Files (37 Appendix C). The upload route asks `columnBlocks` for the
      // named column's `file` block — its allowlist, its cap, its destination
      // and the reference shape to hand back.
      await api.register(
        filesRoutes({
          meta,
          storage,
          storageCrypto,
          columnFileBlock: (input) => columnBlocks.forColumn(input),
          // The sidecar half: `config.attachments` narrows the allowlist, the
          // cap and the destination for an upload that names no column, and
          // enforces the per-record count.
          pageAttachments: (input) => columnBlocks.attachmentsFor(input.connectionId, input.table),
        }),
      );
      /*
       * Documents — the register, its bytes and the mappings.
       *
       * Registered UNCONDITIONALLY, like the add-on routes above and for the
       * same reason: `GET /documents/providers` is what the record page asks
       * to decide whether to draw a Documents panel at all, and a
       * conditionally-registered route would 404 there instead of answering
       * `{installed: false}` — a 404 being indistinguishable from "this build
       * is too old".
       */
      await api.register(
        documentRoutes({
          meta,
          storage,
          runtime: () => addOnRuntime,
          // An app's staff screen draws through the same pipeline as every other door.
          pipeline: documents,
          enqueue: (input) => jobs.enqueue(input as never),
        }),
      );
      // Storage destinations. Its own grant, `storage.manage`, and the
      // resolver instance the store itself uses — so a credential edit
      // invalidates the driver the next upload gets.
      await api.register(
        storageRoutes({
          meta,
          storageCrypto,
          destinations: destinationResolver,
          enqueue: (input) => jobs.enqueue(input),
        }),
      );
      await api.register(i18nRoutes({ meta }));
      await api.register(viewsRoutes({ meta }));
      await api.register(meViewsRoutes({ meta }));
      await api.register(onboardingRoutes({ meta }));
      // Managing the public surface. Always registered, even when the public
      // namespace itself is not: an operator must be able to author a
      // scope and see WHY the surface is off, and the page reports level 1 as a
      // read-only fact rather than a toggle that would silently do nothing.
      await api.register(
        publicAdminRoutes({
          meta,
          env,
          crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET),
          invalidateGate: () => {
            publicGate.invalidate();
          },
          invalidateDocsGate: () => {
            docsGate.invalidate();
          },
          invalidateResolver: (keyId) => {
            publicResolver.invalidate(keyId);
          },
          onChange: () => {
            apiCatalogue.invalidate();
          },
          // The same schema cache the public routes read, so an endpoint is
          // checked against exactly what a request will run against.
          views: publicViews,
          service: endpointService,
        }),
      );
      // Hosted app surfaces: placement + domain attachment. Registered
      // whenever a meta store exists — with no surfaces
      // discovered the list is empty and the page says how to add some, which
      // beats a namespace that 404s only on some instances.
      // The public API catalogue behind `/api-docs`. No key, no
      // session; 404 unless `publicApi.docsEnabled`.
      await api.register(
        apiDocsRoutes({
          meta,
          catalogue: apiCatalogue,
          docsEnabled: () => docsGate.isEnabled(),
          apiEnabled: () => publicGate.isEnabled(),
          registered: env.ADMINIUM_PUBLIC_API_ORIGINS !== undefined,
          surfaceForHost: (request) => app.surfaceForHost(request),
        }),
      );
      await api.register(surfacesAdminRoutes({ meta }));
      // Installing an app. Registered on the same
      // terms as the surfaces admin above: with nothing installed the list is
      // empty, which is a different thing from a namespace that 404s.
      /*
       * The add-on installer, built once: the add-on routes install with it,
       * and so does an app install for the add-ons the app needs — one body,
       * one schema target, one catalogue client.
       */
      const addOnInstaller = {
        meta,
        store: addOnStore,
        credentialCrypto: addOnCredentialCryptoFromSecret(env.ADMINIUM_SECRET),
        // Where an add-on's tables are planned against and created.
        schemaTarget: createAddOnSchemaTarget({
          meta,
          manager,
          credentialCrypto: addOnCredentialCryptoFromSecret(env.ADMINIUM_SECRET),
        }),
        rebuildRuntime: () => rebuildAddOnRuntime(),
      };
      // The same client the acquisition jobs use, so the routes' gate check
      // and the jobs' cannot disagree about whether browsing is on.
      const addOnCatalog = createCatalogClient({
        meta,
        networkFeatures: env.ADMINIUM_NETWORK_FEATURES,
      });
      await api.register(
        appRoutes({
          meta,
          store: appStore,
          installed: installedApps,
          credentialCrypto: addOnCredentialCryptoFromSecret(env.ADMINIUM_SECRET),
          // An install may not shadow a surface the operator deployed by hand:
          // those own registered routes the installed-app hook yields to, so it
          // would appear to succeed and then serve nothing.
          directoryKeys: () => (opts.surfaces ?? []).map((surface) => surface.appKey),
          // Where an installed app's tables are planned and created.
          // The same shared core the add-on target runs, given the connection
          // the operator picked instead of one inferred from a host.
          schemaTarget: createAppSchemaTarget({ meta, manager, crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET) }),
          catalog: appCatalog,
          addOns: { installer: addOnInstaller, catalog: addOnCatalog, bundledDir: resolve(BUNDLED_ADD_ONS_DIR) },
          // Which add-ons are loaded now: an app's documents are on only while theirs is.
          addOnRuntime: () => addOnRuntime,
          sampleData: sampleDataDeps,
          // What an app's guests may call: endpoints and a browser key made
          // through the same service the API keys page saves with.
          publicAccess: {
            service: endpointService,
            viewFor: publicViews.viewFor,
            crypto: dsnCryptoFromSecret(env.ADMINIUM_SECRET),
            origins: env.ADMINIUM_PUBLIC_API_ORIGINS ?? [],
            onChange: () => {
              apiCatalogue.invalidate();
            },
            invalidateKey: (keyId) => {
              publicResolver.invalidate(keyId);
            },
          },
        }),
      );
      // The add-on runtime. Registered unconditionally: an instance with no
      // add-ons serves an empty list, which is what a host in connected
      // mode expects to read — a conditionally-registered route would 404 there
      // instead, and a 404 is indistinguishable from "this build is too old".
      await api.register(
        addOnRoutes({
          meta,
          store: addOnStore,
          // Without this a provider installed at 10am is unreachable until the
          // process restarts, round trip cannot pass.
          rebuildRuntime: () => rebuildAddOnRuntime(),
          /*
           * Uninstall's 34 half, run BEFORE the manifest row goes: disable the
           * add-on's document mappings so no write can enqueue a render for a
           * provider that is already gone, and drop its own settings — which
           * is the one place "uninstall keeps data" bends, because an add-on's
           * configuration is part of the add-on, not the customer's data.
           */
          onAddOnRemoved: async (key) => {
            await documentProfilesRepo(meta).setEnabledForAddOn(key, false);
            // …and through to the RULES those mappings own (D55). Disabling
            // the mapping alone would leave a rule that still fires on every
            // write and skips every time — a run row per write, in Workflow
            // Logs, for an add-on that is gone.
            await syncTriggersForAddOn(meta, key, false);
            await addOnSettingsRepo(meta).clear(key);
          },
          credentialCrypto: addOnCredentialCryptoFromSecret(env.ADMINIUM_SECRET),
          schemaTarget: addOnInstaller.schemaTarget,
          catalog: addOnCatalog,
        }),
      );
      await api.register(rolesRoutes);
      await api.register(usersRoutes);
      await api.register(permissionsRoutes);
      await api.register(apiKeysRoutes);
      await api.register(auditRoutes);
      if (llm !== null) {
        await api.register(
          assistantRoutes({
            meta,
            manager,
            networkFeatures: env.ADMINIUM_NETWORK_FEATURES,
            secret: env.ADMINIUM_SECRET,
            cancelJob: (jobId) => {
              jobs.worker.requestCancel(jobId);
            },
          }),
        );
      }
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

  /*
   * The public namespace.
   *
   * A SIBLING of the block above, not a child. Three reasons, all of which bite
   * if it moves inside:
   *  - it needs a different CORS posture (uncredentialed, its own origin list),
   *    and the `/api/v1` block inherits the credentialed admin one;
   *  - it needs its own limiter, keyed on things `principalKey` cannot see (D9);
   *  - its prefix is what the off switch and the isolation test both key on.
   * It still starts `/api/`, which is what the boot-time schema contract keys
   * on, so every route here is schema-checked like any other.
   *
   * `publicApiRegistrationBlocked` is the level-1 + D21 gate. When it refuses,
   * NOTHING is registered — no door to probe — and the reason is logged once at
   * boot, because an operator who set the env var and got nothing needs to be
   * told why rather than left to guess.
   */
  const publicBlocked = publicApiRegistrationBlocked(env);
  if (publicBlocked === null) {
    await app.register(
      async (api) => {
        await api.register(publicRoutes({
        env,
        meta,
        manager,
        isEnabled: publicGate.isEnabled,
        resolver: publicResolver,
        views: publicViews,
        stats: publicStats,
        // The door. The SAME pipeline the queued job and the automation step
        // use, so "one profile draws one document however it was asked for"
        // survives a third entry point.
        documents,
        storage,
        writes: recordWrites,
      }));
      },
      { prefix: API_PREFIX },
    );
    app.log.info(
      { origins: env.ADMINIUM_PUBLIC_API_ORIGINS },
      'public API namespace registered (still gated by the publicApi.enabled setting)',
    );
  } else if (env.ADMINIUM_PUBLIC_API_ORIGINS !== undefined) {
    // Only warn when the operator ASKED for it. An instance that never set the
    // variable is not misconfigured and should not be told it is.
    app.log.warn({ reason: publicBlocked }, 'public API not registered');
  }

  // Add-on acquisition. The two job kinds are registered unconditionally;
  // NEITHER of them can reach the network
  // on its own, because the catalog client's gate (`ADMINIUM_NETWORK_FEATURES`
  // AND the default-off `addOns.catalogEnabled` setting) is checked before any
  // URL is constructed — the same shape as telemetry below, and pinned by
  // `add-on-network-isolation.test.ts`. Registering the schedule is not consent.
  registerAddOnAcquireHandlers(jobs.registry, {
    meta,
    store: addOnStore,
    catalog: createCatalogClient({
      meta,
      networkFeatures: env.ADMINIUM_NETWORK_FEATURES,
    }),
  });
  jobs.scheduler.registerSchedule(
    CATALOG_REFRESH_SCHEDULE_NAME,
    CATALOG_REFRESH_CRON,
    async () => enqueueCatalogRefresh(meta),
    { jitterMs: CATALOG_REFRESH_JITTER_MS },
  );

  // App acquisition (b G8-D3/D5): the add-on jobs' twins, behind the app
  // catalog's own switch and cached in the app store.
  registerAppAcquireHandlers(jobs.registry, { meta, store: appStore, catalog: appCatalog });
  // An app's sample data is added by a job (its rows and images in one go).
  registerSampleDataHandler(jobs.registry, sampleDataDeps);
  jobs.scheduler.registerSchedule(
    APP_CATALOG_REFRESH_SCHEDULE_NAME,
    APP_CATALOG_REFRESH_CRON,
    async () => enqueueAppCatalogRefresh(meta),
    { jitterMs: CATALOG_REFRESH_JITTER_MS },
  );

  /**
   * The add-on runtime — the point at which installed
   * add-on code enters this process.
   *
   * O1 was ratified in-process on 2026-08-29 on the plan's recorded
   * recommendation, so this loads server halves from the installed bundle on
   * local disk and nowhere else, after re-checking each file against the hash
   * recorded when it was unpacked (D4).
   *
   * Best-effort and AFTER everything else is composed: an add-on whose bundle is
   * corrupt must cost its own integration and nothing more. A boot that died
   * here would take an entire instance down for one broken third-party module,
   * which is the opposite of the trade this design is making.
   */
  /*
   * ONE function, called at boot AND from the add-on routes. It was an IIFE
   * that ran once; making it a named function is what lets install, upgrade,
   * enable/disable and uninstall rebuild without a restart — the behaviour
   * `runtime.ts` has claimed since wave 26 and that round trip has been
   * unable to demonstrate.
   */
  rebuildAddOnRuntime = async () => {
    const repo = manifestsRepo(meta, addOnCredentialCryptoFromSecret(env.ADMINIUM_SECRET));
    const installedAddOns = await repo.list('add-on');
    if (installedAddOns.length === 0) {
      // An empty runtime is a REBUILD RESULT, not an absence: uninstalling the
      // last add-on must clear the provider map, and leaving the old state
      // here would keep a removed provider reachable.
      addOnRuntime = null;
      return;
    }

    const parsed = installedAddOns.flatMap((entry) => {
      const result = validateManifest(entry.document);
      if (!result.ok || !isAddOnManifest(result.manifest)) {
        app.log.warn({ key: entry.row.manifestKey }, 'installed add-on manifest no longer validates');
        return [];
      }
      return [{ row: entry.row, manifest: result.manifest }];
    });

    const runtime = await buildAddOnRuntime({
      store: addOnStore,
      installed: parsed.map((p) => ({ manifest: p.manifest, version: p.row.version })),
      log: (message, data) => app.log.warn(data, message),
    });
    // Published where the document pipeline and `GET /documents/kinds` read it.
    addOnRuntime = runtime;
    for (const problem of runtime.problems) {
      app.log.error({ key: problem.addOnKey, reason: problem.reason }, problem.message);
    }
    for (const conflict of runtime.conflicts) {
      // Never silent: an operator looking at a slot filled by an add-on they
      // did not expect has to be able to find out why.
      app.log.warn(conflict, 'add-on slot conflict — the lower `order` wins');
    }

    // Event handlers become job kinds on the SHARED registry, so add-on work
    // gets the worker's retries, cancellation and `jobs:<jobId>` progress.
    const events = [];
    for (const { row, manifest } of parsed) {
      for (const declared of manifest.addOn.events ?? []) {
        let module: unknown;
        try {
          module = await importServerHalf(
            addOnStore,
            manifest.key,
            row.version,
            declared.server,
          );
        } catch (err) {
          app.log.error({ key: manifest.key, event: declared.on, err }, 'add-on event half failed to load');
          continue;
        }
        events.push({
          addOnKey: manifest.key,
          event: declared.on,
          module,
          // Built from the MANIFEST, so no caller can widen the allow-list.
          http: addOnHttpClientFor(meta, manifest),
          credential: async () => (await repo.getCredential(row.id))?.secret ?? null,
        });
      }
    }
    const registered = registerAddOnEventHandlers(jobs.registry, events);
    for (const refusal of registered.refused) {
      app.log.error(refusal, 'add-on event module does not export handle()');
    }
    if (registered.registered.length > 0) {
      app.log.info({ kinds: registered.registered }, 'registered add-on event handlers');
    }
  };

  /*
   * Best-effort and AFTER everything else is composed: an add-on whose bundle
   * is corrupt must cost its own integration and nothing more. A boot that
   * died here would take an entire instance down for one broken third-party
   * module, which is the opposite of the trade this design is making.
   *
   * AND AFTER THE BUNDLED SEED. On an empty data directory — every redeploy on
   * a host with no persistent disk — the seed is what puts a bundled add-on's
   * files back, and a runtime built before it finishes finds no pin, records
   * `IMPORT_FAILED`, and is not built again until something unrelated
   * rebuilds it. 0.2.9 lost that race by 60–90 ms on each of the three such
   * boots measured. The seed settles either way (it catches its own failures),
   * so this always runs.
   */
  /*
   * PUT BACK WHAT THE DEPLOY TOOK, THEN KEEP A COPY OF WHAT IS LEFT.
   *
   * After the bundled seeds, because a package the image carries is already
   * back by now and restoring over it would be work for nothing. BEFORE the
   * runtime build and the missing report below, because both read the store:
   * 0.2.9 built the runtime 60-90 ms ahead of the seed and an add-on restored
   * afterwards stayed dark until an unrelated toggle, which is the same race
   * one step further along.
   *
   * The keep pass runs on every boot and skips any row that already names a
   * copy, so an instance that predates 0037 becomes protected without anyone
   * reinstalling anything, and a later boot costs one `versions()` call per
   * install.
   */
  const packagesReady = Promise.all([appSeed, addOnSeed])
    .then(async () => {
      const repo = manifestsRepo(meta, addOnCredentialCryptoFromSecret(env.ADMINIUM_SECRET));
      const storeFor = (kind: string): AddOnStore | null =>
        kind === 'app' ? appStore : kind === 'add-on' ? addOnStore : null;
      const copies = createPackageCopies({
        files: storage,
        filesRepo: filesRepo(meta),
        manifests: repo,
        storeFor,
        log: (level, message, data) => {
          app.log[level](data ?? {}, message);
        },
      });

      let restoredApp = false;
      for (const kind of ['add-on', 'app'] as const) {
        for (const installed of await repo.list(kind)) {
          const store = storeFor(kind);
          if (store === null) continue;
          const here = await packageIsInStore(store, {
            key: installed.row.manifestKey,
            version: installed.row.version,
          });
          if (here) {
            await copies.keep(installed);
            continue;
          }
          // Missing. A restore that fails is not fatal and not silent: the
          // report below still names the package, and the operator still sees
          // it as Missing in Studio.
          if (await copies.restore(installed) && kind === 'app') restoredApp = true;
        }
      }

      if (restoredApp) {
        // Same reason the bundled app seed refreshes: the registry was read
        // before these files existed, and an app nothing has re-read is an app
        // nothing serves.
        try {
          await installedApps.refresh();
        } catch (error) {
          app.log.warn({ err: error }, 'could not read installed apps after a restore');
        }
      }
    })
    .catch((err: unknown) => {
      // Never fatal: a boot that cannot reach its storage destination is still
      // a boot, and every package it could not bring back reads as Missing.
      app.log.warn({ err }, 'could not restore installed packages from their copies');
    });

  void packagesReady
    .then(() => rebuildAddOnRuntime())
    .catch((err: unknown) => {
      app.log.error({ err }, 'the add-on runtime could not be built');
    });

  /*
   * NAME WHAT DID NOT COME BACK. The meta store remembers every install; the
   * data directory holds its files. After a deploy that emptied the directory,
   * the seeds restore only the exact versions this build bundles, and
   * everything else — an uploaded add-on, a version the build does not carry,
   * any app it does not carry — is gone while Studio still lists it as
   * installed. The log is the one place an operator on such a host looks, so it
   * says which, and what to do.
   */
  void packagesReady
    .then(async () => {
      const repo = manifestsRepo(meta, addOnCredentialCryptoFromSecret(env.ADMINIUM_SECRET));
      const refs = (rows: readonly InstalledManifest[]) =>
        rows.map(({ row }) => ({ key: row.manifestKey, version: row.version }));
      const dataDir = env.ADMINIUM_DATA_DIR;
      for (const { key, version } of await installedNotInStore(
        addOnStore,
        refs(await repo.list('add-on')),
      )) {
        app.log.error(
          { key, version, dataDir },
          'installed add-on is not on this server (its files in the data directory are gone), so none of ' +
            'it loads — upload the same package again, or uninstall it',
        );
      }
      for (const { key, version } of await installedNotInStore(appStore, refs(await repo.list('app')))) {
        app.log.error(
          { key, version, dataDir },
          'installed app is not on this server (its files in the data directory are gone), so it is not ' +
            'served — upload or download the same version and install it again, or uninstall it',
        );
      }
    })
    .catch((err: unknown) => {
      app.log.warn({ err }, 'could not check installed add-ons and apps against the data directory');
    });

  // Telemetry. OPT-IN: `report()` reads `telemetry.enabled` FIRST and returns
  // before building a payload, so an instance that has not consented
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

  // Export retention: daily `ready` → `expired` sweep past
  // `expires_at`, then byte GC — expired snapshots (potentially
  // unmasked PII)
  // must not persist on disk past the promised retention window. `remove` is
  // idempotent and the worklist re-derives from rows, so a crash mid-pass
  // self-heals on the next tick.
  jobs.scheduler.registerSchedule(EXPORTS_RETENTION_SCHEDULE_NAME, EXPORTS_RETENTION_CRON, async () => {
    const repo = exportsRepo(meta);
    await repo.expireDue();
    const files = filesRepo(meta);
    for (const artifact of await repo.listExpiredArtifacts()) {
      await files.markDeleted(artifact.fileId);
      // Through the FILE's own destination, not the current default: an
      // artifact written before a destination was configured still lives on
      // this server's disk, and removing it from the new bucket would remove
      // nothing while leaving the real bytes behind forever.
      const row = await files.findById(artifact.fileId);
      if (row !== null) await storage.remove(row);
    }
  });

  // Files retention — see FILES_RETENTION_SCHEDULE_NAME for the
  // two halves. Counts are logged for the reason the meta GC logs its own: a
  // sweep that runs silently is indistinguishable from a sweep that is not
  // running.
  jobs.scheduler.registerSchedule(FILES_RETENTION_SCHEDULE_NAME, FILES_RETENTION_CRON, async () => {
    const settings = settingsRepo(meta);
    const repo = filesRepo(meta);
    const at = Date.now();

    const unattachedHours = await settings.get('files.unattachedHours');
    let trashed = 0;
    for (;;) {
      const stale = await repo.listUnattachedBefore(at - unattachedHours * HOUR_MS, 100);
      if (stale.length === 0) break;
      for (const file of stale) {
        if (await repo.markDeleted(file.id, at)) trashed += 1;
      }
      if (stale.length < 100) break;
    }

    const trashDays = await settings.get('retention.filesTrashDays');
    let purged = 0;
    let failed = 0;
    for (;;) {
      const due = (await repo.listDeletedBefore(at - trashDays * DAY_MS, 100)).filter(
        // `upload` (and 34's `document`) only: an export's bytes are the
        // exports sweep's business and its retention is a different setting.
        (file) => file.kind === 'upload',
      );
      if (due.length === 0) break;
      for (const file of due) {
        try {
          // BYTES FIRST, then the row: a row that survives a failed byte
          // deletion is retried on the next tick, where a byte deletion with no
          // row left is unreachable garbage forever.
          await storage.remove(file);
          await repo.purge(file.id);
          purged += 1;
        } catch (error) {
          failed += 1;
          app.log.warn({ err: error, fileId: file.id }, 'could not remove a trashed file’s bytes');
        }
      }
      if (due.length < 100) break;
    }

    if (trashed > 0 || purged > 0 || failed > 0) {
      app.log.info({ trashed, purged, failed }, 'files retention sweep');
    }
  });

  // Meta-store retention (BRIEF). Every deletion is logged with its count:
  // a GC that runs silently is indistinguishable from a GC that is not running,
  // and "why is adminium_audit_log 4 GB" is exactly the question an operator
  // asks six months in, when there is nothing left to read.
  //
  // `retention.exportsDays` is deliberately absent — the exports sweep above
  // owns that lifecycle, including the artifact bytes on disk, which this pass
  // knows nothing about.
  jobs.scheduler.registerSchedule(
    PUBLIC_STATS_FLUSH_NAME,
    '* * * * *',
    async () => {
      await publicStats.flush();
    },
    { jitterMs: 2_000 },
  );
  // The last minute's counts, before the meta store closes.
  app.addHook('onClose', async () => {
    await publicStats.flush();
  });

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

    // `retention.automationRunsDays` has been a registered setting
    // read by nobody since it was added; this is its first reader. Failed runs
    // are kept twice as long and `pending`/`waiting` rows are never
    // swept — they are work that has not happened yet.
    const automationRunsDays = await settings.get('retention.automationRunsDays');
    const automationRuns = await automationRunsRepo(meta).gc(at, automationRunsDays);

    // Assistant sessions: close what a closed browser left open, then delete
    // the closed ones past their window, with their turns. A few lines in this
    // callback rather than a schedule of its own — it is the same nightly
    // tidy-up over the same store, and a second 03:00 job would only mean two
    // places to look.
    const assistantSessions = await sweepAssistantSessions(meta, at);

    // Public-surface sessions past their `expires_at` (28). `purgeExpired` was
    // written with the repo and never called, so the table only grew. Last,
    // and in its own catch, so a failure here cannot skip the steps above.
    let publicSessions: number | null = null;
    try {
      publicSessions = await publicSessionsRepo(meta).purgeExpired(at);
    } catch (error) {
      app.log.warn({ err: error }, 'retention sweep: public session purge failed');
    }
    // Emailed codes and used human checks: a day and more after they were made
    // (the per-person caps read a day back), in its own catch.
    let publicChallenges: number | null = null;
    try {
      publicChallenges = await publicChallengesRepo(meta).purgeBefore(at - 2 * DAY_MS);
      publicChallenges += await publicProofsRepo(meta).purgeExpired(at);
    } catch (error) {
      app.log.warn({ err: error }, 'retention sweep: public code purge failed');
    }
    // Public request counts past `retention.publicRequestStatsDays`,
    // in its own catch for the same reason.
    let publicRequestStats: number | null = null;
    try {
      const days = await settings.get('retention.publicRequestStatsDays');
      publicRequestStats = await publicStatsRepo.purgeBefore(at - days * DAY_MS);
    } catch (error) {
      app.log.warn({ err: error }, 'retention sweep: public request stats purge failed');
    }

    app.log.info(
      {
        sessions,
        passwordResets,
        jobs: finishedJobs,
        auditEntries,
        automationRuns,
        assistantSessions,
        publicSessions,
        publicChallenges,
        publicRequestStats,
        jobsDays,
        auditLogDays,
        automationRunsDays,
      },
      auditArchive
        ? 'retention sweep complete — audit log skipped, retention.auditArchive is on and archiving is not implemented'
        : 'retention sweep complete',
    );
  });

  // The project's hooks and actions load before the server listens, so no
  // write reaches a table ahead of its hooks. A file that fails to load is
  // reported and skipped (`project/code/load.ts`). The pages the build has get
  // their rows now too, and pages whose file is gone lose theirs.
  if (projectCode !== null) {
    await projectCode.load();
    try {
      await applyClientBuild(projectCode.loadClient());
    } catch (error) {
      opts.project?.warn(`Could not add the project's pages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
