/**
 * First-run bootstrap (07-meta-store.md §6): migrations + built-in role and
 * permission seeds + `system.*` settings, plus the guarded creation of the
 * first super admin. Re-running is safe — every step is guarded by existence
 * checks and seeds use slug/key natural-key upserts, so upgrades can add new
 * built-in permission rows without touching user edits.
 */

import { randomUUID } from 'node:crypto';

import type { MetaDb } from './connect.js';
import { applyMigrations } from './migrator.js';
import { SYSTEM_ACTION_KEYS, type SystemActionKey } from './schema/json-payloads.js';
import { permissionsRepo } from './repos/permissions.js';
import { rolesRepo, type Role } from './repos/roles.js';
import { settingsRepo } from './repos/settings.js';
import { usersRepo, type User } from './repos/users.js';
import { packJson } from './repos/util.js';

export interface BuiltinRoleDef {
  slug: string;
  name: string;
  description: string;
  /** System action grants seeded as `{ allowed: true }` rows (§6 step 3). */
  systemActions: readonly SystemActionKey[];
}

/**
 * The four built-in roles (§3.8, §6). Super-admin gets every system action
 * (the RBAC layer short-circuits for `super-admin` anyway); admin gets the §6
 * management set; editor/viewer get table/page grants dynamically at
 * generation time, no system actions.
 *
 * Reserved-key footprint: "every system action" includes ALL FOUR
 * `RESERVED_SYSTEM_ACTION_KEYS` (automations/webhooks/manifests/sql.run —
 * no v1 enforcement point), and admin's set includes two of them. These
 * seeded rows are inert no-op grants, but they ARE persisted and read-only
 * surfaces that render stored grants verbatim (e.g. the API-keys scope chips)
 * will show them. That display is permitted by the reservation contract
 * (json-payloads.ts `RESERVED_SYSTEM_ACTION_KEYS`): only grant-EDITING UIs
 * must hide reserved keys, via `GRANTABLE_SYSTEM_ACTION_KEYS`.
 */
export const BUILTIN_ROLES: readonly BuiltinRoleDef[] = [
  {
    slug: 'super-admin',
    name: 'Super Admin',
    description: 'Full access to everything, including users, roles, and settings.',
    systemActions: SYSTEM_ACTION_KEYS,
  },
  {
    slug: 'admin',
    name: 'Admin',
    description: 'Manages connections, schema, automations, and webhooks.',
    systemActions: ['connections.manage', 'schema.remap', 'llm.run', 'automations.manage', 'webhooks.manage'],
  },
  {
    slug: 'editor',
    name: 'Editor',
    description: 'Reads, creates, and updates records; views pages.',
    systemActions: [],
  },
  {
    slug: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to records and pages.',
    systemActions: [],
  },
];

export class FirstUserExistsError extends Error {
  override name = 'FirstUserExistsError';
  constructor() {
    super('createFirstSuperAdmin is only allowed when zero users exist.');
  }
}

export class BootstrapStateError extends Error {
  override name = 'BootstrapStateError';
}

/**
 * Seed the built-in roles and their permission baselines. Idempotent
 * natural-key upserts: existing roles are left untouched (user renames of
 * non-super-admin built-ins survive), and only missing permission rows are
 * inserted (user permission edits survive upgrades).
 */
export async function seedBuiltinRoles(meta: MetaDb, at: number = Date.now()): Promise<{ createdRoles: string[] }> {
  const roles = rolesRepo(meta);
  const permissions = permissionsRepo(meta);
  const createdRoles: string[] = [];

  for (const def of BUILTIN_ROLES) {
    let role: Role | null = await roles.findBySlug(def.slug);
    if (!role) {
      role = await roles.create(
        { slug: def.slug, name: def.name, description: def.description, isBuiltin: true },
        at,
      );
      createdRoles.push(def.slug);
    }
    for (const action of def.systemActions) {
      const existing = await permissions.find(role.id, 'system', action);
      if (!existing) {
        await permissions.grant(role.id, 'system', action, { allowed: true });
      }
    }
  }
  return { createdRoles };
}

/**
 * Seed the `system.*` settings keys (§6 step 4). Only system identity keys
 * are written — behavioral settings stay unset so a fresh install resolves to
 * registry defaults (indigo / system theme / en_US) without a settings row.
 */
export async function seedSystemSettings(meta: MetaDb, at: number = Date.now()): Promise<void> {
  const settings = settingsRepo(meta);
  if ((await settings.get('system.instanceId')) === null) {
    await settings.set('system.instanceId', randomUUID(), { at });
  }
  if ((await settings.get('system.bootstrappedAt')) === null) {
    await settings.set('system.bootstrappedAt', at, { at });
    await settings.set('system.configVersion', 1, { at });
  }
}

export interface FirstRunResult {
  appliedMigrations: string[];
  createdRoles: string[];
}

/**
 * Everything a fresh database needs from a single call: apply all pending
 * migrations, seed built-in roles/permissions, seed system settings.
 * Safe to run at every boot (§6).
 */
