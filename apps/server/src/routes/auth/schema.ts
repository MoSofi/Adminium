// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the auth resource (08-server-api.md §2.1; naming per §1.5:
 * `<resource><Action><Part>` consts, PascalCase `z.infer` types).
 */
import { z } from 'zod';

/** Public projection of `adminium_users` — never hashes/secrets (§7 item 6). */
export const authUserView = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: z.enum(['active', 'invited', 'suspended']),
  totpEnabled: z.boolean(),
  lastLoginAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type AuthUserView = z.infer<typeof authUserView>;

export const okReply = z.object({ data: z.object({ ok: z.literal(true) }) });
export type OkReply = z.infer<typeof okReply>;

export const authLoginBody = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(200),
});
export type AuthLoginBody = z.infer<typeof authLoginBody>;

export const authLoginReply = z.object({
  data: z.object({
    user: authUserView,
    /**
     * Present and true only when `auth.require2fa` is on and this account has
     * no TOTP yet: the client routes into /auth/2fa/enroll rather than to the
     * dashboard. Optional because the paths that cannot produce it (2FA verify
     * — the user demonstrably has TOTP — and the desktop boot-token exchange)
     * share this reply and must not have to say "false".
     */
    twoFactorSetupRequired: z.literal(true).optional(),
  }),
});
export type AuthLoginReply = z.infer<typeof authLoginReply>;

/** 202 login step-up: the user has TOTP enabled (§2.1). */
export const authLoginChallengeReply = z.object({
  data: z.object({
    twoFactorRequired: z.literal(true),
    /** 5-minute single-use challenge token to present at /auth/2fa/verify. */
    challengeToken: z.string(),
  }),
});
export type AuthLoginChallengeReply = z.infer<typeof authLoginChallengeReply>;

export const auth2faVerifyBody = z.object({
  challengeToken: z.string().min(1),
  /** 6-digit TOTP or a recovery code (`xxxxx-xxxxx`). */
  code: z.string().trim().min(6).max(20),
});
export type Auth2faVerifyBody = z.infer<typeof auth2faVerifyBody>;

export const authSessionReply = z.object({
  data: z.object({
    user: authUserView,
    /** Role slugs, e.g. `["super-admin"]` — full RBAC arrives with rbac. */
    roles: z.array(z.string()),
    /**
     * `auth.require2fa` is on and this account has no TOTP. Always present
     * here (unlike the login reply) because this is the route a reload asks
     * "where does this user belong?", and a missing field would read as "no".
     */
    twoFactorSetupRequired: z.boolean(),
  }),
});
export type AuthSessionReply = z.infer<typeof authSessionReply>;

export const authForgotBody = z.object({
  email: z.string().trim().min(3).max(320),
});
export type AuthForgotBody = z.infer<typeof authForgotBody>;

export const authResetBody = z.object({
  token: z.string().min(1),
  /** Floor only — `auth.passwordMinLength` is the policy (see the handler). */
  newPassword: z.string().min(8).max(200),
});
export type AuthResetBody = z.infer<typeof authResetBody>;

export const auth2faEnrollReply = z.object({
  data: z.object({
    /** Base32 secret for manual entry. Shown once; encrypted at rest. */
    secret: z.string(),
    /** `otpauth://totp/...` — render as a QR code client-side. */
    otpauthUrl: z.string(),
  }),
});
export type Auth2faEnrollReply = z.infer<typeof auth2faEnrollReply>;

export const auth2faActivateBody = z.object({
  code: z.string().trim().min(6).max(20),
});
export type Auth2faActivateBody = z.infer<typeof auth2faActivateBody>;

export const auth2faActivateReply = z.object({
  data: z.object({
    /** 10 single-use recovery codes — returned exactly once, stored hashed. */
    recoveryCodes: z.array(z.string()),
  }),
});
export type Auth2faActivateReply = z.infer<typeof auth2faActivateReply>;

export const auth2faDisableBody = z.object({
  password: z.string().min(1).max(200),
  /** Optional current TOTP code — verified when provided. */
  code: z.string().trim().min(6).max(20).optional(),
});
export type Auth2faDisableBody = z.infer<typeof auth2faDisableBody>;

/** One row of `GET /auth/sessions` — the caller's own signed-in devices. */
export const authSessionListItem = z.object({
  id: z.string(),
  /** Address and client recorded at sign-in; null when unknown. */
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  /** True for the one session this very request authenticated with. */
  current: z.boolean(),
});
export type AuthSessionListItem = z.infer<typeof authSessionListItem>;

export const authSessionListReply = z.object({
  data: z.object({ sessions: z.array(authSessionListItem) }),
});
export type AuthSessionListReply = z.infer<typeof authSessionListReply>;

export const authSessionRevokeParams = z.object({
  id: z.string().min(1).max(64),
});
export type AuthSessionRevokeParams = z.infer<typeof authSessionRevokeParams>;

export const authPasswordChangeBody = z.object({
  currentPassword: z.string().min(1).max(200),
  /**
   * 8 is the registry FLOOR of `auth.passwordMinLength`, not the policy — the
   * handler reads the workspace's own value and 422s below it. Bounding it
   * here only keeps obviously-too-short bodies out of the argon2 path.
   */
  newPassword: z.string().min(8).max(200),
});
export type AuthPasswordChangeBody = z.infer<typeof authPasswordChangeBody>;

/**
 * `POST /auth/desktop-session` (11-electron.md §5) — the desktop shell's per-boot
 * token, exchanged for a normal session.
 *
 * The shape is pinned to §2.2 step 4's token (32 bytes, hex) rather than left as
 * a loose string: a body that cannot be the token is rejected by the schema
 * before any comparison runs, and 422-on-malformed keeps the handler's own 401
 * meaning exactly one thing — "well-formed, and wrong".
 */
export const authDesktopSessionBody = z.object({
  bootToken: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters'),
});
export type AuthDesktopSessionBody = z.infer<typeof authDesktopSessionBody>;
