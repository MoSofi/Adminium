// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the first-run setup resource (M10-T04; naming per
 * 08-server-api.md §1.5: `<resource><Action><Part>` consts, `z.infer`
 * PascalCase types).
 *
 * These are the only UNAUTHENTICATED write-capable schemas in the API — there
 * is no session to authorize against on a fresh install — so the bodies are
 * deliberately narrow and `.strict()`: an unknown key is a rejection, not
 * something silently dropped near super-admin creation.
 */
import { z } from 'zod';

import { authUserView } from '../auth/schema.js';

/**
 * `GET /setup/state` — the only thing a fresh install exposes pre-auth.
 * Carries NOTHING about the instance beyond "is setup still open" and the
 * password policy the wizard mirrors client-side: an internet-reachable
 * un-bootstrapped instance must not leak version, engine, or user counts here.
 */
export const setupStateReply = z.object({
  data: z.object({
    /** True only when zero users exist AND bootstrap has never been claimed. */
    required: z.boolean(),
    passwordMinLength: z.number().int().positive(),
  }),
});
export type SetupStateReply = z.infer<typeof setupStateReply>;

/** The first-run consent answers. Both OFF by default (v0.5 exit criterion). */
export const setupConsentBody = z
  .object({
    telemetry: z.boolean(),
    updateCheck: z.boolean(),
  })
  .strict();
export type SetupConsentBody = z.infer<typeof setupConsentBody>;

export const setupSuperAdminBody = z
  .object({
    email: z.string().trim().min(3).max(320).email('must be a valid email address'),
    /** Upper bound only — the real floor is `auth.passwordMinLength` (server-side). */
    password: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(120).optional(),
    /** Omitted ⇒ registry defaults stand (telemetry + update check both off). */
    consent: setupConsentBody.optional(),
  })
  .strict();
export type SetupSuperAdminBody = z.infer<typeof setupSuperAdminBody>;

/** 201 — the super admin exists and the response carries their session cookie. */
export const setupSuperAdminReply = z.object({
  data: z.object({ user: authUserView }),
});
export type SetupSuperAdminReply = z.infer<typeof setupSuperAdminReply>;
