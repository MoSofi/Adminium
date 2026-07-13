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

export const authLoginReply = z.object({ data: z.object({ user: authUserView }) });
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
  }),
});
export type AuthSessionReply = z.infer<typeof authSessionReply>;

export const authForgotBody = z.object({
  email: z.string().trim().min(3).max(320),
});
export type AuthForgotBody = z.infer<typeof authForgotBody>;

export const authResetBody = z.object({
  token: z.string().min(1),
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
