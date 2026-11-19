// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which source databases a trial or hosted installation may connect to.
 *
 * Its Super Admin is a stranger on the operator's servers, so three rules hold
 * on every way a source DSN is dialled (the connection manager runs them before
 * any lookup):
 *
 *   - no SQLite file: a path on the operator's disk, whatever folder it names;
 *   - only the hosts on `ADMINIUM_DATABASE_HOSTS`: the list is the operator's
 *     word on what this installation may reach, so a host not on it is refused
 *     even when it is on the internet. A MySQL source passes only when a
 *     listed entry takes MySQL's host and port;
 *   - besides the list, the user's own host (`ADMINIUM_DATABASE_USER_HOST`),
 *     only while `ADMINIUM_YOUR_DATABASE` is set and only on a database port
 *     (`connections/user-host.ts`). It is never listed: the guard holds it to
 *     public addresses on every lookup (`connections/dsn.ts`);
 *   - on an operator host (a listed host that is not the person's own
 *     Supabase project, or the user host found at one's address), only the
 *     login the operator gave this installation:
 *     the user and database of `ADMINIUM_SOURCE_URL`. The operator's database
 *     server holds every trial's database; another login there is someone
 *     else's, however it was learnt. With no `ADMINIUM_SOURCE_URL`, no login
 *     on an operator host is allowed.
 */
import { isIP } from 'node:net';

import { databaseHostListed, parseDsn, type DatabaseHost, type ParsedDsn } from '../connections/dsn.js';
import { isUserHost, userPortRefusal, type UserHost } from '../connections/user-host.js';
import { canonicalHost, systemLookup, type HostLookup } from '../net/address-guard.js';
import { OffByOperatorError } from './refuse.js';
import type { TrialPolicy } from './policy.js';

/** A person's own Supabase project: its pooler and its direct host. Never an operator host. */
const OWN_PROJECT_SUFFIXES = ['.supabase.com', '.supabase.co'] as const;

/** Whether `host` is a Supabase project's address, which belongs to the person who connects it. */
export function isOwnSupabaseHost(host: string): boolean {
  const name = canonicalHost(host).replace(/\.$/, '');
  return OWN_PROJECT_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** The user and database a login on an operator host must have: `ADMINIUM_SOURCE_URL`'s. Null when it is unset or names neither. */
export function operatorLoginOf(sourceUrl: string | undefined): { user: string; database: string } | null {
  if (sourceUrl === undefined || sourceUrl === '') return null;
  let parsed: ParsedDsn;
  try {
    parsed = parseDsn(sourceUrl);
  } catch {
    return null;
  }
  if (parsed.scheme === 'sqlite' || parsed.user === null || parsed.database === null) return null;
  return { user: parsed.user, database: databaseName(parsed.database) };
}

/** The database as the driver reads it: the path decoded. A spelling that does not decode matches nothing. */
function databaseName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return `\u0000${raw}`;
  }
}

export interface TrialSourceRules {
  policy: Pick<TrialPolicy, 'allows'>;
  /** `ADMINIUM_DATABASE_HOSTS`, as parsed. */
  hosts: readonly DatabaseHost[];
  /** {@link operatorLoginOf} `ADMINIUM_SOURCE_URL`. */
  operatorLogin: { user: string; database: string } | null;
  /** `ADMINIUM_DATABASE_USER_HOST` while `ADMINIUM_YOUR_DATABASE` is set; null otherwise. */
  userHost?: UserHost | null | undefined;
}

/** Whether the profile holds sources to the operator's word at all (trial and hosted mode). */
export function sourcesHeld(rules: Pick<TrialSourceRules, 'policy'>): boolean {
  return !rules.policy.allows('unlistedDatabaseHosts').allowed;
}

/** Whether a parsed DSN is on the user host, where the profile allows one. */
export function onUserHost(parsed: Pick<ParsedDsn, 'host' | 'port'>, rules: Pick<TrialSourceRules, 'policy' | 'userHost'>): boolean {
  return sourcesHeld(rules) && isUserHost(rules.userHost, parsed.host, parsed.port);
}

/** The login rule, for a DSN on an operator host. Throws 403 `OFF_BY_OPERATOR`. */
function assertOperatorLogin(parsed: ParsedDsn, rules: TrialSourceRules): void {
  const answer = rules.policy.allows('anyDatabaseLogin');
  if (answer.allowed) return;
  const login = rules.operatorLogin;
  if (login !== null && parsed.user === login.user && parsed.database !== null && databaseName(parsed.database) === login.database) return;
  throw new OffByOperatorError(
    'anyDatabaseLogin',
    answer.reason ?? 'trial-mode',
    'On this database host, this installation may use only the login and database its operator gave it.',
  );
}

/**
 * The user host found at an operator host's address counts as that operator
 * host for the login rule: another name for the operator's database server is
 * still the operator's. `addresses` are the ones the guard passed for the user
 * host; each listed host that is a name is looked up (a wildcard cannot be),
 * an address is compared as written. Throws 403 `OFF_BY_OPERATOR`.
 */
export async function assertUserHostNotOperator(
  parsed: ParsedDsn,
  addresses: readonly string[],
  rules: TrialSourceRules,
  lookup: HostLookup = systemLookup,
): Promise<void> {
  if (addresses.length === 0 || rules.policy.allows('anyDatabaseLogin').allowed) return;
  const mine = new Set(addresses.map((address) => canonicalHost(address)));
  for (const entry of rules.hosts) {
    if (entry.wildcard || isOwnSupabaseHost(entry.host)) continue;
    let theirs: readonly string[];
    try {
      theirs = isIP(entry.host) !== 0 ? [entry.host] : await lookup(entry.host);
    } catch {
      continue;
    }
    if (theirs.some((address) => mine.has(canonicalHost(address)))) {
      assertOperatorLogin(parsed, rules);
      return;
    }
  }
}

/** Refuse a parsed source DSN the profile does not allow. Throws 403 `OFF_BY_OPERATOR`; does nothing on an ordinary server. */
export function assertTrialSourceAllowed(parsed: ParsedDsn, rules: TrialSourceRules): void {
  if (parsed.scheme === 'sqlite') {
    const answer = rules.policy.allows('sqliteSources');
    if (!answer.allowed) {
      throw new OffByOperatorError('sqliteSources', answer.reason ?? 'trial-mode', 'This installation does not open SQLite files. Connect a database on one of the hosts the operator allows.');
    }
    return;
  }
  if (onUserHost(parsed, rules)) {
    const problem = parsed.port === null ? 'names no port' : userPortRefusal(parsed.port);
    if (problem !== null) {
      throw new OffByOperatorError('unlistedDatabaseHosts', rules.policy.allows('unlistedDatabaseHosts').reason ?? 'trial-mode', `This installation does not connect to that port: it ${problem}.`);
    }
    return;
  }
  const listed = databaseHostListed(rules.hosts, parsed);
  if (!listed) {
    const answer = rules.policy.allows('unlistedDatabaseHosts');
    if (!answer.allowed) {
      throw new OffByOperatorError(
        'unlistedDatabaseHosts',
        answer.reason ?? 'trial-mode',
        `This installation connects only to the database hosts its operator allows, and ${parsed.host ?? 'this host'}${parsed.port === null ? '' : `:${String(parsed.port)}`} is not one of them.`,
      );
    }
    return;
  }
  if (parsed.host === null || isOwnSupabaseHost(parsed.host)) return;
  assertOperatorLogin(parsed, rules);
}