export async function firstRun(meta: MetaDb, at: number = Date.now()): Promise<FirstRunResult> {
  const { applied } = await applyMigrations(meta.db, { dialect: meta.dialect });
  const { createdRoles } = await seedBuiltinRoles(meta, at);
  await seedSystemSettings(meta, at);
  return { appliedMigrations: applied, createdRoles };
}

export interface CreateFirstSuperAdminInput {
  email: string;
  /** Defaults to the email local part. */
  name?: string;
  /** argon2id — hashing happens in the server. */
  passwordHash: string;
}

/**
 * The settings key whose ROW PRESENCE claims the one-and-only first-run
 * bootstrap (M10-T04). See the registry entry for why it exists.
 */
const SUPER_ADMIN_CLAIM_KEY = 'system.superAdminCreatedAt';

/**
 * Create the very first user and grant `super-admin` (§6 step 2). This is the
 * entire attack surface of a self-hosted first boot, so it is once-only by
 * CONSTRUCTION rather than by a check-then-act read:
 *
 * everything runs in ONE transaction that first INSERTs the
 * `system.superAdminCreatedAt` claim row. `adminium_settings.key` is a PRIMARY
 * KEY, so a second — or a concurrently racing — attempt either sees the row
 * (fast path below) or loses the INSERT to a duplicate-key violation, and its
 * whole transaction rolls back. Either way exactly one super admin can ever be
 * created, on every dialect and across processes/replicas; a plain
 * `count() === 0` read could not promise that (two racers both read zero).
 *
 * Throws {@link FirstUserExistsError} when the claim is already taken or any
 * user already exists.
 */
export async function createFirstSuperAdmin(
  meta: MetaDb,
  input: CreateFirstSuperAdminInput,
  at: number = Date.now(),
): Promise<User> {
  return meta.db.transaction().execute(async (trx) => {
    const tmeta: MetaDb = { db: trx, dialect: meta.dialect };
    const users = usersRepo(tmeta);
    const roles = rolesRepo(tmeta);

    // Fast, readable rejections for the common (non-racing) cases.
    const claimed = await trx
      .selectFrom('adminium_settings')
      .select('key')
      .where('key', '=', SUPER_ADMIN_CLAIM_KEY)
      .executeTakeFirst();
    if (claimed !== undefined) throw new FirstUserExistsError();
    if ((await users.count()) > 0) throw new FirstUserExistsError();

    const superAdmin = await roles.findBySlug('super-admin');
    if (!superAdmin) {
      throw new BootstrapStateError('built-in roles missing — run firstRun() before createFirstSuperAdmin().');
    }

    // The claim itself. A racer that passed the reads above collides here and
    // its transaction aborts — this INSERT, not the reads, is the guarantee.
    try {
      await trx
        .insertInto('adminium_settings')
        .values({ key: SUPER_ADMIN_CLAIM_KEY, value: packJson(at), updatedAt: at, updatedBy: null })
        .execute();
    } catch (error) {
      // The only row that can already hold this PK is another bootstrap's
      // claim (nothing else ever writes this key), so a failed INSERT means
      // we lost the race. Anything genuinely unexpected still surfaces: it
      // would have to be a non-duplicate write error, which we rethrow.
      if (isDuplicateKeyError(error)) throw new FirstUserExistsError();
      throw error;
    }

    const name = input.name ?? input.email.split('@')[0] ?? input.email;
    const user = await users.create(
      { email: input.email, name, passwordHash: input.passwordHash, status: 'active' },
      at,
    );
    await roles.assignToUser(user.id, superAdmin.id, null, at);
    return user;
  });
}

/**
 * Duplicate-key detection across the three v1 dialects: SQLite
 * (`SQLITE_CONSTRAINT_PRIMARYKEY` / "UNIQUE constraint failed"), Postgres
 * (SQLSTATE 23505), MySQL/MariaDB (errno 1062 / `ER_DUP_ENTRY`). Falls back to
 * a message probe so an unrecognized driver shape still reads as a duplicate
 * rather than a 500 on the security-critical path.
 */
function isDuplicateKeyError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const e = error as { code?: unknown; errno?: unknown; message?: unknown };
  if (typeof e.code === 'string') {
    if (e.code === '23505') return true; // Postgres unique_violation
    if (e.code.startsWith('SQLITE_CONSTRAINT')) return true;
    if (e.code === 'ER_DUP_ENTRY') return true;
  }
  if (e.errno === 1062) return true; // MySQL/MariaDB
  return typeof e.message === 'string' && /duplicate|unique constraint/i.test(e.message);
}

/**
 * Zero users AND an unclaimed bootstrap ⇒ setup mode: the server serves only
 * /setup/* (§6 step 1).
 *
 * The claim is checked as well as the user count so that bootstrap is
 * PERMANENTLY closed once it has run: deleting every user later must not
 * re-open an unauthenticated super-admin-creation endpoint (M10-T04).
 */
export async function isBootstrapRequired(meta: MetaDb): Promise<boolean> {
  if ((await usersRepo(meta).count()) > 0) return false;
  const claimed = await meta.db
    .selectFrom('adminium_settings')
    .select('key')
    .where('key', '=', SUPER_ADMIN_CLAIM_KEY)
    .executeTakeFirst();
  return claimed === undefined;
}
