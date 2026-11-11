// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DSN parsing, masking, and the connection-string SSRF guard. Scheme
 * allowlist `postgres|mysql|sqlite`, and a query-parameter allowlist per
 * engine so the string names one host only; cloud-metadata addresses are always
 * refused. Loopback blocking is production-only by default — a DB on the
 * same box is the normal self-host case (`ADMINIUM_NETWORK_POLICY=strict`
 * tightens it further at M15). A production server reaches a source on its own
 * loopback only when the operator names that host and port in
 * `ADMINIUM_DATABASE_HOSTS` ({@link DatabaseHost}).
 */

import { isIP } from 'node:net';

import { AppError, ValidationFailedError } from '../errors.js';
import { addressKind } from '../llm/outbound.js';

export interface ParsedDsn {
  scheme: 'postgres' | 'mysql' | 'sqlite';
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  /** SQLite: the file path. */
  file: string | null;
}

const SCHEME_ALIASES: Readonly<Record<string, ParsedDsn['scheme']>> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  sqlite: 'sqlite',
  file: 'sqlite',
};

const DEFAULT_PORTS: Readonly<Record<ParsedDsn['scheme'], number | null>> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: null,
};

/** Split a DSN into its parts without judging its parameters (masking, comparison). */
function readDsn(dsn: string): { parsed: ParsedDsn; url: URL | null } {
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(dsn);
  const rawScheme = schemeMatch?.[1]?.toLowerCase();
  const scheme = rawScheme === undefined ? undefined : SCHEME_ALIASES[rawScheme];
  if (scheme === undefined) {
    throw new ValidationFailedError('Unsupported DSN scheme — postgres, mysql, or sqlite only.', {
      allowed: ['postgres', 'mysql', 'sqlite'],
    });
  }
  if (scheme === 'sqlite') {
    const file = dsn.replace(/^(sqlite:\/\/|sqlite:|file:)/i, '');
    return { parsed: { scheme, host: null, port: null, database: null, user: null, file }, url: null };
  }
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new ValidationFailedError('Malformed DSN.', {});
  }
  const port = url.port.length > 0 ? Number(url.port) : DEFAULT_PORTS[scheme];
  return {
    parsed: {
      scheme,
      host: url.hostname.length > 0 ? url.hostname : null,
      port,
      database: url.pathname.replace(/^\//, '') || null,
      user: url.username.length > 0 ? decodeURIComponent(url.username) : null,
      file: null,
    },
    url,
  };
}

/**
 * The query parameters a DSN may carry, per engine. Anything else is refused.
 *
 * The drivers copy query parameters into their config, and several of them
 * outrank the URL: `pg` dials `?host=` and `?port=` in place of the host the
 * guard checked (a unix socket too, `?host=/var/run/postgresql`) and reads
 * `sslcert`, `sslkey` and `sslrootcert` from disk; `mysql2` dials
 * `?socketPath=` and takes `flags`, `localAddress` and `multipleStatements`.
 * So the guard cannot check "the host" unless the string can name only one.
 * The lists hold what managed providers and ORMs put in the strings they hand
 * out (Neon's `channel_binding`, Prisma's `schema` and `pgbouncer`), none of
 * which moves the connection elsewhere.
 */
const ALLOWED_PARAMETERS: Readonly<Record<'postgres' | 'mysql', ReadonlySet<string>>> = {
  postgres: new Set([
    'sslmode',
    'ssl',
    'sslnegotiation',
    'channel_binding',
    'uselibpqcompat',
    'application_name',
    'fallback_application_name',
    'connect_timeout',
    'options',
    'search_path',
    'pgbouncer',
    'schema',
    'connection_limit',
    'pool_timeout',
    'sslaccept',
  ]),
  // Prisma's `sslaccept`, `connection_limit` and `pool_timeout` are not mysql2 options: it warns and ignores them.
  mysql: new Set(['ssl', 'sslmode', 'charset', 'timezone', 'connectTimeout', 'sslaccept', 'connection_limit', 'pool_timeout']),
};

