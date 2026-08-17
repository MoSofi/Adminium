// SPDX-License-Identifier: AGPL-3.0-only
/**
 * API-key routes (08-server-api.md §2.16, M2-T06): list, create with the
 * one-time secret reveal (`adm_sk_…` stored SHA-256-hashed + short prefix for
 * display/lookup), and revoke. Keys act with a role's permissions — scopes
 * are that role's §5.1 grant set. Guarded by `system:api-keys:manage`
 * (meta closed-set key `api-keys.manage`). Mutations audit under the
 * `system` category (§7.2 matrix).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { apiKeysRepo, permissionsRepo, rolesRepo, type ApiKey } from '@adminium/meta';

import { ConflictError, NotFoundError } from '../../errors.js';
import { generateApiKey } from '../../rbac/api-keys.js';
import { PERMISSIONS, grantsFromMatrixRows } from '../../rbac/permissions.js';
import {
  apiKeyCreateBody,
  apiKeyCreateReply,
  apiKeyIdParams,
  apiKeyListReply,
  apiKeyOkReply,
  type ApiKeyDto,
} from './schema.js';

/** Strips `tokenHash` — no secret material ever leaves this mapper. */
function toDto(row: ApiKey): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    roleId: row.roleId,
    createdBy: row.createdBy,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export const apiKeysRoutes: FastifyPluginAsyncZod = async (app) => {
  const { meta } = app.rbac;
  const apiKeys = apiKeysRepo(meta);
  const roles = rolesRepo(meta);
  const permissions = permissionsRepo(meta);

  app.get(
    '/api-keys',
    {
      preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
      schema: { response: { 200: apiKeyListReply } },
    },
    async () => ({ apiKeys: (await apiKeys.list()).map(toDto) }),
  );

  app.post(
    '/api-keys',
    {
      preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
      schema: { body: apiKeyCreateBody, response: { 201: apiKeyCreateReply } },
    },
    async (request, reply) => {
      const role = await roles.findById(request.body.roleId);
      if (role === null) {
        throw new NotFoundError('Role not found.', { roleId: request.body.roleId });
      }
      const generated = generateApiKey();
      const actingUserId =
        request.apiKeyPrincipal === null
          ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
          : null;
      const row = await apiKeys.create(
        {
          name: request.body.name,
          prefix: generated.prefix,
          tokenHash: generated.tokenHash,
          roleId: role.id,
          createdBy: actingUserId,
          expiresAt: request.body.expiresAt ?? null,
        },
        app.rbac.now(),
      );
      const scopes = role.slug === 'super-admin'
        ? ['*']
        : grantsFromMatrixRows(await permissions.listForRole(role.id));
      await app.rbac.audit(request, {
        category: 'system',
        action: 'api-key.create',
        changes: { after: { apiKeyId: row.id, name: row.name, prefix: row.prefix, roleId: role.id } },
      });
      // The ONLY place the full key is ever serialized (§2.16 one-time reveal).
      return reply.status(201).send({ apiKey: toDto(row), key: generated.key, scopes });
    },
  );

  app.delete(
    '/api-keys/:id',
    {
      preHandler: app.rbac.require(PERMISSIONS.apiKeysManage),
      schema: { params: apiKeyIdParams, response: { 200: apiKeyOkReply } },
    },
    async (request) => {
      const row = await apiKeys.findById(request.params.id);
      if (row === null) throw new NotFoundError('API key not found.', { id: request.params.id });
      if (row.revokedAt !== null) {
        throw new ConflictError('API key is already revoked.', 'CONFLICT', { id: row.id });
      }
      await apiKeys.revoke(row.id, app.rbac.now());
      await app.rbac.audit(request, {
        category: 'system',
        action: 'api-key.revoke',
        changes: { before: { apiKeyId: row.id, name: row.name, prefix: row.prefix } },
      });
      return { ok: true as const };
    },
  );
};
