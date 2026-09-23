// SPDX-License-Identifier: AGPL-3.0-only
/**
 * First-run bootstrap: migrations + built-in role and permission seeds +
 * `system.*` settings, plus the guarded creation of the first super admin.
 * Re-running is safe — every step is guarded by existence checks and seeds
 * use slug/key natural-key upserts, so upgrades can add new built-in
 * permission rows without touching user edits.
 */

import { randomUUID } from 'node:crypto';

import type { MetaDb } from './connect.js';
import { applyMigrations } from './migrator.js';
import {
  SYSTEM_ACTION_KEYS,
  type AppActions,
  type PageActions,
  type PermissionActions,
  type SystemActionKey,
  type TableActions,
} from './schema/json-payloads.js';
import { permissionsRepo } from './repos/permissions.js';
import { rolesRepo, type Role } from './repos/roles.js';
import { settingsRepo } from './repos/settings.js';
import { usersRepo, type User } from './repos/users.js';
import { isDuplicateKeyError, packJson } from './repos/util.js';

export interface BuiltinRoleDef {
  slug: string;
  name: string;
  description: string;
  /** System action grants seeded as `{ allowed: true }` rows. */
  systemActions: readonly SystemActionKey[];
  /**
   * WILDCARD data grants: one `page` row whose ref is {@link ALL_PAGES_REF}
   * (every page) and one `table` row whose ref is {@link ALL_TABLES_REF} (every
   * table on every connection). Seeded once
   * through the same ledger as `systemActions`, so a Super Admin who narrows
   * them in Team → Roles keeps the narrowing across restarts and upgrades.
   * Absent on super-admin, which bypasses every check anyway.
   */
  dataGrants?: { pages: PageActions; tables: TableActions; apps?: AppActions };
}

/** The `resource_ref` of the every-page and every-table wildcard rows. */
export const ALL_PAGES_REF = '*';
export const ALL_TABLES_REF = '*/*';
/** The every-app row: every installed app's staff screens. */
export const ALL_APPS_REF = '*';

/**
 * The four built-in roles. Super-admin gets every system action (the RBAC
 * layer short-circuits for `super-admin` anyway); admin gets the management
 * set — including `users.manage` and `audit.read`, without which an Admin can
 * neither invite a colleague nor read the trail its own changes leave;
 * editor/viewer get no system actions.
 *
 * DATA ACCESS is seeded as wildcards, once (`dataGrants`): Viewer reads every
 * page and table, Editor also creates and updates rows, Admin holds every
 * table action and may edit page layouts. Before this, every built-in role but
 * Super Admin saw NO page and NO table on any install — an invited Admin landed
 * on an empty sidebar — while a comment here promised grants "at generation
 * time" that nothing ever wrote. Wildcards rather than per-page rows so a page
 * generated tomorrow is covered too, and so there is exactly one row per role
 * to narrow. Widening a built-in role also widens every `adm_sk_` API key
 * bound to it; `adm_pub_` keys never reach RBAC.
 *
 * `roles.manage` deliberately stays super-admin-only: it authorizes GRANTING a
 * role, and an actor that can both invite a user and pick that user's role can
 * mint itself any privilege (the invite reply carries the activation token —
 * there is no SMTP to keep it out of the inviter's hands). `seedBuiltinRoles`
 * runs at every boot and backfills the two new rows on existing installs.
 *
 * Reserved-key footprint: "every system action" includes BOTH remaining
 * `RESERVED_SYSTEM_ACTION_KEYS` (webhooks/sql.run — no
 * v1 enforcement point). That is deliberate and super-admin-ONLY: the role is
 * definitionally full-access (and the RBAC layer short-circuits for
 * `super-admin` anyway), so its reserved rows are inert declarations of
 * intent, not capabilities. Every other role seeds enforced keys only —
 * read-only surfaces render stored grants verbatim (e.g. the API-keys scope
 * chips), and a reserved key there would advertise a feature that does not
 * exist. When a deferred feature lands, re-add its key to the role defs in
 * the same change that moves it out of `RESERVED_SYSTEM_ACTION_KEYS`;
 * `seedBuiltinRoles` runs at every boot and backfills the missing rows on
 * existing installs.
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
    description: 'Manages connections, schema, and LLM assist.',
    dataGrants: {
      pages: { view: true, edit: true },
      tables: { read: true, create: true, update: true, delete: true, export: true, import: true },
      apps: { staff: true },
    },
    // `schema.ddl` is deliberately ABSENT:
    // the built-in Admin manages connections and labels, and writing DDL to
    // the customer's database is a capability an operator grants on purpose,
    // not one four roles arrive holding. Super Admin has it via SYSTEM_ACTION_KEYS.
    systemActions: [
      'users.manage',
      'audit.read',
      'connections.manage',
      'schema.remap',
      'llm.run',
      'project.read',
      // The page assistant, beside `llm.run` for the same reason: an Admin
      // already administers the LLM connection, and is the role that can find
      // the pages the assistant is opened from. Editor is deliberately absent
      // — it holds no system key at all, those pages are hidden from its rail,
      // and every save on them needs `settings.manage`, so the button would be
      // an offer nothing behind it could honour.
      'assistant.use',
    ],
  },
  {
    slug: 'editor',
    name: 'Editor',
    description: 'Reads, creates, and updates records; views pages.',
    systemActions: [],
    dataGrants: {
      pages: { view: true, edit: false },
      tables: { read: true, create: true, update: true, delete: false, export: false, import: false },
      apps: { staff: true },
    },
  },
  {
    slug: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to records and pages.',
    systemActions: [],
    dataGrants: {
      pages: { view: true, edit: false },
      tables: { read: true, create: false, update: false, delete: false, export: false, import: false },
      apps: { staff: true },
    },
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

/** The ledger key's own spelling, so the two readers cannot disagree about it. */
const SEEDED_ROLE_GRANTS_KEY = 'system.seededRoleGrants';

