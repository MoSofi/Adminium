// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared fixtures for the auth suites (not collected by vitest — no .test
 * suffix): in-memory SQLite meta store via `createSqliteMetaDb` + `firstRun`,
 * a seeded first super admin, and cookie plumbing around `app.inject`.
 */
import BetterSqlite3 from 'better-sqlite3';
import * as OTPAuth from 'otpauth';
import { expect } from 'vitest';
import {
  createFirstSuperAdmin,
  createSqliteMetaDb,
  firstRun,
  initMetaDb,
  type MetaDb,
  type User,
} from '@adminium/meta';

import { buildServer, type AdminiumServer, type BuildServerOptions } from '../src/app.js';
import { hashPassword } from '../src/auth/passwords.js';
import { makeEnv } from './helpers.js';

export const ADMIN_EMAIL = 'ava@example.com';
export const ADMIN_NAME = 'Ava Reyes';
export const ADMIN_PASSWORD = 'correct-horse-battery-staple';

/** argon2id at 19 MiB×2 is deliberately slow — hash the fixture once. */
let cachedAdminHash: Promise<string> | undefined;
export function adminPasswordHash(): Promise<string> {
  cachedAdminHash ??= hashPassword(ADMIN_PASSWORD);
  return cachedAdminHash;
}

export interface AuthTestApp {
  app: AdminiumServer;
  meta: MetaDb;
  admin: User;
  destroy: () => Promise<void>;
}

/** Fresh in-memory meta DB, bootstrapped and seeded with one super admin. */
export async function makeMeta(): Promise<{ meta: MetaDb; admin: User }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await initMetaDb(meta);
  await firstRun(meta);
  const admin = await createFirstSuperAdmin(meta, {
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    passwordHash: await adminPasswordHash(),
  });
  return { meta, admin };
}

export async function buildAuthApp(opts: Partial<BuildServerOptions> = {}): Promise<AuthTestApp> {
  const { meta, admin } = await makeMeta();
  const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta, ...opts });
  return {
    app,
    meta,
    admin,
    destroy: async () => {
      await app.close();
      await meta.db.destroy();
    },
  };
}

/** Extracts the raw `adminium_session=…` pair from a set-cookie header. */
export function sessionCookie(setCookie: string | string[] | undefined): string {
  const headers = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
  const pair = headers
    .map((header) => header.split(';')[0] ?? '')
    .find((p) => p.startsWith('adminium_session='));
  expect(pair, 'expected an adminium_session set-cookie').toBeDefined();
  return pair ?? '';
}

/**
 * POST /auth/login and return the response plus the session cookie pair.
 * `extra` rides along in the body (e.g. `{ remember: false }`).
 */
export async function login(
  app: AdminiumServer,
  email: string = ADMIN_EMAIL,
  password: string = ADMIN_PASSWORD,
  extra: Record<string, unknown> = {},
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password, ...extra },
  });
  return { res, cookie: res.statusCode === 200 ? sessionCookie(res.headers['set-cookie']) : null };
}

export function totpCode(secretBase32: string): string {
  return new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).generate();
}

/** enroll + activate for the signed-in admin; returns secret + recovery codes. */
export async function enable2fa(app: AdminiumServer, cookie: string) {
  const enroll = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/2fa/enroll',
    headers: { cookie },
  });
  expect(enroll.statusCode).toBe(200);
  const { secret, otpauthUrl } = (enroll.json() as { data: { secret: string; otpauthUrl: string } })
    .data;
  expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  expect(otpauthUrl).toContain('Adminium');

  const activate = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/2fa/activate',
    headers: { cookie },
    payload: { code: totpCode(secret) },
  });
  expect(activate.statusCode).toBe(200);
  const { recoveryCodes } = (activate.json() as { data: { recoveryCodes: string[] } }).data;
  expect(recoveryCodes).toHaveLength(10);
  return { secret, recoveryCodes };
}
