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
  description: string;
}

function def<T>(schema: z.ZodType<T>, dflt: T, description: string, secret?: boolean): SettingDef<T> {
  return secret === undefined ? { schema, default: dflt, description } : { schema, default: dflt, description, secret };
}

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

export const SETTINGS_REGISTRY = {
  'appearance.theme': def<z.infer<typeof themeSchema>>(themeSchema, 'system', 'Default UI theme'),
  'appearance.accent': def<z.infer<typeof accentSchema>>(accentSchema, 'indigo', 'Default accent color'),
  'appearance.density': def<z.infer<typeof densitySchema>>(densitySchema, 'comfortable', 'Default layout density'),
  'locale.default': def<z.infer<typeof localeSchema>>(localeSchema, 'en_US', 'Default locale'),
  'branding.appName': def(z.string().min(1).max(60), 'Adminium', 'Application display name'),
  'branding.logoFileId': def<string | null>(z.string().nullable(), null, 'Logo file id'),
  'branding.faviconFileId': def<string | null>(z.string().nullable(), null, 'Favicon file id'),
  'auth.sessionTtlHours': def(z.number().int().min(1).max(8760), 720, 'Session lifetime in hours'),
  'auth.require2fa': def(z.boolean(), false, 'Require TOTP for all users'),
  'auth.allowSignup': def(z.boolean(), false, 'Allow self-signup (default invite-only)'),
  'auth.passwordMinLength': def(z.number().int().min(8).max(128), 10, 'Minimum password length'),
  'email.smtp': def<z.infer<typeof smtpSchema>>(smtpSchema, null, 'SMTP transport; email features degrade gracefully when unset', true),
  'llm.provider': def<z.infer<typeof llmProviderSchema>>(llmProviderSchema, null, 'LLM provider (06-llm-assist.md §3.1)'),
  'llm.apiKey': def<string | null>(z.string().nullable(), null, 'LLM provider API key', true),
  'llm.model': def<string | null>(z.string().nullable(), null, 'LLM model override (null = provider default)'),
  'llm.baseUrl': def<string | null>(z.string().nullable(), null, 'Base URL for openai-compatible / ollama'),
  'llm.maxOutputTokens': def<number | null>(z.number().int().positive().nullable(), null, 'Max output tokens (null = provider default)'),
  'retention.auditLogDays': def(z.number().int().min(30).max(3650), 365, 'Audit log retention in days'),
  'retention.exportsDays': def(z.number().int().min(1).max(365), 30, 'Export artifact retention in days'),
  'retention.webhookDeliveriesDays': def(z.number().int().min(1), 30, 'Webhook delivery log retention in days'),
  'retention.automationRunsDays': def(z.number().int().min(1), 90, 'Automation run retention in days'),
  'retention.notificationsDays': def(z.number().int().min(1), 90, 'Read-notification retention in days'),
  'retention.llmRunsDays': def(z.number().int().min(1), 90, 'Unapplied LLM run retention in days'),
  'retention.jobsDays': def(z.number().int().min(1), 30, 'Finished job retention in days'),
  'retention.auditArchive': def(z.boolean(), false, 'Archive audit batches to adminium_files before deleting'),
  'telemetry.enabled': def(z.boolean(), false, 'Anonymous telemetry (opt-in)'),
  'system.instanceId': def<string | null>(z.string().nullable(), null, 'Stable instance identity (seeded at bootstrap)'),
  'system.bootstrappedAt': def<number | null>(z.number().nullable(), null, 'First-run timestamp (epoch ms)'),
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
