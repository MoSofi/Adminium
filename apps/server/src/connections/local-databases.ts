// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Allow databases on this server": whether a production server's source
 * connections may reach any database on its own loopback.
 *
 * Production refuses loopback (`dsn.ts`), because with host networking it is
 * every service on the box. The operator can name the one database it runs
 * there (`ADMINIUM_DATABASE_HOSTS`); this switch is the other way in, for the
 * person who set Postgres up next to Adminium and administers both. It is two
 * hands, as the live Designer is (`designer/live.ts`): the operator lets the
 * switch exist (`ADMINIUM_LOCAL_DATABASES=setting`, the default, or `off`), and
 * a Super Admin switches it on with their password.
 *
 *   on      any loopback host and port passes for SOURCE connections (data and
 *           introspect strings, a project's databases), as a listed entry
 *           does. The cloud-metadata check still applies, and nothing else
 *           reads it: webhooks, storage, AI and meta-store URLs keep their own
 *           rules. The `ADMINIUM_SOURCE_URL` seed is checked at boot against
 *           the list alone: a boot does not depend on a switch in the store.
 *   off     the operator's list alone.
 *   locked  `ADMINIUM_LOCAL_DATABASES=off`: off whatever the setting holds.
 *
 * The setting (`connections.allowLocalDatabases`) is not portable: no bundle,
 * archive or import may switch it on on another machine.
 */
import { settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { settingLock, type LockReason } from '../trial/operator-lock.js';
import { ORDINARY_POLICY, type TrialPolicy } from '../trial/policy.js';
import type { DatabaseHost } from './dsn.js';

export type LocalDatabasesMode = 'setting' | 'off';
/**
 * Why it cannot be switched on: the operator's lock ("Set by the operator",
 * `trial/operator-lock.ts`). `not-allowed` is `ADMINIUM_LOCAL_DATABASES=off`;
 * `trial-mode` / `hosted-mode` is the profile, which locks it whatever that says.
 */
export type LocalDatabasesReason = LockReason;

export interface LocalDatabasesState {
  /** The operator lets the switch exist (`ADMINIUM_LOCAL_DATABASES` is not `off`). */
  allowed: boolean;
  /** Switched on, and counted. */
  on: boolean;
  /** Why it cannot be switched on. */
  reason: LocalDatabasesReason | null;
  /** `ADMINIUM_DATABASE_HOSTS`, as entries: what the locked card names. */
  hosts: string[];
  /** Who switched it on, and when, while it is on. */
  turnedOn: { by: string; at: number } | null;
  /** This server never refuses loopback (the desktop app, `adminium dev`): the switch changes nothing here. */
  loopbackAllowed: boolean;
}

/**
 * What the operator decided. Under trial mode or the hosted profile the parsed
 * environment already holds `off` (`enforceProfile`, `config/env.ts`), and an
 * explicit `setting` with either fails the boot (`profileIssues`).
 */
export function localDatabasesMode(env: { ADMINIUM_LOCAL_DATABASES?: LocalDatabasesMode | undefined }): LocalDatabasesMode {
  return env.ADMINIUM_LOCAL_DATABASES ?? 'setting';
}

/** `localhost:5432`, `[::1]:5432`, `*.pooler.supabase.com:6543`, `postgres`: an entry as the operator would write it. */
export function databaseHostText(entry: DatabaseHost): string {
  const host = entry.wildcard ? `*.${entry.host}` : entry.host.includes(':') ? `[${entry.host}]` : entry.host;
  if (entry.port !== null) return `${host}:${String(entry.port)}`;
  // A bare IPv6 address reads without brackets when it has no port, as the list takes it.
  return entry.wildcard ? host : entry.host;
}

/** The switch as the store holds it: off when the operator locked it, whatever it holds. */
export async function readLocalDatabases(meta: MetaDb, mode: LocalDatabasesMode): Promise<boolean> {
  if (mode === 'off') return false;
  return settingsRepo(meta).get('connections.allowLocalDatabases');
}

export interface LocalDatabasesDeps {
  meta: MetaDb;
  mode: LocalDatabasesMode;
  /** The profile's lock, which comes first (`trial/policy.ts`). Default: an ordinary server's. */
  policy?: Pick<TrialPolicy, 'allows'> | undefined;
  hosts: readonly DatabaseHost[] | undefined;
  /** Whether this server refuses loopback at all (production, not the desktop app). */
  loopbackRefused: boolean;
  /** Told every time the switch is read or changed: the connection manager's guard. */
  apply(on: boolean): void;
}

export interface LocalDatabases {
  state(): Promise<LocalDatabasesState>;
  /** At boot, and after a store that was not readable: what the guard counts. */
  load(): Promise<boolean>;
  /** Switch it, as `userId`. The reason it cannot be switched on, or null. */
  set(on: boolean, userId: string | null): Promise<LocalDatabasesReason | null>;
}

export function createLocalDatabases(deps: LocalDatabasesDeps): LocalDatabases {
  const lock = settingLock(deps.policy ?? ORDINARY_POLICY, 'connections.allowLocalDatabases', { envLocked: deps.mode === 'off' });
  const allowed = lock.allowed;
  // A profile locks it without the mode: read as off all the same.
  const mode: LocalDatabasesMode = allowed ? deps.mode : 'off';
  const hosts = (deps.hosts ?? []).map(databaseHostText);

  const row = async (): Promise<{ on: boolean; by: string | null; at: number } | null> => {
    const found = await deps.meta.db
      .selectFrom('adminium_settings')
      .select(['updatedBy', 'updatedAt'])
      .where('key', '=', 'connections.allowLocalDatabases')
      .executeTakeFirst();
    if (found === undefined) return null;
    return { on: await settingsRepo(deps.meta).get('connections.allowLocalDatabases'), by: found.updatedBy, at: found.updatedAt };
  };

  const load = async (): Promise<boolean> => {
    const on = await readLocalDatabases(deps.meta, mode);
    deps.apply(on);
    return on;
  };

  return {
    async state() {
      const on = await load();
      let turnedOn: LocalDatabasesState['turnedOn'] = null;
      if (on) {
        const stored = await row();
        if (stored !== null && stored.by !== null) {
          const user = await usersRepo(deps.meta).findById(stored.by);
          turnedOn = { by: user === null ? stored.by : user.name.trim() === '' ? user.email : user.name, at: stored.at };
        }
      }
      return { allowed, on, reason: lock.reason, hosts, turnedOn, loopbackAllowed: !deps.loopbackRefused };
    },
    load,
    async set(on, userId) {
      if (on && !allowed) return lock.reason ?? 'not-allowed';
      await settingsRepo(deps.meta).set('connections.allowLocalDatabases', on, { updatedBy: userId });
      deps.apply(allowed && on);
      return null;
    },
  };
}
