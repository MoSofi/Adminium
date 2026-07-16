/**
 * Zod schemas for the global-defaults settings resource
 * (10-i18n-theming.md §7.2, 08-server-api.md): the four preference axes with
 * the same enums the meta json-payloads use, plus per-axis adoption counts
 * (`following` = users whose override is NULL for that axis).
 */
import { z } from 'zod';
import { accentSchema, densitySchema, localeSchema, themeSchema } from '@adminium/meta';

/** PUT body — a full-object write (§7.2), never a partial patch. */
export const settingsDefaultsPutBody = z.object({
  theme: themeSchema,
  accent: accentSchema,
  density: densitySchema,
  locale: localeSchema,
});
export type SettingsDefaultsPutBody = z.infer<typeof settingsDefaultsPutBody>;

const adoptionView = z.object({
  totalUsers: z.number().int().min(0),
  following: z.object({
    theme: z.number().int().min(0),
    accent: z.number().int().min(0),
    density: z.number().int().min(0),
    locale: z.number().int().min(0),
  }),
});

export const settingsDefaultsReply = z.object({
  data: z.object({
    theme: themeSchema,
    accent: accentSchema,
    density: densitySchema,
    locale: localeSchema,
    adoption: adoptionView,
  }),
});
export type SettingsDefaultsReply = z.infer<typeof settingsDefaultsReply>;

// --- workspace identity (M5-T05, 08 §2.16 sectioned puts) -----------------------
// Bounds mirror the settings-registry Zod defs (07-meta-store.md §7.1) — the
// repo re-validates on write, so these fail fast with a 422 instead of a 500.
//
// The `auth.*` security controls (require2fa / allowSignup / sessionTtlHours /
// passwordMinLength) are intentionally NOT exposed here: no auth flow reads
// them yet, so a PUT surface would persist inert config and present dead
// security toggles in the UI. They return when enforcement lands (the login /
// session / password paths), so admins are never shown a control that does
// nothing.

/** `PUT /settings/branding` — workspace identity (registry `branding.*`). */
export const settingsBrandingPutBody = z.object({
  appName: z.string().min(1).max(60),
});
export type SettingsBrandingPutBody = z.infer<typeof settingsBrandingPutBody>;

export const settingsWorkspaceReply = z.object({
  data: z.object({
    branding: settingsBrandingPutBody,
  }),
});
export type SettingsWorkspaceReply = z.infer<typeof settingsWorkspaceReply>;

// --- telemetry + update check (M10-T04, 08 §2.16 `settingsTelemetryPutBody`) ----
// Both are OFF by default in the registry and are first asked on the first-run
// consent screen; this section is how they are revisited later. Unlike the
// `auth.*` controls above, these two ARE exposed because both are enforced
// today: `telemetry.enabled` gates ../../telemetry/service.ts and
// `updates.checkEnabled` gates ../../telemetry/update-check.ts, each of which
// returns before touching the network when its key is false.

/** `PUT /settings/telemetry` — the two outbound-call consents (full write). */
export const settingsTelemetryPutBody = z.object({
  telemetry: z.boolean(),
  updateCheck: z.boolean(),
});
export type SettingsTelemetryPutBody = z.infer<typeof settingsTelemetryPutBody>;

export const settingsTelemetryReply = z.object({
  data: z.object({
    telemetry: z.boolean(),
    updateCheck: z.boolean(),
  }),
});
export type SettingsTelemetryReply = z.infer<typeof settingsTelemetryReply>;