const PG_SSLMODES = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify']);
const PG_SSL_FLAGS = new Set(['true', 'false', '1', '0', 'no-verify']);

/**
 * mysql2 parses `?ssl=` as JSON when it can. A profile name or a bare boolean
 * passes; an object may only switch certificate checking, because every other
 * TLS option it could carry (`ca`, `servername`, `checkServerIdentity`) changes
 * what the connection trusts or where it believes it is.
 */
function mysqlSslAllowed(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return true; // a profile name: mysql2 refuses an unknown one itself
  }
  if (typeof parsed === 'boolean') return true;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return Object.entries(parsed).every(([key, v]) => key === 'rejectUnauthorized' && typeof v === 'boolean');
}

function assertDsnParameters(scheme: 'postgres' | 'mysql', url: URL): void {
  const allowed = ALLOWED_PARAMETERS[scheme];
  for (const [name, value] of url.searchParams) {
    if (!allowed.has(name)) {
      throw new ValidationFailedError(
        `The connection string's "${name}" parameter is not allowed. Remove it from the string; the host, port and database go before the "?".`,
        { parameter: name, allowed: [...allowed] },
      );
    }
    const valueOk =
      scheme === 'postgres'
        ? (name !== 'sslmode' || PG_SSLMODES.has(value)) && (name !== 'ssl' || PG_SSL_FLAGS.has(value))
        : name !== 'ssl' || mysqlSslAllowed(value);
    if (!valueOk) {
      throw new ValidationFailedError(`The connection string's "${name}" parameter has a value that is not allowed.`, {
        parameter: name,
      });
    }
  }
  // Both drivers percent-decode the host before they dial it, so
  // `%31%32%37.0.0.1` reaches 127.0.0.1 and `%2Fvar%2Frun%2Fpostgresql` a unix
  // socket while the guard reads neither. No real host name needs a `%`.
  if (url.hostname.includes('%')) {
    throw new ValidationFailedError('The connection string\'s host may not be percent-encoded.', {});
  }
}

/** Parse + allowlist a DSN; throws 422 `VALIDATION_FAILED` outside the grammar. */
export function parseDsn(dsn: string): ParsedDsn {
  const { parsed, url } = readDsn(dsn);
  if (url !== null && parsed.scheme !== 'sqlite') assertDsnParameters(parsed.scheme, url);
  return parsed;
}

/**
 * The host as the system resolver will read it. `getaddrinfo` takes the old
 * inet_aton spellings (`2852039166`, `0xa9fea9fe`, `127.1`, `0177.0.0.1`) and
 * IPv4 inside IPv6 (`::ffff:169.254.169.254`), and a `postgres:`/`mysql:` URL
 * keeps its host exactly as written. The WHATWG parser for an http URL turns
 * every one of those into the plain address, so the checks below see what the
 * driver will dial. A name that is not an address comes back lower-cased.
 */
export function canonicalHost(host: string): string {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, '');
  try {
    const wrapped = bare.includes(':') ? `[${bare}]` : bare;
    return new URL(`http://${wrapped}/`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return bare;
  }
}

export interface DsnGuardOptions {
  /** Default: `NODE_ENV === 'production'` at the call site. */
  blockLoopback?: boolean | undefined;
}

const METADATA_NAME = 'metadata.google.internal';

/** What the guard knows about a host from how it is written: no lookup. */
function classifyHost(host: string): { host: string; metadata: boolean; loopback: boolean } {
  const h = canonicalHost(host);
  const name = h.replace(/\.$/, '');
  const kind = isIP(h) === 0 ? null : addressKind(h);
  return {
    host: h,
    metadata: kind === 'metadata' || name === METADATA_NAME,
    loopback: kind === 'loopback' || name === 'localhost' || name.endsWith('.localhost'),
  };
}

/**
 * Shared outbound-host SSRF guard. Cloud-metadata endpoints (169.254.0.0/16,
 * IPv6 link-local, metadata.google.internal, the AWS IPv6 IMDS fd00:ec2::254)
 * are ALWAYS blocked — that is the credential-theft target; loopback is
 * blocked only per {@link DsnGuardOptions}. The host is read as the resolver
 * reads it ({@link canonicalHost}). Used for both source DSNs and any
 * user-configurable outbound URL (e.g. the LLM provider baseUrl). Throws 422.
 */
