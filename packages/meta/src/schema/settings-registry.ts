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
  'branding.appName': def(z.string().min(1).max(60), 'Adminium', 'Application display name', P),
  'branding.logoFileId': def<string | null>(z.string().nullable(), null, 'Logo file id', P),
  'branding.faviconFileId': def<string | null>(z.string().nullable(), null, 'Favicon file id', P),
  'auth.sessionTtlHours': def(z.number().int().min(1).max(8760), 720, 'Session lifetime in hours', P),
  'auth.require2fa': def(z.boolean(), false, 'Require TOTP for all users', P),
  'auth.allowSignup': def(z.boolean(), false, 'Allow self-signup (default invite-only)', P),
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
