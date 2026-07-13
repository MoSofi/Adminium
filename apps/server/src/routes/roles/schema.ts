/**
 * Zod schemas for the roles resource (08-server-api.md §2.3; naming per §1.5:
 * `<resource><Action><Part>` consts, PascalCase inferred types).
 */
import { z } from 'zod';

export const roleDto = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isBuiltin: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type RoleDto = z.infer<typeof roleDto>;

export const roleListItem = roleDto.extend({
  /** Users currently holding the role (`adminium_user_roles`). */
  memberCount: z.number().int().nonnegative(),
});

export const roleListReply = z.object({ roles: z.array(roleListItem) });
export type RoleListReply = z.infer<typeof roleListReply>;

export const roleReply = roleDto;
export type RoleReply = z.infer<typeof roleReply>;

export const roleCreateBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  /** Copy the source role's permission matrix rows. */
  cloneFromRoleId: z.string().optional(),
});
export type RoleCreateBody = z.infer<typeof roleCreateBody>;

export const rolePatchBody = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: 'Provide name and/or description.',
  });
export type RolePatchBody = z.infer<typeof rolePatchBody>;

export const roleIdParams = z.object({ id: z.string() });

export const roleDeleteQuery = z.object({
  /** Target role for existing members; required when the role has members. */
  reassignTo: z.string().optional(),
});

export const roleOkReply = z.object({ ok: z.literal(true) });

export const rolePermissionsReply = z.object({
  roleId: z.string(),
  /** §5.1 grant strings expanded from the matrix rows. */
  grants: z.array(z.string()),
});
export type RolePermissionsReply = z.infer<typeof rolePermissionsReply>;

export const rolePermissionsPutBody = z.object({
  grants: z.array(z.string()).max(2000),
});
export type RolePermissionsPutBody = z.infer<typeof rolePermissionsPutBody>;

// --- user-role assignment (POST/DELETE /users/:id/roles…) ---------------------

export const userRolesParams = z.object({ id: z.string() });
export const userRoleDeleteParams = z.object({ id: z.string(), roleId: z.string() });

export const userRolesPostBody = z.object({ roleId: z.string() });
export type UserRolesPostBody = z.infer<typeof userRolesPostBody>;

export const userRolesReply = z.object({
  userId: z.string(),
  roleIds: z.array(z.string()),
});
export type UserRolesReply = z.infer<typeof userRolesReply>;
