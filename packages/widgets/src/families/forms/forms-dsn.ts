// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The DSN grammar behind `connection-string-field` (annex §10) — PURE module
 * (zod-free, React-free, JSX-free, and deliberately free of user-visible copy).
 *
 * LIFTED FROM THE STUDIO WIZARD. This logic was born in
 * `apps/dashboard/src/studio/connect/wizardState.ts` (M9-T04); the wizard is now
 * a CONSUMER of this module rather than a second implementation. Two reasons:
 * `@adminium/widgets` may never import `apps/*` (so a shared rule has to live on
 * this side), and two ideas of "what is a valid DSN" would inevitably drift —
 * the wizard would reject a connection string this widget accepts, or vice
 * versa, and the user would be told their database is unreachable by one screen
 * and fine by another. The wizard keeps only what is wizard-specific: its
 * narrower 3-engine vocabulary, its host/port *fields* form (the inverse of this
 * grammar), and the copy it maps the codes below onto.
 *
 * LOCALE POLICY (04 §2): widgets are locale-agnostic, so validation returns a
 * CODE, never a message — the caller owns the copy. That is also what lets the
 * wizard keep its existing `t()` strings while sharing the RULE.
 *
 * ENGINE VOCABULARY: `allowed` is a parameter, not a constant, because the annex
 * makes `protocols` a config field ("postgres/mysql/mongodb/…") while Adminium
 * v1 connects to Postgres/MySQL/SQLite only. Parameterising it means the wizard
 * can keep rejecting `mongodb://` — which it cannot connect to — without forking
 * the grammar to do it.
 */

/** Every scheme family the DSN grammar can NAME (annex §10 `protocols`). */
export const DSN_ENGINES = ['postgres', 'mysql', 'sqlite', 'mongodb', 'mssql'] as const;
export type DsnEngine = (typeof DSN_ENGINES)[number];