/** One ledger entry: the role that was given a key, and the key. */
function grantPair(roleSlug: string, action: SystemActionKey): string {
  return `${roleSlug}:${action}`;
}

/**
 * Seed the built-in roles and their permission baselines. Idempotent
 * natural-key upserts: existing roles are left untouched (user renames of
 * non-super-admin built-ins survive), and user permission edits survive
 * upgrades.
 *
 * SEEDED ONCE, NOT ENFORCED FOREVER. This used to grant any listed key whose
 * permission row was MISSING, which made a revocation last exactly until the
 * next restart: Team → Roles revokes by deleting that row, and the next boot
 * put it straight back. So the question asked here is "has this pair ever been
 * seeded?", answered by a ledger of `<role>:<key>` strings, rather than "is it
 * there right now?". A revocation survives; a key a later version adds still
 * reaches an existing install, because its pair has never been seeded.
 *
 * On the FIRST boot that knows about the ledger it is empty, so this behaves
 * exactly as it always did — every listed pair whose row is missing is granted
 * — and records what it found. That one boot cannot tell a key an operator
 * revoked from one that was never granted at all, and the alternative reading
 * (adopt everything, grant nothing) would permanently strand the keys added
 * between an old install's version and this one.
 */
export async function seedBuiltinRoles(meta: MetaDb, at: number = Date.now()): Promise<{ createdRoles: string[] }> {
  const roles = rolesRepo(meta);
  const permissions = permissionsRepo(meta);
  const settings = settingsRepo(meta);
  const createdRoles: string[] = [];

  const seeded = new Set(await settings.get(SEEDED_ROLE_GRANTS_KEY));
  const before = seeded.size;

  for (const def of BUILTIN_ROLES) {
    let role: Role | null = await roles.findBySlug(def.slug);
    let roleIsNew = false;
    if (!role) {
      role = await roles.create(
        { slug: def.slug, name: def.name, description: def.description, isBuiltin: true },
        at,
      );
      createdRoles.push(def.slug);
      roleIsNew = true;
    }
    for (const action of def.systemActions) {
      const pair = grantPair(def.slug, action);
      // A role row that did not exist a moment ago has been given nothing,
      // whatever the ledger remembers about an older row of the same name.
      if (!roleIsNew && seeded.has(pair)) continue;
      const existing = await permissions.find(role.id, 'system', action);
      if (!existing) {
        await permissions.grant(role.id, 'system', action, { allowed: true });
      }
      seeded.add(pair);
    }
    if (def.dataGrants !== undefined) {
      const rows: { kind: 'page' | 'table' | 'app'; ref: string; actions: PermissionActions }[] = [
        { kind: 'page', ref: ALL_PAGES_REF, actions: def.dataGrants.pages },
        { kind: 'table', ref: ALL_TABLES_REF, actions: def.dataGrants.tables },
        // Every app's staff screens, as every signed-in role could before the grant existed.
        ...(def.dataGrants.apps === undefined ? [] : [{ kind: 'app' as const, ref: ALL_APPS_REF, actions: def.dataGrants.apps }]),
      ];
      for (const row of rows) {
        // `<role>:<kind>:<ref>` — a system key never holds a colon, so these
        // cannot collide with a `<role>:<key>` pair.
        const pair = `${def.slug}:${row.kind}:${row.ref}`;
        if (!roleIsNew && seeded.has(pair)) continue;
        // An operator's own row for the same wildcard wins: this seeds a
        // default, it never overwrites a choice.
        const existing = await permissions.find(role.id, row.kind, row.ref);
        if (!existing) await permissions.grant(role.id, row.kind, row.ref, row.actions);
        seeded.add(pair);
      }
    }
  }

  if (seeded.size !== before) {
    await settings.set(SEEDED_ROLE_GRANTS_KEY, [...seeded].sort(), { at });
  }
  return { createdRoles };
}

/**
 * Seed the `system.*` settings keys. Only system identity keys are written —
 * behavioral settings stay unset so a fresh install resolves to registry
 * defaults (indigo / system theme / en_US) without a settings row.
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
 * Safe to run at every boot.
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
 * bootstrap. See the registry entry for why it exists.
 */
const SUPER_ADMIN_CLAIM_KEY = 'system.superAdminCreatedAt';

/**
 * Create the very first user and grant `super-admin`. This is the entire
 * attack surface of a self-hosted first boot, so it is once-only by
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
 * Zero users AND an unclaimed bootstrap ⇒ setup mode: the server serves only
 * /setup/*.
 *
 * The claim is checked as well as the user count so that bootstrap is
 * PERMANENTLY closed once it has run: deleting every user later must not
 * re-open an unauthenticated super-admin-creation endpoint.
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