export function assertOutboundHostAllowed(host: string, opts: DsnGuardOptions = {}): void {
  const h = classifyHost(host);
  if (h.metadata) {
    throw new ValidationFailedError('Host resolves to a blocked address range.', { host: h.host });
  }
  if (h.loopback && opts.blockLoopback === true) {
    throw new ValidationFailedError('Loopback hosts are not allowed in production.', { host: h.host });
  }
}

/**
 * One `ADMINIUM_DATABASE_HOSTS` entry: a database host a production server may
 * reach although it is on loopback. Source connections only (data and
 * introspect DSNs, the `ADMINIUM_SOURCE_URL` seed, a project's databases),
 * never the meta store, storage, webhooks or AI addresses.
 *
 * Host AND port, because loopback on a one-server install is every service on
 * the box: naming `localhost:5432` lets Postgres through and leaves Redis on
 * 6379 and the box's own admin ports refused. A cloud-metadata address is never
 * an entry ({@link parseDatabaseHost} refuses it) and never passes the guard
 * even if a list holds one.
 */
export interface DatabaseHost {
  /** Lowercase, no trailing dot, no IPv6 brackets, as the resolver reads it. A wildcard's suffix after `*.`. */
  host: string;
  /** Null: the engine's own port (5432 / 3306), decided when a DSN is matched. */
  port: number | null;
  /** `*.suffix`: any name under the suffix (not the suffix itself, never an address). */
  wildcard: boolean;
}

export type DatabaseHostParse = { ok: true; entry: DatabaseHost } | { ok: false; reason: 'invalid' | 'metadata' };

/** A name's label; `_` is allowed because Docker service and container names carry it. */
const HOST_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

/**
 * Read one `host[:port]` entry: a name, an IPv4 address, an IPv6 address (in
 * brackets when it has a port), or `*.suffix` with at least two labels after
 * the `*.` (the `ADMINIUM_CSP_IMG_HOSTS` rule: `*.com` is not a host).
 */
export function parseDatabaseHost(raw: string): DatabaseHostParse {
  const invalid = { ok: false, reason: 'invalid' } as const;
  const text = raw.trim().toLowerCase();
  let host: string;
  let portText: string | undefined;
  let wildcard = false;
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/.exec(text);
  if (bracketed !== null) {
    host = bracketed[1] ?? '';
    portText = bracketed[2];
    if (isIP(host) !== 6) return invalid;
  } else if ((text.match(/:/g) ?? []).length > 1) {
    // A bare IPv6 address takes no port: `::1:5432` is an address, not `::1` port 5432.
    host = text;
    if (isIP(host) !== 6) return invalid;
  } else {
    const match = /^(\*\.)?([a-z0-9_.-]+)(?::(\d{1,5}))?$/.exec(text);
    if (match === null) return invalid;
    wildcard = match[1] !== undefined;
    host = (match[2] ?? '').replace(/\.$/, '');
    portText = match[3];
    const labels = host.split('.');
    if (!labels.every((label) => HOST_LABEL.test(label))) return invalid;
    // `*.0.0.1` would read as every address ending in .0.0.1.
    if (wildcard && (labels.length < 2 || /^\d+$/.test(labels.at(-1) ?? ''))) return invalid;
  }
  const port = portText === undefined ? null : Number(portText);
  if (port !== null && (port < 1 || port > 65535)) return invalid;
  if (wildcard) {
    if (METADATA_NAME.endsWith(`.${host}`)) return { ok: false, reason: 'metadata' };
    return { ok: true, entry: { host, port, wildcard } };
  }
  const h = classifyHost(host);
  if (h.metadata) return { ok: false, reason: 'metadata' };
  return { ok: true, entry: { host: h.host.replace(/\.$/, ''), port, wildcard } };
}

