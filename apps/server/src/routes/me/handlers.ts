// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `me` handlers (08-server-api.md §2.2): profile view/patch (email change
 * requires the current password) and per-user preference axes with the §7.2
 * server-side resolution. Prefs writes go through `userPrefsRepo`; `null`
 * clears an axis back to "inherit".
 */
import type { FastifyRequest } from 'fastify';
import {
  userPrefsRepo,
  usersRepo,
  type UserPrefs,
  type UserPrefsPatch,
  type User,
} from '@adminium/meta';

import { ConflictError, UnauthorizedError } from '../../errors.js';
import { auditAuth } from '../../auth/audit.js';
import { verifyPassword } from '../../auth/passwords.js';
import type { AuthContext } from '../../plugins/auth.js';
import { toUserView } from '../auth/handlers.js';
import type { MePatchBody, MePrefsPatchBody, MePrefsReply, MeReply } from './schema.js';

function principal(request: FastifyRequest): User {
  if (request.user === null) throw new UnauthorizedError('UNAUTHENTICATED');
  return request.user;
}

export async function getMeHandler(_ctx: AuthContext, request: FastifyRequest): Promise<MeReply> {
  return { data: { user: toUserView(principal(request)) } };
}

export async function patchMeHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  body: MePatchBody,
): Promise<MeReply> {
  const now = Date.now();
  const user = principal(request);
  const users = usersRepo(ctx.meta);

  const patch: { name?: string; email?: string } = {};
  if (body.name !== undefined && body.name !== user.name) patch.name = body.name;

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (email !== user.email) {
      // Email is a credential — re-authenticate before changing it (§2.2).
      const passwordOk =
        body.password !== undefined &&
        user.passwordHash !== null &&
        (await verifyPassword(user.passwordHash, body.password));
      if (!passwordOk) {
        throw new UnauthorizedError('UNAUTHENTICATED', 'Password verification failed.');
      }
      const taken = await users.findByEmail(email);
      if (taken !== null && taken.id !== user.id) {
        throw new ConflictError('That email is already in use.', 'UNIQUE_VIOLATION');
      }
      patch.email = email;
    }
  }

  if (Object.keys(patch).length > 0) {
    await ctx.meta.db
      .updateTable('adminium_users')
      .set({ ...patch, updatedAt: now })
      .where('id', '=', user.id)
      .execute();
    await auditAuth(ctx.meta, request, {
      action: 'me_updated',
      actorId: user.id,
      actorLabel: user.name,
      changes: {
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, user[k as 'name' | 'email']])),
        after: { ...patch },
      },
    });
  }

  const fresh = (await users.findById(user.id)) ?? user;
  return { data: { user: toUserView(fresh) } };
}

function prefsView(prefs: UserPrefs | null) {
  return {
    theme: prefs?.theme ?? null,
    accent: prefs?.accent ?? null,
    density: prefs?.density ?? null,
    locale: prefs?.locale ?? null,
    dir: prefs?.dir ?? null,
  };
}

export async function getMePrefsHandler(
  ctx: AuthContext,
  request: FastifyRequest,
): Promise<MePrefsReply> {
  const user = principal(request);
  const repo = userPrefsRepo(ctx.meta);
  const [prefs, resolved] = await Promise.all([repo.get(user.id), repo.resolve(user.id)]);
  return { data: { prefs: prefsView(prefs), resolved } };
}

export async function patchMePrefsHandler(
  ctx: AuthContext,
  request: FastifyRequest,
  body: MePrefsPatchBody,
): Promise<MePrefsReply> {
  const now = Date.now();
  const user = principal(request);
  const repo = userPrefsRepo(ctx.meta);

  // Absent = unchanged; explicit `null` = clear back to inherit (§7.2).
  const patch: UserPrefsPatch = {
    ...(body.theme !== undefined ? { theme: body.theme } : {}),
    ...(body.accent !== undefined ? { accent: body.accent } : {}),
    ...(body.density !== undefined ? { density: body.density } : {}),
    ...(body.locale !== undefined ? { locale: body.locale } : {}),
    ...(body.dir !== undefined ? { dir: body.dir } : {}),
  };
  const prefs = await repo.set(user.id, patch, now);
  const resolved = await repo.resolve(user.id);
  return { data: { prefs: prefsView(prefs), resolved } };
}
