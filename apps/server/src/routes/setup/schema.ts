// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the first-run setup resource (naming:
 * `<resource><Action><Part>` consts, `z.infer` PascalCase types).
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
 * `csrfToken` is that session's -item-4 token, the same value `GET /bootstrap`
 * issues for it. It is here because this reply MINTS the ambient credential the
 * CSRF check exists to protect, and the client that receives it may keep
 * mutating without ever reaching `/bootstrap`: the desktop first-run wizard
 * creates the account at step 3 and then creates a database, introspects it and
 * generates pages at step 4, all on the `/desktop/setup` route — which is a
 * child of the router ROOT precisely because it cannot bootstrap (there is no
 * account to bootstrap as when it loads). Without the token in this reply,
 * every one of those step-4 calls is a session-authenticated,
 * browser-provenanced, tokenless mutation: a 403.
 *
 * Handing it back here leaks nothing. Reading this response body cross-origin
 * requires CORS, which is off unless an operator opts an origin in
 * (plugins/core.ts) — the same thing that already protects `/bootstrap`'s copy.
 */
export const setupSuperAdminReply = z.object({
  data: z.object({ user: authUserView, csrfToken: z.string() }),
});
export type SetupSuperAdminReply = z.infer<typeof setupSuperAdminReply>;

/**
 * `POST /setup/probe` — does this database already hold an Adminium instance?
 *
 * The wizard asks BEFORE it asks for a password, so a person who points a
 * second install at a database that already runs one is told while they can
 * still change their mind, rather than after an account exists and a
 * relocation has failed.
 *
 * Narrow on purpose: it takes a DSN and answers about `adminium_` tables only.
 * It reports no row counts, no schema, no server version — nothing an
 * un-bootstrapped instance should be usable to learn about a database.
 */
export const setupProbeBody = z
  .object({
    dsn: z.string().trim().min(1).max(2000),
  })
  .strict();
export type SetupProbeBody = z.infer<typeof setupProbeBody>;

export const setupProbeReply = z.object({
  data: z.object({
    /** False ⇒ nothing else here is meaningful; `reason` says why. */
    reachable: z.boolean(),
    /** Why it could not be reached, in the operator's terms. */
    reason: z.string().nullable(),
    /** Physical `adminium_` tables found, sorted. Empty on a clean database. */
    tables: z.array(z.string()),
    /**
     * The subset holding rows — what a relocation actually refuses over. Empty
     * tables from an abandoned attempt are not an obstacle.
     */
    occupied: z.array(z.string()),
    /**
     * Whether THIS instance's `ADMINIUM_SECRET` can read what that store
     * encrypted. `null` when the store holds nothing encrypted to test.
     * Adopting a store under a different secret still signs you in — password
     * hashes are not encrypted — but its saved connection strings are lost.
     */
    secretMatches: z.boolean().nullable(),
  }),
});
export type SetupProbeReply = z.infer<typeof setupProbeReply>;

/**
 * `POST /setup/adopt` — point this instance at an Adminium store that already
 * exists, instead of creating a second one beside it.
 *
 * Writes the bootstrap file and restarts onto the named store; the reply is
 * the health path to wait on, exactly as `/meta/relocate` answers. Nothing is
 * copied and nothing is dropped — the local store this instance booted on is
 * left on disk, and the wizard sends the operator to `/login`, where their
 * existing account is.
 */
export const setupAdoptBody = setupProbeBody;
export type SetupAdoptBody = z.infer<typeof setupAdoptBody>;

export const setupAdoptReply = z.object({
  data: z.object({
    engine: z.string(),
    restarting: z.boolean(),
    healthPath: z.string(),
  }),
});
export type SetupAdoptReply = z.infer<typeof setupAdoptReply>;
