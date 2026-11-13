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
 *   - on an operator host (a listed host that is not the person's own
 *     Supabase project), only the login the operator gave this installation:
 *     the user and database of `ADMINIUM_SOURCE_URL`. The operator's database
 *     server holds every trial's database; another login there is someone
 *     else's, however it was learnt. With no `ADMINIUM_SOURCE_URL`, no login
 *     on an operator host is allowed.
 */
import { databaseHostListed, parseDsn, type DatabaseHost, type ParsedDsn } from '../connections/dsn.js';
import { canonicalHost } from '../net/address-guard.js';
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
