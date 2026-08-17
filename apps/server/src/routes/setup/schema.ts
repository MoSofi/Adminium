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

/**
 * 201 — the super admin exists and the response carries their session cookie.
 *
 * `csrfToken` is that session's §7-item-4 token, the same value
 * `GET /bootstrap` issues for it. It is here because this reply MINTS the
 * ambient credential the CSRF check exists to protect, and the client that
 * receives it may keep mutating without ever reaching `/bootstrap`: the desktop
 * first-run wizard (11-electron.md §6) creates the account at step 3 and then
 * creates a database, introspects it and generates pages at step 4, all on the
 * `/desktop/setup` route — which is a child of the router ROOT precisely
 * because it cannot bootstrap (there is no account to bootstrap as when it
 * loads). Without the token in this reply, every one of those step-4 calls is a
 * session-authenticated, browser-provenanced, tokenless mutation: a 403.
 *
 * Handing it back here leaks nothing. Reading this response body cross-origin
 * requires CORS, which is off unless an operator opts an origin in
 * (plugins/core.ts) — the same thing that already protects `/bootstrap`'s copy.
 */
export const setupSuperAdminReply = z.object({
  data: z.object({ user: authUserView, csrfToken: z.string() }),
});
export type SetupSuperAdminReply = z.infer<typeof setupSuperAdminReply>;
