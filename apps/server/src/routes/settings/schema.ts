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

// --- email / SMTP (08 §2.16 sectioned puts) --------------------------------------
// The first settings section whose stored value is a SECRET, so it is also the
// first that cannot be a symmetric read/write pair. Everything else here reads
// back exactly what it accepts; a password must never be readable, so the GET
// answers the only question a form actually needs — is one set? — and the PUT
// takes a plaintext `pass` that `email/config.ts`'s key encrypts before it ever
// reaches a row.
//
// Bounds mirror `smtpSchema` in the settings registry (07-meta-store.md §7.1),
// which re-validates on write, so a bad value fails as a 422 here rather than a
// 500 out of the repo.

/** Longest hostname the DNS wire format can express. */
const SMTP_HOST_MAX = 255;
/** RFC 5321 caps an addressable path at 256 octets; the display-name form is longer. */
const SMTP_FROM_MAX = 320;
const SMTP_USER_MAX = 320;
const SMTP_PASS_MAX = 512;

/**
 * CR and LF are refused everywhere in this section. SMTP is line-oriented, so a
 * newline inside a configured value is not a typo — it is how a second header
 * or a second command gets appended to one Adminium wrote.
 */
const noControlChars = (value: string): boolean => {
  // Written as a scan rather than a regex: a character class of literal control
  // characters is unreadable in source and trips `no-control-regex` for exactly
  // the reason it usually should — this is the rare case where they ARE the
  // subject.
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
};
const CONTROL_CHAR_MESSAGE = 'must not contain line breaks or control characters';

/**
 * `PUT /settings/email` body.
 *
 * WRAPPED IN `smtp` rather than being a bare nullable object, because clearing
 * the configuration has to be expressible: a JSON body of literal `null` is a
 * shape no other route here uses and that reads as "empty body" at every layer
 * between the client and the handler. `{"smtp": null}` says it out loud.
 *
 * `pass` is OPTIONAL AND THAT IS THE FEATURE. Without it, changing the port
 * would force the admin to retype the password — which is exactly how a
 * production SMTP password ends up in someone's notes app so it can be pasted
 * back. Absent ⇒ keep the stored one; empty string ⇒ clear it.
 */
export const settingsEmailPutBody = z.object({
  smtp: z
    .object({
      host: z.string().min(1).max(SMTP_HOST_MAX).refine(noControlChars, CONTROL_CHAR_MESSAGE),
      port: z.number().int().min(1).max(65535),
      /** Empty = an unauthenticated relay (a local postfix / MailHog). */
      user: z.string().max(SMTP_USER_MAX).refine(noControlChars, CONTROL_CHAR_MESSAGE),
      /** Omit to keep the stored password. */
      pass: z.string().max(SMTP_PASS_MAX).refine(noControlChars, CONTROL_CHAR_MESSAGE).optional(),
      /** `addr@example.com` or `Name <addr@example.com>`. */
      from: z
        .string()
        .min(3)
        .max(SMTP_FROM_MAX)
        .refine(noControlChars, CONTROL_CHAR_MESSAGE)
        .refine((value) => value.includes('@'), 'must be an email address'),
      /** true = implicit TLS (465); false = STARTTLS on a cleartext port (587). */
      secure: z.boolean(),
    })
    .nullable(),
});
export type SettingsEmailPutBody = z.infer<typeof settingsEmailPutBody>;

/**
 * What both verbs return. `configured` is the same question `smtpConfigured` on
 * `/system/info` answers (is `email.smtp` set?) — and the other fields are null
 * in exactly that case, so a form can bind them without inventing placeholder
 * values it would then save back.
 *
 * There is no password field, in any form: not the value, not a masked copy,
 * not a last-4. A last-4 is defensible for an API key a human reads off a
 * provider dashboard (`llm.apiKey` does it); for a password a human CHOSE it is
 * four characters of a secret they may well have reused elsewhere.
 */
export const settingsEmailView = z.object({
  configured: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  user: z.string().nullable(),
  from: z.string().nullable(),
  secure: z.boolean().nullable(),
});
export type SettingsEmailView = z.infer<typeof settingsEmailView>;

export const settingsEmailReply = z.object({ data: settingsEmailView });
export type SettingsEmailReply = z.infer<typeof settingsEmailReply>;
