// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings registry (07-meta-store.md §7.1): every global settings key with
 * its Zod schema, code default, and secret flag. `adminium_settings` stores
 * explicit overrides only — unset keys fall back to these defaults, so new
 * releases can change defaults without data migrations.
 */

import { z } from 'zod';

import { accentSchema, densitySchema, localeSchema, themeSchema } from './json-payloads.js';

export interface SettingDef<T = unknown> {
  schema: z.ZodType<T>;
  default: T;
  /** Sensitive fields stored encrypted; redacted in API reads (write-only from the UI). */
  secret?: boolean;
  /**
   * May this key travel in a config bundle (`adminium export-zip`)?
   *
   * DEFAULT FALSE — the flag is opt-IN, so a key added by a future wave is NOT
   * exportable until someone reads this comment and decides it is. That default
   * is the point. The export used to name the *non*-portable keys instead
   * (`INSTANCE_IDENTITY_SETTINGS`, a deny-list of two), and it rotted inside the
   * same wave that added it: `system.superAdminCreatedAt` — the once-only
   * first-boot CLAIM whose mere presence permanently closes `/setup/*` — was not
   * on it, so a full-instance bundle carried the claim into fresh installs and
   * bricked them (zero users, setup closed forever, no account creatable). See
   * `apps/server/src/export/redaction.ts`, whose own header argues exactly this:
   * a deny-list rots, an allow-list fails closed.
   *
   * The bar for `portable: true` is "this is CONFIGURATION the operator authored
   * and would want on another instance" — not instance identity, not a bootstrap
   * claim, not anything whose meaning is "something already happened here".
   */
  portable?: boolean;
  description: string;
}

interface DefOptions {
  secret?: boolean;
  portable?: boolean;
}

function def<T>(
  schema: z.ZodType<T>,
  dflt: T,
  description: string,
  opts: DefOptions = {},
): SettingDef<T> {
  return {
    schema,
    default: dflt,
    description,
    ...(opts.secret === undefined ? {} : { secret: opts.secret }),
    ...(opts.portable === undefined ? {} : { portable: opts.portable }),
  };
}

/** Shorthand for the common case: operator-authored config that a bundle carries. */
const P: DefOptions = { portable: true };

/**
 * An app-instance slug: the URL segment naming ONE tenant of a hosted app.
 *
 * Lowercase kebab, because it is typed into a URL bar and read back off one.
 * `staff` and `customer` are refused by name — the slug sits in the same
 * position as the SIDE, and a slug called `staff` would make
 * `/apps/clients/staff/` mean two things at once. Refusing them here is the
 * whole reason that ambiguity cannot occur rather than merely being unlikely.
 */
export const surfaceInstanceSlug = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase letters, digits and single hyphens')
  .refine((v) => v !== 'staff' && v !== 'customer', {
    message: '`staff` and `customer` are reserved — they name a side, not an instance',
  });

const smtpSchema = z
  .object({
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    user: z.string(),
    passEncrypted: z.string(),
    from: z.string(),
    secure: z.boolean(),
  })
  .nullable();

const llmProviderSchema = z
  .enum(['anthropic', 'openai', 'openai-compatible', 'ollama', 'adminium-managed'])
  .nullable();

/**
 * One row of the desktop capability grant table (11-electron.md §12).
 *
 * A grant is the record that an installed micro-SaaS manifest was consented to a
 * host capability — `{ manifestId, capabilityId }` is its identity, `grantedAt`
 * its audit trail. The desktop `CapabilityHost` reads these to decide whether a
 * `capabilities.invoke` (§4) may reach a provider; a call with no matching grant
 * is refused with `CAPABILITY_NOT_GRANTED`. The dashboard's consent step writes
 * one and its revoke control removes one.
 *
 * Bounds, not free strings: `capabilityId` is a dotted id from a closed host
 * vocabulary (`printer.escpos`, …) and `manifestId` a reverse-DNS app id, so both
 * are short. This is the meta-store boundary; the route validates `capabilityId`
 * against the known set on top of it.
 */
