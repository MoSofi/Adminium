// SPDX-License-Identifier: AGPL-3.0-only
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
// `auth.allowSignup` is still NOT exposed: nothing reads it (there is no
// self-signup route to gate), so a toggle for it would persist inert config
// and present a dead security control in the UI. It returns when a signup
// path enforces it. The other three `auth.*` keys are exposed below, because
// enforcement for each landed with this surface.

/**
 * `PUT /settings/branding` — the workspace identity fields an admin TYPES
 * (registry `branding.appName` + `branding.showVersion`). The logo is not
 * here: bytes travel over `POST /branding/logo` (routes/branding), and a
 * JSON section-put that silently ignored a file would be the worse contract.
 */
export const settingsBrandingPutBody = z.object({
  appName: z.string().min(1).max(60),
  showVersion: z.boolean(),
});
export type SettingsBrandingPutBody = z.infer<typeof settingsBrandingPutBody>;

/**
 * What the settings screen READS back — the typed fields plus the resolved
 * logo. `logoUrl` is a URL rather than the raw `branding.logoFileId` because
 * no client should have to know how a file id becomes bytes; it carries the
 * id as a query stamp so a replaced logo busts the browser cache.
 */
export const settingsBrandingView = settingsBrandingPutBody.extend({
  logoUrl: z.string().nullable(),
});
export type SettingsBrandingView = z.infer<typeof settingsBrandingView>;

export const settingsWorkspaceReply = z.object({
  data: z.object({
    branding: settingsBrandingView,
  }),
});
export type SettingsWorkspaceReply = z.infer<typeof settingsWorkspaceReply>;

// --- security (auth.*) ----------------------------------------------------------
// Exposed only now, and only these three, because each one is read by a live
// auth path — the rule the `auth.allowSignup` note above still applies:
//   sessionTtlHours   → auth/sessions.ts createSession, on every mint;
//   passwordMinLength → the reset and change handlers, on every password write
//                       (setup/service.ts already enforced it at first run);
//   require2fa        → login/session flag an account with no TOTP into the
//                       enroll flow, and 2fa/disable refuses while it is on.
// Bounds mirror the registry defs, same as the branding section.

/** `PUT /settings/security` — the enforced `auth.*` policy (full write). */
export const settingsSecurityPutBody = z.object({
  sessionTtlHours: z.number().int().min(1).max(8760),
  require2fa: z.boolean(),
  passwordMinLength: z.number().int().min(8).max(128),
});
export type SettingsSecurityPutBody = z.infer<typeof settingsSecurityPutBody>;

export const settingsSecurityReply = z.object({ data: settingsSecurityPutBody });
export type SettingsSecurityReply = z.infer<typeof settingsSecurityReply>;

// --- telemetry + update check (M10-T04, 08 §2.16 `settingsTelemetryPutBody`) ----
// Both are OFF by default in the registry and are first asked on the first-run
// consent screen; this section is how they are revisited later. Exposed under
// the same rule as every other section here — both are enforced today:
// `telemetry.enabled` gates ../../telemetry/service.ts and
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
