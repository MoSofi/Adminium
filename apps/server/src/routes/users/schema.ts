// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the users resource (08-server-api.md §2.15). The user
 * projection EXTENDS `authUserView` rather than restating it: that object is
 * the audited safe projection of `adminium_users` (§7 item 6), so
 * `passwordHash`, `totpSecretEncrypted` and `recoveryCodes` cannot reappear
 * here by a later edit adding a field.
 *
 * The one-time invite token appears in exactly two replies — the invite and
 * the resend — mirroring the api-keys one-time reveal (§2.16). Nothing else
 * on this resource ever serializes token material.
 */
import { z } from 'zod';

import { authUserView } from '../auth/schema.js';
import { boolFlag } from '../query-flag.js';

/** Enough of a role to render a chip without `system:roles:manage`. */
export const userRoleRef = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});
export type UserRoleRef = z.infer<typeof userRoleRef>;

export const userDto = authUserView.extend({ roles: z.array(userRoleRef) });
export type UserDto = z.infer<typeof userDto>;

export const userStatusFilter = z.enum(['active', 'invited', 'suspended']);

export const userListQuery = z.object({
  /** Case-insensitive substring over name + email. */
  q: z.string().max(200).optional(),
  status: userStatusFilter.optional(),
  roleId: z.string().optional(),
  /** Opaque keyset cursor from a previous reply (same shape as `/audit`). */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type UserListQuery = z.infer<typeof userListQuery>;

export const userListReply = z.object({
  users: z.array(userDto),
  /** Pass back as `cursor` for the next page; `null` on the last page. */
  nextCursor: z.string().nullable(),
  /** Whole-directory tallies for the status tabs — not page-scoped. */
  counts: z.object({
    active: z.number(),
    invited: z.number(),
    suspended: z.number(),
  }),
});
export type UserListReply = z.infer<typeof userListReply>;

export const userIdParams = z.object({ id: z.string() });

export const userInviteBody = z.object({
  email: z.string().trim().min(3).max(320),
  name: z.string().trim().min(1).max(120),
  /**
   * Optional at invite time. Assigning ANY role additionally requires
   * `system:roles:manage` — see the guard in index.ts.
   */
  roleIds: z.array(z.string()).max(20).optional(),
});
export type UserInviteBody = z.infer<typeof userInviteBody>;

/** The activation credential. Returned once; only its SHA-256 is stored. */
export const inviteDto = z.object({
  token: z.string(),
  expiresAt: z.number(),
  /** Dashboard path that consumes it: `/reset/<token>`. */
  activationPath: z.string(),
});
export type InviteDto = z.infer<typeof inviteDto>;

export const userInviteReply = z.object({
  user: userDto,
  invite: inviteDto,
  /**
   * Always `false` in v1: this build has no mail transport at all, so the
   * activation link is handed to the inviter to pass on. Typed as a literal
   * so a future SMTP wave has to widen the contract deliberately.
   */
  emailSent: z.literal(false),
});
export type UserInviteReply = z.infer<typeof userInviteReply>;

export const userPatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().min(3).max(320).optional(),
  /**
   * `invited` is not settable — it is the invite route's outcome, and the
   * activation flow (§2.1) is what leaves it.
   */
  status: z.enum(['active', 'suspended']).optional(),
});
export type UserPatchBody = z.infer<typeof userPatchBody>;

export const userDeleteQuery = z.object({
  /**
   * Opt in to a HARD delete. Default (absent/`false`) suspends instead:
   * `adminium_user_prefs`, `_sessions` and `_password_resets` all CASCADE from
   * `adminium_users`, and `adminium_settings.updated_by` is SET NULL, so a row
   * delete quietly erases history that the audit log then cannot explain.
   */
  permanent: boolFlag(),
});
export type UserDeleteQuery = z.infer<typeof userDeleteQuery>;

export const userDeleteReply = z.object({
  ok: z.literal(true),
  permanent: z.boolean(),
  /** The suspended row; `null` when the row was hard-deleted. */
  user: userDto.nullable(),
});
export type UserDeleteReply = z.infer<typeof userDeleteReply>;

export const userRolesPutBody = z.object({
  /** Full replace — the user ends up holding exactly these roles. */
  roleIds: z.array(z.string()).max(20),
});
export type UserRolesPutBody = z.infer<typeof userRolesPutBody>;

export const userReply = userDto;