export const capabilityGrantSchema = z.object({
  manifestId: z.string().min(1).max(200),
  capabilityId: z.string().min(1).max(120),
  grantedAt: z.number().int().nonnegative(),
});
export const capabilityGrantsSchema = z.array(capabilityGrantSchema);

/** One consented desktop capability grant (11-electron.md §12). */
export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>;

export const SETTINGS_REGISTRY = {
  'appearance.theme': def<z.infer<typeof themeSchema>>(themeSchema, 'system', 'Default UI theme', P),
  'appearance.accent': def<z.infer<typeof accentSchema>>(accentSchema, 'indigo', 'Default accent color', P),
  'appearance.density': def<z.infer<typeof densitySchema>>(densitySchema, 'comfortable', 'Default layout density', P),
  'locale.default': def<z.infer<typeof localeSchema>>(localeSchema, 'en_US', 'Default locale', P),
  /**
   * Monotonic stamp over the runtime-translation tables (23 §3.4). Every
   * mutation bumps it inside its own transaction, and clients key their
   * bundle cache / ETag on it.
   *
   * NOT `MAX(updated_at)` over the rows: reset-to-built-in is a hard DELETE,
   * so the most common admin operation is invisible to a max-timestamp — the
   * cache would go stale exactly when an admin undoes a bad edit.
   *
   * NOT portable. This is instance state, not authored configuration: a
   * counter from another install means nothing here, and carrying it would
   * let an imported bundle push a target instance's clients into believing
   * they already hold the newest strings.
   */
  'i18n.version': def(z.number().int().min(0), 0, 'Runtime-translation version stamp'),
  'branding.appName': def(z.string().min(1).max(60), 'Adminium', 'Application display name', P),
  'branding.logoFileId': def<string | null>(z.string().nullable(), null, 'Logo file id', P),
  /**
   * The `v<version>` chip in the sidebar rail. On by default — knowing which
   * build you are looking at is a support handshake — but a white-labelled
   * deployment is entitled to hide the fact that it is Adminium underneath.
   */
  'branding.showVersion': def(z.boolean(), true, 'Show the app version in the sidebar', P),
  'branding.faviconFileId': def<string | null>(z.string().nullable(), null, 'Favicon file id', P),
  'auth.sessionTtlHours': def(z.number().int().min(1).max(8760), 720, 'Session lifetime in hours', P),
  /**
   * ADVISORY, NOT A PERIMETER — the name overpromises, so read this before
   * relying on it. Exactly two things in the product read this flag:
   *
   * 1. `apps/server/src/routes/auth/handlers.ts` — `needsTwoFactorSetup` puts
   *    `twoFactorSetupRequired` on the login reply and on `GET /auth/session`
   *    when the account has no TOTP. That is a SIGNAL for the client to route
   *    into the enroll flow, deliberately not a denial: `/auth/2fa/enroll` and
   *    `/auth/2fa/activate` are themselves `requireAuth`, so refusing the
   *    session would leave the user no door to enroll through.
   * 2. Same file, `disable2faHandler` — `POST /auth/2fa/disable` throws
   *    ForbiddenError while the flag is on, so an account that IS enrolled
   *    cannot opt back out.
   *
   * NOTHING ELSE READS IT. In as many words: no server-side preHandler blocks
   * an un-enrolled principal. A caller that simply ignores the signal — any
   * API client that is not our dashboard — holds a full session and can call
   * every route without ever enrolling. API-key principals are outside the
   * question structurally: `apps/server/src/plugins/auth.ts` resolves an
   * `Authorization: Bearer adm_…` key and returns before a session exists, so
   * no session-conditioned gate could reach them even if one were added. What
   * this flag hardens is enrollment (you cannot leave once in), not access.
   *
   * Marked `P`, so a config bundle carries it: `adminium import-zip` replays
   * settings through `settingsRepo.set` (see the import service under
   * `apps/server/src/export/`), which can land `true` on an instance where
   * nobody has TOTP enrolled. Survivable precisely BECAUSE it is not a
   * perimeter — everyone can still log in — so the recovery is to turn it off
   * at Settings → Security (`PUT /settings/security`, needs `settings.manage`).
   * If no admin UI is reachable, the floor is SQL; there is no
   * `adminium settings` subcommand to do it with:
   *
   *     DELETE FROM adminium_settings WHERE key = 'auth.require2fa';
   *
   * Deleting the row suffices — `packages/meta/src/repos/settings.ts` `get()`
   * returns the registry default when no row exists, and that default is
   * `false`.
   */
  'auth.require2fa': def(z.boolean(), false, 'Require TOTP for all users', P),
  'auth.allowSignup': def(z.boolean(), false, 'Allow self-signup (default invite-only)', P),

  /*
   * The public API's runtime off switch (28-public-surface.md §3.5 level 2).
   *
   * DEFAULT FALSE, and deliberately NOT `portable`. It is an instance-level
   * decision about whether this database is reachable from the internet, and
   * carrying it in a config bundle would turn "I replayed my setup on a new
   * box" into "I published a database I had not scoped yet". That is the same
   * class of mistake as `system.superAdminCreatedAt` travelling in a bundle,
   * which is the incident this file's `portable` comment was written for.
   *
   * Level 1 (`ADMINIUM_PUBLIC_API_ORIGINS`) still gates registration, so this
   * key does nothing on an instance that never opted in — two independent
   * switches, both of which must be on.
   */
  'publicApi.enabled': def(z.boolean(), false, 'Serve the scoped public API at /api/v1/public'),

  /*
   * WHERE a hosted app's surfaces appear (29-app-surfaces.md D9).
   *
   * `surfaces.apps` — per app key, whether the STAFF surface is blended into
   * this dashboard (`internal`, the default whenever a staff surface exists) or
   * left as its own thing (`external`). Hosted is the normal case (28 D25) and
   * "we do not need another surface" is the point of the whole wave, so
   * external is the OPT-OUT, not the default.
   *
   * `connectionId` on the same record is WHICH DATABASE that staff surface
   * reads. A customer surface already answers this: its publishable key names a
   * scope and a scope names a connection, `NOT NULL` since wave 0014. The staff
   * side has no key by design — it reads through the operator's session — and
   * the key was also the thing carrying that identity, so nothing replaced it.
   * The app was left to infer its database from "the only one serving", which
   * is a guess that holds until an instance has two connections and then fails
   * as a schema mismatch against somebody else's tables.
   *
   * Optional, and absent keeps the old inference: a single-connection instance
   * — nearly all of them — needs no answer here, and demanding one would make
   * every existing surface stop booting on upgrade.
   *
   * `instances` serves the SAME app over MORE THAN ONE database — the shape the
   * dashboard's own generated pages have always had, where every page carries a
   * `connectionId` and two connections simply produce two sets. Each entry adds
   * a mount at `/apps/<appKey>/<slug>/<side>/` reading its own connection; the
   * unslugged `/apps/<appKey>/<side>/` stays exactly where it is, reading
   * `connectionId` above, so no existing URL moves.
   *
   * THE SLUG GOES BEFORE THE SIDE, and that is not cosmetic. After it —
   * `/apps/clients/staff/<slug>` — the segment collides with the app's own
   * routes, and `/apps/clients/staff/invoices` becomes a question with two
   * answers. Before it, the only values in that position are `staff`, `customer`
   * and slugs, so refusing those two names as slugs makes the ambiguity
   * impossible rather than merely unlikely.
   *
   * `surfaces.domains` — `host → {appKey, side}`. A request whose `Host`
   * matches serves that surface at `/` instead of the dashboard.
   *
   * NEITHER IS PORTABLE, and a domain map is the clearest case in this file.
   * It names one instance's DNS. Carrying it in a config bundle would point a
   * fresh install at a domain it does not own and take the dashboard away from
   * whoever restored the bundle — the `system.superAdminCreatedAt` lesson in
   * this file's own header, with a worse blast radius.
   *
   * Both are read on a HOT path (Host routing runs per request), so both go
   * through the same short-TTL cache as `publicApi.enabled` rather than a
   * meta-store SELECT per request.
   */
  'surfaces.apps': def<
    Record<
      string,
      {
        staff?: 'internal' | 'external' | undefined;
        connectionId?: string | undefined;
        instances?: { slug: string; connectionId: string }[] | undefined;
      }
    >
  >(
    z.record(
      z.string(),
      z.object({
        staff: z.enum(['internal', 'external']).optional(),
        connectionId: z.string().min(1).optional(),
        instances: z
          .array(
            z.object({
              slug: surfaceInstanceSlug,
              connectionId: z.string().min(1),
            }),
          )
          .max(32)
          .refine(
            (list) => new Set(list.map((i) => i.slug)).size === list.length,
            { message: 'instance slugs must be unique within an app' },
          )
          .optional(),
      }),
    ),
    {},
    'Per-app surface placement, connection binding and extra instances (29 D9)',
  ),
  'surfaces.domains': def<
    Record<string, { appKey: string; side: 'staff' | 'customer'; instance?: string | undefined }>
  >(
    z.record(
      z.string(),
      z.object({
        appKey: z.string().min(1),
        side: z.enum(['staff', 'customer']),
        /*
         * Which INSTANCE this host serves (29 D9). Absent is the app's own
         * mount, which is what every existing mapping means and keeps meaning.
         * A host is the only signal a mapped domain has — the app cannot read
         * the mapping — so the server has to answer with it rather than expect
         * the bundle to work it out.
         */
        instance: surfaceInstanceSlug.optional(),
      }),
    ),
    {},
    'Host → app surface mapping; the operator points DNS and their proxy at this instance',
  ),
  'auth.passwordMinLength': def(z.number().int().min(8).max(128), 10, 'Minimum password length', P),
  'email.smtp': def<z.infer<typeof smtpSchema>>(smtpSchema, null, 'SMTP transport; email features degrade gracefully when unset', { secret: true, portable: true }),
  'llm.provider': def<z.infer<typeof llmProviderSchema>>(llmProviderSchema, null, 'LLM provider (06-llm-assist.md §3.1)', P),
  'llm.apiKey': def<string | null>(z.string().nullable(), null, 'LLM provider API key', { secret: true, portable: true }),
  'llm.model': def<string | null>(z.string().nullable(), null, 'LLM model override (null = provider default)', P),
  'llm.baseUrl': def<string | null>(z.string().nullable(), null, 'Base URL for openai-compatible / ollama', P),
  'llm.maxOutputTokens': def<number | null>(z.number().int().positive().nullable(), null, 'Max output tokens (null = provider default)', P),
  'retention.auditLogDays': def(z.number().int().min(30).max(3650), 365, 'Audit log retention in days', P),
  'retention.exportsDays': def(z.number().int().min(1).max(365), 30, 'Export artifact retention in days', P),
  'retention.webhookDeliveriesDays': def(z.number().int().min(1), 30, 'Webhook delivery log retention in days', P),
  'retention.automationRunsDays': def(z.number().int().min(1), 90, 'Automation run retention in days', P),
  'retention.notificationsDays': def(z.number().int().min(1), 90, 'Read-notification retention in days', P),
  'retention.llmRunsDays': def(z.number().int().min(1), 90, 'Unapplied LLM run retention in days', P),
  'retention.jobsDays': def(z.number().int().min(1), 30, 'Finished job retention in days', P),
  'retention.auditArchive': def(z.boolean(), false, 'Archive audit batches to adminium_files before deleting', P),
  'telemetry.enabled': def(z.boolean(), false, 'Anonymous telemetry (opt-in)', P),
  // Separate from telemetry.enabled and likewise OFF by default: an update
  // check is an outbound call that discloses the instance's IP + version to
  // the vendor, so a self-hosted instance opts into it explicitly rather than
  // inheriting consent from the telemetry answer (M10-T04).
  'updates.checkEnabled': def(z.boolean(), false, 'Check for new releases (opt-in outbound call)', P),
  // The add-on catalog's browse-online switch (32-add-on-distribution.md D8,
  // O1). OFF by default, and for the same reason `updates.checkEnabled` is: an
  // online browse discloses this deployment's IP, the time, and the exact
  // `package@version` it pulls to a third-party registry. The bundled set
  // (D3) makes the Add-ons page useful with the switch off, so default-off
  // costs a fresh install nothing. `ADMINIUM_NETWORK_FEATURES=off` and the
  // desktop's air-gap mode both override it downward; nothing overrides it up.
  'addOns.catalogEnabled': def(z.boolean(), false, 'Browse the online add-on catalog (opt-in outbound call)', P),
  // ── NOT portable ──────────────────────────────────────────────────────────
  // Everything below identifies THIS instance, records that something already
  // happened to it, or answers a question about the MACHINE it runs on. A
  // bundle that carried any of them would fuse two installs into one identity,
  // decide one device's login policy from another's, or — worst, for the claim —
  // hand a fresh install a "setup already done" flag it can never clear. See
  // `SettingDef.portable`.
  /**
   * The desktop shell's §5 "Skip login on this computer" answer, mirrored out of
   * `<userData>/config.json` (11-electron.md §2.3 `singleUser`) at every boot by
   * the composition root. `POST /api/v1/auth/desktop-session` reads THIS — the
   * route refuses while it is false, which is what the "Require login on this
   * device" toggle turns off.
   *
   * NAMING: §5 spells the key `desktop.single_user`. This registry's convention
   * is `<domain>.<camelCase>` for all 30 of its siblings, and the key is a TS
   * literal type here rather than a string in a doc, so it follows the code.
   *
   * DEFAULT FALSE — i.e. "ask for the password" — even though §2.3's `config.json`
   * default is `true` and §6 step 3's checkbox ships ticked. That is not a
   * contradiction, because THIS DEFAULT IS ONLY EVER REACHED WHEN THE MIRROR DID
   * NOT RUN. When the desktop shell passes `ADMINIUM_DESKTOP_SINGLE_USER`, every
   * boot overwrites this row with the user's real answer and the default is dead
   * code; the only world where it decides anything is one where the wrapper
   * failed to tell the server what the user chose.
   *
   * In that world the two candidate defaults fail in opposite directions:
   *
   *   true  ⇒ a user who explicitly turned ON "Require login on this device" is
   *           silently auto-logged-in anyway. The control fails OPEN, against
   *           exactly the threat it exists for (someone else at this keyboard),
   *           and nothing anywhere says so.
   *   false ⇒ auto-login stops working and the user sees the standard login
   *           screen. A visible missing convenience, and their password still
   *           opens the app.
   *
   * A broken promise about a password beats a broken promise about a shortcut, so
   * the unmirrored case fails closed and loudly rather than open and silently.
   *
   * NEVER portable: it is per-DEVICE policy. A bundle that carried it would
   * answer "may this machine skip its login?" using another machine's answer.
   */
  'desktop.singleUser': def(z.boolean(), false, 'Desktop: skip login on this computer (11-electron.md §5)'),
  /**
   * The desktop capability grant table (11-electron.md §12). Written by the
   * consent step on manifest install and cleared by its revoke control; read by
   * the main-process `CapabilityHost` on every `capabilities.invoke` to gate a
   * call against a real, revocable grant.
   *
   * NAMING: §12 spells the `adminium_settings` key `desktop.capability_grants`.
   * This registry's convention is `<domain>.<camelCase>` — the same override
   * `desktop.singleUser` makes over §5's `desktop.single_user`, and for the same
   * reason: the key is a TS literal type here, so it follows the code.
   *
   * NEVER portable: a grant is a per-DEVICE authorization to touch THIS machine's
   * hardware. A bundle that carried it would silently pre-authorize an app to
   * reach a receipt printer on a machine whose owner never consented.
   */
  'desktop.capabilityGrants': def<z.infer<typeof capabilityGrantsSchema>>(
    capabilityGrantsSchema,
    [],
    'Desktop: consented capability grants (11-electron.md §12)',
  ),
  'system.instanceId': def<string | null>(z.string().nullable(), null, 'Stable instance identity (seeded at bootstrap)'),
  'system.bootstrappedAt': def<number | null>(z.number().nullable(), null, 'First-run timestamp (epoch ms)'),
  /**
   * The first-super-admin CLAIM (M10-T04). Its row's PRESENCE — not its value —
   * is the once-only gate: `createFirstSuperAdmin` INSERTs it inside the same
   * transaction that creates the user, so the `key` PRIMARY KEY makes a second
   * (or concurrent) bootstrap attempt fail atomically on every dialect. Never
   * `set()` this key from application code.
   *
   * NEVER portable, for the same reason it is never `set()`: importing it into
   * an instance with zero users closes `/setup/*` (409) forever, so no super
   * admin can be created and nobody can log in. The instance is scrap.
   */
  'system.superAdminCreatedAt': def<number | null>(z.number().nullable(), null, 'First-super-admin bootstrap claim (epoch ms)'),
  /*
   * The first-boot source-connection seed (28-public-surface.md 28-T31), in two
   * keys because the seed has two distinct facts to remember and collapsing
   * them into one produces a dead end.
   *
   * `system.sourceConnectionId` — WHICH row the seed made. Written on the first
   * attempt whether it worked or not, so a retry updates that row instead of
   * inserting a second one every time the container restarts.
   *
   * `system.sourceSeededAt` — that a HEALTHY seed happened. Written only after
   * the DSN probes OK, and it is the once-only gate: set, the seed never runs
   * again, so a connection the operator later deletes STAYS deleted rather than
   * reappearing on the next `docker compose up`.
   *
   * Why not one key. A single claim written on failure too would strand the
   * common mistake — a typo in `ADMINIUM_SOURCE_URL`. `PATCH /connections/:id`
   * takes `name` and `settings` and NOT a DSN (routes/connections/schema.ts),
   * so a stored bad DSN cannot be corrected anywhere in the product; the
   * operator's fix is to correct compose, which the seed must therefore still
   * be listening for. Split, the retry path is "no healthy seed yet" and the
   * once-only path is "there was one" — neither borrows the other's meaning.
   *
   * Neither is portable (the default). Both mean "something already happened
   * here", which is the exact bar the `portable` comment above sets, and
   * `system.superAdminCreatedAt` is the incident it was written for: a bundle
   * carrying `sourceConnectionId` would name a connection row that does not
   * exist in the target, and one carrying `sourceSeededAt` would suppress the
   * new instance's own seed — booting it to an empty dashboard with no
   * indication why.
   */
  'system.sourceConnectionId': def<string | null>(z.string().nullable(), null, 'Connection id the first-boot source seed created (28-T31)'),
  'system.sourceSeededAt': def<number | null>(z.number().nullable(), null, 'First-boot source-connection seed claim, healthy probes only (epoch ms)'),
  /**
   * The bundle FORMAT version of this store. Not portable: the target records
   * its own, and the version a bundle was written at already travels in the
   * manifest (`BundleManifest.configVersion`), which is what replay reads.
   * Copying the source's value would let an old bundle silently downgrade the
   * number a newer target reports about itself.
   */
  'system.configVersion': def(z.number().int().min(1), 1, 'Config bundle format version'),
} as const;

export type SettingsRegistry = typeof SETTINGS_REGISTRY;
export type SettingKey = keyof SettingsRegistry;
export type SettingValue<K extends SettingKey> = SettingsRegistry[K] extends SettingDef<infer T> ? T : never;

export const SETTING_KEYS = Object.keys(SETTINGS_REGISTRY) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, key);
}

export function isSecretSettingKey(key: SettingKey): boolean {
  return SETTINGS_REGISTRY[key].secret === true;
}

/**
 * True when the registry declares `key` safe to carry in a config bundle.
 * Opt-in, so an undeclared (i.e. new) key is never exported — see
 * {@link SettingDef.portable}.
 */
export function isPortableSettingKey(key: SettingKey): boolean {
  return SETTINGS_REGISTRY[key].portable === true;
}