/**
 * Whether a parsed DSN's host and port are on the list. Read from the parsed
 * DSN, whose parameters {@link parseDsn} has already held to the allow-list,
 * so the host matched is the one the driver dials: a `?host=` cannot sit
 * behind a listed name.
 */
export function databaseHostListed(
  hosts: readonly DatabaseHost[] | undefined,
  parsed: Pick<ParsedDsn, 'scheme' | 'host' | 'port'>,
): boolean {
  if (hosts === undefined || hosts.length === 0 || parsed.host === null || parsed.scheme === 'sqlite') return false;
  const defaultPort = DEFAULT_PORTS[parsed.scheme];
  const host = canonicalHost(parsed.host).replace(/\.$/, '');
  const port = parsed.port ?? defaultPort;
  const address = isIP(host) !== 0;
  return hosts.some(
    (entry) =>
      (entry.port ?? defaultPort) === port &&
      (entry.wildcard ? !address && host.endsWith(`.${entry.host}`) : host === entry.host),
  );
}

/** `localhost:5432`, `[::1]:5432`: the entry that would list this DSN's host and port. */
function databaseHostEntry(parsed: ParsedDsn): string {
  const host = canonicalHost(parsed.host ?? '').replace(/\.$/, '');
  const port = parsed.port ?? DEFAULT_PORTS[parsed.scheme];
  return `${host.includes(':') ? `[${host}]` : host}:${String(port)}`;
}

/**
 * The `ADMINIUM_DATABASE_HOSTS` entry a DSN on loopback still needs, or null
 * when it needs none (not loopback, already listed, SQLite, or not a DSN at
 * all: those are someone else's error). For the boot's fail-fast row.
 */
export function unlistedLoopbackEntry(dsn: string, hosts: readonly DatabaseHost[] | undefined): string | null {
  let parsed: ParsedDsn;
  try {
    parsed = parseDsn(dsn);
  } catch {
    return null;
  }
  if (parsed.scheme === 'sqlite' || parsed.host === null) return null;
  const h = classifyHost(parsed.host);
  if (h.metadata || !h.loopback || databaseHostListed(hosts, parsed)) return null;
  return databaseHostEntry(parsed);
}

/**
 * SSRF guard for a user-configurable outbound http(s) URL — the LLM provider
 * baseUrl (openai-compatible accepts an arbitrary one). Rejects non-http(s)
 * schemes and applies {@link assertOutboundHostAllowed}. Throws 422.
 */
export function guardOutboundUrl(rawUrl: string, opts: DsnGuardOptions = {}): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationFailedError('Invalid URL.', { url: rawUrl });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationFailedError('Only http and https URLs are allowed.', { protocol: url.protocol });
  }
  assertOutboundHostAllowed(url.hostname, opts);
}

export interface DsnCheckOptions extends DsnGuardOptions {
  /**
   * The engine the string will be handed to. The drivers do not look at the
   * scheme: `pg` and `mysql2` read a `sqlite:` string as a URL and dial its
   * host and parameters, which the guard skips for SQLite. So a string whose
   * scheme names a different engine is refused.
   */
  engine?: string | undefined;
  /**
   * `ADMINIUM_DATABASE_HOSTS`: a host and port on this list passes the loopback
   * check. Never the metadata check.
   */
  databaseHosts?: readonly DatabaseHost[] | undefined;
}

/**
 * The SSRF guard, run before any dial. Cloud-metadata is always blocked;
 * loopback per {@link DsnGuardOptions}, unless the host and port are on
 * `databaseHosts`; a scheme that does not match the engine is refused.
 * Throws 422.
 */
