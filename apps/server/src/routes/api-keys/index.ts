// SPDX-License-Identifier: AGPL-3.0-only
/**
 * API-key routes: list, create with the one-time secret reveal (`adm_sk_…`
 * stored SHA-256-hashed + short prefix for display/lookup), and revoke. Keys
 * act with a role's permissions — scopes are that role's grant set. Guarded
 * by `system:api-keys:manage` (meta closed-set key `api-keys.manage`).
 * Mutations audit under the `system` category (matrix).
 *
 * WHICH ROLE. Choosing a key's role hands out that role's power, so a caller
 * gives only a role they already hold all of (`routes/roles/role-giving.ts`).
 * Only a signed-in Super Admin gives Super Admin. A key is held to its own
 * permissions and to those of the person behind it, and a key with nobody
 * behind it makes no keys. Keys already made are not touched.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { apiKeysRepo, permissionsRepo, rolesRepo, type ApiKey } from '@adminium/meta';

import { ConflictError, ForbiddenError, NotFoundError } from '../../errors.js';
import { generateApiKey } from '../../rbac/api-keys.js';
import { PERMISSIONS, grantsFromMatrixRows } from '../../rbac/permissions.js';
import { roleGiving } from '../roles/role-giving.js';
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

  const giving = roleGiving(app);

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
      // Whose key this is. One made by a key is that key's maker's, so stopping the person stops it too.
      const callingKey = request.apiKeyPrincipal === null ? null : await apiKeys.findById(request.apiKeyPrincipal.id);
      const makerId =
        request.apiKeyPrincipal === null
          ? ((request as unknown as { user?: { id?: string } }).user?.id ?? null)
          : (callingKey?.createdBy ?? null);
      await giving.assertMayHandle(request, role);
      // A key made by a key ends no later than the key that made it.
      const asked = request.body.expiresAt ?? null;
      const until = callingKey?.expiresAt ?? null;
      const expiresAt = until === null ? asked : asked === null ? until : Math.min(asked, until);
      // With the maker's row held, so a stop either finishes first and is seen here, or waits and revokes this key too.
      const row = await meta.db.transaction().execute(async (trx) => {
        if (makerId !== null) {
          const read = trx.selectFrom('adminium_users').select('status').where('id', '=', makerId);
          const maker = await (meta.dialect === 'sqlite' ? read : read.forUpdate()).executeTakeFirst();
          if (maker?.status !== 'active') throw new ForbiddenError('This account is no longer active.');
        }
        return apiKeysRepo({ ...meta, db: trx }).create(
          {
            name: request.body.name,
            prefix: generated.prefix,
            tokenHash: generated.tokenHash,
            roleId: role.id,
            createdBy: makerId,
            expiresAt,
          },
          app.rbac.now(),
        );
      });
      const scopes = role.slug === 'super-admin'
        ? ['*']
        : grantsFromMatrixRows(await permissions.listForRole(role.id));
      await app.rbac.audit(request, {
        category: 'system',
        action: 'api-key.create',
        changes: { after: { apiKeyId: row.id, name: row.name, prefix: row.prefix, roleId: role.id } },
      });
      // The ONLY place the full key is ever serialized (one-time reveal).
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