/** DSN scheme → engine. Aliases collapse (`mariadb://` is a MySQL DSN). */
const SCHEME_ENGINES: ReadonlyArray<readonly [RegExp, DsnEngine]> = [
  [/^postgres(ql)?:\/\//i, 'postgres'],
  [/^mysql:\/\//i, 'mysql'],
  [/^mariadb:\/\//i, 'mysql'],
  [/^sqlite:/i, 'sqlite'],
  [/^mongodb(\+srv)?:\/\//i, 'mongodb'],
  [/^(mssql|sqlserver):\/\//i, 'mssql'],
];

/**
 * The engine a DSN names, or `null` when the scheme is unrecognised **or is not
 * in `allowed`**. Folding the allow-list in here (rather than validating it
 * separately) is what makes an out-of-scope scheme read as "unrecognised" to
 * every caller at once: for a host that cannot connect to Mongo, `mongodb://`
 * genuinely is an unrecognised scheme, not a valid DSN it happens to refuse.
 */
export function engineForDsn(dsn: string, allowed: readonly DsnEngine[] = DSN_ENGINES): DsnEngine | null {
  const trimmed = dsn.trim();
  for (const [pattern, engine] of SCHEME_ENGINES) {
    if (pattern.test(trimmed)) return allowed.includes(engine) ? engine : null;
  }
  return null;
}

/** Why a DSN is not usable yet. The caller maps these onto its own copy. */
export type DsnValidationCode = 'invalid-scheme' | 'incomplete';

/**
 * `null` when the DSN is usable (or still EMPTY — an untouched field is not an
 * error, and reporting one before the user has typed is just noise).
 */
export function dsnValidationCode(
  dsn: string,
  allowed: readonly DsnEngine[] = DSN_ENGINES,
): DsnValidationCode | null {
  const trimmed = dsn.trim();
  if (trimmed.length === 0) return null;
  if (engineForDsn(trimmed, allowed) === null) return 'invalid-scheme';
  // A bare `scheme://` parses as its engine but names no host or database.
  // (`sqlite:` is deliberately NOT caught: it is a path prefix, not an
  // authority, so `sqlite:` + a path is the complete form.)
  if (/^[a-z+]+:\/\/$/i.test(trimmed)) return 'incomplete';
  return null;
}

/** The example DSN shown as the input's placeholder, per engine. */
const DSN_PLACEHOLDERS: Record<DsnEngine, string> = {
  postgres: 'postgres://user:password@host:5432/database',
  mysql: 'mysql://user:password@host:3306/database',
  sqlite: 'sqlite:/absolute/path/app.db',
  mongodb: 'mongodb://user:password@host:27017/database',
  mssql: 'sqlserver://user:password@host:1433/database',
};

export function dsnPlaceholder(engine: DsnEngine): string {
  return DSN_PLACEHOLDERS[engine];
}

/**
 * The host a DSN points at (annex §10: "host parsing") — `null` for SQLite (a
 * file path has no host) and for anything unparseable.
 *
 * The authority's LAST `@` separates credentials from host, not the first: an
 * un-encoded `@` in a password is common in the wild, and splitting on the first
 * one would report the password's own tail as the hostname.
 */
export function dsnHost(dsn: string): string | null {
  const trimmed = dsn.trim();
  const engine = engineForDsn(trimmed);
  if (engine === null || engine === 'sqlite') return null;
  const afterScheme = trimmed.replace(/^[a-z+]+:\/\//i, '');
  const authority = afterScheme.split(/[/?#]/)[0] ?? '';
  const at = authority.lastIndexOf('@');
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  const host = hostPort.split(':')[0] ?? '';
  return host === '' ? null : host;
}

/**
 * Rewrite a DSN's scheme to match a newly picked engine. Network engines swap
 * schemes in place; to/from SQLite there is nothing meaningful to carry over (a
 * file path is not a host/port authority), so the input resets rather than
 * producing a `sqlite://user@host:5432/db` that cannot mean anything.
 *
 * `allowed` is threaded through to `engineForDsn` for the same reason every
 * other entry point takes it: an OUT-OF-SCOPE scheme must read as unrecognised,
 * so the DSN RESETS rather than being rewritten in place. Without it, a host
 * that only speaks Postgres/MySQL/SQLite would turn a pasted
 * `mongodb+srv://…@cluster0.mongodb.net/db` into a valid-LOOKING
 * `mysql://…@cluster0.mongodb.net/db` and send the user to "Test connection"
 * with a MySQL driver aimed at a Mongo host.
 */
export function dsnWithEngine(dsn: string, engine: DsnEngine, allowed: readonly DsnEngine[] = DSN_ENGINES): string {
  const trimmed = dsn.trim();
  if (trimmed.length === 0) return trimmed;
  const current = engineForDsn(trimmed, allowed);
  if (current === engine) return trimmed;
  if (current === null || current === 'sqlite' || engine === 'sqlite') return '';
  return trimmed.replace(/^[a-z+]+:\/\//i, `${engine}://`);
}

/** One quick-fill chip: a provider's DSN skeleton the user edits in place. */
export interface DsnProviderChip {
  key: string;
  label: string;
  engine: DsnEngine;
  dsn: string;
}

/**
 * Quick-fill provider chips (Adminium Console + Connect Database comps). The
 * placeholders are SHOUTED (`PASSWORD`, `PROJECT`) so a half-edited skeleton
 * cannot be mistaken for a working DSN.
 */
export const DSN_PROVIDER_CHIPS: readonly DsnProviderChip[] = [
  {
    key: 'supabase',
    label: 'Supabase',
    engine: 'postgres',
    dsn: 'postgres://postgres.PROJECT:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres',
  },
  {
    key: 'neon',
    label: 'Neon',
    engine: 'postgres',
    dsn: 'postgres://USER:PASSWORD@ep-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require',
  },
  {
    key: 'rds',
    label: 'RDS',
    engine: 'postgres',
    dsn: 'postgres://USER:PASSWORD@mydb.abc123.us-east-1.rds.amazonaws.com:5432/postgres',
  },
  { key: 'localhost', label: 'localhost', engine: 'postgres', dsn: 'postgres://postgres@localhost:5432/app_dev' },
  {
    key: 'planetscale',
    label: 'PlanetScale',
    engine: 'mysql',
    dsn: 'mysql://USER:PASSWORD@aws.connect.psdb.cloud/mydb?ssl={"rejectUnauthorized":true}',
  },
  {
    key: 'atlas',
    label: 'Atlas',
    engine: 'mongodb',
    dsn: 'mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/mydb',
  },
];

/**
 * The chips for one engine — shown only for the engine they belong to, so the
 * Postgres row stays Postgres-relevant (M9-T04). `allowed` additionally hides
 * chips for engines the host cannot connect to at all.
 */
export function providerChipsFor(engine: DsnEngine, allowed: readonly DsnEngine[] = DSN_ENGINES): DsnProviderChip[] {
  if (!allowed.includes(engine)) return [];
  return DSN_PROVIDER_CHIPS.filter((chip) => chip.engine === engine);
}