export function guardDsn(dsn: string, opts: DsnCheckOptions = {}): ParsedDsn {
  const parsed = parseDsn(dsn);
  if (opts.engine !== undefined && parsed.scheme !== opts.engine) {
    throw new ValidationFailedError(
      `This is a ${parsed.scheme} connection string, but the connection is for ${opts.engine}. Use a ${opts.engine} string, or pick ${parsed.scheme} as the engine.`,
      { scheme: parsed.scheme, engine: opts.engine },
    );
  }
  if (parsed.scheme === 'sqlite') return parsed;
  // No host means the driver's default, which is this machine.
  if (parsed.host === null && opts.blockLoopback === true) {
    throw new ValidationFailedError('The connection string names no host.', {});
  }
  const h = classifyHost(parsed.host ?? '');
  if (h.metadata) {
    throw new ValidationFailedError('Host resolves to a blocked address range.', { host: h.host });
  }
  if (h.loopback && opts.blockLoopback === true && !databaseHostListed(opts.databaseHosts, parsed)) {
    const entry = databaseHostEntry(parsed);
    throw new ValidationFailedError(
      `Loopback hosts are not allowed in production. If this database runs on this server, add ${entry} to ADMINIUM_DATABASE_HOSTS.`,
      { host: h.host, port: parsed.port, variable: 'ADMINIUM_DATABASE_HOSTS', entry },
    );
  }
  return parsed;
}

/** `postgres://ava:secret@db.acme.io:5432/prod` → `postgres://ava@db.acme.io:5432/prod`. */
export function maskDsn(dsn: string | null): string | null {
  if (dsn === null) return null;
  let parsed: ParsedDsn;
  try {
    parsed = readDsn(dsn).parsed;
  } catch {
    return null; // never leak an unparseable (possibly credentialed) string
  }
  if (parsed.scheme === 'sqlite') return `sqlite:${parsed.file ?? ''}`;
  const auth = parsed.user === null ? '' : `${parsed.user}@`;
  const port = parsed.port === null ? '' : `:${String(parsed.port)}`;
  const db = parsed.database === null ? '' : `/${parsed.database}`;
  return `${parsed.scheme}://${auth}${parsed.host ?? ''}${port}${db}`;
}

/**
 * True when two DSNs point at the same physical database (host+port+db, or
 * the same SQLite file) — drives the meta-placement same-db check.
 */
export function sameDatabase(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  let pa: ParsedDsn;
  let pb: ParsedDsn;
  try {
    pa = readDsn(a).parsed;
    pb = readDsn(b).parsed;
  } catch {
    return false;
  }
  if (pa.scheme !== pb.scheme) return false;
  if (pa.scheme === 'sqlite') return pa.file !== null && pa.file === pb.file;
  const hostA = pa.host?.toLowerCase() ?? '';
  const hostB = pb.host?.toLowerCase() ?? '';
  const localA = hostA === 'localhost' || hostA === '127.0.0.1' ? 'localhost' : hostA;
  const localB = hostB === 'localhost' || hostB === '127.0.0.1' ? 'localhost' : hostB;
  return localA === localB && pa.port === pb.port && pa.database === pb.database;
}

/** 409 `META_PLACEMENT_INVALID` (enforced server-side). */
export class MetaPlacementError extends AppError {
  override readonly name = 'MetaPlacementError';

  constructor(message: string, details?: unknown) {
    super(409, 'META_PLACEMENT_INVALID', message, details);
  }
}

/**
 * 409 `META_PREFIX_COLLISION` — the meta store points at a database that
 * ALREADY contains `adminium_*` tables Adminium did not create.
 *
 * The sibling of {@link MetaPlacementError}: both refuse a meta-store PLACEMENT
 * before anything is written, and both exist because the alternative is a
 * failure the operator cannot read. Placement's alternative is a migration that
 * dies on a permission error; this one's is a `CREATE TABLE adminium_users`
 * landing on somebody else's `adminium_users` — a mid-migration DDL error naming
 * one table, from a runner that has already committed the migrations before it
 * (is up-only, so there is no rollback to a clean state).
 *
 * Thrown by `ConnectionManager.assertMetaPrefixAvailable`, which is where the
 * remedy lives too — see that method for why the ledger is the discriminator.
 */
export class MetaPrefixCollisionError extends AppError {
  override readonly name = 'MetaPrefixCollisionError';

  constructor(message: string, details?: unknown) {
    super(409, 'META_PREFIX_COLLISION', message, details);
  }
}
